use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use uuid::Uuid;

use tracing::{debug, error, info, warn};

use runtimelib::{
    create_client_iopub_connection, CommId, CommMsg, CommOpen, CommClose, ExecuteRequest,
    ExecutionState, JupyterMessage, JupyterMessageContent, KernelInfoRequest, Stdio,
};

use crate::connection::{
    create_shell_connection, send_comm_open, send_data_explorer_comm_open, send_help_comm_open,
    send_ui_comm_open, send_variables_comm_open, wait_for_comm_port, wait_for_iopub_idle,
};
use crate::types::{
    DATA_EXPLORER_COMM_TARGET, HELP_COMM_TARGET, PLOT_COMM_TARGET, UI_COMM_TARGET,
    VARIABLES_COMM_TARGET,
};

pub(crate) async fn run_lsp(
    connection: &runtimelib::ConnectionInfo,
    session_id: &str,
    ip_address: &str,
    timeout_ms: u64,
) -> Result<()> {
    info!(mode = "lsp", "Sidecar: starting mode");
    let mut iopub = create_client_iopub_connection(connection, "", session_id)
        .await
        .context("Failed to connect iopub")?;
    let mut shell = create_shell_connection(connection, session_id)
        .await
        .context("Failed to connect shell")?;

    // wait_for_iopub_welcome(&mut iopub, Duration::from_millis(timeout_ms)).await?;

    let comm_id = Uuid::new_v4().to_string();
    send_comm_open(&mut shell, &comm_id, ip_address).await?;
    info!(comm_id = %comm_id, "Sidecar: sent comm_open");

    let port = wait_for_comm_port(&mut iopub, &comm_id, Duration::from_millis(timeout_ms)).await?;
    let payload = json!({
        "event": "lsp_port",
        "port": port,
    });
    println!("{payload}");

    Ok(())
}

pub(crate) async fn run_execute_request(
    connection: &runtimelib::ConnectionInfo,
    session_id: &str,
    code: &str,
    timeout_ms: u64,
    wait_for_idle: bool,
) -> Result<()> {
    info!(mode = "execute", "Sidecar: starting mode");
    let mut iopub = create_client_iopub_connection(connection, "", session_id)
        .await
        .context("Failed to connect iopub")?;
    let mut shell = create_shell_connection(connection, session_id)
        .await
        .context("Failed to connect shell")?;

    // Note: We do NOT wait for IoPubWelcome here. Existing sessions do not
    // resend the welcome message, and waiting for it can cause us to drop
    // other messages or timeout unnecessarily.

    let execute_request = ExecuteRequest::new(code.to_string());
    let message = JupyterMessage::new(execute_request, None);
    let msg_id = message.header.msg_id.clone();
    debug!(code_len = code.len(), "Sidecar: sending execute_request");
    shell.send(message).await.context("Failed to send execute_request")?;

    if wait_for_idle {
        wait_for_iopub_idle(&mut iopub, &msg_id, Duration::from_millis(timeout_ms)).await?;
    }

    Ok(())
}

