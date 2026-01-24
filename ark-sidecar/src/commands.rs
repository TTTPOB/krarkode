use anyhow::{anyhow, Context, Result};
use base64::Engine;
use std::env;

use crate::types::{Args, Mode, DEFAULT_TIMEOUT_MS};

pub(crate) fn parse_args() -> Result<Args> {
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

    let connection_file =
        connection_file.ok_or_else(|| anyhow!("--connection-file is required"))?;
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
    eprintln!(
        "  vscode-r-ark-sidecar --connection-file <path> --ip-address <addr> [--timeout-ms <ms>]"
    );
    eprintln!("  vscode-r-ark-sidecar --execute --connection-file <path> --code <text> [--code-base64] [--timeout-ms <ms>] [--wait-for-idle]");
    eprintln!("  vscode-r-ark-sidecar --watch-plot --connection-file <path> [--timeout-ms <ms>]");
    eprintln!("  vscode-r-ark-sidecar --check --connection-file <path> [--timeout-ms <ms>]");
}

pub(crate) fn decode_code(args: &Args) -> Result<String> {
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
