use anyhow::{anyhow, Context, Result};
use serde_json::{Map, Value};
use std::fs;
use std::str::FromStr;
use std::time::{Duration, Instant};
use uuid::Uuid;
use zeromq::util::PeerIdentity;
use zeromq::{DealerSocket, Socket as ZmqSocket, SocketOptions};

use runtimelib::{
    CommId, CommOpen, Connection, ConnectionInfo, ExecutionState, JupyterMessage,
    JupyterMessageContent,
};

use tracing::debug;
use crate::types::{
    DATA_EXPLORER_COMM_TARGET, HELP_COMM_TARGET, LSP_COMM_TARGET, UI_COMM_TARGET,
    VARIABLES_COMM_TARGET,
};

pub(crate) fn read_connection(path: &str) -> Result<ConnectionInfo> {
    let content = fs::read_to_string(path)?;
    let info: ConnectionInfo = serde_json::from_str(&content)?;
    Ok(info)
}

pub(crate) async fn send_comm_open(
    shell: &mut runtimelib::ClientShellConnection,
    comm_id: &str,
    ip_address: &str,
) -> Result<()> {
    let mut data = Map::new();
    data.insert("ip_address".to_string(), Value::String(ip_address.to_string()));
    let comm_open = CommOpen {
        comm_id: CommId(comm_id.to_string()),
        target_name: LSP_COMM_TARGET.to_string(),
        data,
        target_module: None,
    };
    let message = JupyterMessage::new(comm_open, None);
    shell.send(message).await.context("Failed to send comm_open")
}

pub(crate) async fn send_help_comm_open(
    shell: &mut runtimelib::ClientShellConnection,
    comm_id: &str,
) -> Result<()> {
    let comm_open = CommOpen {
        comm_id: CommId(comm_id.to_string()),
        target_name: HELP_COMM_TARGET.to_string(),
        data: Map::new(),
        target_module: None,
    };
    let message = JupyterMessage::new(comm_open, None);
    shell.send(message).await.context("Failed to send help comm_open")
}

pub(crate) async fn send_ui_comm_open(
    shell: &mut runtimelib::ClientShellConnection,
    comm_id: &str,
) -> Result<()> {
    let comm_open = CommOpen {
        comm_id: CommId(comm_id.to_string()),
        target_name: UI_COMM_TARGET.to_string(),
        data: Map::new(),
        target_module: None,
    };
    let message = JupyterMessage::new(comm_open, None);
    shell.send(message).await.context("Failed to send UI comm_open")
}

pub(crate) async fn send_variables_comm_open(
    shell: &mut runtimelib::ClientShellConnection,
    comm_id: &str,
) -> Result<()> {
    let comm_open = CommOpen {
        comm_id: CommId(comm_id.to_string()),
        target_name: VARIABLES_COMM_TARGET.to_string(),
        data: Map::new(),
        target_module: None,
    };
    let message = JupyterMessage::new(comm_open, None);
    shell.send(message)
        .await
        .context("Failed to send variables comm_open")
}

pub(crate) async fn send_data_explorer_comm_open(
    shell: &mut runtimelib::ClientShellConnection,
    comm_id: &str,
) -> Result<()> {
    let comm_open = CommOpen {
        comm_id: CommId(comm_id.to_string()),
        target_name: DATA_EXPLORER_COMM_TARGET.to_string(),
        data: Map::new(),
        target_module: None,
    };
    let message = JupyterMessage::new(comm_open, None);
    shell.send(message)
        .await
        .context("Failed to send data explorer comm_open")
}

pub(crate) async fn create_shell_connection(
    connection_info: &ConnectionInfo,
    session_id: &str,
) -> Result<runtimelib::ClientShellConnection> {
    let mut options = SocketOptions::default();
    let identity = PeerIdentity::from_str(&format!("sidecar-{}", Uuid::new_v4()))
        .context("Failed to create peer identity")?;
    options.peer_identity(identity);

    let mut socket = DealerSocket::with_options(options);
    socket
        .connect(&connection_info.shell_url())
        .await
        .context("Failed to connect shell socket")?;

    Ok(Connection::new(socket, &connection_info.key, session_id))
}

