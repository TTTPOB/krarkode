// Jupyter-backed tab completion for console mode.
//
// Implements reedline::Completer by bridging to the async kernel_loop
// via channels. The completer sends a CompletionBridgeRequest and
// blocks on a std::sync::mpsc receiver for the reply.

use reedline::{Completer, Span, Suggestion};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;
use tracing::debug;

/// Request sent from the completer to the kernel loop.
pub(crate) struct CompletionBridgeRequest {
    pub code: String,
    pub cursor_pos: usize,
    pub reply_tx: std_mpsc::Sender<Vec<Suggestion>>,
}

/// Completer that delegates to the Ark Jupyter kernel via complete_request.
pub(crate) struct JupyterCompleter {
    /// Channel to send completion requests to the kernel loop.
    request_tx: tokio::sync::mpsc::Sender<CompletionBridgeRequest>,
    /// Timeout for waiting for kernel response.
    timeout: Duration,
}

impl JupyterCompleter {
    pub fn new(request_tx: tokio::sync::mpsc::Sender<CompletionBridgeRequest>) -> Self {
        Self {
            request_tx,
            timeout: Duration::from_millis(500),
        }
    }
}

impl Completer for JupyterCompleter {
    fn complete(&mut self, line: &str, pos: usize) -> Vec<Suggestion> {
        debug!(pos = pos, line_len = line.len(), "Console: requesting completion");

        let (reply_tx, reply_rx) = std_mpsc::channel();

        let request = CompletionBridgeRequest {
            code: line.to_string(),
            cursor_pos: pos,
            reply_tx,
        };

        // Send request to kernel loop (blocking_send is safe from blocking context)
        if self.request_tx.blocking_send(request).is_err() {
            debug!("Console: completion channel closed");
            return vec![];
        }

        // Block waiting for response with timeout
        match reply_rx.recv_timeout(self.timeout) {
            Ok(suggestions) => {
                debug!(count = suggestions.len(), "Console: got completions");
                suggestions
            }
            Err(std_mpsc::RecvTimeoutError::Timeout) => {
                debug!("Console: completion timed out");
                vec![]
            }
            Err(std_mpsc::RecvTimeoutError::Disconnected) => {
                debug!("Console: completion reply channel dropped");
                vec![]
            }
        }
    }
}

/// Convert a Jupyter CompleteReply into reedline Suggestions.
pub(crate) fn complete_reply_to_suggestions(
    matches: &[String],
    cursor_start: usize,
    cursor_end: usize,
) -> Vec<Suggestion> {
    matches
        .iter()
        .map(|m| Suggestion {
            value: m.clone(),
            description: None,
            style: None,
            extra: None,
            span: Span::new(cursor_start, cursor_end),
            append_whitespace: false,
            display_override: None,
            match_indices: None,
        })
        .collect()
}
