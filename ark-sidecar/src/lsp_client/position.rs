// UTF-16 <-> byte offset position conversion for LSP communication.
//
// Ark's LSP server uses UTF-16 position encoding (line, character in UTF-16
// code units). Reedline uses byte offsets. This module provides conversion
// functions between the two.

use lsp_types::Position;

/// Convert a byte offset within a string to an LSP Position.
///
/// The returned Position has:
/// - `line`: zero-based line number (counts '\n' characters)
/// - `character`: zero-based offset in UTF-16 code units from line start
pub fn byte_offset_to_lsp_position(text: &str, byte_offset: usize) -> Position {
    let byte_offset = byte_offset.min(text.len());
    let prefix = &text[..byte_offset];

    let line = prefix.matches('\n').count() as u32;
    let last_newline = prefix.rfind('\n').map(|i| i + 1).unwrap_or(0);
    let line_prefix = &text[last_newline..byte_offset];

    // Count UTF-16 code units (chars outside BMP produce 2 code units)
    let character = line_prefix.encode_utf16().count() as u32;

    Position { line, character }
}

/// Convert an LSP Position (line, character in UTF-16 code units) to a byte offset.
///
/// Returns the byte offset into `text` corresponding to the given position.
/// If the position is past the end of the text, returns `text.len()`.
pub fn lsp_position_to_byte_offset(text: &str, position: &Position) -> usize {
    let mut current_line = 0u32;
    let mut line_start_byte = 0usize;

    // Find the byte offset of the target line
    if position.line > 0 {
        for (i, ch) in text.char_indices() {
            if ch == '\n' {
                current_line += 1;
                line_start_byte = i + 1; // byte after the newline
                if current_line == position.line {
                    break;
                }
            }
        }
        // If we didn't reach the target line, return end of text
        if current_line < position.line {
            return text.len();
        }
    }

    // Advance within the line by UTF-16 code units
    let line_text = &text[line_start_byte..];
    let mut utf16_count = 0u32;
    for (i, ch) in line_text.char_indices() {
        if ch == '\n' || utf16_count >= position.character {
            return line_start_byte + i;
        }
        utf16_count += ch.len_utf16() as u32;
    }

    // If we consumed all chars without hitting the target, check final position
    if utf16_count >= position.character {
        // Position is at or past the end of the line content
        line_start_byte + line_text.len()
    } else {
        text.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- byte_offset_to_lsp_position ---

    #[test]
    fn ascii_single_line() {
        let text = "hello";
        assert_eq!(byte_offset_to_lsp_position(text, 0), Position { line: 0, character: 0 });
        assert_eq!(byte_offset_to_lsp_position(text, 3), Position { line: 0, character: 3 });
        assert_eq!(byte_offset_to_lsp_position(text, 5), Position { line: 0, character: 5 });
    }

    #[test]
    fn multi_line() {
        let text = "line1\nline2\nline3";
        assert_eq!(byte_offset_to_lsp_position(text, 0), Position { line: 0, character: 0 });
        assert_eq!(byte_offset_to_lsp_position(text, 5), Position { line: 0, character: 5 });
        // byte 6 = start of "line2"
        assert_eq!(byte_offset_to_lsp_position(text, 6), Position { line: 1, character: 0 });
        assert_eq!(byte_offset_to_lsp_position(text, 7), Position { line: 1, character: 1 });
        // byte 12 = start of "line3"
        assert_eq!(byte_offset_to_lsp_position(text, 12), Position { line: 2, character: 0 });
    }

    #[test]
    fn cjk_characters() {
        // Each CJK char: 3 bytes UTF-8, 1 UTF-16 code unit
        let text = "ab\u{4e2d}\u{6587}cd";
        // "ab" = 2 bytes, "中" = 3 bytes (offset 2..5), "文" = 3 bytes (offset 5..8), "cd" = 2 bytes
        assert_eq!(byte_offset_to_lsp_position(text, 0), Position { line: 0, character: 0 });
        assert_eq!(byte_offset_to_lsp_position(text, 2), Position { line: 0, character: 2 });
        // After "中" (byte 5)
        assert_eq!(byte_offset_to_lsp_position(text, 5), Position { line: 0, character: 3 });
        // After "文" (byte 8)
        assert_eq!(byte_offset_to_lsp_position(text, 8), Position { line: 0, character: 4 });
        // After "c" (byte 9)
        assert_eq!(byte_offset_to_lsp_position(text, 9), Position { line: 0, character: 5 });
    }

    #[test]
    fn emoji_surrogate_pair() {
        // Emoji U+1F600: 4 bytes UTF-8, 2 UTF-16 code units (surrogate pair)
        let text = "a\u{1F600}b";
        assert_eq!(byte_offset_to_lsp_position(text, 0), Position { line: 0, character: 0 });
        assert_eq!(byte_offset_to_lsp_position(text, 1), Position { line: 0, character: 1 });
        // After emoji (byte 5)
        assert_eq!(byte_offset_to_lsp_position(text, 5), Position { line: 0, character: 3 });
        // After "b" (byte 6)
        assert_eq!(byte_offset_to_lsp_position(text, 6), Position { line: 0, character: 4 });
    }

    #[test]
    fn empty_string() {
        assert_eq!(byte_offset_to_lsp_position("", 0), Position { line: 0, character: 0 });
    }

    #[test]
    fn offset_past_end_clamps() {
        let text = "abc";
        assert_eq!(byte_offset_to_lsp_position(text, 100), Position { line: 0, character: 3 });
    }

    // --- lsp_position_to_byte_offset ---

    #[test]
    fn reverse_ascii_single_line() {
        let text = "hello";
        assert_eq!(lsp_position_to_byte_offset(text, &Position { line: 0, character: 0 }), 0);
        assert_eq!(lsp_position_to_byte_offset(text, &Position { line: 0, character: 3 }), 3);
        assert_eq!(lsp_position_to_byte_offset(text, &Position { line: 0, character: 5 }), 5);
    }

    #[test]
    fn reverse_multi_line() {
        let text = "line1\nline2\nline3";
        assert_eq!(lsp_position_to_byte_offset(text, &Position { line: 1, character: 0 }), 6);
        assert_eq!(lsp_position_to_byte_offset(text, &Position { line: 1, character: 1 }), 7);
        assert_eq!(lsp_position_to_byte_offset(text, &Position { line: 2, character: 0 }), 12);
    }

    #[test]
    fn reverse_cjk() {
        let text = "ab\u{4e2d}\u{6587}cd";
        // character 3 = after "ab中", byte offset = 5
        assert_eq!(lsp_position_to_byte_offset(text, &Position { line: 0, character: 3 }), 5);
        // character 4 = after "ab中文", byte offset = 8
        assert_eq!(lsp_position_to_byte_offset(text, &Position { line: 0, character: 4 }), 8);
    }

    #[test]
    fn reverse_emoji() {
        let text = "a\u{1F600}b";
        // character 1 = after "a", byte offset = 1
        assert_eq!(lsp_position_to_byte_offset(text, &Position { line: 0, character: 1 }), 1);
        // character 3 = after emoji (2 UTF-16 units), byte offset = 5
        assert_eq!(lsp_position_to_byte_offset(text, &Position { line: 0, character: 3 }), 5);
    }

    #[test]
    fn reverse_past_end() {
        let text = "abc";
        assert_eq!(lsp_position_to_byte_offset(text, &Position { line: 5, character: 0 }), 3);
        assert_eq!(lsp_position_to_byte_offset(text, &Position { line: 0, character: 100 }), 3);
    }

    #[test]
    fn round_trip_ascii() {
        let text = "hello world\nfoo bar\nbaz";
        for offset in 0..=text.len() {
            // Only test valid char boundaries
            if text.is_char_boundary(offset) {
                let pos = byte_offset_to_lsp_position(text, offset);
                let back = lsp_position_to_byte_offset(text, &pos);
                assert_eq!(back, offset, "round-trip failed for offset {offset}");
            }
        }
    }

    #[test]
    fn round_trip_cjk_and_emoji() {
        let text = "hello\u{4e16}\u{754c}\n\u{1F600}test";
        for (offset, _) in text.char_indices() {
            let pos = byte_offset_to_lsp_position(text, offset);
            let back = lsp_position_to_byte_offset(text, &pos);
            assert_eq!(back, offset, "round-trip failed for offset {offset}");
        }
        // Also test end of string
        let pos = byte_offset_to_lsp_position(text, text.len());
        let back = lsp_position_to_byte_offset(text, &pos);
        assert_eq!(back, text.len());
    }
}
