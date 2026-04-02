// Async event loop for console mode.
//
// Bridges the blocking reedline loop with the Jupyter kernel via
// tokio::select! over shell, iopub, heartbeat, and request channels.
// Completion is handled directly by LspCompleter over TCP,
// so this loop manages execute requests, output, and disconnect detection.

use anyhow::{Context, Result};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;
use tracing::{debug, error, warn};

use runtimelib::{
    ClientControlConnection, ClientIoPubConnection,
    ExecuteRequest, ExecutionState, InterruptRequest, JupyterMessage, JupyterMessageContent,
};

use crate::connection::create_shell_connection;
use crate::heartbeat::{spawn_heartbeat_monitor, stop_heartbeat_monitor};

use super::output::{format_iopub_content, kernel_disconnect_message, ConsoleUiEvent};

const EXIT_AFTER_EXEC_TIMEOUT: Duration = Duration::from_secs(5);

/// Request sent from the reedline loop to the kernel loop.
pub(crate) enum ConsoleRequest {
    /// Execute R code.
    Execute(String),
    /// Execute R code and then exit the console (used for confirmed q()/quit()).
    ExecuteAndExit(String),
    /// Exit the console.
    Exit,
}

/// Run the async kernel event loop.
///
/// This function coordinates between:
/// - `request_rx`: execute/exit requests from the reedline loop
/// - `ui_event_tx`: real-time execution output and disconnect events back to the reedline loop
/// - Jupyter shell/iopub/control sockets
pub(crate) async fn run_kernel_loop(
    connection_info: &runtimelib::ConnectionInfo,
    session_id: &str,
    mut iopub: ClientIoPubConnection,
    mut request_rx: tokio::sync::mpsc::Receiver<ConsoleRequest>,
    ui_event_tx: std_mpsc::Sender<ConsoleUiEvent>,
    mut control: ClientControlConnection,
    mut interrupt_rx: tokio::sync::mpsc::Receiver<()>,
) -> Result<()> {
    debug!("Console kernel_loop: connecting to kernel");

    let mut shell = create_shell_connection(connection_info, session_id)
        .await
        .context("Failed to connect shell")?;

    let (mut heartbeat_disconnect_rx, heartbeat_handle) =
        spawn_heartbeat_monitor(connection_info.clone());

    debug!("Console kernel_loop: connected, entering event loop");

    // Track the current execute_request msg_id to correlate iopub output
    let mut current_exec_msg_id: Option<String> = None;
    // Whether to exit after the current execution completes (for q()/quit())
    let mut exit_after_exec = false;
    // Deadline for exit timeout — when q() kills Ark, ZMQ SUB sockets hang
    // forever (no close notification), so we need a safety timeout.
    let mut exit_deadline: Option<tokio::time::Instant> = None;

    loop {
        tokio::select! {
            // Handle execute/exit requests from the reedline loop
            request = request_rx.recv() => {
                match request {
                    Some(ConsoleRequest::ExecuteAndExit(code)) => {
                        exit_after_exec = true;
                        exit_deadline = Some(
                            tokio::time::Instant::now() + EXIT_AFTER_EXEC_TIMEOUT,
                        );
                        debug!(code_len = code.len(), exit_after = true, "Console kernel_loop: execute-and-exit request");
                        let execute_request = ExecuteRequest::new(code);
                        let message = JupyterMessage::new(execute_request, None);
                        let msg_id = message.header.msg_id.clone();
                        current_exec_msg_id = Some(msg_id);
                        if let Err(err) = shell.send(message).await {
                            error!(error = ?err, "Console kernel_loop: failed to send execute_request");
                            if handle_transport_disconnect(
                                &ui_event_tx,
                                "execute_request send failed",
                                &err,
                                current_exec_msg_id.is_some(),
                            ) {
                                break;
                            }
                            let _ = ui_event_tx.send(ConsoleUiEvent::Output(
                                format!("Error sending execute request: {}\n", err),
                            ));
                            let _ = ui_event_tx.send(ConsoleUiEvent::ExecutionDone);
                            break;
                        }
                    }
                    Some(ConsoleRequest::Execute(code)) => {
                        debug!(code_len = code.len(), "Console kernel_loop: execute request");
                        let execute_request = ExecuteRequest::new(code);
                        let message = JupyterMessage::new(execute_request, None);
                        let msg_id = message.header.msg_id.clone();
                        current_exec_msg_id = Some(msg_id);
                        if let Err(err) = shell.send(message).await {
                            error!(error = ?err, "Console kernel_loop: failed to send execute_request");
                            if handle_transport_disconnect(
                                &ui_event_tx,
                                "execute_request send failed",
                                &err,
                                current_exec_msg_id.is_some(),
                            ) {
                                break;
                            }
                            let _ = ui_event_tx.send(ConsoleUiEvent::Output(
                                format!("Error sending execute request: {}\n", err),
                            ));
                            let _ = ui_event_tx.send(ConsoleUiEvent::ExecutionDone);
                        }
                    }
                    Some(ConsoleRequest::Exit) | None => {
                        debug!("Console kernel_loop: exit requested");
                        break;
                    }
                }
            }

            disconnect_reason = heartbeat_disconnect_rx.recv() => {
                if let Some(disconnect_reason) = disconnect_reason {
                    warn!(
                        reason = %disconnect_reason,
                        execution_in_progress = current_exec_msg_id.is_some(),
                        "Console kernel_loop: heartbeat confirmed kernel disconnect"
                    );
                    let _ = ui_event_tx.send(ConsoleUiEvent::KernelDisconnected(
                        kernel_disconnect_message(),
                    ));
                    break;
                }
            }

            // Handle interrupt signals (Ctrl+C during execution)
            _ = interrupt_rx.recv() => {
                if exit_after_exec {
                    // Ark is likely dead after q(), no point sending interrupt
                    debug!("Console kernel_loop: interrupt during exit-after-exec, breaking immediately");
                    let _ = ui_event_tx.send(ConsoleUiEvent::ExecutionDone);
                    break;
                }
                if current_exec_msg_id.is_some() {
                    debug!("Console kernel_loop: sending InterruptRequest to kernel");
                    let interrupt = InterruptRequest {};
                    let message = JupyterMessage::new(interrupt, None);
                    if let Err(err) = control.send(message).await {
                        warn!(error = ?err, "Console kernel_loop: failed to send InterruptRequest");
                        if handle_transport_disconnect(
                            &ui_event_tx,
                            "interrupt send failed",
                            &err,
                            true,
                        ) {
                            break;
                        }
                    }
                } else {
                    debug!("Console kernel_loop: interrupt received but no execution in progress");
                }
            }

            // Handle iopub messages from the kernel
            iopub_result = iopub.read() => {
                match iopub_result {
                    Ok(message) => {
                        let parent_msg_id = message
                            .parent_header
                            .as_ref()
                            .map(|h| h.msg_id.as_str());

                        debug!(
                            msg_type = %message.content.message_type(),
                            parent = ?parent_msg_id,
                            "Console kernel_loop: iopub message"
                        );

                        // Check if this message belongs to our current execution
                        let is_our_exec = current_exec_msg_id.is_some()
                            && current_exec_msg_id.as_deref() == parent_msg_id;

                        // Handle status changes
                        if let JupyterMessageContent::Status(status) = &message.content {
                            if is_our_exec && status.execution_state == ExecutionState::Idle {
                                debug!("Console kernel_loop: execution idle");
                                current_exec_msg_id = None;
                                let _ = ui_event_tx.send(ConsoleUiEvent::ExecutionDone);
                                if exit_after_exec {
                                    debug!("Console kernel_loop: exit_after_exec set, breaking");
                                    break;
                                }
                                continue;
                            }
                        }

                        // Format and send displayable output
                        if is_our_exec {
                            if let Some(text) = format_iopub_content(&message.content) {
                                let _ = ui_event_tx.send(ConsoleUiEvent::Output(text));
                            }
                        }
                    }
                    Err(err) => {
                        let err_text = format!("{err:?}");
                        // Ignore comm_close missing data errors (known runtimelib issue)
                        if is_comm_close_missing_data(&err_text) {
                            debug!(error = ?err, "Console kernel_loop: ignoring comm_close without data");
                            continue;
                        }
                        error!(error = ?err, "Console kernel_loop: iopub read error");
                        if handle_transport_disconnect(
                            &ui_event_tx,
                            "iopub read failed",
                            &err,
                            current_exec_msg_id.is_some(),
                        ) {
                            break;
                        }
                        break;
                    }
                }
            }

            // Handle shell replies (execute_reply, etc.)
            shell_result = shell.read() => {
                match shell_result {
                    Ok(message) => {
                        debug!(
                            msg_type = %message.content.message_type(),
                            "Console kernel_loop: shell reply"
                        );

                        match message.content {
                            JupyterMessageContent::ExecuteReply(_) => {
                                // Execute result comes via iopub; this is just the status
                                debug!("Console kernel_loop: execute_reply received");
                            }
                            _ => {
                                debug!(
                                    msg_type = %message.content.message_type(),
                                    "Console kernel_loop: ignoring shell message"
                                );
                            }
                        }
                    }
                    Err(err) => {
                        warn!(error = ?err, "Console kernel_loop: shell read error");
                        if handle_transport_disconnect(
                            &ui_event_tx,
                            "shell read failed",
                            &err,
                            current_exec_msg_id.is_some(),
                        ) {
                            break;
                        }
                        // Shell decode errors can be non-fatal with Ark replies, so continue.
                    }
                }
            }

            // Safety timeout after q()/quit() — when Ark dies, ZMQ PUB/SUB
            // sockets never signal disconnection, so iopub.read() hangs forever.
            // This timeout ensures the console exits cleanly.
            _ = async {
                match exit_deadline {
                    Some(deadline) => tokio::time::sleep_until(deadline).await,
                    None => std::future::pending::<()>().await,
                }
            } => {
                warn!("Console kernel_loop: exit timeout after q(), kernel likely terminated");
                let _ = ui_event_tx.send(ConsoleUiEvent::ExecutionDone);
                break;
            }
        }
    }

    stop_heartbeat_monitor(heartbeat_handle);
    debug!("Console kernel_loop: exiting");
    Ok(())
}

