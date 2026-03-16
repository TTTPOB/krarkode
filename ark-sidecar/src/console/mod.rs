mod highlighter;
mod history;
mod r_parser;
mod validator;

use anyhow::Result;
use runtimelib::ConnectionInfo;
use tracing::debug;

pub(crate) async fn run_console(
    _connection_info: &ConnectionInfo,
    _session_id: &str,
) -> Result<()> {
    debug!("Console mode: stub — not yet implemented");
    Ok(())
}
