// Blocking reedline loop for console mode.
//
// Runs in tokio::task::spawn_blocking. Constructs the reedline editor
// with highlighter, validator, completer, and history, then enters the
// read-execute-display loop.

use std::io::Write;
use std::panic::{catch_unwind, panic_any, resume_unwind, AssertUnwindSafe};
use std::sync::mpsc as std_mpsc;
use std::sync::{Arc, Mutex};

use nu_ansi_term::Color;
use reedline::{
    default_emacs_keybindings, ColumnarMenu, DefaultPrompt, DefaultPromptSegment, Emacs,
    ExternalPrinter, KeyCode, KeyModifiers, MenuBuilder, Reedline, ReedlineEvent, ReedlineMenu,
    Signal, TraversalDirection,
};
use tracing::{debug, error, info};

use super::completer::LspCompleter;
use super::highlighter::RHighlighter;
use super::history::create_history;
use super::kernel_loop::ConsoleRequest;
use super::output::{kernel_disconnect_message, ConsoleUiEvent};
use super::r_parser::parse_r;
use super::validator::RValidator;
use crate::lsp_client::virtual_document::DebouncedVirtualDocument;
use crate::lsp_client::LspClient;

type SharedUiReceiver = Arc<Mutex<std_mpsc::Receiver<ConsoleUiEvent>>>;

#[derive(Debug)]
struct DisconnectExitSentinel {
    message: String,
}

#[derive(Debug, PartialEq, Eq)]
enum IdleUiAction {
    Print(String),
    Exit(String),
}

#[derive(Debug, PartialEq, Eq)]
enum ExecutionUiAction {
    Print(String),
    ExecutionDone,
    Exit(String),
}

/// The R console prompt.
fn make_prompt() -> DefaultPrompt {
    DefaultPrompt::new(
        DefaultPromptSegment::Basic("R".to_string()),
        DefaultPromptSegment::Empty,
    )
}

/// Print the startup banner with R version and binary path info.
fn print_banner(r_version: Option<&str>, r_binary_path: Option<&str>) {
    let mut banner = String::from("Ark R Console");
    if let Some(version) = r_version {
        banner.push_str(" \u{2014} ");
        banner.push_str(version);
    }
    if let Some(path) = r_binary_path {
        banner.push_str(&format!(" ({})", path));
    }
    println!("{}", banner);
    println!("Ctrl+D to exit console (Ark session continues).");
    println!();
}

/// Check if user input is a call to q() or quit() using tree-sitter AST.
///
/// Matches: q(), quit(), q(save="no"), base::q(), base::quit(), etc.
/// Does NOT match: q, quit (without parens), myq(), or q() embedded in
/// larger expressions like `if (x) q()`.
fn is_quit_call(input: &str) -> bool {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return false;
    }

    let tree = match parse_r(trimmed) {
        Some(tree) => tree,
        None => return false,
    };

    let root = tree.root_node();
    if root.has_error() {
        return false;
    }

    // Must be a program with exactly one top-level expression
    let mut child_count = 0;
    let mut first_child = None;
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if child.is_named() {
            child_count += 1;
            if first_child.is_none() {
                first_child = Some(child);
            }
        }
    }
    if child_count != 1 {
        return false;
    }

    let expr = match first_child {
        Some(node) => node,
        None => return false,
    };

    // The expression must be a function call
    if expr.kind() != "call" {
        return false;
    }

    // Get the function being called
    let function_node = match expr.child_by_field_name("function") {
        Some(node) => node,
        None => return false,
    };

    let source = trimmed.as_bytes();

    match function_node.kind() {
        // Direct call: q() or quit()
        "identifier" => {
            let name = &source[function_node.start_byte()..function_node.end_byte()];
            name == b"q" || name == b"quit"
        }
        // Namespaced call: base::q() or base::quit()
        "namespace_operator" => {
            let mut cursor = function_node.walk();
            let children: Vec<_> = function_node.children(&mut cursor).collect();
            // Expected structure: identifier(base) :: identifier(q/quit)
            if children.len() < 3 {
                return false;
            }
            let ns = &source[children[0].start_byte()..children[0].end_byte()];
            let func = &source[children[2].start_byte()..children[2].end_byte()];
            ns == b"base" && (func == b"q" || func == b"quit")
        }
        _ => false,
    }
}

