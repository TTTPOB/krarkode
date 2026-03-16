// Kernel output formatting for console mode.
//
// Formats Jupyter iopub messages for terminal display using ANSI colors.

use nu_ansi_term::{Color, Style};
use runtimelib::{media::MediaType, JupyterMessageContent};
use tracing::debug;

/// Execution event sent from kernel_loop to reedline_loop.
#[derive(Debug)]
pub(crate) enum ExecutionEvent {
    /// A line of formatted output to print to stdout.
    Output(String),
    /// Execution is complete (kernel returned to idle).
    Done,
}

/// Format an iopub message content for terminal display.
///
/// Returns `Some(formatted_string)` for displayable messages,
/// `None` for messages that should be silently ignored.
pub(crate) fn format_iopub_content(content: &JupyterMessageContent) -> Option<String> {
    match content {
        JupyterMessageContent::StreamContent(stream) => {
            debug!(stream_name = ?stream.name, "Console: stream output");
            match stream.name {
                runtimelib::Stdio::Stderr => Some(Color::Red.paint(&stream.text).to_string()),
                runtimelib::Stdio::Stdout => Some(stream.text.clone()),
            }
        }
        JupyterMessageContent::ExecuteResult(result) => {
            debug!("Console: execute_result");
            extract_text_plain(&result.data.content)
        }
        JupyterMessageContent::DisplayData(display) => {
            debug!("Console: display_data");
            let text = extract_text_plain(&display.data.content);
            if text.is_some() {
                return text;
            }
            // If no text/plain, check for images
            if has_image(&display.data.content) {
                Some(
                    Style::new()
                        .dimmed()
                        .paint("[Image output not displayable in terminal]")
                        .to_string()
                        + "\n",
                )
            } else {
                None
            }
        }
        JupyterMessageContent::ErrorOutput(error) => {
            debug!(ename = %error.ename, "Console: error output");
            Some(format_error(error))
        }
        _ => None,
    }
}

/// Extract text/plain from media content.
fn extract_text_plain(content: &[MediaType]) -> Option<String> {
    for media in content {
        if let MediaType::Plain(text) = media {
            let mut result = text.clone();
            if !result.ends_with('\n') {
                result.push('\n');
            }
            return Some(result);
        }
    }
    None
}

/// Check if media content contains an image type.
fn has_image(content: &[MediaType]) -> bool {
    content.iter().any(|m| {
        matches!(
            m,
            MediaType::Png(_) | MediaType::Jpeg(_) | MediaType::Gif(_) | MediaType::Svg(_)
        )
    })
}

/// Format an error output with ANSI colors.
fn format_error(error: &runtimelib::ErrorOutput) -> String {
    let mut output = String::new();

    // Error header
    let header = format!("Error in {}: {}\n", error.ename, error.evalue);
    output.push_str(&Color::Red.bold().paint(header).to_string());

    // Traceback lines
    for line in &error.traceback {
        output.push_str(&Color::Red.paint(line).to_string());
        if !line.ends_with('\n') {
            output.push('\n');
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use runtimelib::{ExecuteResult, ExecutionCount, StreamContent};

    #[test]
    fn format_stdout_stream() {
        let content = JupyterMessageContent::StreamContent(StreamContent::stdout("hello\n"));
        let result = format_iopub_content(&content);
        assert_eq!(result, Some("hello\n".to_string()));
    }

    #[test]
    fn format_execute_result_text_plain() {
        let result = ExecuteResult::new(
            ExecutionCount::new(1),
            vec![MediaType::Plain("[1] 42".to_string())].into(),
        );
        let content = JupyterMessageContent::ExecuteResult(result);
        let formatted = format_iopub_content(&content);
        assert_eq!(formatted, Some("[1] 42\n".to_string()));
    }

    #[test]
    fn format_error_output() {
        let error = runtimelib::ErrorOutput {
            ename: "simpleError".to_string(),
            evalue: "oops".to_string(),
            traceback: vec!["line 1".to_string(), "line 2".to_string()],
        };
        let content = JupyterMessageContent::ErrorOutput(error);
        let result = format_iopub_content(&content);
        assert!(result.is_some());
        // Contains the error text (with ANSI codes)
        let text = result.unwrap();
        assert!(text.contains("simpleError"));
        assert!(text.contains("oops"));
    }
}
