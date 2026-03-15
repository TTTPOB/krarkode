# Changelog

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
- **Test Explorer**: testthat integration with VS Code Test Explorer (opt-in via `krarkode.testing.enabled`).
- **Doctor Command**: `Krarkode: Doctor (Check Environment)` validates R, Ark, tmux, and sidecar prerequisites with actionable error messages.
- **Logging**: Multi-channel logging system (ark, kernel, LSP, sidecar) with configurable levels.

### Configuration

- 26 settings covering R environment, Ark kernel, console driver (tmux/external), LSP, plot viewer, HTML viewer, logging, and testing.
- Key settings: `krarkode.bracketedPaste`, `krarkode.ark.path`, `krarkode.r.rBinaryPath`, `krarkode.ark.console.driver`.
