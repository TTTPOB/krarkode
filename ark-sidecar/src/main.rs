mod commands;
mod connection;
mod console;
mod handlers;
mod logging;
mod lsp_client;
mod protocol;
mod types;

use anyhow::{anyhow, Context, Result};
use tokio::runtime::Builder;
use tracing::error;
use uuid::Uuid;

use crate::commands::{decode_code, parse_args};
use crate::connection::read_connection;
use crate::console::run_console;
use crate::handlers::{run_check, run_execute_request, run_lsp, run_plot_watcher};
use crate::logging::init_logging;
use crate::protocol::{emit_event, SidecarEvent};
use crate::types::{Command, SUPPORTED_SIGNATURE_SCHEME};

fn main() {
    let log_handle = init_logging();
    if let Err(err) = run(log_handle) {
        error!(error = ?err, "Ark sidecar error");
        emit_event(SidecarEvent::Error {
            message: err.to_string(),
        });
        std::process::exit(1);
    }
}

fn run(log_handle: crate::logging::LogReloadHandle) -> Result<()> {
    let cli = parse_args();

    // Extract connection_file from any command variant
    let connection_file = match &cli.command {
        Command::Lsp {
            connection_file, ..
        }
        | Command::Execute {
            connection_file, ..
        }
        | Command::WatchPlot {
            connection_file, ..
        }
        | Command::Check {
            connection_file, ..
        }
        | Command::Console {
            connection_file, ..
        } => connection_file,
    };

    let connection = read_connection(connection_file)?;

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
        match cli.command {
            Command::Lsp {
                ip_address,
                timeout_ms,
                ..
            } => {
                run_lsp(&connection, &session_id, &ip_address, timeout_ms).await?;
            }
            Command::Execute {
                code,
                code_base64,
                wait_for_idle,
                timeout_ms,
                ..
            } => {
                let code = decode_code(&code, code_base64)?;
                run_execute_request(&connection, &session_id, &code, timeout_ms, wait_for_idle)
                    .await?;
            }
            Command::WatchPlot { timeout_ms, .. } => {
                // timeout_ms is available but run_plot_watcher doesn't use it directly
                let _ = timeout_ms;
                run_plot_watcher(&connection, &session_id, log_handle.clone()).await?;
            }
            Command::Check { timeout_ms, .. } => {
                run_check(&connection, &session_id, timeout_ms).await?;
            }
            Command::Console { .. } => {
                run_console(&connection, &session_id).await?;
            }
        }

        Ok::<(), anyhow::Error>(())
    })
}
