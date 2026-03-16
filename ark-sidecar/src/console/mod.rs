mod completer;
mod highlighter;
mod history;
mod kernel_loop;
mod output;
mod r_parser;
mod reedline_loop;
mod validator;

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use runtimelib::{
    create_client_iopub_connection, ConnectionInfo, ExecuteRequest, ExecutionState,
    JupyterMessage, JupyterMessageContent,
};
use std::sync::mpsc as std_mpsc;
use tokio::signal::unix::{signal, SignalKind};
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::connection::{
    create_control_connection, create_shell_connection, send_comm_open, wait_for_comm_port,
};
use crate::lsp_client::LspClient;
use kernel_loop::{run_kernel_loop, ConsoleRequest};

/// Run the interactive R console.
///
/// Sets up channels between the blocking reedline loop and the async
/// kernel event loop, then runs both concurrently. Optionally initializes
/// an LSP client for tab completion.
pub(crate) async fn run_console(
    connection_info: &ConnectionInfo,
    session_id: &str,
    r_binary_path: Option<&str>,
) -> Result<()> {
    info!(mode = "console", "Sidecar: starting console mode");

    // --- LSP Initialization (best-effort) ---
    let lsp_client = match init_lsp(connection_info, session_id).await {
        Ok(client) => {
            info!("Console: LSP client initialized, completion enabled");
            Some(Arc::new(client))
        }
        Err(err) => {
            warn!(error = ?err, "Console: failed to initialize LSP, completion disabled");
            None
        }
    };

    // --- Query R version (best-effort) ---
    let r_version = match query_r_version(connection_info, session_id).await {
        Ok(version) => {
            info!(version = %version, "Console: R version queried");
            Some(version)
        }
        Err(err) => {
            warn!(error = ?err, "Console: failed to query R version");
            None
        }
    };

    // --- Control channel for interrupt/shutdown ---
    let control = create_control_connection(connection_info, session_id)
        .await
        .context("Failed to connect control socket")?;

    // --- SIGINT handler ---
    // Register synchronously so the default SIGINT action (terminate process)
    // is replaced BEFORE the reedline loop starts. Previously this was inside
    // tokio::spawn, creating a race where SIGINT could arrive before the
    // spawned task was polled — killing the sidecar instead of interrupting Ark.
    let mut sigint = signal(SignalKind::interrupt())
        .context("Failed to register SIGINT handler")?;
    debug!("Console: SIGINT handler registered");

    let (interrupt_tx, interrupt_rx) = tokio::sync::mpsc::channel::<()>(4);
    tokio::spawn(async move {
        loop {
            sigint.recv().await;
            debug!("Console: SIGINT received, forwarding to kernel loop");
            if interrupt_tx.send(()).await.is_err() {
                debug!("Console: interrupt channel closed, SIGINT handler exiting");
                break;
            }
        }
    });

    // Channel: reedline -> kernel (execute/exit requests)
    let (request_tx, request_rx) = tokio::sync::mpsc::channel::<ConsoleRequest>(16);

    // Channel: kernel -> reedline (real-time execution output)
    let (exec_output_tx, exec_output_rx) = std_mpsc::channel();

    // Clone connection info for the blocking task
    let conn_info = connection_info.clone();
    let sess_id = session_id.to_string();
    let runtime_handle = tokio::runtime::Handle::current();
    let r_binary_path_owned = r_binary_path.map(|s| s.to_string());

    // Spawn the blocking reedline loop
    let reedline_handle = tokio::task::spawn_blocking(move || {
        reedline_loop::run_reedline_loop(
            request_tx,
            exec_output_rx,
            lsp_client,
            runtime_handle,
            r_version,
            r_binary_path_owned,
        );
    });

    // Run the async kernel loop (in the current task)
    let kernel_result = run_kernel_loop(
        &conn_info,
        &sess_id,
        request_rx,
        exec_output_tx,
        control,
        interrupt_rx,
    )
    .await;

    // Wait for reedline to finish
    let _ = reedline_handle.await;

    debug!("Console mode: finished");

    kernel_result
}

