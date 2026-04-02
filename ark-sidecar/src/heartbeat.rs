// Shared heartbeat monitor for detecting kernel death.
//
// Used by both watch-plot mode and console mode to detect when the
// Jupyter kernel has exited. ZMQ PUB/SUB sockets never signal peer
// disconnection, so we must actively probe the kernel's heartbeat port.

use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing::{debug, warn};

use runtimelib::create_client_heartbeat_connection;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
const HEARTBEAT_CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(1);
const HEARTBEAT_FAILURE_THRESHOLD: u32 = 2;

#[derive(Debug, Default)]
struct HeartbeatMonitorState {
    consecutive_failures: u32,
}

impl HeartbeatMonitorState {
    fn consecutive_failures(&self) -> u32 {
        self.consecutive_failures
    }

    fn record_success(&mut self) -> bool {
        let had_failures = self.consecutive_failures > 0;
        self.consecutive_failures = 0;
        had_failures
    }

    fn record_failure(&mut self) -> bool {
        self.consecutive_failures += 1;
        self.consecutive_failures >= HEARTBEAT_FAILURE_THRESHOLD
    }
}

/// Spawn a heartbeat monitor task that periodically probes the kernel.
///
/// Returns `(disconnect_rx, handle)`. When the kernel is confirmed dead,
/// a reason string is sent on `disconnect_rx`. Call `stop()` to abort.
pub(crate) fn spawn_heartbeat_monitor(
    connection_info: runtimelib::ConnectionInfo,
) -> (mpsc::Receiver<String>, JoinHandle<()>) {
    let (disconnect_tx, disconnect_rx) = mpsc::channel::<String>(1);
    let handle = tokio::spawn(run_heartbeat_monitor(connection_info, disconnect_tx));
    (disconnect_rx, handle)
}

/// Abort the heartbeat monitor task.
pub(crate) fn stop_heartbeat_monitor(handle: JoinHandle<()>) {
    handle.abort();
}

