use anyhow::{anyhow, Context, Result};
use base64::Engine;
use serde_json::{json, Map, Value};
use std::env;
use std::fs;
use std::time::{Duration, Instant};
use tokio::runtime::Builder;
use uuid::Uuid;

use runtimelib::{
    create_client_iopub_connection, CommId, CommMsg, CommOpen, Connection, ConnectionInfo,
    ExecuteRequest, ExecutionState, JupyterMessage, JupyterMessageContent, Stdio, KernelInfoRequest,
};
use std::str::FromStr;
use tokio::io::{AsyncBufReadExt, BufReader};
use zeromq::util::PeerIdentity;
use zeromq::{DealerSocket, Socket as ZmqSocket, SocketOptions};

const LSP_COMM_TARGET: &str = "positron.lsp";
const PLOT_COMM_TARGET: &str = "positron.plot";
const UI_COMM_TARGET: &str = "positron.ui";
const DEFAULT_TIMEOUT_MS: u64 = 15000;
const SUPPORTED_SIGNATURE_SCHEME: &str = "hmac-sha256";

#[derive(Debug)]
enum Mode {
    Lsp,
    Execute,
    WatchPlot,
    Check,
}

#[derive(Debug)]
struct Args {
    connection_file: String,
    ip_address: Option<String>,
    timeout_ms: u64,
    mode: Mode,
    code: Option<String>,
    code_is_base64: bool,
    wait_for_idle: bool,
}

fn debug_enabled() -> bool {
    env::var("ARK_SIDECAR_DEBUG").map(|val| val != "0").unwrap_or(false)
}

fn log_debug(message: &str) {
    if debug_enabled() {
        eprintln!("{message}");
    }
}

fn main() {
    if let Err(err) = run() {
        eprintln!("Ark sidecar error: {err}");
        let payload = json!({
            "event": "error",
            "message": err.to_string(),
        });
        println!("{payload}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let args = parse_args()?;
    let connection = read_connection(&args.connection_file)?;

    if connection.signature_scheme != SUPPORTED_SIGNATURE_SCHEME {
        return Err(anyhow!(
            "Unsupported signature scheme: {}",
            connection.signature_scheme
        ));
    }

    let runtime = Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .context("Failed to build Tokio runtime")?;

    runtime.block_on(async move {
        let session_id = Uuid::new_v4().to_string();
        match args.mode {
            Mode::Lsp => {
                let ip_address = args
                    .ip_address
                    .clone()
                    .ok_or_else(|| anyhow!("--ip-address is required"))?;
                run_lsp(&connection, &session_id, &ip_address, args.timeout_ms).await?;
            }
            Mode::Execute => {
                let code = decode_code(&args)?;
                run_execute_request(
                    &connection,
                    &session_id,
                    &code,
                    args.timeout_ms,
                    args.wait_for_idle,
                )
                .await?;
            }
            Mode::WatchPlot => {
                run_plot_watcher(&connection, &session_id, args.timeout_ms).await?;
            }
            Mode::Check => {
                run_check(&connection, &session_id, args.timeout_ms).await?;
            }
        }

        Ok::<(), anyhow::Error>(())
    })
}

fn parse_args() -> Result<Args> {
    let mut connection_file: Option<String> = None;
    let mut ip_address: Option<String> = None;
    let mut timeout_ms = DEFAULT_TIMEOUT_MS;
    let mut mode = Mode::Lsp;
    let mut code: Option<String> = None;
    let mut code_is_base64 = false;
    let mut wait_for_idle = false;

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--connection-file" => {
                connection_file = args.next();
            }
            "--ip-address" => {
                ip_address = args.next();
            }
            "--timeout-ms" => {
                if let Some(value) = args.next() {
                    timeout_ms = value.parse::<u64>().unwrap_or(DEFAULT_TIMEOUT_MS);
                }
            }
            "--execute" => {
                mode = Mode::Execute;
            }
            "--watch-plot" => {
                mode = Mode::WatchPlot;
            }
            "--check" => {
                mode = Mode::Check;
            }
            "--code" => {
                code = args.next();
            }
            "--code-base64" => {
                code_is_base64 = true;
            }
            "--wait-for-idle" => {
                wait_for_idle = true;
            }
            "-h" | "--help" => {
                print_usage();
                std::process::exit(0);
            }
            _ => {}
        }
    }

    let connection_file = connection_file.ok_or_else(|| anyhow!("--connection-file is required"))?;
    if matches!(mode, Mode::Execute) && code.is_none() {
        return Err(anyhow!("--code is required for --execute"));
    }
    if matches!(mode, Mode::Lsp) && ip_address.is_none() {
        return Err(anyhow!("--ip-address is required"));
    }

    Ok(Args {
        connection_file,
        ip_address,
        timeout_ms,
        mode,
        code,
        code_is_base64,
        wait_for_idle,
    })
}

