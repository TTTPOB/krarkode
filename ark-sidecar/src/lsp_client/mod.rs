// Minimal LSP client for console completion.
//
// Connects to Ark's LSP server over TCP and provides textDocument/completion.
// Manages a single in-memory document representing the console buffer.

pub(crate) mod completion;
pub(crate) mod document;
pub(crate) mod position;
pub(crate) mod transport;
pub(crate) mod virtual_document;

use std::sync::Mutex;

use anyhow::{Context, Result};
use lsp_types::{
    ClientCapabilities, CompletionClientCapabilities, CompletionItemCapability, CompletionParams,
    CompletionResponse, InitializeParams, InitializeResult, InitializedParams,
    TextDocumentClientCapabilities, TextDocumentPositionParams, TextDocumentSyncClientCapabilities,
};
use tracing::{debug, info};

use self::document::ConsoleDocument;
use self::position::byte_offset_to_lsp_position;
use self::transport::LspTransport;

/// LSP client for console completion.
///
/// Maintains a TCP connection to Ark's LSP server and an in-memory document
/// for the console buffer. Thread-safe: the document state is behind a Mutex.
pub(crate) struct LspClient {
    transport: LspTransport,
    document: Mutex<ConsoleDocument>,
}

impl LspClient {
    /// Connect to the LSP server at the given address and port.
    pub async fn connect(ip: &str, port: u16) -> Result<Self> {
        info!(ip = %ip, port = port, "LspClient: connecting to LSP server");
        let transport = LspTransport::connect(ip, port).await?;
        Ok(Self {
            transport,
            document: Mutex::new(ConsoleDocument::new()),
        })
    }

    /// Send initialize request, initialized notification, and didOpen.
    pub async fn initialize(&self) -> Result<InitializeResult> {
        #[allow(deprecated)] // root_uri is deprecated in favor of workspace_folders
        let params = InitializeParams {
            process_id: Some(std::process::id()),
            root_uri: None,
            capabilities: ClientCapabilities {
                text_document: Some(TextDocumentClientCapabilities {
                    completion: Some(CompletionClientCapabilities {
                        completion_item: Some(CompletionItemCapability {
                            snippet_support: Some(false),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                    synchronization: Some(TextDocumentSyncClientCapabilities {
                        did_save: Some(false),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            },
            ..Default::default()
        };

        let result: InitializeResult = self
            .transport
            .request("initialize", &params)
            .await
            .context("LSP initialize failed")?;

        info!(
            server_name = ?result.server_info.as_ref().map(|s| &s.name),
            "LspClient: server initialized"
        );

        self.transport
            .notify("initialized", &InitializedParams {})
            .await
            .context("LSP initialized notification failed")?;

        // Open the console document
        let did_open = self.document.lock().expect("document mutex poisoned").did_open_params();
        self.transport
            .notify("textDocument/didOpen", &did_open)
            .await
            .context("LSP didOpen failed")?;

        debug!(
            uri = %document::CONSOLE_DOC_URI,
            "LspClient: console document opened"
        );

        Ok(result)
    }

    /// Synchronize the console document if the buffer content changed.
    pub async fn sync_document_if_changed(&self, buffer: &str) -> Result<bool> {
        let did_change = {
            let mut doc = self.document.lock().expect("document mutex poisoned");
            doc.update_if_changed(buffer)
        };

        let Some(did_change) = did_change else {
            debug!(
                buffer_len = buffer.len(),
                "LspClient: console document already up to date"
            );
            return Ok(false);
        };

        debug!(
            version = did_change.text_document.version,
            buffer_len = buffer.len(),
            "LspClient: sending textDocument/didChange"
        );
        self.transport
            .notify("textDocument/didChange", &did_change)
            .await
            .context("LSP didChange failed")?;

        Ok(true)
    }

    /// Request completions for the given buffer content at the given byte offset.
    ///
    /// The caller is responsible for synchronizing the virtual document first.
    pub async fn request_completion(
        &self,
        buffer: &str,
        cursor_byte_offset: usize,
    ) -> Result<Option<CompletionResponse>> {
        let uri = {
            let doc = self.document.lock().expect("document mutex poisoned");
            doc.uri().clone()
        };

        // Build completion request
        let position = byte_offset_to_lsp_position(buffer, cursor_byte_offset);

        let params = CompletionParams {
            text_document_position: TextDocumentPositionParams {
                text_document: lsp_types::TextDocumentIdentifier { uri },
                position,
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
            context: None,
        };

        debug!(
            line = position.line,
            character = position.character,
            buffer_len = buffer.len(),
            cursor = cursor_byte_offset,
            "LspClient: requesting completion"
        );

        let response: Option<CompletionResponse> = self
            .transport
            .request("textDocument/completion", &params)
            .await
            .context("LSP completion request failed")?;

        if let Some(ref resp) = response {
            let count = match resp {
                CompletionResponse::Array(items) => items.len(),
                CompletionResponse::List(list) => list.items.len(),
            };
            debug!(count = count, "LspClient: completion response received");
        } else {
            debug!("LspClient: completion response was null");
        }

        Ok(response)
    }

    /// Send shutdown request and exit notification.
    #[allow(dead_code)] // Kept for future graceful shutdown support
    pub async fn shutdown(&self) -> Result<()> {
        debug!("LspClient: shutting down");
        // shutdown expects a null result
        let _: () = self
            .transport
            .request("shutdown", &serde_json::Value::Null)
            .await
            .unwrap_or(());
        self.transport
            .notify("exit", &serde_json::Value::Null)
            .await
            .ok();
        info!("LspClient: shutdown complete");
        Ok(())
    }
}
