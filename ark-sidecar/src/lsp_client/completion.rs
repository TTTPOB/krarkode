// LSP CompletionItem to reedline Suggestion mapping.
//
// Converts LSP completion responses into reedline suggestions, handling:
// - Text extraction from textEdit, insertText, or label fallbacks
// - Snippet syntax stripping ($0, ${1:default}, etc.)
// - Span computation from textEdit ranges or word-start heuristics

use lsp_types::{CompletionItem, CompletionResponse, InsertTextFormat};
use reedline::{Span, Suggestion};
use tracing::debug;

use super::position::lsp_position_to_byte_offset;

/// Convert an LSP CompletionResponse to reedline Suggestions.
pub(crate) fn completion_response_to_suggestions(
    response: Option<CompletionResponse>,
    buffer: &str,
    cursor_byte_offset: usize,
) -> Vec<Suggestion> {
    let items = match response {
        Some(CompletionResponse::Array(items)) => items,
        Some(CompletionResponse::List(list)) => list.items,
        None => return vec![],
    };
    let token = current_completion_token(buffer, cursor_byte_offset);

    debug!(
        item_count = items.len(),
        token = token,
        "completion: filtering CompletionItems for console suggestions"
    );

    filter_completion_items(&items, token)
        .iter()
        .map(|item| completion_item_to_suggestion(item, buffer, cursor_byte_offset))
        .collect()
}

/// Convert a single CompletionItem to a reedline Suggestion.
fn completion_item_to_suggestion(
    item: &CompletionItem,
    buffer: &str,
    cursor_byte_offset: usize,
) -> Suggestion {
    let clean_text = completion_item_replacement_text(item);
    let span = compute_span(item, buffer, cursor_byte_offset);

    Suggestion {
        value: clean_text,
        description: item.detail.clone(),
        style: None,
        extra: None,
        span,
        append_whitespace: false,
        display_override: None,
        match_indices: None,
    }
}

fn filter_completion_items<'a>(
    items: &'a [CompletionItem],
    token: &str,
) -> Vec<&'a CompletionItem> {
    let case_sensitive_matches: Vec<_> = items
        .iter()
        .filter(|item| completion_item_replacement_text(item).starts_with(token))
        .collect();

    let case_insensitive_matches = if case_sensitive_matches.is_empty() {
        items
            .iter()
            .filter(|item| starts_with_ignore_case(&completion_item_replacement_text(item), token))
            .collect()
    } else {
        Vec::new()
    };
    let case_sensitive_count = case_sensitive_matches.len();
    let case_insensitive_count = case_insensitive_matches.len();

    let (strategy, filtered) = if !case_sensitive_matches.is_empty() {
        ("case_sensitive_prefix", case_sensitive_matches)
    } else if !case_insensitive_matches.is_empty() {
        ("case_insensitive_prefix", case_insensitive_matches)
    } else {
        ("fallback_original", items.iter().collect())
    };

    debug!(
        token = token,
        original_count = items.len(),
        case_sensitive_matches = case_sensitive_count,
        case_insensitive_matches = case_insensitive_count,
        returned_count = filtered.len(),
        strategy = strategy,
        "completion: selected console completion candidates"
    );

    filtered
}

fn current_completion_token(buffer: &str, cursor_byte_offset: usize) -> &str {
    let cursor_byte_offset = cursor_byte_offset.min(buffer.len());
    let word_start = find_word_start(buffer, cursor_byte_offset);
    &buffer[word_start..cursor_byte_offset]
}

fn completion_item_replacement_text(item: &CompletionItem) -> String {
    let insert_text = extract_insert_text(item);
    strip_snippet_syntax(&insert_text, item.insert_text_format)
}

fn starts_with_ignore_case(text: &str, prefix: &str) -> bool {
    if prefix.is_empty() {
        return true;
    }

    text.to_lowercase().starts_with(&prefix.to_lowercase())
}

/// Extract the text to insert from a CompletionItem.
///
/// Fallback chain: textEdit.newText -> insertText -> label
fn extract_insert_text(item: &CompletionItem) -> String {
    if let Some(edit) = &item.text_edit {
        match edit {
            lsp_types::CompletionTextEdit::Edit(text_edit) => {
                return text_edit.new_text.clone();
            }
            lsp_types::CompletionTextEdit::InsertAndReplace(isr) => {
                return isr.new_text.clone();
            }
        }
    }
    if let Some(ref text) = item.insert_text {
        return text.clone();
    }
    item.label.clone()
}

