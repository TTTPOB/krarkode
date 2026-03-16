// R syntax highlighting using tree-sitter-r.
//
// Simplified adaptation of arf's r_tree_sitter.rs highlighter.
// No bracket matching, no config system, no editor state sync.

use nu_ansi_term::{Color, Style};
use once_cell::sync::Lazy;
use reedline::{Highlighter, StyledText};
use std::collections::HashSet;
use tree_sitter::Node;

use super::r_parser::{is_atomic_node, parse_r};

/// Reserved keywords in R.
static KEYWORDS: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    [
        "if", "else", "for", "while", "repeat", "in", "next", "break", "return", "function",
    ]
    .into_iter()
    .collect()
});

/// Built-in constants in R.
static CONSTANTS: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    [
        "TRUE",
        "FALSE",
        "NULL",
        "Inf",
        "NaN",
        "NA",
        "NA_integer_",
        "NA_real_",
        "NA_complex_",
        "NA_character_",
    ]
    .into_iter()
    .collect()
});

/// Token types for R syntax elements.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenType {
    Comment,
    String,
    Number,
    Keyword,
    Constant,
    Operator,
    Punctuation,
    Identifier,
    Whitespace,
    Other,
}

impl TokenType {
    fn style(self) -> Style {
        match self {
            TokenType::Keyword => Style::new().fg(Color::LightBlue),
            TokenType::String => Style::new().fg(Color::Green),
            TokenType::Number => Style::new().fg(Color::LightMagenta),
            TokenType::Comment => Style::new().fg(Color::DarkGray),
            TokenType::Constant => Style::new().fg(Color::LightCyan),
            TokenType::Operator => Style::new().fg(Color::Yellow),
            TokenType::Punctuation | TokenType::Identifier => Style::new(),
            TokenType::Whitespace | TokenType::Other => Style::new(),
        }
    }
}

/// A token with its byte range and type.
#[derive(Debug, Clone)]
struct Token {
    start: usize,
    end: usize,
    token_type: TokenType,
}

/// Map a tree-sitter node kind to our TokenType.
fn node_to_token_type(node: &Node, source: &[u8]) -> TokenType {
    match node.kind() {
        // Literals
        "integer" | "float" | "complex" => TokenType::Number,
        "string" | "string_content" | "escape_sequence" => TokenType::String,

        // Comments
        "comment" => TokenType::Comment,

        // Constants
        "true" | "false" | "null" | "inf" | "nan" | "na" => TokenType::Constant,
        "dots" | "dot_dot_i" => TokenType::Constant,

        // Keywords
        "function" | "if" | "else" | "for" | "while" | "repeat" | "in" | "next" | "break"
        | "return" => TokenType::Keyword,

        // Operators
        "?" | ":=" | "=" | "<-" | "<<-" | "->" | "->>" | "~" | "|>" | "||" | "|" | "&&" | "&"
        | "<" | "<=" | ">" | ">=" | "==" | "!=" | "+" | "-" | "*" | "/" | "::" | ":::" | "**"
        | "^" | "$" | "@" | ":" | "!" | "\\" | "special" => TokenType::Operator,

        // Punctuation
        "(" | ")" | "{" | "}" | "[" | "]" | "[[" | "]]" | "comma" | ";" => TokenType::Punctuation,

        // Identifiers
        "identifier" => {
            let text = node.utf8_text(source).unwrap_or("");
            if KEYWORDS.contains(text) {
                TokenType::Keyword
            } else if CONSTANTS.contains(text) {
                TokenType::Constant
            } else {
                TokenType::Identifier
            }
        }

        _ => TokenType::Other,
    }
}

/// Recursively visit nodes and collect leaf tokens.
fn visit_node(cursor: &mut tree_sitter::TreeCursor, source: &[u8], tokens: &mut Vec<Token>) {
    let node = cursor.node();

    // For atomic nodes, treat as a whole (don't recurse into children)
    if is_atomic_node(node.kind()) {
        tokens.push(Token {
            start: node.start_byte(),
            end: node.end_byte(),
            token_type: node_to_token_type(&node, source),
        });
        return;
    }

    // If this is a leaf node (no children), add it as a token
    if node.child_count() == 0 {
        let token_type = node_to_token_type(&node, source);
        if token_type != TokenType::Other || node.start_byte() < node.end_byte() {
            tokens.push(Token {
                start: node.start_byte(),
                end: node.end_byte(),
                token_type,
            });
        }
    } else {
        // Recurse into children
        if cursor.goto_first_child() {
            loop {
                visit_node(cursor, source, tokens);
                if !cursor.goto_next_sibling() {
                    break;
                }
            }
            cursor.goto_parent();
        }
    }
}

