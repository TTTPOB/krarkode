// In-memory document model for LSP text synchronization.
//
// Models the console buffer as a single persistent document. The document
// URI uses the `inmemory://` scheme, consistent with how Positron handles
// console input. Full-content replacement is used for each update.

use lsp_types::{
    DidChangeTextDocumentParams, DidOpenTextDocumentParams, TextDocumentContentChangeEvent,
    TextDocumentIdentifier, TextDocumentItem, Uri, VersionedTextDocumentIdentifier,
};

pub(crate) const CONSOLE_DOC_URI: &str = "inmemory://console.R";
const CONSOLE_LANGUAGE_ID: &str = "r";

/// Tracks the in-memory document state for LSP synchronization.
///
/// Each call to `update()` increments the version and produces
/// `DidChangeTextDocumentParams` with the full document content.
pub(crate) struct ConsoleDocument {
    uri: Uri,
    version: i32,
    content: String,
}

impl ConsoleDocument {
    pub fn new() -> Self {
        Self {
            uri: CONSOLE_DOC_URI.parse().expect("valid URI"),
            version: 0,
            content: String::new(),
        }
    }

    /// Build the initial `textDocument/didOpen` params.
    pub fn did_open_params(&self) -> DidOpenTextDocumentParams {
        DidOpenTextDocumentParams {
            text_document: TextDocumentItem {
                uri: self.uri.clone(),
                language_id: CONSOLE_LANGUAGE_ID.to_string(),
                version: self.version,
                text: self.content.clone(),
            },
        }
    }

    /// Update content and return `textDocument/didChange` params.
    ///
    /// Uses a single content change with `range: None` which is a valid
    /// full-document replacement for both FULL and INCREMENTAL sync modes
    /// per the LSP spec.
    pub fn update(&mut self, new_content: &str) -> DidChangeTextDocumentParams {
        self.version += 1;
        self.content = new_content.to_string();
        DidChangeTextDocumentParams {
            text_document: VersionedTextDocumentIdentifier {
                uri: self.uri.clone(),
                version: self.version,
            },
            content_changes: vec![TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: self.content.clone(),
            }],
        }
    }

    /// Get the document URI.
    pub fn uri(&self) -> &Uri {
        &self.uri
    }

    /// Get a `TextDocumentIdentifier` for this document.
    pub fn text_document_identifier(&self) -> TextDocumentIdentifier {
        TextDocumentIdentifier {
            uri: self.uri.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_document_has_version_zero() {
        let doc = ConsoleDocument::new();
        assert_eq!(doc.version, 0);
        assert_eq!(doc.content, "");
    }

    #[test]
    fn did_open_params_structure() {
        let doc = ConsoleDocument::new();
        let params = doc.did_open_params();
        assert_eq!(params.text_document.uri.as_str(), CONSOLE_DOC_URI);
        assert_eq!(params.text_document.language_id, "r");
        assert_eq!(params.text_document.version, 0);
        assert_eq!(params.text_document.text, "");
    }

    #[test]
    fn update_increments_version() {
        let mut doc = ConsoleDocument::new();
        let params1 = doc.update("print(1)");
        assert_eq!(params1.text_document.version, 1);

        let params2 = doc.update("print(2)");
        assert_eq!(params2.text_document.version, 2);
    }

    #[test]
    fn update_sends_full_content() {
        let mut doc = ConsoleDocument::new();
        let params = doc.update("x <- 1\ny <- 2");
        assert_eq!(params.content_changes.len(), 1);
        assert!(params.content_changes[0].range.is_none());
        assert_eq!(params.content_changes[0].text, "x <- 1\ny <- 2");
    }

    #[test]
    fn uri_is_inmemory() {
        let doc = ConsoleDocument::new();
        assert!(doc.uri().as_str().starts_with("inmemory://"));
    }
}
