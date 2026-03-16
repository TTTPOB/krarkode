// R expression validator using tree-sitter.
//
// Checks if user input is a complete R expression or needs more input
// (multiline continuation). Adapted from arf's validator.rs with
// EditorStateRef and meta-command handling removed.

use reedline::{ValidationResult, Validator};

/// Validator for R expressions using tree-sitter.
pub(crate) struct RValidator;

impl RValidator {
    fn create_parser() -> tree_sitter::Parser {
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&tree_sitter_r::LANGUAGE.into())
            .expect("Failed to load R grammar");
        parser
    }

    /// Check if the syntax tree indicates an incomplete expression.
    ///
    /// We distinguish between:
    /// - Incomplete expressions (MISSING nodes, or ERROR at end) -> Incomplete
    /// - Syntax errors (ERROR not at end) -> Complete (let R report the error)
    fn is_incomplete(tree: &tree_sitter::Tree, source: &[u8]) -> bool {
        let root = tree.root_node();

        if !root.has_error() {
            return false;
        }

        let mut cursor = root.walk();
        Self::check_incomplete(&mut cursor, source)
    }

    /// Recursively check for signs of incomplete input:
    /// - MISSING nodes (tree-sitter inserted expected tokens)
    /// - ERROR nodes that extend to the end of meaningful content
    fn check_incomplete(cursor: &mut tree_sitter::TreeCursor, source: &[u8]) -> bool {
        let node = cursor.node();

        // Find the end of meaningful content (ignoring trailing whitespace)
        let content_end = source
            .iter()
            .rposition(|&b| !b.is_ascii_whitespace())
            .map(|i| i + 1)
            .unwrap_or(0);

        // MISSING nodes always indicate incomplete input
        if node.is_missing() {
            return true;
        }

        // ERROR nodes at the end of meaningful content suggest incomplete input
        if node.kind() == "ERROR" && node.end_byte() >= content_end {
            return true;
        }

        // Recursively check children
        if cursor.goto_first_child() {
            loop {
                if Self::check_incomplete(cursor, source) {
                    return true;
                }
                if !cursor.goto_next_sibling() {
                    break;
                }
            }
            cursor.goto_parent();
        }

        false
    }

    /// Detect misparsed raw strings.
    ///
    /// Tree-sitter may parse incomplete raw strings like `r"(\n"` as:
    ///   (program (identifier) (string ...))
    /// where `r` is an identifier and `"(\n"` is a regular string.
    fn is_misparsed_raw_string(root: &tree_sitter::Node, source: &[u8]) -> bool {
        if root.child_count() < 2 {
            return false;
        }

        let first = match root.child(0) {
            Some(n) => n,
            None => return false,
        };
        let second = match root.child(1) {
            Some(n) => n,
            None => return false,
        };

        // First child must be identifier "r" or "R"
        if first.kind() != "identifier" {
            return false;
        }
        let id_text = &source[first.start_byte()..first.end_byte()];
        if id_text != b"r" && id_text != b"R" {
            return false;
        }

        // Second child must be a string
        if second.kind() != "string" {
            return false;
        }

        // Check if string starts with quote followed by raw string delimiter
        let string_start = second.start_byte();
        if string_start + 1 >= source.len() {
            return false;
        }

        let after_quote = source.get(string_start + 1).copied();
        matches!(
            after_quote,
            Some(b'(') | Some(b'[') | Some(b'{') | Some(b'-')
        )
    }
}

impl Validator for RValidator {
    fn validate(&self, line: &str) -> ValidationResult {
        // Empty lines are considered complete
        if line.trim().is_empty() {
            return ValidationResult::Complete;
        }

        let source = line.as_bytes();

        // Parse with tree-sitter
        let mut parser = Self::create_parser();
        let tree = match parser.parse(source, None) {
            Some(tree) => tree,
            None => return ValidationResult::Complete,
        };

        let root = tree.root_node();

        // Check for incomplete raw strings that tree-sitter misparses
        if Self::is_misparsed_raw_string(&root, source) {
            return ValidationResult::Incomplete;
        }

        if Self::is_incomplete(&tree, source) {
            ValidationResult::Incomplete
        } else {
            ValidationResult::Complete
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_complete(result: ValidationResult) -> bool {
        matches!(result, ValidationResult::Complete)
    }

    fn is_incomplete(result: ValidationResult) -> bool {
        matches!(result, ValidationResult::Incomplete)
    }

    #[test]
    fn complete_expressions() {
        let v = RValidator;

        assert!(is_complete(v.validate("1 + 1")));
        assert!(is_complete(v.validate("x <- 1")));
        assert!(is_complete(v.validate("print(x)")));
        assert!(is_complete(v.validate("mean(c(1, 2, 3))")));
        assert!(is_complete(v.validate("list(a = 1, b = 2)")));
        assert!(is_complete(v.validate("{ x <- 1; x }")));
        assert!(is_complete(v.validate("if (TRUE) 1 else 2")));
    }

    #[test]
    fn incomplete_expressions() {
        let v = RValidator;

        // Unclosed parentheses
        assert!(is_incomplete(v.validate("foo(")));
        assert!(is_incomplete(v.validate("mean(c(1, 2")));

        // Unclosed braces
        assert!(is_incomplete(v.validate("{")));
        assert!(is_incomplete(v.validate("function() {")));

        // Unclosed brackets
        assert!(is_incomplete(v.validate("x[")));

        // Unclosed strings
        assert!(is_incomplete(v.validate("\"hello")));
        assert!(is_incomplete(v.validate("'world")));

        // Trailing operators
        assert!(is_incomplete(v.validate("1 +")));
        assert!(is_incomplete(v.validate("x <-")));
    }

    #[test]
    fn empty_and_whitespace() {
        let v = RValidator;

        assert!(is_complete(v.validate("")));
        assert!(is_complete(v.validate("   ")));
        assert!(is_complete(v.validate("\t")));
    }

    #[test]
    fn raw_strings() {
        let v = RValidator;

        // Complete raw strings
        assert!(is_complete(v.validate(r#"r"(hello)""#)));
        assert!(is_complete(v.validate(r#"r"-(hello)-""#)));

        // Incomplete raw strings
        assert!(is_incomplete(v.validate(r#"r"(hello"#)));
    }

    #[test]
    fn multiline() {
        let v = RValidator;

        assert!(is_incomplete(v.validate("(")));
        assert!(is_incomplete(v.validate("(\n")));
        assert!(is_incomplete(v.validate("(\n1")));
        assert!(is_complete(v.validate("(\n1\n)")));

        assert!(is_incomplete(v.validate("function() {")));
        assert!(is_complete(v.validate("function() {\n1\n}")));
    }
}