fn print_usage() {
    eprintln!("Usage:");
    eprintln!("  vscode-r-ark-sidecar --connection-file <path> --ip-address <addr> [--timeout-ms <ms>]");
    eprintln!("  vscode-r-ark-sidecar --execute --connection-file <path> --code <text> [--code-base64] [--timeout-ms <ms>] [--wait-for-idle]");
    eprintln!("  vscode-r-ark-sidecar --watch-plot --connection-file <path> [--timeout-ms <ms>]");
    eprintln!("  vscode-r-ark-sidecar --check --connection-file <path> [--timeout-ms <ms>]");
}

fn read_connection(path: &str) -> Result<ConnectionInfo> {
    let content = fs::read_to_string(path)?;
    let info: ConnectionInfo = serde_json::from_str(&content)?;
    Ok(info)
}

fn decode_code(args: &Args) -> Result<String> {
    let code = args.code.clone().unwrap_or_default();
    if args.code_is_base64 {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(code.as_bytes())
            .context("Failed to decode base64 code")?;
        let decoded = String::from_utf8(bytes).context("Decoded code is not valid UTF-8")?;
        Ok(decoded)
    } else {
        Ok(code)
    }
}

async fn run_lsp(
    connection: &ConnectionInfo,
    session_id: &str,
    ip_address: &str,
    timeout_ms: u64,
) -> Result<()> {
    let mut iopub = create_client_iopub_connection(connection, "", session_id)
        .await
        .context("Failed to connect iopub")?;
    let mut shell = create_shell_connection(connection, session_id)
        .await
        .context("Failed to connect shell")?;

    wait_for_iopub_welcome(&mut iopub, Duration::from_millis(timeout_ms)).await?;

    let comm_id = Uuid::new_v4().to_string();
    send_comm_open(&mut shell, &comm_id, ip_address).await?;
    log_debug("Sidecar: sent comm_open.");

    let port = wait_for_comm_port(&mut iopub, &comm_id, Duration::from_millis(timeout_ms)).await?;
    let payload = json!({
        "event": "lsp_port",
        "port": port,
    });
    println!("{payload}");

    Ok(())
}

async fn run_execute_request(
    connection: &ConnectionInfo,
    session_id: &str,
    code: &str,
    timeout_ms: u64,
    wait_for_idle: bool,
) -> Result<()> {
    let mut iopub = create_client_iopub_connection(connection, "", session_id)
        .await
        .context("Failed to connect iopub")?;
    let mut shell = create_shell_connection(connection, session_id)
        .await
        .context("Failed to connect shell")?;

    wait_for_iopub_welcome(&mut iopub, Duration::from_millis(timeout_ms)).await?;

    let execute_request = ExecuteRequest::new(code.to_string());
    let message = JupyterMessage::new(execute_request, None);
    let msg_id = message.header.msg_id.clone();
    shell.send(message).await.context("Failed to send execute_request")?;

    if wait_for_idle {
        wait_for_iopub_idle(&mut iopub, &msg_id, Duration::from_millis(timeout_ms)).await?;
    }

    Ok(())
}