/// Strip LSP snippet syntax, keeping default values for placeholders.
///
/// Handles:
/// - `$0` (final cursor) -> removed
/// - `$N` (tabstop) -> removed
/// - `${N:default}` -> "default" (keeps the default value)
/// - `${N}` -> removed
/// - `\\$` (escaped dollar) -> "$"
///
/// If format is not SNIPPET, returns text unchanged.
pub(crate) fn strip_snippet_syntax(text: &str, format: Option<InsertTextFormat>) -> String {
    if format != Some(InsertTextFormat::SNIPPET) {
        return text.to_string();
    }

    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut result = String::with_capacity(len);
    let mut i = 0;

    while i < len {
        if bytes[i] == b'\\' && i + 1 < len && bytes[i + 1] == b'$' {
            // Escaped dollar sign
            result.push('$');
            i += 2;
        } else if bytes[i] == b'$' {
            i += 1;
            if i >= len {
                break;
            }
            if bytes[i] == b'{' {
                // ${...} form
                i += 1;
                // Find the matching closing brace
                let start = i;
                let mut depth = 1;
                while i < len && depth > 0 {
                    if bytes[i] == b'{' {
                        depth += 1;
                    } else if bytes[i] == b'}' {
                        depth -= 1;
                    }
                    if depth > 0 {
                        i += 1;
                    }
                }
                let inner = &text[start..i];
                if i < len {
                    i += 1; // skip '}'
                }
                // Parse inner: "N:default" or just "N"
                if let Some(colon_pos) = inner.find(':') {
                    // Keep the default value
                    result.push_str(&inner[colon_pos + 1..]);
                }
                // else: just a number like ${0} or ${1} -> drop it
            } else {
                // $N form - skip digits
                while i < len && bytes[i].is_ascii_digit() {
                    i += 1;
                }
            }
        } else {
            result.push(text[i..].chars().next().unwrap());
            i += text[i..].chars().next().unwrap().len_utf8();
        }
    }

    result
}

/// Compute the reedline Span for replacement.
///
/// If the CompletionItem has a textEdit, convert its LSP range to byte offsets.
/// Otherwise, find the start of the word being typed before the cursor.
fn compute_span(item: &CompletionItem, buffer: &str, cursor_byte_offset: usize) -> Span {
    if let Some(edit) = &item.text_edit {
        match edit {
            lsp_types::CompletionTextEdit::Edit(text_edit) => {
                let start = lsp_position_to_byte_offset(buffer, &text_edit.range.start);
                let end = lsp_position_to_byte_offset(buffer, &text_edit.range.end);
                return Span::new(start, end);
            }
            lsp_types::CompletionTextEdit::InsertAndReplace(isr) => {
                // Use replace range for full replacement behavior
                let start = lsp_position_to_byte_offset(buffer, &isr.replace.start);
                let end = lsp_position_to_byte_offset(buffer, &isr.replace.end);
                return Span::new(start, end);
            }
        }
    }
    // No textEdit: find word start before cursor
    let word_start = find_word_start(buffer, cursor_byte_offset);
    Span::new(word_start, cursor_byte_offset)
}

/// Find the start of the R identifier being typed at the cursor position.
///
/// Scans backwards from cursor, matching R identifier characters:
/// letters, digits, underscore, and dot.
fn find_word_start(buffer: &str, cursor: usize) -> usize {
    let bytes = buffer.as_bytes();
    let mut pos = cursor;
    while pos > 0 {
        let b = bytes[pos - 1];
        if b.is_ascii_alphanumeric() || b == b'_' || b == b'.' {
            pos -= 1;
        } else {
            break;
        }
    }
    pos
}

#[cfg(test)]
mod tests {
    use super::*;
    use lsp_types::{CompletionItem, CompletionItemKind, Position, Range, TextEdit};

    // --- strip_snippet_syntax ---

    #[test]
    fn strip_plain_text_unchanged() {
        assert_eq!(
            strip_snippet_syntax("hello", Some(InsertTextFormat::PLAIN_TEXT)),
            "hello"
        );
    }

    #[test]
    fn strip_non_snippet_unchanged() {
        assert_eq!(strip_snippet_syntax("foo($0)", None), "foo($0)");
    }

