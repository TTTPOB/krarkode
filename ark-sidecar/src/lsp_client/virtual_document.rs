use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Result;
use lsp_types::CompletionResponse;
use tokio::runtime::Handle;
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{sleep_until, Instant};
use tracing::{debug, warn};

use super::LspClient;

const VIRTUAL_DOCUMENT_DEBOUNCE: Duration = Duration::from_millis(150);

#[derive(Debug, Clone)]
struct PendingSync {
    generation: u64,
    buffer: String,
    due_at: Instant,
}

#[derive(Debug, Default)]
struct DebounceState {
    latest_generation: u64,
    last_synced_generation: u64,
    latest_buffer: String,
    pending: Option<PendingSync>,
    task_running: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScheduleAction {
    Skipped,
    Scheduled,
    SpawnTask,
}

impl DebounceState {
    fn schedule(&mut self, buffer: &str, now: Instant, delay: Duration) -> ScheduleAction {
        if self.latest_buffer == buffer {
            return ScheduleAction::Skipped;
        }

        self.latest_generation += 1;
        self.latest_buffer.clear();
        self.latest_buffer.push_str(buffer);
        self.pending = Some(PendingSync {
            generation: self.latest_generation,
            buffer: self.latest_buffer.clone(),
            due_at: now + delay,
        });

        if self.task_running {
            ScheduleAction::Scheduled
        } else {
            self.task_running = true;
            ScheduleAction::SpawnTask
        }
    }

    fn flush(&mut self, buffer: &str) -> u64 {
        if self.latest_buffer != buffer {
            self.latest_generation += 1;
            self.latest_buffer.clear();
            self.latest_buffer.push_str(buffer);
        }

        self.pending = None;
        self.latest_generation
    }

    fn pending_snapshot(&self) -> Option<PendingSync> {
        self.pending.clone()
    }

    fn clear_pending_if(&mut self, generation: u64) {
        if self.pending.as_ref().map(|pending| pending.generation) == Some(generation) {
            self.pending = None;
        }
    }

    fn finish_if_idle(&mut self) -> bool {
        if self.pending.is_none() {
            self.task_running = false;
            true
        } else {
            false
        }
    }

    fn should_sync(&self, generation: u64) -> bool {
        generation >= self.latest_generation && generation > self.last_synced_generation
    }

    fn mark_synced(&mut self, generation: u64) {
        self.last_synced_generation = self.last_synced_generation.max(generation);
    }
}

/// Debounced controller for the console's virtual LSP document.
///
/// User edits schedule background `didChange` notifications. Completion requests
/// always flush the latest buffer first so Ark sees a fully up-to-date document.
pub(crate) struct DebouncedVirtualDocument {
    client: Arc<LspClient>,
    runtime_handle: Handle,
    send_lock: AsyncMutex<()>,
    state: Mutex<DebounceState>,
}

impl DebouncedVirtualDocument {
    pub fn new(client: Arc<LspClient>, runtime_handle: Handle) -> Arc<Self> {
        Arc::new(Self {
            client,
            runtime_handle,
            send_lock: AsyncMutex::new(()),
            state: Mutex::new(DebounceState::default()),
        })
    }

    pub fn schedule_sync(self: &Arc<Self>, buffer: &str) {
        let action = {
            let mut state = self.state.lock().unwrap();
            state.schedule(buffer, Instant::now(), VIRTUAL_DOCUMENT_DEBOUNCE)
        };

        if action == ScheduleAction::SpawnTask {
            debug!(
                debounce_ms = VIRTUAL_DOCUMENT_DEBOUNCE.as_millis(),
                "VirtualDocument: starting debounce loop"
            );
            let controller = Arc::clone(self);
            self.runtime_handle.spawn(async move {
                controller.run_debounce_loop().await;
            });
        }

        if action != ScheduleAction::Skipped {
            debug!(
                buffer_len = buffer.len(),
                debounce_ms = VIRTUAL_DOCUMENT_DEBOUNCE.as_millis(),
                "VirtualDocument: scheduled debounced sync"
            );
        }
    }

