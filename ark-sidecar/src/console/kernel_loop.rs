// Async event loop for console mode.
//
// Bridges the blocking reedline loop with the Jupyter kernel via
// tokio::select! over shell, iopub, and request channels.

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::sync::mpsc as std_mpsc;
use tracing::{debug, error, warn};

use runtimelib::{
    create_client_iopub_connection, CompleteRequest, ExecuteRequest, ExecutionState,
    JupyterMessage, JupyterMessageContent,
};

use crate::connection::create_shell_connection;

use super::completer::{complete_reply_to_suggestions, CompletionBridgeRequest};
use super::output::{format_iopub_content, ExecutionEvent};

/// Request sent from the reedline loop to the kernel loop.
pub(crate) enum ConsoleRequest {
    /// Execute R code.
    Execute(String),
    /// Exit the console.
    Exit,
}

/// Run the async kernel event loop.
///
/// This function coordinates between:
/// - `request_rx`: execute/exit requests from the reedline loop
/// - `complete_rx`: completion requests from the JupyterCompleter
/// - `exec_output_tx`: real-time execution output back to the reedline loop
/// - Jupyter shell/iopub sockets
pub(crate) async fn run_kernel_loop(
    connection_info: &runtimelib::ConnectionInfo,
    session_id: &str,
    mut request_rx: tokio::sync::mpsc::Receiver<ConsoleRequest>,
    mut complete_rx: tokio::sync::mpsc::Receiver<CompletionBridgeRequest>,
    exec_output_tx: std_mpsc::Sender<ExecutionEvent>,
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

    // Track pending completion requests: msg_id -> reply sender
    let mut pending_completions: HashMap<String, std_mpsc::Sender<Vec<reedline::Suggestion>>> =
        HashMap::new();

    loop {
        tokio::select! {
            // Handle execute/exit requests from the reedline loop
            request = request_rx.recv() => {
                match request {
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

            // Handle completion requests from the JupyterCompleter
            complete_req = complete_rx.recv() => {
                if let Some(req) = complete_req {
                    debug!(cursor_pos = req.cursor_pos, "Console kernel_loop: complete request");
                    let complete_request = CompleteRequest {
                        code: req.code,
                        cursor_pos: req.cursor_pos,
                    };
                    let message = JupyterMessage::new(complete_request, None);
                    let msg_id = message.header.msg_id.clone();
                    pending_completions.insert(msg_id, req.reply_tx);
                    if let Err(err) = shell.send(message).await {
                        error!(error = ?err, "Console kernel_loop: failed to send complete_request");
                    }
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

            // Handle shell replies (complete_reply, execute_reply, etc.)
            shell_result = shell.read() => {
                match shell_result {
                    Ok(message) => {
                        let parent_msg_id = message
                            .parent_header
                            .as_ref()
                            .map(|h| h.msg_id.clone())
                            .unwrap_or_default();

                        debug!(
                            msg_type = %message.content.message_type(),
                            parent = %parent_msg_id,
                            "Console kernel_loop: shell reply"
                        );

                        match message.content {
                            JupyterMessageContent::CompleteReply(reply) => {
                                if let Some(reply_tx) = pending_completions.remove(&parent_msg_id) {
                                    let suggestions = complete_reply_to_suggestions(
                                        &reply.matches,
                                        reply.cursor_start,
                                        reply.cursor_end,
                                    );
                                    let _ = reply_tx.send(suggestions);
                                }
                            }
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
        }
    }

    debug!("Console kernel_loop: exiting");
    Ok(())
}