async fn run_plot_watcher(
    connection: &ConnectionInfo,
    session_id: &str,
    timeout_ms: u64,
) -> Result<()> {
    let mut iopub = create_client_iopub_connection(connection, "", session_id)
        .await
        .context("Failed to connect iopub")?;
    let mut shell = create_shell_connection(connection, session_id)
        .await
        .context("Failed to connect shell")?;

    // Spawn a task to handle stdin commands (for sending RPC requests to backend)
    // We do this BEFORE waiting for IOPub welcome, so that we can send comm_open (positron.ui)
    // immediately. This ensures Ark knows about the UI even if IOPub is slow/flaky.
    tokio::spawn(async move {
        let stdin = tokio::io::stdin();
        let mut reader = BufReader::new(stdin).lines();

        while let Ok(Some(line)) = reader.next_line().await {
            if let Ok(json) = serde_json::from_str::<Value>(&line) {
                if let Some(command) = json.get("command").and_then(|c| c.as_str()) {
                    if command == "comm_msg" {
                        if let (Some(comm_id), Some(data)) = (
                            json.get("comm_id").and_then(|s| s.as_str()),
                            json.get("data").and_then(|d| d.as_object()),
                        ) {
                            let comm_msg = CommMsg {
                                comm_id: CommId(comm_id.to_string()),
                                data: data.clone(),
                            };
                            let message = JupyterMessage::new(comm_msg, None);
                            if let Err(e) = shell.send(message).await {
                                eprintln!("Failed to send comm_msg: {}", e);
                            }
                        }
                    } else if command == "comm_open" {
                        if let (Some(comm_id), Some(target_name), Some(data)) = (
                            json.get("comm_id").and_then(|s| s.as_str()),
                            json.get("target_name").and_then(|s| s.as_str()),
                            json.get("data").and_then(|d| d.as_object()),
                        ) {
                            let comm_open = CommOpen {
                                comm_id: CommId(comm_id.to_string()),
                                target_name: target_name.to_string(),
                                data: data.clone(),
                                target_module: None,
                            };
                            let message = JupyterMessage::new(comm_open, None);
                            if let Err(e) = shell.send(message).await {
                                eprintln!("Failed to send comm_open: {}", e);
                            }
                        }
                    } else if command == "comm_close" {
                        if let Some(comm_id) = json.get("comm_id").and_then(|s| s.as_str()) {
                            let data = json.get("data").and_then(|d| d.as_object()).cloned().unwrap_or_default();
                            let comm_close = runtimelib::CommClose {
                                comm_id: CommId(comm_id.to_string()),
                                data,
                            };
                            let message = JupyterMessage::new(comm_close, None);
                            if let Err(e) = shell.send(message).await {
                                eprintln!("Failed to send comm_close: {}", e);
                            }
                        }
                    }
                }
            }
        }
    });

    // We no longer wait for IOPub welcome. When attaching to an existing session,
    // the kernel might not send a welcome message, or it might have already sent it.
    // Also, waiting for it might cause us to drop other important messages (like plot data)
    // that arrive in the meantime. We just start listening.
    // wait_for_iopub_welcome(&mut iopub, Duration::from_millis(timeout_ms)).await?;

    loop {
        let message = iopub.read().await.context("Failed to read iopub message")?;
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
                } else {
                    None
                }
            }
            JupyterMessageContent::CommMsg(comm_msg) => {
                // Check if this is a UI comm message with show_html_file method
                if let Some(method) = comm_msg.data.get("method").and_then(|m| m.as_str()) {
                    if method == "show_html_file" {
                        Some(json!({
                            "event": "show_html_file",
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
            _ => None,
        };

        if let Some(payload) = payload {
            println!("{payload}");
        }
    }
}

async fn run_check(
    connection: &ConnectionInfo,
    session_id: &str,
    timeout_ms: u64,
) -> Result<()> {
    let mut shell = create_shell_connection(connection, session_id)
        .await
        .context("Failed to connect shell")?;

    let request = KernelInfoRequest {};
    let message = JupyterMessage::new(request, None);
    let msg_id = message.header.msg_id.clone();
    shell.send(message).await.context("Failed to send kernel_info_request")?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .unwrap_or(Duration::from_millis(0));
        if remaining.is_zero() {
            return Err(anyhow!("Timed out waiting for kernel_info_reply"));
        }
        let msg = tokio::time::timeout(remaining, shell.read())
            .await
            .context("Timed out waiting for kernel_info_reply")??;

        if msg.parent_header.as_ref().map(|h| h.msg_id.as_str()) == Some(&msg_id) {
            if matches!(msg.content, JupyterMessageContent::KernelInfoReply(_)) {
                break;
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

fn extract_png_data(media: &runtimelib::Media) -> Option<String> {
    for item in &media.content {
        if let runtimelib::MediaType::Png(data) = item {
            return Some(data.clone());
        }
    }
    None
}

async fn send_comm_open(
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

async fn create_shell_connection(
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

async fn wait_for_iopub_welcome(
    iopub: &mut runtimelib::ClientIoPubConnection,
    timeout: Duration,
) -> Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .unwrap_or(Duration::from_millis(0));
        if remaining.is_zero() {
            return Err(anyhow!("Timed out waiting for iopub_welcome"));
        }
        let message = tokio::time::timeout(remaining, iopub.read())
            .await
            .map_err(|_| anyhow!("Timed out waiting for iopub_welcome"))??;
        if debug_enabled() {
            log_debug(&format!(
                "Sidecar: iopub message while waiting for welcome: {}",
                message.content.message_type()
            ));
        }
        if matches!(message.content, JupyterMessageContent::IoPubWelcome(_)) {
            log_debug("Sidecar: received iopub_welcome");
            return Ok(());
        }
    }
}

async fn wait_for_iopub_idle(
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

async fn wait_for_comm_port(
    iopub: &mut runtimelib::ClientIoPubConnection,
    comm_id: &str,
    timeout: Duration,
) -> Result<u16> {
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
        if debug_enabled() {
            log_debug(&format!(
                "Sidecar: iopub message while waiting for port: {}",
                content.message_type()
            ));
        }
        if let JupyterMessageContent::StreamContent(stream) = &content {
            if debug_enabled() {
                log_debug(&format!(
                    "Sidecar: iopub stream ({:?}): {}",
                    stream.name, stream.text
                ));
            }
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
        if debug_enabled() {
            log_debug(&format!("Sidecar: comm_msg data: {}", Value::Object(comm_msg.data.clone())));
        }
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
