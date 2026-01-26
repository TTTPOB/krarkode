use anyhow::{anyhow, Context, Result};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use uuid::Uuid;

use tracing::{debug, error, info, warn};

use runtimelib::{
    create_client_iopub_connection, CommId, CommMsg, CommOpen, CommClose, ExecuteRequest,
    ExecutionState, JupyterMessage, JupyterMessageContent, KernelInfoRequest,
};

use crate::connection::{
    create_shell_connection, send_comm_open, send_data_explorer_comm_open, send_help_comm_open,
    send_ui_comm_open, send_variables_comm_open, wait_for_comm_port, wait_for_iopub_idle,
};
use crate::logging::LogReloadHandle;
use crate::types::{
    DATA_EXPLORER_COMM_TARGET, HELP_COMM_TARGET, PLOT_COMM_TARGET, UI_COMM_TARGET,
    VARIABLES_COMM_TARGET,
};

const LOG_RELOAD_COMMAND: &str = "reload_log_level";

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
    log_handle: LogReloadHandle,
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
    let mut pending_comm_ids: HashMap<String, String> = HashMap::new();

    // We no longer wait for IOPub welcome. When attaching to an existing session,
    // the kernel might not send a welcome message, or it might have already sent it.
    // Also, waiting for it might cause us to drop other important messages (like plot data)
    // that arrive in the meantime. We just start listening.
    loop {
        tokio::select! {
            line = reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        match serde_json::from_str::<Value>(&line) {
                            Ok(json) => {
                                if let Some(command) = json.get("command").and_then(|c| c.as_str()) {
                                    if command == LOG_RELOAD_COMMAND {
                                        let log_level = json.get("log_level").and_then(|value| value.as_str());
                                        debug!(command = %command, log_level = ?log_level, "Sidecar: reloading log filter");
                                        match log_level {
                                            Some("inherit") | None => log_handle.reload_from_env(),
                                            Some(level) => log_handle.reload_with_level(level),
                                        }
                                    } else if command == "comm_msg" {
                                        if let (Some(comm_id), Some(data)) = (
                                            json.get("comm_id").and_then(|s| s.as_str()),
                                            json.get("data").and_then(|d| d.as_object()),
                                        ) {
                                            let request_id = extract_request_id(data);
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
                                            let parent_msg_id = message.header.msg_id.clone();
                                            if let Err(e) = shell.send(message).await {
                                                warn!(error = %e, "Failed to send comm_msg");
                                            } else if let Some(request_id) = request_id {
                                                debug!(
                                                    parent_msg_id = %parent_msg_id,
                                                    request_id = %request_id,
                                                    "Sidecar: recorded comm request id"
                                                );
                                                pending_comm_ids.insert(parent_msg_id, request_id);
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
                                } else {
                                    warn!("Sidecar: stdin message missing command");
                                }
                            }
                            Err(err) => {
                                warn!(error = %err, "Sidecar: ignored invalid stdin JSON");
                            }
                        }
                    }
                    Ok(None) => break Ok(()), // EOF
                    Err(e) => {
                         info!(error = %e, "Error reading stdin");
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
                let parent_msg_id = message.parent_header.as_ref().map(|header| header.msg_id.as_str());
                let payload = match &message.content {
                    JupyterMessageContent::DisplayData(display) => {
                        build_plot_payload("display_data", &display.data, display.transient.as_ref())
                    }
                    JupyterMessageContent::UpdateDisplayData(update) => {
                        build_plot_payload("update_display_data", &update.data, Some(&update.transient))
                    }
                    JupyterMessageContent::StreamContent(_) => None,
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
                        let data = attach_comm_reply_id(
                            comm_msg.data.clone(),
                            parent_msg_id,
                            &mut pending_comm_ids,
                        );
                        // Check for UI methods
                        if let Some(method) = data.get("method").and_then(|m| m.as_str()) {
                            if method == "show_html_file" {
                                Some(json!({
                                    "event": "show_html_file",
                                    "comm_id": comm_msg.comm_id.0,
                                    "data": data
                                }).to_string())
                            } else if method == "show_help" {
                                Some(json!({
                                    "event": "show_help",
                                    "comm_id": comm_msg.comm_id.0,
                                    "data": data
                                }).to_string())
                            } else {
                                // Other comm messages (e.g., plot render replies)
                                Some(json!({
                                    "event": "comm_msg",
                                    "comm_id": comm_msg.comm_id.0,
                                    "data": data
                                }).to_string())
                            }
                        } else {
                            Some(json!({
                                "event": "comm_msg",
                                "comm_id": comm_msg.comm_id.0,
                                "data": data
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
                        let data = attach_comm_reply_id(
                            comm_msg.data.clone(),
                            message.parent_header.as_ref().map(|header| header.msg_id.as_str()),
                            &mut pending_comm_ids,
                        );
                        let payload = Some(json!({
                            "event": "comm_msg",
                            "comm_id": comm_msg.comm_id.0,
                            "data": data
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

fn extract_request_id(data: &Map<String, Value>) -> Option<String> {
    match data.get("id")? {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn attach_comm_reply_id(
    mut data: Map<String, Value>,
    parent_msg_id: Option<&str>,
    pending_comm_ids: &mut HashMap<String, String>,
) -> Map<String, Value> {
    if data.get("id").is_some() {
        if let Some(parent_msg_id) = parent_msg_id {
            pending_comm_ids.remove(parent_msg_id);
        }
        return data;
    }

    let parent_msg_id = match parent_msg_id {
        Some(parent_msg_id) => parent_msg_id,
        None => return data,
    };

    let request_id = match pending_comm_ids.remove(parent_msg_id) {
        Some(request_id) => request_id,
        None => return data,
    };

    debug!(
        parent_msg_id = %parent_msg_id,
        request_id = %request_id,
        "Sidecar: attached comm reply id"
    );
    data.insert("id".to_string(), Value::String(request_id));
    data
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

#[cfg(test)]
mod tests {
    use super::extract_png_data;
    use runtimelib::{Media, MediaType};

    #[test]
    fn extract_png_data_returns_png() {
        let media = Media::new(vec![MediaType::Png("png-data".to_string())]);
        assert_eq!(extract_png_data(&media), Some("png-data".to_string()));
    }

    #[test]
    fn extract_png_data_skips_non_png() {
        let media = Media::new(vec![MediaType::Html("<p>hi</p>".to_string())]);
        assert_eq!(extract_png_data(&media), None);
    }
}
