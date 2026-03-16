mod completer;
mod highlighter;
mod history;
mod kernel_loop;
mod output;
mod r_parser;
mod reedline_loop;
mod validator;

use anyhow::Result;
use runtimelib::ConnectionInfo;
use std::sync::mpsc as std_mpsc;
use tracing::{debug, info};

use completer::CompletionBridgeRequest;
use kernel_loop::{run_kernel_loop, ConsoleRequest};

/// Run the interactive R console.
///
/// Sets up channels between the blocking reedline loop and the async
/// kernel event loop, then runs both concurrently.
pub(crate) async fn run_console(
    connection_info: &ConnectionInfo,
    session_id: &str,
) -> Result<()> {
    info!(mode = "console", "Sidecar: starting console mode");

    // Channel: reedline -> kernel (execute/exit requests)
    let (request_tx, request_rx) = tokio::sync::mpsc::channel::<ConsoleRequest>(16);

    // Channel: kernel -> reedline (real-time execution output)
    let (exec_output_tx, exec_output_rx) = std_mpsc::channel();

    // Channel: completer -> kernel (completion requests, separate from main requests)
    let (complete_tx, complete_rx) =
        tokio::sync::mpsc::channel::<CompletionBridgeRequest>(16);

    // Clone connection info for the blocking task
    let conn_info = connection_info.clone();
    let sess_id = session_id.to_string();

    // Spawn the blocking reedline loop
    let reedline_handle = tokio::task::spawn_blocking(move || {
        reedline_loop::run_reedline_loop(request_tx, exec_output_rx, complete_tx);
    });

    // Run the async kernel loop (in the current task)
    let kernel_result =
        run_kernel_loop(&conn_info, &sess_id, request_rx, complete_rx, exec_output_tx).await;

    // Wait for reedline to finish
    let _ = reedline_handle.await;

    debug!("Console mode: finished");

    kernel_result
}