/// Show red warning and ask for y/N confirmation when q()/quit() is detected.
/// Returns true if user confirms (wants to quit R session).
fn confirm_quit() -> bool {
    let warning = Color::Red.paint(
        "q() will terminate the Ark session, not just exit this console.\n\
         Press Ctrl+D to exit console only.\n\
         Really quit R? (y/N): ",
    );
    print!("{}", warning);
    let _ = std::io::stdout().flush();

    let mut answer = String::new();
    match std::io::stdin().read_line(&mut answer) {
        Ok(_) => answer.trim().eq_ignore_ascii_case("y"),
        Err(_) => false,
    }
}

fn print_dimmed_message(message: &str) {
    println!();
    print!("{}", Color::DarkGray.paint(message));
    if !message.ends_with('\n') {
        println!();
    }
}

fn recv_ui_event(shared_ui_rx: &SharedUiReceiver) -> Result<ConsoleUiEvent, std_mpsc::RecvError> {
    shared_ui_rx.lock().unwrap().recv()
}

fn try_recv_ui_event(
    shared_ui_rx: &SharedUiReceiver,
) -> Result<ConsoleUiEvent, std_mpsc::TryRecvError> {
    shared_ui_rx.lock().unwrap().try_recv()
}

fn classify_execution_event(event: ConsoleUiEvent) -> ExecutionUiAction {
    match event {
        ConsoleUiEvent::Output(text) => ExecutionUiAction::Print(text),
        ConsoleUiEvent::ExecutionDone => ExecutionUiAction::ExecutionDone,
        ConsoleUiEvent::KernelDisconnected(message) => ExecutionUiAction::Exit(message),
    }
}

fn drain_idle_actions(shared_ui_rx: &SharedUiReceiver) -> Vec<IdleUiAction> {
    let mut actions = Vec::new();

    loop {
        match try_recv_ui_event(shared_ui_rx) {
            Ok(ConsoleUiEvent::Output(text)) => actions.push(IdleUiAction::Print(text)),
            Ok(ConsoleUiEvent::ExecutionDone) => {}
            Ok(ConsoleUiEvent::KernelDisconnected(message)) => {
                debug!("Console idle: received KernelDisconnected, triggering immediate exit");
                actions.push(IdleUiAction::Exit(message));
                return actions;
            }
            Err(std_mpsc::TryRecvError::Empty) => break,
            Err(std_mpsc::TryRecvError::Disconnected) => {
                debug!("Console idle: ui event channel disconnected, triggering exit");
                actions.push(IdleUiAction::Exit(kernel_disconnect_message()));
                return actions;
            }
        }
    }

    actions
}

/// Run the blocking reedline loop.
///
/// This function should be called inside `tokio::task::spawn_blocking`.
pub(crate) fn run_reedline_loop(
    request_tx: tokio::sync::mpsc::Sender<ConsoleRequest>,
    ui_event_rx: std_mpsc::Receiver<ConsoleUiEvent>,
    lsp_client: Option<Arc<LspClient>>,
    runtime_handle: tokio::runtime::Handle,
    r_version: Option<String>,
    r_binary_path: Option<String>,
) {
    let result = catch_unwind(AssertUnwindSafe(|| {
        run_reedline_loop_inner(
            request_tx,
            ui_event_rx,
            lsp_client,
            runtime_handle,
            r_version,
            r_binary_path,
        );
    }));

    match result {
        Ok(()) => {}
        Err(payload) => match payload.downcast::<DisconnectExitSentinel>() {
            Ok(sentinel) => {
                debug!("Console reedline_loop: idle disconnect exit");
                print_dimmed_message(&sentinel.message);
            }
            Err(other) => resume_unwind(other),
        },
    }
}

