use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::reload;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

#[derive(Clone)]
pub(crate) struct LogReloadHandle {
    handle: reload::Handle<EnvFilter, tracing_subscriber::Registry>,
}

pub(crate) fn init_logging() -> LogReloadHandle {
    let filter = build_env_filter();
    let (reload_layer, handle) = reload::Layer::new(filter);
    let subscriber = tracing_subscriber::registry()
        .with(reload_layer)
        .with(tracing_subscriber::fmt::layer().with_target(false));
    let _ = subscriber.try_init();
    LogReloadHandle { handle }
}

impl LogReloadHandle {
    pub(crate) fn reload_from_env(&self) {
        let filter = build_env_filter();
        match self.handle.reload(filter) {
            Ok(()) => {
                tracing::info!("Reloaded sidecar logging filter from env.");
            }
            Err(err) => {
                tracing::warn!(error = %err, "Failed to reload sidecar logging filter.");
            }
        }
    }
}

fn build_env_filter() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))
}
