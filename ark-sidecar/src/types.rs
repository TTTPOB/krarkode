#[derive(Debug)]
pub(crate) enum Mode {
    Lsp,
    Execute,
    WatchPlot,
    Check,
}

#[derive(Debug)]
pub(crate) struct Args {
    pub(crate) connection_file: String,
    pub(crate) ip_address: Option<String>,
    pub(crate) timeout_ms: u64,
    pub(crate) mode: Mode,
    pub(crate) code: Option<String>,
    pub(crate) code_is_base64: bool,
    pub(crate) wait_for_idle: bool,
}

pub(crate) const LSP_COMM_TARGET: &str = "positron.lsp";
pub(crate) const PLOT_COMM_TARGET: &str = "positron.plot";
pub(crate) const UI_COMM_TARGET: &str = "positron.ui";
pub(crate) const HELP_COMM_TARGET: &str = "positron.help";
pub(crate) const VARIABLES_COMM_TARGET: &str = "positron.variables";
pub(crate) const DATA_EXPLORER_COMM_TARGET: &str = "positron.dataExplorer";
pub(crate) const DEFAULT_TIMEOUT_MS: u64 = 15000;
pub(crate) const SUPPORTED_SIGNATURE_SCHEME: &str = "hmac-sha256";
