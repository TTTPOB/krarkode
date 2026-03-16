# Changelog

## Unreleased

### Features

- **Sidecar Console**: Built-in reedline-based REPL replacing `jupyter console`, with R syntax highlighting, bracket validation, XDG history persistence, and LSP-powered tab completion.
- **LSP Client**: Embedded LSP client in sidecar for console code completions via JSON-RPC over TCP.
- **Multi R Binary Support**: `krarkode.r.rBinaryPath` accepts a string or array; session creation shows a QuickPick for binary selection.
- **Pixi Environment Discovery**: Automatic detection of R from pixi environments; `Doctor` command reports pixi status.
- **Template Variables in Paths**: All path configuration settings now support `{arkPath}`, `{connectionFile}`, etc.
- **ConfigurationWatcher**: Centralized, debounced watcher for configuration changes.
- **Bundled Ark Binary**: Ark binary is bundled in the VSIX and used as default.
- **Data Explorer**: Histogram axis labels formatted to 3 significant digits.

### Improvements

- Sidecar CLI migrated from manual argument parsing to clap subcommands.
- Console completions prefer prefix matches and use column-first layout.
- Logging channels reorganized: runtime, ui, kernel, lsp, sidecar, doctor.
- Dropped Windows target and testthat integration.

### Fixes

- Sidecar responds to LSP server requests during completion flow.
- Preserve existing `RUST_LOG` directives when setting log level.
- Validate R binary path is an executable file, not a directory.

## 0.1.0 (2026-03-15)

Initial release of krarkode, providing Positron-like R development experience in VS Code via Ark kernel integration.

### Features

- **Ark Session Management**: Create, attach, switch, stop, and interrupt Ark kernel sessions. Status bar indicator shows kernel state (idle/busy/starting).
- **Code Execution**: Run selection/line (Ctrl+Enter), source files, run from line to end or beginning to line. Quick inspection commands (nrow, length, head, names, View).
- **Smart Expression Execution**: Ctrl+Enter with no selection uses Ark LSP `statementRange` to detect and send complete multi-line R expressions (for loops, function definitions, pipe chains).
- **Bracketed Paste**: Multi-line code is sent to the terminal wrapped with ANSI bracketed paste escape sequences for reliable execution.
- **Ark LSP Integration**: Code completion, diagnostics, go-to-definition, and hover via Ark language server. Auto-starts background kernel if no session is active.
- **Plot Viewer**: Display base R graphics and display_data plots with history navigation, zoom controls, save to file, and open in browser. Dynamic re-rendering on resize.
- **Help Browser**: Interactive R help viewer with navigation (back/forward/home), find, and F1 cursor lookup.
- **Variables Panel**: Webview-based variable inspector connected to the active Ark session.
- **Data Explorer**: Interactive data frame/table exploration with sorting, filtering, column profiling, and pagination.
- **HTML Output**: Display R HTML output (htmlwidgets, etc.) in dedicated panels.
- **Doctor Command**: `Krarkode: Doctor (Check Environment)` validates R, Ark, tmux, and sidecar prerequisites with actionable error messages.
- **Logging**: Multi-channel logging system (ark, kernel, LSP, sidecar) with configurable levels.

### Configuration

- 25 settings covering R environment, Ark kernel, console driver (tmux/external), LSP, plot viewer, HTML viewer, and logging.
- Key settings: `krarkode.bracketedPaste`, `krarkode.ark.path`, `krarkode.r.rBinaryPath`, `krarkode.ark.console.driver`.