    #[test]
    fn strip_final_cursor() {
        assert_eq!(
            strip_snippet_syntax("print($0)", Some(InsertTextFormat::SNIPPET)),
            "print()"
        );
    }

    #[test]
    fn strip_tabstop() {
        assert_eq!(
            strip_snippet_syntax("$1", Some(InsertTextFormat::SNIPPET)),
            ""
        );
    }

    #[test]
    fn strip_placeholder_keeps_default() {
        assert_eq!(
            strip_snippet_syntax("${1:x}", Some(InsertTextFormat::SNIPPET)),
            "x"
        );
    }

    #[test]
    fn strip_multiple_placeholders() {
        assert_eq!(
            strip_snippet_syntax(
                "func(${1:arg1}, ${2:arg2})",
                Some(InsertTextFormat::SNIPPET)
            ),
            "func(arg1, arg2)"
        );
    }

    #[test]
    fn strip_function_with_cursor_inside_parens() {
        assert_eq!(
            strip_snippet_syntax("mean($0)", Some(InsertTextFormat::SNIPPET)),
            "mean()"
        );
    }

    #[test]
    fn strip_escaped_dollar() {
        assert_eq!(
            strip_snippet_syntax("cost: \\$100", Some(InsertTextFormat::SNIPPET)),
            "cost: $100"
        );
    }

    #[test]
    fn strip_empty_braces() {
        assert_eq!(
            strip_snippet_syntax("${0}", Some(InsertTextFormat::SNIPPET)),
            ""
        );
    }

    // --- extract_insert_text ---

    #[test]
    fn extract_from_text_edit() {
        let item = CompletionItem {
            label: "print".to_string(),
            text_edit: Some(lsp_types::CompletionTextEdit::Edit(TextEdit {
                range: Range::default(),
                new_text: "print($0)".to_string(),
            })),
            ..Default::default()
        };
        assert_eq!(extract_insert_text(&item), "print($0)");
    }

    #[test]
    fn extract_from_insert_text() {
        let item = CompletionItem {
            label: "print".to_string(),
            insert_text: Some("print()".to_string()),
            ..Default::default()
        };
        assert_eq!(extract_insert_text(&item), "print()");
    }

    #[test]
    fn extract_fallback_to_label() {
        let item = CompletionItem {
            label: "View".to_string(),
            ..Default::default()
        };
        assert_eq!(extract_insert_text(&item), "View");
    }

    #[test]
    fn replacement_text_uses_snippet_cleaning() {
        let item = CompletionItem {
            label: "ignored".to_string(),
            insert_text: Some("View($0)".to_string()),
            insert_text_format: Some(InsertTextFormat::SNIPPET),
            ..Default::default()
        };
        assert_eq!(completion_item_replacement_text(&item), "View()");
    }

    // --- find_word_start ---

    #[test]
    fn word_start_simple() {
        assert_eq!(find_word_start("print(Vi", 8), 6);
    }

    #[test]
    fn word_start_with_dot() {
        assert_eq!(find_word_start("data.fr", 7), 0);
    }

    #[test]
    fn word_start_after_operator() {
        assert_eq!(find_word_start("x <- mea", 8), 5);
    }

    #[test]
    fn word_start_at_beginning() {
        assert_eq!(find_word_start("abc", 3), 0);
    }

    #[test]
    fn word_start_empty() {
        assert_eq!(find_word_start("", 0), 0);
    }

    #[test]
    fn current_token_uses_identifier_before_cursor() {
        assert_eq!(current_completion_token("print(Vi", 8), "Vi");
    }

    // --- compute_span ---

    #[test]
    fn span_from_text_edit() {
        let item = CompletionItem {
            label: "View".to_string(),
            text_edit: Some(lsp_types::CompletionTextEdit::Edit(TextEdit {
                range: Range {
                    start: Position {
                        line: 0,
                        character: 6,
                    },
                    end: Position {
                        line: 0,
                        character: 8,
                    },
                },
                new_text: "View".to_string(),
            })),
            ..Default::default()
        };
        let span = compute_span(&item, "print(Vi", 8);
        assert_eq!(span.start, 6);
        assert_eq!(span.end, 8);
    }

