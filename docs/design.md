# Design Choices

## Guiding Principle

Ark already does the hard work: kernel execution, LSP, plot device, comm protocol. Krarkode's job is to surface that work inside VS Code—nothing more. Every design decision flows from this constraint.

---

## 1. Rust Sidecar Instead of TypeScript ZeroMQ Bindings

**The problem**: Jupyter's wire protocol runs over ZeroMQ. TypeScript ZeroMQ bindings (`zeromq.js`) exist but are native addons that complicate packaging, platform support, and VS Code's extension sandbox.

**The choice**: A small Rust binary (`ark-sidecar`) owns all socket work. The extension spawns it as a child process and exchanges newline-delimited JSON over stdin/stdout.

The sidecar supports five operating modes, each invoked as a CLI subcommand:

| Mode | Purpose |
|------|---------|
| `lsp` | Opens LSP comm, retrieves the TCP port Ark exposes |
| `execute` | Runs R code, optionally waits for kernel idle |
| `watch-plot` | Opens UI/help/variables/data-explorer comms, watches for plot updates |
| `check` | Kernel liveness probe |
| `console` | Interactive REPL with LSP-powered completions (via reedline) |

Key Rust dependencies: `runtimelib` (Jupyter protocol), `tokio` (async runtime), `zeromq`, `tree-sitter-r` (R syntax parsing), `reedline` (REPL), `lsp-types`.

**Trade-offs**:
- Sidecar emits typed JSON events to stdout (`SidecarEvent` union); the extension consumes them via auto-generated TypeScript types (`sidecarProtocol.generated.ts`)
- Clean process isolation: sidecar crash doesn't take down the extension
- Binary must be distributed/built separately from the extension JS bundle
- Adds a Rust toolchain requirement for contributors

---

## 2. Comm Protocol Over Custom IPC

**The problem**: Ark exposes its UI surface (variables, help, data explorer, plots) through Jupyter's comm protocol. We need to reach those surfaces from the extension.

**The choice**: Use comm natively rather than inventing a parallel channel. The sidecar opens comms on behalf of the extension and proxies messages.

Six comm targets are in use:

| Target | Purpose |
|--------|---------|
| `positron.lsp` | LSP port negotiation |
| `positron.plot` | Plot rendering and metadata |
| `positron.ui` | Dynamic plot enable, general UI bridge |
| `positron.help` | Help page content |
| `positron.variables` | Variables panel data |
| `positron.dataExplorer` | Data explorer schema, values, filters, profiles |

**Why not a custom WebSocket or REST API?**
Ark does not expose one. The comm protocol is Ark's public contract—using it means Krarkode stays compatible across Ark versions without patching the kernel.

**Critical constraints discovered during implementation**:
- `positron.ui` comm **must be opened at session start** or Ark disables dynamic plot re-rendering (reverts to static one-shot images).
- `comm_msg` payloads **must include an `id` field** for Ark to treat them as RPC requests. Without `id`, Ark silently discards the message instead of calling the handler.

---

## 3. Purpose-Built for Ark, Not Multi-Backend

**The problem**: The predecessor approach (vscode-R) maintained compatibility with multiple Jupyter kernels. This created complexity and prevented full use of Ark-specific features.

**The choice**: Krarkode targets only Ark. It uses Ark's specific comm targets, startup behavior, and LSP extensions without abstraction layers.

**Trade-offs**:
- Clean, minimal codebase—no backend detection or capability negotiation
- Can exploit Ark-specific protocol details (e.g., `statementRange` LSP method)
- Does not work with IRkernel or other R kernels

---

## 4. Template-Based Session Configuration

**The problem**: Users have wildly different setups—Ark installed via Positron, built from source, managed by pixi, or wrapped in a container.

**The choice**: All launch commands are Go-style templates with named substitution variables:

```
# Kernel launch
{arkPath} --connection_file {connectionFile} --session-mode console --startup-file {startupFile}

# Console launch
{sidecarPath} console --connection-file {connectionFile}
```

Additional template variables for path settings: `${userHome}`, `${workspaceFolder}`, `${fileWorkspaceFolder}`, `${fileDirname}`.

Users override the default templates in settings to match their environment.

---

## 5. Generated Startup Script (`init-ark.R`)

Each session generates a per-session R startup script rather than embedding R code as escaped strings in TypeScript.

**The constraint**: The startup script often contains JSON payloads. Manual string escaping in R is error-prone and breaks on nested quotes or special characters.

