use anyhow::{anyhow, Context, Result};
use base64::Engine;
use std::env;

use crate::types::{Args, Mode, DEFAULT_TIMEOUT_MS};

pub(crate) fn parse_args() -> Result<Args> {
    parse_args_from(env::args().skip(1))
}

fn parse_args_from<I>(args: I) -> Result<Args>
where
    I: IntoIterator<Item = String>,
{
    let mut connection_file: Option<String> = None;
    let mut ip_address: Option<String> = None;
    let mut timeout_ms = DEFAULT_TIMEOUT_MS;
    let mut mode = Mode::Lsp;
    let mut code: Option<String> = None;
    let mut code_is_base64 = false;
    let mut wait_for_idle = false;

    let mut args = args.into_iter();
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

#[cfg(test)]
mod tests {
    use super::{decode_code, parse_args_from};
    use crate::types::{Args, Mode, DEFAULT_TIMEOUT_MS};
    use base64::Engine;

    #[test]
    fn parse_args_defaults_to_lsp() {
        let args = parse_args_from(vec![
            "--connection-file".to_string(),
            "connection.json".to_string(),
            "--ip-address".to_string(),
            "127.0.0.1".to_string(),
        ])
        .expect("parse args");

        assert!(matches!(args.mode, Mode::Lsp));
        assert_eq!(args.connection_file, "connection.json");
        assert_eq!(args.ip_address.as_deref(), Some("127.0.0.1"));
        assert_eq!(args.timeout_ms, DEFAULT_TIMEOUT_MS);
    }

    #[test]
    fn parse_args_execute_sets_code() {
        let args = parse_args_from(vec![
            "--execute".to_string(),
            "--connection-file".to_string(),
            "connection.json".to_string(),
            "--code".to_string(),
            "1 + 1".to_string(),
            "--wait-for-idle".to_string(),
        ])
        .expect("parse args");

        assert!(matches!(args.mode, Mode::Execute));
        assert_eq!(args.code.as_deref(), Some("1 + 1"));
        assert!(args.wait_for_idle);
    }

    #[test]
    fn decode_code_handles_base64() {
        let encoded = base64::engine::general_purpose::STANDARD.encode("plot(1:10)");
        let args = Args {
            connection_file: "connection.json".to_string(),
            ip_address: None,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            mode: Mode::Execute,
            code: Some(encoded),
            code_is_base64: true,
            wait_for_idle: false,
        };

        let decoded = decode_code(&args).expect("decode code");
        assert_eq!(decoded, "plot(1:10)");
    }

    #[test]
    fn decode_code_returns_plain_text() {
        let args = Args {
            connection_file: "connection.json".to_string(),
            ip_address: None,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            mode: Mode::Execute,
            code: Some("summary(x)".to_string()),
            code_is_base64: false,
            wait_for_idle: false,
        };

        let decoded = decode_code(&args).expect("decode code");
        assert_eq!(decoded, "summary(x)");
    }
}
