// Async event loop for console mode.
//
// Bridges the blocking reedline loop with the Jupyter kernel via
// tokio::select! over shell, iopub, and request channels.
// Completion is handled directly by LspCompleter over TCP,
// so this loop only manages execute requests and output.

use anyhow::{Context, Result};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;
use tracing::{debug, error, warn};

use runtimelib::{
    create_client_iopub_connection, ClientControlConnection, ExecuteRequest, ExecutionState,
    InterruptRequest, JupyterMessage, JupyterMessageContent,
};

use crate::connection::create_shell_connection;

use super::output::{format_iopub_content, ExecutionEvent};

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
/// - `exec_output_tx`: real-time execution output back to the reedline loop
/// - Jupyter shell/iopub sockets
pub(crate) async fn run_kernel_loop(
    connection_info: &runtimelib::ConnectionInfo,
    session_id: &str,
    mut request_rx: tokio::sync::mpsc::Receiver<ConsoleRequest>,
    exec_output_tx: std_mpsc::Sender<ExecutionEvent>,
    mut control: ClientControlConnection,
    mut interrupt_rx: tokio::sync::mpsc::Receiver<()>,
) -> Result<()> {
    debug!("Console kernel_loop: connecting to kernel");

    let mut iopub = create_client_iopub_connection(connection_info, "", session_id)
        .await
        .context("Failed to connect iopub")?;
    let mut shell = create_shell_connection(connection_info, session_id)
        .await
        .context("Failed to connect shell")?;

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
                            tokio::time::Instant::now() + Duration::from_secs(5),
                        );
                        debug!(code_len = code.len(), exit_after = true, "Console kernel_loop: execute-and-exit request");
                        let execute_request = ExecuteRequest::new(code);
                        let message = JupyterMessage::new(execute_request, None);
                        let msg_id = message.header.msg_id.clone();
                        current_exec_msg_id = Some(msg_id);
                        if let Err(err) = shell.send(message).await {
                            error!(error = ?err, "Console kernel_loop: failed to send execute_request");
                            let _ = exec_output_tx.send(ExecutionEvent::Output(
                                format!("Error sending execute request: {}\n", err),
                            ));
                            let _ = exec_output_tx.send(ExecutionEvent::Done);
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
                            let _ = exec_output_tx.send(ExecutionEvent::Output(
                                format!("Error sending execute request: {}\n", err),
                            ));
                            let _ = exec_output_tx.send(ExecutionEvent::Done);
                        }
                    }
                    Some(ConsoleRequest::Exit) | None => {
                        debug!("Console kernel_loop: exit requested");
                        break;
                    }
                }
            }

            // Handle interrupt signals (Ctrl+C during execution)
            _ = interrupt_rx.recv() => {
                if exit_after_exec {
                    // Ark is likely dead after q(), no point sending interrupt
                    debug!("Console kernel_loop: interrupt during exit-after-exec, breaking immediately");
                    let _ = exec_output_tx.send(ExecutionEvent::Done);
                    break;
                }
                if current_exec_msg_id.is_some() {
                    debug!("Console kernel_loop: sending InterruptRequest to kernel");
                    let interrupt = InterruptRequest {};
                    let message = JupyterMessage::new(interrupt, None);
                    if let Err(err) = control.send(message).await {
                        warn!(error = ?err, "Console kernel_loop: failed to send InterruptRequest");
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
                        let is_our_exec = current_exec_msg_id.as_deref() == parent_msg_id;

                        // Handle status changes
                        if let JupyterMessageContent::Status(status) = &message.content {
                            if is_our_exec && status.execution_state == ExecutionState::Idle {
                                debug!("Console kernel_loop: execution idle");
                                current_exec_msg_id = None;
                                let _ = exec_output_tx.send(ExecutionEvent::Done);
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
                                let _ = exec_output_tx.send(ExecutionEvent::Output(text));
                            }
                        }
                    }
                    Err(err) => {
                        let err_str = format!("{err:?}");
                        // Ignore comm_close missing data errors (known runtimelib issue)
                        if err_str.contains("comm_close") && err_str.contains("missing field `data`") {
                            debug!(error = ?err, "Console kernel_loop: ignoring comm_close without data");
                            continue;
                        }
                        error!(error = ?err, "Console kernel_loop: iopub read error");
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
                        // Shell errors are less critical; continue the loop
                    }
                }
            }

            // Safety timeout after q()/quit() — when Ark dies, ZMQ PUB/SUB
            // sockets never signal disconnection, so iopub.read() hangs forever.
            // This timeout ensures the console exits cleanly.
            _ = async {
                match exit_deadline {
                    Some(d) => tokio::time::sleep_until(d).await,
                    None => std::future::pending::<()>().await,
                }
            } => {
                warn!("Console kernel_loop: exit timeout after q(), kernel likely terminated");
                let _ = exec_output_tx.send(ExecutionEvent::Done);
                break;
            }
        }
    }

    debug!("Console kernel_loop: exiting");
    Ok(())
}