/// Fill gaps between tokens with whitespace.
fn fill_gaps(tokens: &[Token], total_len: usize) -> Vec<Token> {
    let mut result = Vec::new();
    let mut pos = 0;

    for token in tokens {
        if token.start > pos {
            result.push(Token {
                start: pos,
                end: token.start,
                token_type: TokenType::Whitespace,
            });
        }
        result.push(token.clone());
        pos = token.end;
    }

    if pos < total_len {
        result.push(Token {
            start: pos,
            end: total_len,
            token_type: TokenType::Whitespace,
        });
    }

    result
}

/// Tree-sitter based R syntax highlighter for reedline.
pub(crate) struct RHighlighter;

impl Highlighter for RHighlighter {
    fn highlight(&self, line: &str, _cursor: usize) -> StyledText {
        let mut styled = StyledText::new();

        if let Some(tree) = parse_r(line) {
            let source = line.as_bytes();
            let mut tokens = Vec::new();
            let mut cursor = tree.walk();

            visit_node(&mut cursor, source, &mut tokens);
            tokens.sort_by_key(|t| t.start);
            let tokens = fill_gaps(&tokens, source.len());

            for token in tokens {
                if token.start < line.len() && token.end <= line.len() {
                    let text = &line[token.start..token.end];
                    styled.push((token.token_type.style(), text.to_string()));
                }
            }
        } else {
            styled.push((Style::new(), line.to_string()));
        }

        if styled.buffer.is_empty() {
            styled.push((Style::new(), String::new()));
        }

        styled
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get_token_types(input: &str) -> Vec<(String, TokenType)> {
        let tree = parse_r(input).unwrap();
        let source = input.as_bytes();
        let mut tokens = Vec::new();
        let mut cursor = tree.walk();
        visit_node(&mut cursor, source, &mut tokens);
        tokens.sort_by_key(|t| t.start);
        let tokens = fill_gaps(&tokens, source.len());
        tokens
            .into_iter()
            .filter(|t| t.token_type != TokenType::Whitespace)
            .map(|t| (input[t.start..t.end].to_string(), t.token_type))
            .collect()
    }

    #[test]
    fn test_comment() {
        let tokens = get_token_types("# this is a comment");
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0].1, TokenType::Comment);
    }

    #[test]
    fn test_string() {
        let tokens = get_token_types(r#""hello world""#);
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0].1, TokenType::String);
    }

    #[test]
    fn test_numbers() {
        for case in &["42", "3.14", "1L", "2i"] {
            let tokens = get_token_types(case);
            assert_eq!(tokens[0].1, TokenType::Number, "Failed for: {}", case);
        }
    }

    #[test]
    fn test_keywords() {
        let tokens = get_token_types("if (TRUE) else FALSE");
        let keywords: Vec<_> = tokens
            .iter()
            .filter(|(_, t)| *t == TokenType::Keyword)
            .collect();
        assert_eq!(keywords.len(), 2); // if, else
    }

    #[test]
    fn test_constants() {
        let tokens = get_token_types("TRUE FALSE NULL NA Inf NaN");
        let constants: Vec<_> = tokens
            .iter()
            .filter(|(_, t)| *t == TokenType::Constant)
            .collect();
        assert_eq!(constants.len(), 6);
    }

    #[test]
    fn test_operators() {
        let tokens = get_token_types("x <- 1 + 2");
        let operators: Vec<_> = tokens
            .iter()
            .filter(|(_, t)| *t == TokenType::Operator)
            .collect();
        assert_eq!(operators.len(), 2); // <-, +
    }

    #[test]
    fn test_assignment_tokens() {
        let tokens = get_token_types("x <- 42");
        assert_eq!(tokens[0], ("x".to_string(), TokenType::Identifier));
        assert_eq!(tokens[1], ("<-".to_string(), TokenType::Operator));
        assert_eq!(tokens[2], ("42".to_string(), TokenType::Number));
    }

    #[test]
    fn test_highlight_preserves_text() {
        let highlighter = RHighlighter;
        let input = "x <- c(1, 2, 3)";
        let styled = highlighter.highlight(input, 0);
        assert_eq!(styled.raw_string(), input);
    }

    #[test]
    fn test_highlight_empty() {
        let highlighter = RHighlighter;
        let styled = highlighter.highlight("", 0);
        assert_eq!(styled.raw_string(), "");
    }
}