pub(crate) async fn wait_for_iopub_idle(
    iopub: &mut runtimelib::ClientIoPubConnection,
    msg_id: &str,
    timeout: Duration,
) -> Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .unwrap_or(Duration::from_millis(0));
        if remaining.is_zero() {
            return Err(anyhow!("Timed out waiting for iopub idle"));
        }
        let message = tokio::time::timeout(remaining, iopub.read())
            .await
            .map_err(|_| anyhow!("Timed out waiting for iopub idle"))??;
        if message.parent_header.as_ref().map(|h| h.msg_id.as_str()) != Some(msg_id) {
            continue;
        }
        if let JupyterMessageContent::Status(status) = message.content {
            if status.execution_state == ExecutionState::Idle {
                return Ok(());
            }
        }
    }
}

pub(crate) async fn wait_for_comm_port(
    iopub: &mut runtimelib::ClientIoPubConnection,
    comm_id: &str,
    timeout: Duration,
) -> Result<u16> {
    debug!(comm_id = %comm_id, "Sidecar: waiting for comm port");
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .unwrap_or(Duration::from_millis(0));
        if remaining.is_zero() {
            return Err(anyhow!("Timed out waiting for Ark LSP comm response"));
        }
        let message = tokio::time::timeout(remaining, iopub.read())
            .await
            .map_err(|_| anyhow!("Timed out waiting for Ark LSP comm response"))??;
        let JupyterMessage { content, .. } = message;
        debug!(
            message_type = %content.message_type(),
            "Sidecar: iopub message while waiting for port"
        );
        if let JupyterMessageContent::StreamContent(stream) = &content {
            debug!(stream_name = ?stream.name, stream_text = %stream.text, "Sidecar: iopub stream");
        }
        let JupyterMessageContent::CommMsg(comm_msg) = content else {
            if let JupyterMessageContent::CommClose(comm_close) = content {
                if comm_close.comm_id.0 == comm_id {
                    return Err(anyhow!("Comm closed before LSP port was received"));
                }
            }
            continue;
        };
        if comm_msg.comm_id.0 != comm_id {
            continue;
        }
        debug!(comm_msg_data = ?comm_msg.data, "Sidecar: comm_msg data");
        if let Some(port) = extract_comm_port(&comm_msg.data) {
            return Ok(port);
        }
    }
}

fn extract_comm_port(data: &Map<String, Value>) -> Option<u16> {
    if let Some(Value::Object(params)) = data.get("params") {
        if let Some(port) = find_port(&Value::Object(params.clone())) {
            return Some(port);
        }
    }
    if let Some(Value::Object(content)) = data.get("content") {
        if let Some(port) = find_port(&Value::Object(content.clone())) {
            return Some(port);
        }
    }
    find_port(&Value::Object(data.clone()))
}

fn find_port(value: &Value) -> Option<u16> {
    match value {
        Value::Object(map) => {
            if let Some(port) = parse_port_value(map.get("port")) {
                return Some(port);
            }
            for nested in map.values() {
                if let Some(port) = find_port(nested) {
                    return Some(port);
                }
            }
            None
        }
        Value::Array(values) => {
            for nested in values {
                if let Some(port) = find_port(nested) {
                    return Some(port);
                }
            }
            None
        }
        _ => None,
    }
}

fn parse_port_value(value: Option<&Value>) -> Option<u16> {
    match value? {
        Value::Number(num) => num.as_u64().and_then(|port| u16::try_from(port).ok()),
        Value::String(text) => text.parse::<u16>().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_port_value;
    use serde_json::Value;

    #[test]
    fn parse_port_value_accepts_number() {
        let value = serde_json::json!(8787);
        assert_eq!(parse_port_value(Some(&value)), Some(8787));
    }

    #[test]
    fn parse_port_value_accepts_string() {
        let value = Value::String("9090".to_string());
        assert_eq!(parse_port_value(Some(&value)), Some(9090));
    }

    #[test]
    fn parse_port_value_rejects_invalid_type() {
        let value = Value::Bool(true);
        assert_eq!(parse_port_value(Some(&value)), None);
    }
}