    #[test]
    fn span_fallback_to_word_start() {
        let item = CompletionItem {
            label: "View".to_string(),
            ..Default::default()
        };
        let span = compute_span(&item, "print(Vi", 8);
        assert_eq!(span.start, 6);
        assert_eq!(span.end, 8);
    }

    // --- completion_response_to_suggestions ---

    #[test]
    fn empty_response() {
        let suggestions = completion_response_to_suggestions(None, "Vi", 2);
        assert!(suggestions.is_empty());
    }

    #[test]
    fn array_response() {
        let response = CompletionResponse::Array(vec![
            CompletionItem {
                label: "View".to_string(),
                kind: Some(CompletionItemKind::FUNCTION),
                detail: Some("{utils}".to_string()),
                ..Default::default()
            },
            CompletionItem {
                label: "Visibility".to_string(),
                ..Default::default()
            },
        ]);
        let suggestions = completion_response_to_suggestions(Some(response), "Vi", 2);
        assert_eq!(suggestions.len(), 2);
        assert_eq!(suggestions[0].value, "View");
        assert_eq!(suggestions[0].description, Some("{utils}".to_string()));
        assert_eq!(suggestions[1].value, "Visibility");
    }

    #[test]
    fn filters_to_case_sensitive_prefix_matches() {
        let response = CompletionResponse::Array(vec![
            CompletionItem {
                label: "View".to_string(),
                ..Default::default()
            },
            CompletionItem {
                label: "Visibility".to_string(),
                ..Default::default()
            },
            CompletionItem {
                label: "deviance".to_string(),
                ..Default::default()
            },
            CompletionItem {
                label: "activeBindingFunction".to_string(),
                ..Default::default()
            },
        ]);

        let suggestions = completion_response_to_suggestions(Some(response), "Vi", 2);
        let values: Vec<_> = suggestions
            .into_iter()
            .map(|suggestion| suggestion.value)
            .collect();

        assert_eq!(values, vec!["View".to_string(), "Visibility".to_string()]);
    }

    #[test]
    fn falls_back_to_case_insensitive_prefix_matches() {
        let response = CompletionResponse::Array(vec![
            CompletionItem {
                label: "View".to_string(),
                ..Default::default()
            },
            CompletionItem {
                label: "Visibility".to_string(),
                ..Default::default()
            },
            CompletionItem {
                label: "deviance".to_string(),
                ..Default::default()
            },
        ]);

        let suggestions = completion_response_to_suggestions(Some(response), "vi", 2);
        let values: Vec<_> = suggestions
            .into_iter()
            .map(|suggestion| suggestion.value)
            .collect();

        assert_eq!(values, vec!["View".to_string(), "Visibility".to_string()]);
    }

    #[test]
    fn falls_back_to_original_items_when_no_prefix_matches_exist() {
        let response = CompletionResponse::Array(vec![
            CompletionItem {
                label: "deviance".to_string(),
                ..Default::default()
            },
            CompletionItem {
                label: "activeBindingFunction".to_string(),
                ..Default::default()
            },
        ]);

        let suggestions = completion_response_to_suggestions(Some(response), "Vi", 2);
        let values: Vec<_> = suggestions
            .into_iter()
            .map(|suggestion| suggestion.value)
            .collect();

        assert_eq!(
            values,
            vec!["deviance".to_string(), "activeBindingFunction".to_string()]
        );
    }

    #[test]
    fn prefix_filter_uses_insert_text_and_text_edit_not_just_label() {
        let response = CompletionResponse::Array(vec![
            CompletionItem {
                label: "not_view".to_string(),
                insert_text: Some("View($0)".to_string()),
                insert_text_format: Some(InsertTextFormat::SNIPPET),
                ..Default::default()
            },
            CompletionItem {
                label: "not_vision".to_string(),
                text_edit: Some(lsp_types::CompletionTextEdit::Edit(TextEdit {
                    range: Range::default(),
                    new_text: "Vision".to_string(),
                })),
                ..Default::default()
            },
            CompletionItem {
                label: "deviance".to_string(),
                ..Default::default()
            },
        ]);

        let suggestions = completion_response_to_suggestions(Some(response), "Vi", 2);
        let values: Vec<_> = suggestions
            .into_iter()
            .map(|suggestion| suggestion.value)
            .collect();

        assert_eq!(values, vec!["View()".to_string(), "Vision".to_string()]);
    }
}