pub(crate) async fn run_plot_watcher(
    connection: &runtimelib::ConnectionInfo,
    session_id: &str,
    timeout_ms: u64,
) -> Result<()> {
    info!(mode = "watch_plot", "Sidecar: starting mode");
    let mut iopub = create_client_iopub_connection(connection, "", session_id)
        .await
        .context("Failed to connect iopub")?;
    let mut shell = create_shell_connection(connection, session_id)
        .await
        .context("Failed to connect shell")?;

    // Open the help comm so Ark can serve help pages
    let help_comm_id = Uuid::new_v4().to_string();
    send_help_comm_open(&mut shell, &help_comm_id).await?;
    println!(
        "{}",
        json!({
            "event": "help_comm_open",
            "comm_id": help_comm_id,
            "target_name": HELP_COMM_TARGET
        })
    );
    info!(comm_id = %help_comm_id, "Sidecar: sent help comm_open");

    // Open the UI comm so Ark knows the UI is connected (enables dynamic plots)
    let ui_comm_id = Uuid::new_v4().to_string();
    send_ui_comm_open(&mut shell, &ui_comm_id).await?;
    println!(
        "{}",
        json!({
            "event": "ui_comm_open",
            "comm_id": ui_comm_id,
            "target_name": UI_COMM_TARGET
        })
    );
    info!(comm_id = %ui_comm_id, "Sidecar: sent UI comm_open");

    // Open the Variables comm so Ark starts sending variable updates
    let variables_comm_id = Uuid::new_v4().to_string();
    send_variables_comm_open(&mut shell, &variables_comm_id).await?;
    println!(
        "{}",
        json!({
            "event": "variables_comm_open",
            "comm_id": variables_comm_id,
            "target_name": VARIABLES_COMM_TARGET
        })
    );
    info!(comm_id = %variables_comm_id, "Sidecar: sent variables comm_open");

    // Open the Data Explorer comm so Ark knows we support it (enables View())
    let data_explorer_comm_id = Uuid::new_v4().to_string();
    send_data_explorer_comm_open(&mut shell, &data_explorer_comm_id).await?;
    println!(
        "{}",
        json!({
            "event": "data_explorer_comm_open",
            "comm_id": data_explorer_comm_id,
            "target_name": DATA_EXPLORER_COMM_TARGET
        })
    );
    info!(comm_id = %data_explorer_comm_id, "Sidecar: sent data explorer comm_open");

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();

    // We no longer wait for IOPub welcome. When attaching to an existing session,
    // the kernel might not send a welcome message, or it might have already sent it.
    // Also, waiting for it might cause us to drop other important messages (like plot data)
    // that arrive in the meantime. We just start listening.
    // wait_for_iopub_welcome(&mut iopub, Duration::from_millis(timeout_ms)).await?;

    loop {
        tokio::select! {
            line = reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        if let Ok(json) = serde_json::from_str::<Value>(&line) {
                            if let Some(command) = json.get("command").and_then(|c| c.as_str()) {
                                if command == "comm_msg" {
                                    if let (Some(comm_id), Some(data)) = (
                                        json.get("comm_id").and_then(|s| s.as_str()),
                                        json.get("data").and_then(|d| d.as_object()),
                                    ) {
                                        debug!(
                                            comm_id = %comm_id,
                                            data = ?data,
                                            "Forwarding comm_msg to shell"
                                        );
                                        let comm_msg = CommMsg {
                                            comm_id: CommId(comm_id.to_string()),
                                            data: data.clone(),
                                        };
                                        let message = JupyterMessage::new(comm_msg, None);
                                        if let Err(e) = shell.send(message).await {
                                            warn!(error = %e, "Failed to send comm_msg");
                                        }
                                    }
                                } else if command == "comm_open" {
                                    if let (Some(comm_id), Some(target_name), Some(data)) = (
                                        json.get("comm_id").and_then(|s| s.as_str()),
                                        json.get("target_name").and_then(|s| s.as_str()),
                                        json.get("data").and_then(|d| d.as_object()),
                                    ) {
                                        debug!(
                                            comm_id = %comm_id,
                                            target_name = %target_name,
                                            data = ?data,
                                            "Forwarding comm_open"
                                        );
                                        let comm_open = CommOpen {
                                            comm_id: CommId(comm_id.to_string()),
                                            target_name: target_name.to_string(),
                                            data: data.clone(),
                                            target_module: None,
                                        };
                                        let message = JupyterMessage::new(comm_open, None);
                                        if let Err(e) = shell.send(message).await {
                                            warn!(error = %e, "Failed to send comm_open");
                                        }
                                    }
                                } else if command == "comm_close" {
                                    if let Some(comm_id) = json.get("comm_id").and_then(|s| s.as_str()) {
                                        let data = json.get("data").and_then(|d| d.as_object()).cloned().unwrap_or_default();
                                        let comm_close = CommClose {
                                            comm_id: CommId(comm_id.to_string()),
                                            data,
                                        };
                                        let message = JupyterMessage::new(comm_close, None);
                                        if let Err(e) = shell.send(message).await {
                                            warn!(error = %e, "Failed to send comm_close");
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Ok(None) => break Ok(()), // EOF
                    Err(e) => {
                         warn!(error = %e, "Error reading stdin");
                         break Ok(());
                    }
                }
            }
            iopub_msg = iopub.read() => {
                let message = match iopub_msg {
                    Ok(message) => message,
                    Err(err) => {
                        if is_comm_close_missing_data(&err) {
                            debug!(error = ?err, "Ignoring comm_close without data");
                            continue;
                        }
                        error!(error = ?err, "IOPub read error");
                        return Err(err).context("Failed to read iopub message");
                    }
                };
                let payload = match &message.content {
                    JupyterMessageContent::DisplayData(display) => {
                        build_plot_payload("display_data", &display.data, display.transient.as_ref())
                    }
                    JupyterMessageContent::UpdateDisplayData(update) => {
                        build_plot_payload("update_display_data", &update.data, Some(&update.transient))
                    }
                    JupyterMessageContent::StreamContent(stream) => {
                        if matches!(stream.name, Stdio::Stdout) && stream.text.starts_with("__VSCODE_R_HTTPGD_URL__=") {
                            let url = stream.text.trim().strip_prefix("__VSCODE_R_HTTPGD_URL__=").unwrap_or("");
                            Some(json!({
                                "event": "httpgd_url",
                                "url": url
                            }).to_string())
                        } else {
                            None
                        }
                    }
                    JupyterMessageContent::CommOpen(comm_open) => {
                        if comm_open.target_name == PLOT_COMM_TARGET {
                            Some(json!({
                                "event": "comm_open",
                                "comm_id": comm_open.comm_id.0,
                                "target_name": comm_open.target_name,
                                "data": comm_open.data
                            }).to_string())
                        } else if comm_open.target_name == UI_COMM_TARGET {
                            Some(json!({
                                "event": "ui_comm_open",
                                "comm_id": comm_open.comm_id.0,
                                "target_name": comm_open.target_name,
                                "data": comm_open.data
                            }).to_string())
                        } else if comm_open.target_name == HELP_COMM_TARGET {
                            Some(json!({
                                "event": "help_comm_open",
                                "comm_id": comm_open.comm_id.0,
                                "target_name": comm_open.target_name,
                                "data": comm_open.data
                            }).to_string())
                        } else if comm_open.target_name == VARIABLES_COMM_TARGET {
                            Some(json!({
                                "event": "variables_comm_open",
                                "comm_id": comm_open.comm_id.0,
                                "target_name": comm_open.target_name,
                                "data": comm_open.data
                            }).to_string())
                        } else if comm_open.target_name == DATA_EXPLORER_COMM_TARGET {
                            Some(json!({
                                "event": "data_explorer_comm_open",
                                "comm_id": comm_open.comm_id.0,
                                "target_name": comm_open.target_name,
                                "data": comm_open.data
                            }).to_string())
                        } else {
                            None
                        }
                    }
                    JupyterMessageContent::CommMsg(comm_msg) => {
                        debug!(comm_id = %comm_msg.comm_id.0, data = ?comm_msg.data, "IOPub comm_msg");
                        // Check for UI methods
                        if let Some(method) = comm_msg.data.get("method").and_then(|m| m.as_str()) {
                            if method == "show_html_file" {
                                Some(json!({
                                    "event": "show_html_file",
                                    "comm_id": comm_msg.comm_id.0,
                                    "data": comm_msg.data
                                }).to_string())
                            } else if method == "show_help" {
                                Some(json!({
                                    "event": "show_help",
                                    "comm_id": comm_msg.comm_id.0,
                                    "data": comm_msg.data
                                }).to_string())
                            } else {
                                // Other comm messages (e.g., plot render replies)
                                Some(json!({
                                    "event": "comm_msg",
                                    "comm_id": comm_msg.comm_id.0,
                                    "data": comm_msg.data
                                }).to_string())
                            }
                        } else {
                            Some(json!({
                                "event": "comm_msg",
                                "comm_id": comm_msg.comm_id.0,
                                "data": comm_msg.data
                            }).to_string())
                        }
                    }
                    JupyterMessageContent::CommClose(comm_close) => {
                        Some(json!({
                            "event": "comm_close",
                            "comm_id": comm_close.comm_id.0
                        }).to_string())
                    }
                    JupyterMessageContent::Status(status) => {
                        let state = match status.execution_state {
                            ExecutionState::Idle => "idle",
                            ExecutionState::Busy => "busy",
                            ExecutionState::Starting => "starting",
                            _ => "unknown",
                        };
                        debug!(state = %state, "Sidecar: kernel status");
                        Some(json!({
                            "event": "kernel_status",
                            "status": state
                        }).to_string())
                    }
                    _ => None,
                };

                if let Some(payload) = payload {
                    println!("{payload}");
                }
            }
            shell_msg = shell.read() => {
                if let Ok(message) = shell_msg {
                    // Handle shell replies. Specifically look for CommMsg replies (Variables list, etc.)
                    if let JupyterMessageContent::CommMsg(comm_msg) = &message.content {
                        debug!(comm_id = %comm_msg.comm_id.0, data = ?comm_msg.data, "Shell comm_msg");
                        let payload = Some(json!({
                            "event": "comm_msg",
                            "comm_id": comm_msg.comm_id.0,
                            "data": comm_msg.data
                        }).to_string());

                        if let Some(payload) = payload {
                            println!("{payload}");
                        }
                    }
                }
            }
        }
    }
}

pub(crate) async fn run_check(
    connection: &runtimelib::ConnectionInfo,
    session_id: &str,
    timeout_ms: u64,
) -> Result<()> {
    let mut shell = create_shell_connection(connection, session_id)
        .await
        .context("Failed to connect shell")?;

    // Send kernel_info_request. If successful, the kernel is alive.
    // Note: Ark's kernel_info_reply may be missing fields expected by runtimelib,
    // causing deserialization errors. We handle this gracefully.
    let request = KernelInfoRequest {};
    let message = JupyterMessage::new(request, None);
    let msg_id = message.header.msg_id.clone();
    shell.send(message)
        .await
        .context("Failed to send kernel_info_request")?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .unwrap_or(Duration::from_millis(0));
        if remaining.is_zero() {
            return Err(anyhow!("Timed out waiting for kernel response"));
        }

        match tokio::time::timeout(remaining, shell.read()).await {
            Ok(Ok(msg)) => {
                // Check if this is a response to our request
                if msg.parent_header.as_ref().map(|h| h.msg_id.as_str()) == Some(&msg_id) {
                    // We got a reply! Consider the kernel alive.
                    break;
                }
                // Otherwise, keep waiting for our reply
            }
            Ok(Err(e)) => {
                // Deserialization error (e.g., missing fields in kernel_info_reply).
                // This is expected with Ark. If we got this far, the kernel is alive.
                debug!(error = %e, "Sidecar: ignoring shell read error");
                break;
            }
            Err(_) => {
                return Err(anyhow!("Timed out waiting for kernel response"));
            }
        }
    }

    let payload = json!({
        "event": "alive",
    });
    println!("{payload}");
    Ok(())
}

fn build_plot_payload(
    event: &str,
    media: &runtimelib::Media,
    transient: Option<&runtimelib::Transient>,
) -> Option<String> {
    let png_data = extract_png_data(media)?;
    let display_id = transient.and_then(|value| value.display_id.clone());
    let payload = json!({
        "event": event,
        "data": png_data,
        "display_id": display_id,
    });
    Some(payload.to_string())
}

pub(crate) fn extract_png_data(media: &runtimelib::Media) -> Option<String> {
    for item in &media.content {
        if let runtimelib::MediaType::Png(data) = item {
            return Some(data.clone());
        }
    }
    None
}

fn is_comm_close_missing_data<E: std::fmt::Debug>(err: &E) -> bool {
    let text = format!("{err:?}");
    text.contains("comm_close") && text.contains("missing field `data`")
}