async fn run_heartbeat_monitor(
    connection_info: runtimelib::ConnectionInfo,
    disconnect_tx: mpsc::Sender<String>,
) {
    let mut interval = tokio::time::interval(HEARTBEAT_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    interval.tick().await;

    let mut heartbeat = None;
    let mut state = HeartbeatMonitorState::default();

    loop {
        interval.tick().await;

        if heartbeat.is_none() {
            let failures_before = state.consecutive_failures();
            debug!(
                failures_before = failures_before,
                timeout_ms = HEARTBEAT_CONNECT_TIMEOUT.as_millis(),
                "Heartbeat: creating connection"
            );
            match tokio::time::timeout(
                HEARTBEAT_CONNECT_TIMEOUT,
                create_client_heartbeat_connection(&connection_info),
            )
            .await
            {
                Ok(Ok(connection)) => {
                    debug!(
                        failures_before = failures_before,
                        "Heartbeat: connection created"
                    );
                    heartbeat = Some(connection);
                }
                Err(_) => {
                    warn!(
                        failures_before = failures_before,
                        timeout_ms = HEARTBEAT_CONNECT_TIMEOUT.as_millis(),
                        "Heartbeat: timed out creating connection"
                    );
                    if record_heartbeat_failure(
                        &mut state,
                        &disconnect_tx,
                        format!(
                            "heartbeat connection timed out after {}ms",
                            HEARTBEAT_CONNECT_TIMEOUT.as_millis()
                        ),
                    )
                    .await
                    {
                        break;
                    }
                    continue;
                }
                Ok(Err(err)) => {
                    let err_text = format!("{err:?}");
                    warn!(
                        error = %err_text,
                        failures_before = failures_before,
                        "Heartbeat: failed to create connection"
                    );
                    if record_heartbeat_failure(
                        &mut state,
                        &disconnect_tx,
                        format!("failed to connect heartbeat socket: {err}"),
                    )
                    .await
                    {
                        break;
                    }
                    continue;
                }
            }
        }

        let Some(connection) = heartbeat.as_mut() else {
            continue;
        };

        match tokio::time::timeout(HEARTBEAT_TIMEOUT, connection.single_heartbeat()).await {
            Ok(Ok(())) => {
                let failures_before = state.consecutive_failures();
                if state.record_success() {
                    debug!(
                        failures_before = failures_before,
                        "Heartbeat: probe succeeded after previous failures"
                    );
                } else {
                    debug!("Heartbeat: probe succeeded");
                }
            }
            Ok(Err(err)) => {
                heartbeat = None;
                let err_text = format!("{err:?}");
                let failures_before = state.consecutive_failures();
                warn!(
                    error = %err_text,
                    failures_before = failures_before,
                    "Heartbeat: probe failed"
                );
                if record_heartbeat_failure(
                    &mut state,
                    &disconnect_tx,
                    format!("heartbeat probe failed: {err}"),
                )
                .await
                {
                    break;
                }
            }
            Err(_) => {
                heartbeat = None;
                let failures_before = state.consecutive_failures();
                warn!(
                    failures_before = failures_before,
                    timeout_ms = HEARTBEAT_TIMEOUT.as_millis(),
                    "Heartbeat: probe timed out"
                );
                if record_heartbeat_failure(
                    &mut state,
                    &disconnect_tx,
                    format!(
                        "heartbeat probe timed out after {}ms",
                        HEARTBEAT_TIMEOUT.as_millis()
                    ),
                )
                .await
                {
                    break;
                }
            }
        }
    }

    debug!("Heartbeat: monitor exiting");
}

async fn record_heartbeat_failure(
    state: &mut HeartbeatMonitorState,
    disconnect_tx: &mpsc::Sender<String>,
    reason: String,
) -> bool {
    let failures_before = state.consecutive_failures();
    let threshold_reached = state.record_failure();
    let failures_after = state.consecutive_failures();
    warn!(
        failures_before = failures_before,
        failures_after = failures_after,
        threshold = HEARTBEAT_FAILURE_THRESHOLD,
        threshold_reached = threshold_reached,
        reason = %reason,
        "Heartbeat: recorded failure"
    );
    if !threshold_reached {
        return false;
    }
    let _ = disconnect_tx.send(reason).await;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heartbeat_success_resets_failures() {
        let mut state = HeartbeatMonitorState::default();

        assert!(!state.record_failure());
        assert_eq!(state.consecutive_failures(), 1);
        assert!(state.record_success());
        assert_eq!(state.consecutive_failures(), 0);
    }

    #[test]
    fn heartbeat_requires_two_failures_to_disconnect() {
        let mut state = HeartbeatMonitorState::default();

        assert!(!state.record_failure());
        assert!(state.record_failure());
        assert_eq!(state.consecutive_failures(), HEARTBEAT_FAILURE_THRESHOLD);
    }

    #[test]
    fn heartbeat_failure_waits_for_second_probe() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("build tokio runtime");

        runtime.block_on(async {
            let (tx, mut rx) = mpsc::channel(1);
            let mut state = HeartbeatMonitorState::default();

            assert!(
                !record_heartbeat_failure(&mut state, &tx, "first".to_string()).await
            );
            assert!(rx.try_recv().is_err());
            assert_eq!(state.consecutive_failures(), 1);
            assert!(record_heartbeat_failure(&mut state, &tx, "second".to_string()).await);
            assert_eq!(rx.recv().await.as_deref(), Some("second"));
        });
    }

    #[test]
    fn heartbeat_connection_failure_counts_toward_disconnect_threshold() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("build tokio runtime");

        runtime.block_on(async {
            let (tx, mut rx) = mpsc::channel(1);
            let mut state = HeartbeatMonitorState::default();

            assert!(
                !record_heartbeat_failure(
                    &mut state,
                    &tx,
                    "heartbeat connection timed out after 1000ms".to_string(),
                )
                .await
            );
            assert_eq!(state.consecutive_failures(), 1);
            assert!(
                record_heartbeat_failure(&mut state, &tx, "heartbeat probe failed".to_string())
                    .await
            );
            assert_eq!(rx.recv().await.as_deref(), Some("heartbeat probe failed"));
        });
    }
}