/// Query the R version string from the kernel by executing `cat(R.version.string)`.
///
/// Uses temporary shell+iopub connections (same pattern as LSP init).
async fn query_r_version(connection_info: &ConnectionInfo, session_id: &str) -> Result<String> {
    debug!("Console: querying R version from kernel");

    let mut iopub = create_client_iopub_connection(connection_info, "", session_id)
        .await
        .context("Failed to connect iopub for R version query")?;
    let mut shell = create_shell_connection(connection_info, session_id)
        .await
        .context("Failed to connect shell for R version query")?;

    // Execute cat(R.version.string) to get clean stdout output
    let execute_request = ExecuteRequest::new("cat(R.version.string)".to_string());
    let message = JupyterMessage::new(execute_request, None);
    let msg_id = message.header.msg_id.clone();
    shell
        .send(message)
        .await
        .context("Failed to send R version execute request")?;

    let mut version_output = String::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);

    loop {
        let remaining = deadline - tokio::time::Instant::now();
        if remaining.is_zero() {
            break;
        }

        match tokio::time::timeout(remaining, iopub.read()).await {
            Ok(Ok(message)) => {
                let parent_match = message
                    .parent_header
                    .as_ref()
                    .map(|h| h.msg_id == msg_id)
                    .unwrap_or(false);

                if !parent_match {
                    continue;
                }

                match &message.content {
                    JupyterMessageContent::StreamContent(stream) => {
                        version_output.push_str(&stream.text);
                    }
                    JupyterMessageContent::Status(status) => {
                        if status.execution_state == ExecutionState::Idle {
                            break;
                        }
                    }
                    _ => {}
                }
            }
            Ok(Err(err)) => {
                // Ignore comm_close errors
                let err_str = format!("{err:?}");
                if err_str.contains("comm_close") && err_str.contains("missing field `data`") {
                    continue;
                }
                debug!(error = ?err, "Console: iopub error during R version query");
                break;
            }
            Err(_) => {
                debug!("Console: timeout waiting for R version");
                break;
            }
        }
    }

    let version = version_output.trim().to_string();
    if version.is_empty() {
        anyhow::bail!("Empty R version response");
    }
    Ok(version)
    // iopub and shell connections are dropped here
}

/// Initialize the LSP client by negotiating with Ark via the Jupyter comm protocol.
///
/// Creates temporary shell+iopub connections for the comm handshake,
/// then connects to the LSP TCP server and performs LSP initialization.
async fn init_lsp(connection_info: &ConnectionInfo, session_id: &str) -> Result<LspClient> {
    let ip_address = &connection_info.ip;
    debug!(ip = %ip_address, "Console: initializing LSP client");

    // Create temporary connections for the comm handshake
    let mut iopub = create_client_iopub_connection(connection_info, "", session_id)
        .await
        .context("Failed to connect iopub for LSP init")?;
    let mut shell = create_shell_connection(connection_info, session_id)
        .await
        .context("Failed to connect shell for LSP init")?;

    // Send comm_open for LSP target
    let comm_id = Uuid::new_v4().to_string();
    send_comm_open(&mut shell, &comm_id, ip_address).await?;
    info!(comm_id = %comm_id, ip = %ip_address, "Console: sent LSP comm_open");

    // Wait for port from kernel
    let port = wait_for_comm_port(&mut iopub, &comm_id, Duration::from_millis(10_000)).await?;
    info!(port = port, "Console: received LSP port");

    // Connect to LSP server and initialize
    let client = LspClient::connect(ip_address, port).await?;
    client.initialize().await?;

    info!("Console: LSP client ready");
    Ok(client)
    // iopub and shell connections are dropped here -- they were only for the comm handshake
}