fn run_reedline_loop_inner(
    request_tx: tokio::sync::mpsc::Sender<ConsoleRequest>,
    ui_event_rx: std_mpsc::Receiver<ConsoleUiEvent>,
    lsp_client: Option<Arc<LspClient>>,
    runtime_handle: tokio::runtime::Handle,
    r_version: Option<String>,
    r_binary_path: Option<String>,
) {
    debug!("Console reedline_loop: building editor");

    // Print startup banner
    print_banner(r_version.as_deref(), r_binary_path.as_deref());

    let shared_ui_rx = Arc::new(Mutex::new(ui_event_rx));
    let virtual_document = lsp_client
        .as_ref()
        .map(|client| DebouncedVirtualDocument::new(client.clone(), runtime_handle.clone()));

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
            .with_column_padding(2)
            .with_traversal_direction(TraversalDirection::Vertical),
    );

    let printer = ExternalPrinter::default();
    let printer_sender = printer.sender();
    let idle_ui_rx = Arc::clone(&shared_ui_rx);

    // Build reedline editor
    let mut editor = Reedline::create()
        .with_highlighter(Box::new(RHighlighter::new(virtual_document.clone())))
        .with_validator(Box::new(RValidator))
        .with_external_printer(printer)
        .with_idle_callback(Box::new(move || {
            for action in drain_idle_actions(&idle_ui_rx) {
                match action {
                    IdleUiAction::Print(text) => {
                        let _ = printer_sender.send(text);
                    }
                    IdleUiAction::Exit(message) => {
                        panic_any(DisconnectExitSentinel { message })
                    }
                }
            }
        }));

    // Attach LSP completer if available
    if let Some(virtual_document) = virtual_document {
        info!("Console reedline_loop: LSP completion enabled");
        editor = editor
            .with_completer(Box::new(LspCompleter::new(
                virtual_document,
                runtime_handle,
            )))
            .with_menu(ReedlineMenu::EngineCompleter(completion_menu))
            .with_edit_mode(edit_mode);
    } else {
        info!("Console reedline_loop: no LSP client, completion disabled");
        editor = editor.with_edit_mode(edit_mode);
    }

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

    'console: loop {
        match editor.read_line(&prompt) {
            Ok(Signal::Success(line)) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                debug!(line_len = line.len(), "Console reedline_loop: user input");

                // Intercept q()/quit() calls with confirmation
                if is_quit_call(trimmed) {
                    if confirm_quit() {
                        debug!(
                            "Console reedline_loop: user confirmed q(), sending execute-and-exit"
                        );
                        if request_tx
                            .blocking_send(ConsoleRequest::ExecuteAndExit(line))
                            .is_err()
                        {
                            debug!("Console reedline_loop: request channel closed, exiting");
                            break;
                        }

                        // Drain remaining output before exiting
                        loop {
                            match recv_ui_event(&shared_ui_rx) {
                                Ok(event) => match classify_execution_event(event) {
                                    ExecutionUiAction::Print(text) => print!("{}", text),
                                    ExecutionUiAction::ExecutionDone => break,
                                    ExecutionUiAction::Exit(message) => {
                                        print_dimmed_message(&message);
                                        break 'console;
                                    }
                                },
                                Err(_) => {
                                    debug!("Console reedline_loop: ui event channel closed during quit drain");
                                    break;
                                }
                            }
                        }
                        break;
                    }
                    debug!("Console reedline_loop: user declined q(), returning to prompt");
                    continue;
                }

                // Send code to kernel loop for execution
                if request_tx
                    .blocking_send(ConsoleRequest::Execute(line))
                    .is_err()
                {
                    debug!("Console reedline_loop: request channel closed, exiting");
                    break;
                }

                // Real-time output loop: receive and print output until execution completes
                loop {
                    match recv_ui_event(&shared_ui_rx) {
                        Ok(event) => match classify_execution_event(event) {
                            ExecutionUiAction::Print(text) => print!("{}", text),
                            ExecutionUiAction::ExecutionDone => break,
                            ExecutionUiAction::Exit(message) => {
                                print_dimmed_message(&message);
                                break 'console;
                            }
                        },
                        Err(_) => {
                            debug!("Console reedline_loop: ui event channel closed");
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
                println!();
                println!(
                    "{}",
                    Color::DarkGray.paint(
                        "Detaching from Ark session. The R session continues running.\n\
                         If a long-running task is in progress, reconnect with:\n  \
                         vscode-r-ark-sidecar console --connection-file <path>"
                    )
                );
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

#[cfg(test)]
mod tests {
    use super::*;
    use reedline::{Prompt, PromptEditMode};

    #[test]
    fn prompt_uses_r_with_default_indicator() {
        assert_eq!(make_prompt().render_prompt_left(), "R");
        assert_eq!(make_prompt().render_prompt_right(), "");
        assert_eq!(
            make_prompt().render_prompt_indicator(PromptEditMode::Default),
            "〉"
        );
    }

    #[test]
    fn quit_call_simple() {
        assert!(is_quit_call("q()"));
        assert!(is_quit_call("quit()"));
    }

    #[test]
    fn quit_call_with_args() {
        assert!(is_quit_call("q(save = \"no\")"));
        assert!(is_quit_call("quit(save=\"yes\")"));
        assert!(is_quit_call("q(save = \"no\", status = 0)"));
    }

    #[test]
    fn quit_call_with_whitespace() {
        assert!(is_quit_call("  q()  "));
        assert!(is_quit_call("quit( )"));
        assert!(is_quit_call("\tq()\n"));
    }

    #[test]
    fn quit_call_namespaced() {
        assert!(is_quit_call("base::q()"));
        assert!(is_quit_call("base::quit()"));
        assert!(is_quit_call("base::q(save = \"no\")"));
    }

    #[test]
    fn not_quit_call() {
        // Not a call (no parens)
        assert!(!is_quit_call("q"));
        assert!(!is_quit_call("quit"));

        // Different function names
        assert!(!is_quit_call("print(q())"));
        assert!(!is_quit_call("myq()"));
        assert!(!is_quit_call("quit2()"));

        // Part of larger expression
        assert!(!is_quit_call("if (TRUE) q()"));
        assert!(!is_quit_call("x <- q()"));
        assert!(!is_quit_call("q(); print(1)"));

        // Empty / whitespace
        assert!(!is_quit_call(""));
        assert!(!is_quit_call("   "));

        // Wrong namespace
        assert!(!is_quit_call("utils::q()"));
        assert!(!is_quit_call("foo::quit()"));
    }

    #[test]
    fn execution_disconnect_event_requests_exit() {
        let action =
            classify_execution_event(ConsoleUiEvent::KernelDisconnected("bye".to_string()));
        assert_eq!(action, ExecutionUiAction::Exit("bye".to_string()));
    }

    #[test]
    fn idle_disconnect_exits_immediately() {
        let (tx, rx) = std_mpsc::channel();
        let shared_rx = Arc::new(Mutex::new(rx));

        tx.send(ConsoleUiEvent::KernelDisconnected("bye".to_string()))
            .expect("send disconnect");

        assert_eq!(
            drain_idle_actions(&shared_rx),
            vec![IdleUiAction::Exit("bye".to_string())]
        );
    }

    #[test]
    fn idle_channel_disconnect_exits() {
        let (tx, rx) = std_mpsc::channel();
        let shared_rx = Arc::new(Mutex::new(rx));

        drop(tx);

        assert_eq!(
            drain_idle_actions(&shared_rx),
            vec![IdleUiAction::Exit(kernel_disconnect_message())]
        );
    }

    #[test]
    fn idle_output_is_printed_without_exiting() {
        let (tx, rx) = std_mpsc::channel();
        let shared_rx = Arc::new(Mutex::new(rx));

        tx.send(ConsoleUiEvent::Output("hello\n".to_string()))
            .expect("send output");

        assert_eq!(
            drain_idle_actions(&shared_rx),
            vec![IdleUiAction::Print("hello\n".to_string())]
        );
        assert!(drain_idle_actions(&shared_rx).is_empty());
    }
}
