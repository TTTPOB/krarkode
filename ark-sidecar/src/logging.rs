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

pub(crate) fn init_logging() -> LogReloadHandle {
    let filter = build_env_filter();
    let show_target = matches!(filter.max_level_hint(), Some(level) if level >= LevelFilter::DEBUG);
    let (reload_layer, handle) = reload::Layer::new(filter);
    let subscriber = tracing_subscriber::registry().with(reload_layer).with(
        tracing_subscriber::fmt::layer()
            .json()
            .with_target(show_target),
    );
    let _ = subscriber.try_init();
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
