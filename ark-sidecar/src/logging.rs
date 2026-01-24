use std::env;

pub(crate) fn debug_enabled() -> bool {
    env::var("ARK_SIDECAR_DEBUG")
        .map(|val| val != "0")
        .unwrap_or(false)
}

pub(crate) fn log_debug(message: &str) {
    if debug_enabled() {
        eprintln!("{message}");
    }
}
