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
use runtimelib::{create_client_iopub_connection, ConnectionInfo};
use std::sync::mpsc as std_mpsc;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::connection::{create_shell_connection, send_comm_open, wait_for_comm_port};
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

    // Channel: reedline -> kernel (execute/exit requests)
    let (request_tx, request_rx) = tokio::sync::mpsc::channel::<ConsoleRequest>(16);

    // Channel: kernel -> reedline (real-time execution output)
    let (exec_output_tx, exec_output_rx) = std_mpsc::channel();

    // Clone connection info for the blocking task
    let conn_info = connection_info.clone();
    let sess_id = session_id.to_string();
    let runtime_handle = tokio::runtime::Handle::current();

    // Spawn the blocking reedline loop
    let reedline_handle = tokio::task::spawn_blocking(move || {
        reedline_loop::run_reedline_loop(
            request_tx,
            exec_output_rx,
            lsp_client,
            runtime_handle,
        );
    });

    // Run the async kernel loop (in the current task)
    let kernel_result = run_kernel_loop(&conn_info, &sess_id, request_rx, exec_output_tx).await;

    // Wait for reedline to finish
    let _ = reedline_handle.await;

    debug!("Console mode: finished");

    kernel_result
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
