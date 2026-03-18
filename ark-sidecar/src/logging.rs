use std::io::Write;

use tracing::level_filters::LevelFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::reload;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

const SIDECAR_LOG_TARGET: &str = "vscode_r_ark_sidecar";

#[derive(Clone)]
pub(crate) struct LogReloadHandle {
    handle: reload::Handle<EnvFilter, tracing_subscriber::Registry>,
}

pub(crate) fn init_logging(console_mode: bool) -> LogReloadHandle {
    let filter = build_env_filter();
    let show_target = matches!(filter.max_level_hint(), Some(level) if level >= LevelFilter::DEBUG);
    let (reload_layer, handle) = reload::Layer::new(filter);

    if console_mode {
        // Human-readable compact format on stderr for console mode.
        // Use RawTerminalWriter to emit \r\n instead of \n, because
        // reedline puts the terminal in raw mode where \n alone does
        // not return the cursor to column 0.
        let subscriber = tracing_subscriber::registry().with(reload_layer).with(
            tracing_subscriber::fmt::layer()
                .compact()
                .with_writer(RawTerminalWriter::make_writer)
                .with_target(show_target),
        );
        let _ = subscriber.try_init();
    } else {
        // JSON format on stdout for extension consumption
        let subscriber = tracing_subscriber::registry().with(reload_layer).with(
            tracing_subscriber::fmt::layer()
                .json()
                .with_target(show_target),
        );
        let _ = subscriber.try_init();
    }

    LogReloadHandle { handle }
}

impl LogReloadHandle {
    pub(crate) fn reload_from_env(&self) {
        self.reload_filter(build_env_filter(), "env", None);
    }

    pub(crate) fn reload_with_level(&self, level: &str) {
        match build_level_filter(level) {
            Some(filter) => self.reload_filter(filter, "level", Some(level)),
            None => {
                tracing::info!(log_level = %level, "Invalid log level; reloading from env.");
                self.reload_from_env();
            }
        }
    }

    fn reload_filter(&self, filter: EnvFilter, source: &str, level: Option<&str>) {
        match self.handle.reload(filter) {
            Ok(()) => {
                tracing::info!(
                    source = source,
                    log_level = level,
                    "Reloaded sidecar logging filter."
                );
            }
            Err(err) => {
                tracing::warn!(error = %err, source = source, log_level = level, "Failed to reload sidecar logging filter.");
            }
        }
    }
}

/// A writer that converts `\n` to `\r\n` on stderr.
///
/// When reedline has the terminal in raw mode, a bare `\n` only moves
/// the cursor down without returning to column 0. This wrapper ensures
/// every newline is a full `\r\n` so log lines start at the left edge.
struct RawTerminalWriter;

impl RawTerminalWriter {
    fn make_writer() -> Self {
        Self
    }
}

impl Write for RawTerminalWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut stderr = std::io::stderr().lock();
        let mut start = 0;
        for (i, &byte) in buf.iter().enumerate() {
            if byte == b'\n' {
                // Flush everything before the \n, then write \r\n
                if i > start {
                    stderr.write_all(&buf[start..i])?;
                }
                stderr.write_all(b"\r\n")?;
                start = i + 1;
            }
        }
        // Write remaining bytes after the last \n
        if start < buf.len() {
            stderr.write_all(&buf[start..])?;
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        std::io::stderr().flush()
    }
}

fn build_env_filter() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))
}

fn build_level_filter(level: &str) -> Option<EnvFilter> {
    let normalized = match level {
        "error" | "warn" | "info" | "debug" | "trace" => level,
        _ => return None,
    };
    EnvFilter::try_new(format!("{SIDECAR_LOG_TARGET}={normalized}")).ok()
}