**The choice**: A standalone R JSON serializer (`resources/scripts/json-serializer.R`) is imported at build time (via Vite `?raw` import) and injected into the generated `init-ark.R`. The serializer provides:
- `.krarkode_json_object()` — converts a named R list to a JSON object string
- `.krarkode_json_scalar()` — converts a single R value to a JSON value
- `.krarkode_escape_json_string()` — handles JSON special character escaping

The startup script reads the `ARK_CONNECTION_FILE` env var, builds an announce payload (`sessionName`, `connectionFilePath`, `pid`, `startedAt`), serializes it, and writes it to an announce file.

This is a hard rule: **never construct JSON payloads ad hoc in R startup scripts. Use the shared serializer helper or pre-serialize in TypeScript.**

---

## 6. Svelte 5 for Data Explorer, Vanilla TS Everywhere Else

The data explorer has significant interactive complexity: virtual scrolling (`@tanstack/virtual-core`), column sorting, row filtering, column statistics with charts (`echarts`), selection state, export. This justified using a reactive framework.

All other webviews (variables, plot viewer) are vanilla TypeScript with direct DOM manipulation. Their state is simple enough that a framework would add build complexity without benefit.

| Webview | Framework | Build |
|---------|-----------|-------|
| Data Explorer | Svelte 5 (runes) | Vite + `@sveltejs/vite-plugin-svelte` → IIFE |
| Variables | Vanilla TS | Vite → IIFE |
| Plot Viewer | Vanilla TS | Vite → IIFE |

Svelte 5 was chosen over React or Vue because:
- Smaller output bundle (matters for webview load time)
- Compile-time reactivity—no virtual DOM overhead for table re-renders
- Runes API (`$state`, `$derived`) makes state flow explicit at large component count

Data explorer stores (`dataStore.svelte.ts`, `uiStore.svelte.ts`, `statsStore.svelte.ts`) use Svelte 5's reactive store pattern.

---

## 7. Background LSP Kernel

The Ark LSP runs inside the kernel process. If there is no active session, code completion would be unavailable.

**The choice**: `ArkLanguageService` automatically spawns a background Ark instance solely for LSP when no session is active. The sidecar opens a `positron.lsp` comm to discover the TCP port, then the extension connects a `vscode-languageclient` LSP client to that port. Supported languages: R and R Markdown.

When a real session starts, the LSP client switches to use that session's kernel.

This means the editor stays fully featured (completions, diagnostics, hover) even when no interactive session is running. The LSP client also relays Ark kernel logs and sidecar Rust logs for debugging.

---

## 8. Vite-Based Build Pipeline

All TypeScript/Svelte compilation uses Vite (v8) with separate configs per target:

| Config | Entry | Format | Output |
|--------|-------|--------|--------|
| `vite.config.ts` | `src/extension.ts` | ESM | `dist/extension.js` |
| `vite.dataexplorer.config.ts` | Data Explorer | IIFE | `dist/html/dataExplorer/` |
| `vite.variables.config.ts` | Variables | IIFE | `dist/html/variables/` |
| `vite.plotviewer.config.ts` | Plot Viewer | IIFE | `dist/html/plotViewer/` |

Type generation is a pre-build step: `data_explorer.json` schema → TypeScript types, `sidecar_events.json` → `SidecarEvent` union type. This keeps the extension's protocol types synchronized with the sidecar's Rust definitions.

---

## 9. Event-Driven Sidecar Protocol

The extension and sidecar communicate over stdin/stdout with a typed JSON event protocol. Events are defined in `resources/sidecar_events.json` and code-generated into both TypeScript (`sidecarProtocol.generated.ts`) and consumed by the Rust side.

Key event categories:

| Category | Events |
|----------|--------|
| Lifecycle | `Alive`, `KernelStatus`, `Error` |
| LSP | `LspPort` |
| Comm lifecycle | `CommOpen`, `CommMsg`, `CommClose` |
| Typed comm opens | `UiCommOpen`, `HelpCommOpen`, `VariablesCommOpen`, `DataExplorerCommOpen` |
| Display | `DisplayData`, `UpdateDisplayData`, `ShowHtmlFile`, `ShowHelp` |

This typed protocol replaces ad hoc message parsing—every event the sidecar can emit has a corresponding TypeScript discriminated union member, enabling exhaustive handling in the extension.
