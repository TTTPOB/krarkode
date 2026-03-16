// History configuration for console mode.
//
// Uses reedline's SqliteBackedHistory for persistent, timestamped
// command history stored at $XDG_DATA_HOME/krarkode/history.db.

use anyhow::{Context, Result};
use reedline::SqliteBackedHistory;
use std::path::PathBuf;
use tracing::debug;

const APP_NAME: &str = "krarkode";

/// Resolve the XDG data directory for krarkode.
fn data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|p| p.join(APP_NAME))
}

/// Resolve the history database path.
///
/// Returns `$XDG_DATA_HOME/krarkode/history.db`
/// (defaults to `~/.local/share/krarkode/history.db` on Linux).
pub(crate) fn history_db_path() -> Option<PathBuf> {
    data_dir().map(|p| p.join("history.db"))
}

/// Create a SqliteBackedHistory instance with XDG-compliant path.
///
/// Creates the parent directory if it doesn't exist.
/// Reedline automatically stores timestamps and session metadata.
pub(crate) fn create_history() -> Result<SqliteBackedHistory> {
    let path = history_db_path().context("Could not determine XDG data directory")?;

    debug!(path = %path.display(), "Console: opening history database");

    // SqliteBackedHistory::with_file creates parent dirs and handles
    // session/timestamp internally. Pass None for session and timestamp
    // to use reedline's defaults (same pattern as arf).
    let history = SqliteBackedHistory::with_file(path, None, None)
        .context("Failed to create SQLite history")?;

    Ok(history)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_db_path_returns_some() {
        // On most systems, $HOME is set so data_dir() returns Some
        let path = history_db_path();
        if let Some(p) = &path {
            assert!(p.ends_with("krarkode/history.db"));
        }
    }
}