    pub async fn complete(
        &self,
        buffer: &str,
        cursor_byte_offset: usize,
    ) -> Result<Option<CompletionResponse>> {
        self.flush_sync(buffer).await?;
        self.client
            .request_completion(buffer, cursor_byte_offset)
            .await
    }

    async fn flush_sync(&self, buffer: &str) -> Result<()> {
        let generation = {
            let mut state = self.state.lock().unwrap();
            state.flush(buffer)
        };

        debug!(
            generation = generation,
            buffer_len = buffer.len(),
            "VirtualDocument: flushing pending sync before completion"
        );

        self.sync_generation(generation, buffer.to_string(), "flush")
            .await
    }

    async fn run_debounce_loop(self: Arc<Self>) {
        loop {
            let pending = {
                let state = self.state.lock().unwrap();
                state.pending_snapshot()
            };

            let Some(pending) = pending else {
                let mut state = self.state.lock().unwrap();
                state.finish_if_idle();
                debug!("VirtualDocument: debounce loop finished");
                break;
            };

            if Instant::now() < pending.due_at {
                sleep_until(pending.due_at).await;
                continue;
            }

            if let Err(err) = self
                .sync_generation(pending.generation, pending.buffer.clone(), "debounced")
                .await
            {
                warn!(
                    error = ?err,
                    generation = pending.generation,
                    "VirtualDocument: debounced sync failed"
                );
            }

            let should_exit = {
                let mut state = self.state.lock().unwrap();
                state.clear_pending_if(pending.generation);
                state.finish_if_idle()
            };

            if should_exit {
                debug!("VirtualDocument: debounce loop is idle");
                break;
            }
        }
    }

    async fn sync_generation(&self, generation: u64, buffer: String, reason: &str) -> Result<()> {
        let _send_guard = self.send_lock.lock().await;

        {
            let state = self.state.lock().unwrap();
            if !state.should_sync(generation) {
                debug!(
                    generation = generation,
                    latest_generation = state.latest_generation,
                    last_synced_generation = state.last_synced_generation,
                    reason = reason,
                    "VirtualDocument: skipping stale sync"
                );
                return Ok(());
            }
        }

        debug!(
            generation = generation,
            buffer_len = buffer.len(),
            reason = reason,
            "VirtualDocument: syncing console document"
        );
        self.client.sync_document_if_changed(&buffer).await?;

        let mut state = self.state.lock().unwrap();
        state.mark_synced(generation);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_only_spawns_once_per_running_loop() {
        let now = Instant::now();
        let mut state = DebounceState::default();

        assert_eq!(
            state.schedule("x <- 1", now, Duration::from_millis(50)),
            ScheduleAction::SpawnTask
        );
        assert_eq!(
            state.schedule("x <- 2", now, Duration::from_millis(50)),
            ScheduleAction::Scheduled
        );
        assert_eq!(state.latest_generation, 2);
        assert_eq!(
            state.pending.as_ref().map(|pending| pending.generation),
            Some(2)
        );
    }

    #[test]
    fn schedule_same_buffer_is_a_noop() {
        let now = Instant::now();
        let mut state = DebounceState::default();

        state.schedule("print(x)", now, Duration::from_millis(50));
        assert_eq!(
            state.schedule("print(x)", now, Duration::from_millis(50)),
            ScheduleAction::Skipped
        );
        assert_eq!(state.latest_generation, 1);
    }

    #[test]
    fn flush_clears_pending_generation() {
        let now = Instant::now();
        let mut state = DebounceState::default();

        state.schedule("summary(x)", now, Duration::from_millis(50));
        let generation = state.flush("summary(x)");

        assert_eq!(generation, 1);
        assert!(state.pending.is_none());
    }

    #[test]
    fn newer_generation_makes_older_sync_stale() {
        let now = Instant::now();
        let mut state = DebounceState::default();

        state.schedule("x <- 1", now, Duration::from_millis(50));
        state.mark_synced(1);
        state.schedule("x <- 2", now, Duration::from_millis(50));

        assert!(!state.should_sync(1));
        assert!(state.should_sync(2));
    }
}