fn handle_transport_disconnect<E: std::fmt::Debug>(
    ui_event_tx: &std_mpsc::Sender<ConsoleUiEvent>,
    operation: &str,
    err: &E,
    execution_in_progress: bool,
) -> bool {
    let err_text = format!("{err:?}");
    if !is_transport_disconnect_error(&err_text) {
        return false;
    }

    warn!(
        operation = operation,
        execution_in_progress = execution_in_progress,
        error = %err_text,
        "Console kernel_loop: transport error confirms kernel disconnect"
    );
    let _ = ui_event_tx.send(ConsoleUiEvent::KernelDisconnected(
        kernel_disconnect_message(),
    ));
    true
}

fn is_comm_close_missing_data(err_text: &str) -> bool {
    err_text.contains("comm_close") && err_text.contains("missing field `data`")
}

fn is_transport_disconnect_error(err_text: &str) -> bool {
    [
        "Broken pipe",
        "Not connected to peers",
        "Connection reset by peer",
        "Connection refused",
        "Network is unreachable",
        "NoMessage",
        "No message received",
        "Server disconnected",
    ]
    .iter()
    .any(|needle| err_text.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_exec_id_does_not_match_none_parent() {
        let current_exec_msg_id: Option<String> = None;
        let parent_msg_id: Option<&str> = None;
        let is_our_exec =
            current_exec_msg_id.is_some() && current_exec_msg_id.as_deref() == parent_msg_id;
        assert!(
            !is_our_exec,
            "None exec_msg_id must not match None parent_msg_id"
        );
    }

    #[test]
    fn matching_exec_id_matches_parent() {
        let current_exec_msg_id: Option<String> = Some("msg-123".to_string());
        let parent_msg_id: Option<&str> = Some("msg-123");
        let is_our_exec =
            current_exec_msg_id.is_some() && current_exec_msg_id.as_deref() == parent_msg_id;
        assert!(is_our_exec);
    }

    #[test]
    fn some_exec_id_does_not_match_none_parent() {
        let current_exec_msg_id: Option<String> = Some("msg-123".to_string());
        let parent_msg_id: Option<&str> = None;
        let is_our_exec =
            current_exec_msg_id.is_some() && current_exec_msg_id.as_deref() == parent_msg_id;
        assert!(!is_our_exec);
    }

    #[test]
    fn transport_disconnect_error_matches_known_patterns() {
        assert!(is_transport_disconnect_error("Broken pipe (os error 32)"));
        assert!(is_transport_disconnect_error(
            "Not connected to peers. Unable to send messages"
        ));
        assert!(is_transport_disconnect_error("ZmqError(NoMessage)"));
        assert!(is_transport_disconnect_error("No message received"));
        assert!(!is_transport_disconnect_error(
            "missing field `execution_count`"
        ));
    }
}
