mod commands;
mod connection;
mod handlers;
mod logging;
mod types;

use anyhow::{anyhow, Context, Result};
use serde_json::json;
use tokio::runtime::Builder;
use tracing::error;
use uuid::Uuid;

use crate::commands::{decode_code, parse_args};
use crate::connection::read_connection;
use crate::handlers::{run_check, run_execute_request, run_lsp, run_plot_watcher};
use crate::logging::init_logging;
use crate::types::{Mode, SUPPORTED_SIGNATURE_SCHEME};

fn main() {
    let log_handle = init_logging();
    if let Err(err) = run(log_handle) {
        error!(error = ?err, "Ark sidecar error");
        let payload = json!({
            "event": "error",
            "message": err.to_string(),
        });
        println!("{payload}");
        std::process::exit(1);
    }
}

fn run(log_handle: crate::logging::LogReloadHandle) -> Result<()> {
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
                run_plot_watcher(&connection, &session_id, log_handle.clone()).await?;
            }
            Mode::Check => {
                run_check(&connection, &session_id, args.timeout_ms).await?;
            }
        }

        Ok::<(), anyhow::Error>(())
    })
}
