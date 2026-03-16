use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(name = "vscode-r-ark-sidecar", about = "Ark kernel sidecar for VS Code R extension")]
pub(crate) struct Cli {
    #[command(subcommand)]
    pub(crate) command: Command,
}

#[derive(Subcommand, Debug)]
pub(crate) enum Command {
    /// Start LSP mode: open comm and retrieve LSP port
    Lsp {
        /// Path to Jupyter connection file
        #[arg(long)]
        connection_file: String,

        /// IP address to bind the LSP server
        #[arg(long)]
        ip_address: String,

        /// Timeout in milliseconds
        #[arg(long, default_value_t = DEFAULT_TIMEOUT_MS)]
        timeout_ms: u64,
    },

    /// Execute R code via the kernel
    Execute {
        /// Path to Jupyter connection file
        #[arg(long)]
        connection_file: String,

        /// R code to execute
        #[arg(long)]
        code: String,

        /// Code is base64 encoded
        #[arg(long, default_value_t = false)]
        code_base64: bool,

        /// Wait for kernel to return to idle
        #[arg(long, default_value_t = false)]
        wait_for_idle: bool,

        /// Timeout in milliseconds
        #[arg(long, default_value_t = DEFAULT_TIMEOUT_MS)]
        timeout_ms: u64,
    },

    /// Watch for plot updates from the kernel
    WatchPlot {
        /// Path to Jupyter connection file
        #[arg(long)]
        connection_file: String,

        /// Timeout in milliseconds
        #[arg(long, default_value_t = DEFAULT_TIMEOUT_MS)]
        timeout_ms: u64,
    },

    /// Check kernel liveness
    Check {
        /// Path to Jupyter connection file
        #[arg(long)]
        connection_file: String,

        /// Timeout in milliseconds
        #[arg(long, default_value_t = DEFAULT_TIMEOUT_MS)]
        timeout_ms: u64,
    },

    /// Interactive R console REPL
    Console {
        /// Path to Jupyter connection file
        #[arg(long)]
        connection_file: String,
    },
}

pub(crate) const LSP_COMM_TARGET: &str = "positron.lsp";
pub(crate) const PLOT_COMM_TARGET: &str = "positron.plot";
pub(crate) const UI_COMM_TARGET: &str = "positron.ui";
pub(crate) const HELP_COMM_TARGET: &str = "positron.help";
pub(crate) const VARIABLES_COMM_TARGET: &str = "positron.variables";
pub(crate) const DATA_EXPLORER_COMM_TARGET: &str = "positron.dataExplorer";
pub(crate) const DEFAULT_TIMEOUT_MS: u64 = 15000;
pub(crate) const SUPPORTED_SIGNATURE_SCHEME: &str = "hmac-sha256";
