// Blocking reedline loop for console mode.
//
// Runs in tokio::task::spawn_blocking. Constructs the reedline editor
// with highlighter, validator, completer, and history, then enters the
// read-execute-display loop.

use reedline::{
    default_emacs_keybindings, ColumnarMenu, Emacs, KeyCode, KeyModifiers, MenuBuilder, Reedline,
    ReedlineEvent, ReedlineMenu, Signal,
};
use std::sync::mpsc as std_mpsc;
use tracing::{debug, error};

use super::completer::{CompletionBridgeRequest, JupyterCompleter};
use super::highlighter::RHighlighter;
use super::history::create_history;
use super::kernel_loop::ConsoleRequest;
use super::output::ExecutionEvent;
use super::validator::RValidator;

/// The R console prompt.
fn make_prompt() -> reedline::DefaultPrompt {
    reedline::DefaultPrompt::new(
        reedline::DefaultPromptSegment::Basic("R> ".to_string()),
        reedline::DefaultPromptSegment::Empty,
    )
}

/// Run the blocking reedline loop.
///
/// This function should be called inside `tokio::task::spawn_blocking`.
pub(crate) fn run_reedline_loop(
    request_tx: tokio::sync::mpsc::Sender<ConsoleRequest>,
    exec_output_rx: std_mpsc::Receiver<ExecutionEvent>,
    complete_tx: tokio::sync::mpsc::Sender<CompletionBridgeRequest>,
) {
    debug!("Console reedline_loop: building editor");

    // Build keybindings with Tab completion
    let mut keybindings = default_emacs_keybindings();
    keybindings.add_binding(
        KeyModifiers::NONE,
        KeyCode::Tab,
        ReedlineEvent::UntilFound(vec![
            ReedlineEvent::Menu("completion_menu".to_string()),
            ReedlineEvent::MenuNext,
        ]),
    );
    let edit_mode = Box::new(Emacs::new(keybindings));

    // Completion menu
    let completion_menu = Box::new(
        ColumnarMenu::default()
            .with_name("completion_menu")
            .with_columns(4)
            .with_column_padding(2),
    );

    // Build reedline editor
    let mut editor = Reedline::create()
        .with_highlighter(Box::new(RHighlighter))
        .with_validator(Box::new(RValidator))
        .with_completer(Box::new(JupyterCompleter::new(complete_tx)))
        .with_menu(ReedlineMenu::EngineCompleter(completion_menu))
        .with_edit_mode(edit_mode);

    // Attach history (non-fatal if it fails)
    match create_history() {
        Ok(history) => {
            debug!("Console reedline_loop: history loaded");
            editor = editor.with_history(Box::new(history));
        }
        Err(err) => {
            error!(error = ?err, "Console reedline_loop: failed to open history, continuing without");
        }
    }

    let prompt = make_prompt();

    debug!("Console reedline_loop: entering main loop");

    loop {
        match editor.read_line(&prompt) {
            Ok(Signal::Success(line)) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                debug!(line_len = line.len(), "Console reedline_loop: user input");

                // Send code to kernel loop for execution
                if request_tx
                    .blocking_send(ConsoleRequest::Execute(line))
                    .is_err()
                {
                    debug!("Console reedline_loop: request channel closed, exiting");
                    break;
                }

                // Real-time output loop: receive and print output until Done
                loop {
                    match exec_output_rx.recv() {
                        Ok(ExecutionEvent::Output(text)) => {
                            print!("{}", text);
                        }
                        Ok(ExecutionEvent::Done) => {
                            break;
                        }
                        Err(_) => {
                            debug!("Console reedline_loop: output channel closed");
                            // Send exit and return
                            let _ = request_tx.blocking_send(ConsoleRequest::Exit);
                            return;
                        }
                    }
                }
            }
            Ok(Signal::CtrlC) => {
                // Clear current line (reedline handles this)
                debug!("Console reedline_loop: Ctrl+C");
            }
            Ok(Signal::CtrlD) => {
                debug!("Console reedline_loop: Ctrl+D, exiting");
                let _ = request_tx.blocking_send(ConsoleRequest::Exit);
                break;
            }
            Err(err) => {
                error!(error = ?err, "Console reedline_loop: read_line error");
                let _ = request_tx.blocking_send(ConsoleRequest::Exit);
                break;
            }
        }
    }

    debug!("Console reedline_loop: exiting");
}
