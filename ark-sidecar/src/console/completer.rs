// LSP-backed tab completion for console mode.
//
// Implements reedline::Completer by sending textDocument/completion
// requests to Ark's LSP server via the LspClient.

use std::sync::Arc;
use std::time::Duration;

use reedline::{Completer, Suggestion};
use tracing::{debug, warn};

use crate::lsp_client::completion::completion_response_to_suggestions;
use crate::lsp_client::virtual_document::DebouncedVirtualDocument;

const LSP_COMPLETION_TIMEOUT: Duration = Duration::from_millis(1500);

/// Completer that delegates to Ark's LSP server for completion.
pub(crate) struct LspCompleter {
    /// Shared handle to the debounced virtual document controller.
    virtual_document: Arc<DebouncedVirtualDocument>,
    /// Handle to the tokio runtime for blocking on async operations.
    runtime_handle: tokio::runtime::Handle,
}

impl LspCompleter {
    pub fn new(
        virtual_document: Arc<DebouncedVirtualDocument>,
        runtime_handle: tokio::runtime::Handle,
    ) -> Self {
        Self {
            virtual_document,
            runtime_handle,
        }
    }
}

impl Completer for LspCompleter {
    fn complete(&mut self, line: &str, pos: usize) -> Vec<Suggestion> {
        debug!(
            pos = pos,
            line_len = line.len(),
            "LspCompleter: requesting completion"
        );

        let virtual_document = self.virtual_document.clone();
        let buffer = line.to_string();

        // Block on the async LSP request with timeout.
        // This is safe because we run inside spawn_blocking, not on a tokio worker thread.
        match self.runtime_handle.block_on(async {
            tokio::time::timeout(
                LSP_COMPLETION_TIMEOUT,
                virtual_document.complete(&buffer, pos),
            )
            .await
        }) {
            Ok(Ok(response)) => {
                let suggestions = completion_response_to_suggestions(response, line, pos);
                debug!(count = suggestions.len(), "LspCompleter: got completions");
                suggestions
            }
            Ok(Err(err)) => {
                warn!(error = ?err, "LspCompleter: completion request failed");
                vec![]
            }
            Err(_) => {
                debug!(
                    "LspCompleter: completion timed out ({}ms)",
                    LSP_COMPLETION_TIMEOUT.as_millis()
                );
                vec![]
            }
        }
    }
}
