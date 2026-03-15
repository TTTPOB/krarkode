# Architecture

## Overview

Krarkode is structured as three layers: the VS Code extension (TypeScript), a Rust sidecar process, and the Ark kernel (R). The extension never speaks ZeroMQ directly—all kernel communication is delegated to the sidecar.

```
┌─────────────────────────────────────────────────────────────────┐
│                       VS Code Extension                          │
│                                                                 │
│  SessionManager ── CodeExecutor ── ArkLanguageService           │
│        │                                   │                    │
│  SidecarManager ◄──────────────────────────┘                    │
│        │                                                        │
│  PlotManager  HelpManager  VariablesManager  DataExplorerManager│
│       │            │             │                  │           │
│  WebviewPanel  WebviewPanel  WebviewPanel       WebviewPanel    │
│  (vanilla TS)  (vanilla TS)  (vanilla TS)       (Svelte 5)      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ stdin / stdout  (newline-delimited JSON)
┌───────────────────────────▼─────────────────────────────────────┐
│                     ark-sidecar  (Rust)                          │
│                                                                 │
│  run_lsp()  run_execute_request()  run_plot_watcher()           │
│                   run_check()                                   │
│                                                                 │
│  ZeroMQ Shell socket  ◄── comm_open / execute_request           │
│  ZeroMQ IoPub socket  ──► display_data / comm_message           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ ZeroMQ  (connection.json)
┌───────────────────────────▼─────────────────────────────────────┐
│                      Ark Kernel  (R)                             │
│                                                                 │
│  Comm: positron.ui  positron.variables  positron.help           │
│        positron.data_explorer                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Extension Core

**Entry point**: `src/extension.ts`

Activation order:

```
1. Logger (multi-channel)
2. SidecarManager
3. ArkCommBackend + PlotManager
4. HtmlViewer
5. VariablesService + VariablesManager
6. SessionManager
7. CodeExecutor
8. ArkLanguageService  (auto-starts background kernel)
9. HelpService + HelpManager
10. DataExplorerManager
```

Session change events cascade down: `SessionManager` notifies `SidecarManager`, which reconnects sockets; `ArkLanguageService` restarts its LSP client; `VariablesManager` re-subscribes to the new session's comm channel.

---

## Sidecar (`ark-sidecar/`)

A small Rust binary that owns all ZeroMQ socket work. The extension spawns sidecar instances on demand and communicates over **newline-delimited JSON on stdin/stdout**.

| Mode | Invocation | Purpose |
|------|-----------|---------|
| `run_lsp` | Once per session | Starts Ark LSP; sends `comm_open` on `positron.ui` (required for dynamic plots); proxies LSP traffic |
| `run_execute_request` | Per execution | Fires a single `execute_request` on the shell socket; optionally waits for kernel-idle |
| `run_plot_watcher` | Once per session | Tails the IoPub socket; emits `display_data` and `show_html_file` events as JSON to stdout |
| `run_check` | On demand | Validates environment (R, Ark, connection) for the `doctor` command |

Key dependencies: `runtimelib` (Jupyter protocol), `zeromq`, `tokio`.

---

## Comm Protocol

Ark exposes its UI surface through Jupyter's [comm protocol](https://jupyter-client.readthedocs.io/en/stable/messaging.html#custom-messages). Each subsystem opens its own named comm:

| Comm target | Subsystem | Direction |
|-------------|-----------|-----------|
| `positron.ui` | Enables dynamic plot re-rendering | ext → kernel |
| `positron.variables` | Variable inspector data | kernel → ext |
| `positron.data_explorer` | Data frame table data | bidirectional |
| `positron.help` | Help page content | bidirectional |

**Message shapes (extension → sidecar stdin):**

```json
{ "command": "comm_open",  "comm_id": "<uuid>", "target_name": "positron.ui", "data": {} }
{ "command": "comm_msg",   "comm_id": "<uuid>", "data": { "id": "<req-id>", "method": "render", "params": { "width": 800, "height": 600 } } }
{ "command": "comm_close", "comm_id": "<uuid>", "data": {} }
```

**Message shapes (sidecar stdout → extension):**

```json
{ "type": "comm_message",    "comm_id": "...", "data": { ... } }
{ "type": "display_data",    "data": { "image/png": "<base64>" } }
{ "type": "show_html_file",  "path": "...", "destination": "..." }
```

---

## Session Storage

Each session gets an isolated directory:

```
~/.krarkode/sessions/{sessionName}/
├── connection.json     # Jupyter connection file (ZeroMQ ports + keys)
├── init-ark.R         # Generated R startup script
└── kernel.log         # Ark stdout/stderr
```

A JSON registry in VS Code's global storage tracks `{ sessionName, connectionFilePath, pid, startedAt }` for all sessions, enabling attach-to-existing across editor restarts.

---

## Webviews

| Webview | UI Layer | Build |
|---------|----------|-------|
| Variables | Vanilla TypeScript + CSS | Vite IIFE |
| Plot Viewer | Vanilla TypeScript + CSS | Vite IIFE |
| Help | Vanilla TypeScript + CSS | Vite IIFE |
| Data Explorer | Svelte 5 | Vite + esbuild-svelte IIFE |

The data explorer is the only Svelte webview—its interactive complexity (filtering, sorting, column stats, virtual scroll) justified the framework overhead. All other webviews stay vanilla for simplicity.

Data explorer internals:
- **14 hook controllers**: row data, schema, row filters, stats, layout, interaction, selection, export, …
- **3 Svelte stores**: `dataStore`, `uiStore`, `statsStore`
- **Virtual scrolling**: TanStack Virtual (handles millions of rows without DOM overflow)

---

## Logging

Six independent VS Code output channels, each independently configurable (`none` → `trace`):

| Channel | Covers |
|---------|--------|
| `runtime` | Session lifecycle, sidecar spawning |
| `ui` | Webview messages, panel events |
| `kernel` | Ark stdout/stderr (parsed from raw logs) |
| `lsp` | LSP client traffic |
| `sidecar` | Sidecar JSON events |
| `doctor` | Environment check output |
