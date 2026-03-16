use anyhow::{Context, Result};
use base64::Engine;
use clap::Parser;

use crate::types::Cli;

pub(crate) fn parse_args() -> Cli {
    Cli::parse()
}

pub(crate) fn decode_code(code: &str, is_base64: bool) -> Result<String> {
    if is_base64 {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(code.as_bytes())
            .context("Failed to decode base64 code")?;
        let decoded = String::from_utf8(bytes).context("Decoded code is not valid UTF-8")?;
        Ok(decoded)
    } else {
        Ok(code.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Command;

    fn parse_from(args: &[&str]) -> Cli {
        Cli::parse_from(args)
    }

    #[test]
    fn parse_lsp_mode() {
        let cli = parse_from(&[
            "sidecar",
            "lsp",
            "--connection-file",
            "connection.json",
            "--ip-address",
            "127.0.0.1",
        ]);
        match cli.command {
            Command::Lsp {
                connection_file,
                ip_address,
                timeout_ms,
            } => {
                assert_eq!(connection_file, "connection.json");
                assert_eq!(ip_address, "127.0.0.1");
                assert_eq!(timeout_ms, crate::types::DEFAULT_TIMEOUT_MS);
            }
            _ => panic!("Expected Lsp command"),
        }
    }

    #[test]
    fn parse_execute_mode() {
        let cli = parse_from(&[
            "sidecar",
            "execute",
            "--connection-file",
            "connection.json",
            "--code",
            "1 + 1",
            "--wait-for-idle",
        ]);
        match cli.command {
            Command::Execute {
                code,
                wait_for_idle,
                ..
            } => {
                assert_eq!(code, "1 + 1");
                assert!(wait_for_idle);
            }
            _ => panic!("Expected Execute command"),
        }
    }

    #[test]
    fn parse_console_mode() {
        let cli = parse_from(&[
            "sidecar",
            "console",
            "--connection-file",
            "connection.json",
        ]);
        assert!(matches!(cli.command, Command::Console { .. }));
    }

    #[test]
    fn parse_check_mode() {
        let cli = parse_from(&[
            "sidecar",
            "check",
            "--connection-file",
            "connection.json",
            "--timeout-ms",
            "5000",
        ]);
        match cli.command {
            Command::Check { timeout_ms, .. } => {
                assert_eq!(timeout_ms, 5000);
            }
            _ => panic!("Expected Check command"),
        }
    }

    #[test]
    fn parse_watch_plot_mode() {
        let cli = parse_from(&[
            "sidecar",
            "watch-plot",
            "--connection-file",
            "connection.json",
        ]);
        assert!(matches!(cli.command, Command::WatchPlot { .. }));
    }

    #[test]
    fn decode_code_handles_base64() {
        let encoded = base64::engine::general_purpose::STANDARD.encode("plot(1:10)");
        let decoded = decode_code(&encoded, true).expect("decode code");
        assert_eq!(decoded, "plot(1:10)");
    }

    #[test]
    fn decode_code_returns_plain_text() {
        let decoded = decode_code("summary(x)", false).expect("decode code");
        assert_eq!(decoded, "summary(x)");
    }
}
