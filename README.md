# Krarkode

VS Code extension using Ark as the R kernel.

> **v0.1.0 released, ready for daily interactive use.**

[中文](README.cn.md)

---

## What Is This?

Previously, the go-to choice for using R in VS Code was the [vscode-R extension](https://marketplace.visualstudio.com/items?itemName=REditorSupport.r). It is a great extension, but I still have some gripes with it: plot viewer backend format support, language server performance and correctness, data explorer experience, and more. Additionally, its LSP server and plot viewer require separate R packages to work.

[Ark](https://github.com/posit-dev/ark) is a full-featured R kernel built by Posit. It ships with an LSP server, Jupyter comm protocol support, and a built-in plot device. However, using Ark natively in VS Code is currently not possible — it only works in [Positron](https://github.com/posit-dev/positron), the Electron-based IDE built by Posit.

That is why I built Krarkode: to bring Ark's R kernel experience into VS Code. This project has a strong personal bias; most design decisions serve my preferred workflow rather than being designed for generic use cases. I am a bioinformatician, mainly using R for data analysis and visualization rather than package development, and I don't use R Markdown at all, so package development and R Markdown-related features are out of scope for now.

Because my time is limited, I chose to glue multiple existing tools together (session management even uses `tmux` directly). The implementation is not the most elegant, but it works anyway. Most of the code was generated with the help of `Claude Code` and `Codex`. But I have put enough human intelligence into the design, and I won't be ashamed of the AI involvement.

The name, though seemingly hard to pronounce, means I `cracked` `ark` out of Positron and put it into VS `Code`.

See [docs/design.md](docs/design.md) for design rationale.

---

## Features (v0.1.0)

### Session Management

- Create, attach, switch, stop, and interrupt Ark sessions
- Status bar shows real-time kernel state: `idle` / `busy` / `starting` / `reconnecting`
- Sessions persist across editor restarts (registry + connection file)

### Code Execution

- Run selection or current line (`Ctrl+Enter` / `Cmd+Enter`)
- Source file with optional echo (`Ctrl+Shift+S`)
- Run from line to end / beginning to line
- Smart multi-line detection via Ark LSP's `statementRange` query
- Quick-inspect: `nrow()`, `length()`, `head()`, `t(head())`, `names()`, `View()`

### Language Server

- Full R language intelligence: completions, diagnostics, hover, go-to-definition
- Auto-starts a background Ark instance for LSP when no interactive session is active

### Plot Viewer

- Captures `display_data` from base R graphics, ggplot2, etc.
- History navigation, zoom controls, fit-to-window
- Save to file, open in browser
- Dynamic re-rendering on panel resize (via `positron.ui` comm)

### Help Browser

- R help viewer inside VS Code with back/forward/home navigation
- In-panel search
- `F1` at cursor looks up the function under point
- `Ctrl+Shift+H` to open

### Variables Panel

- Real-time workspace inspector connected via `positron.variables` comm
- Expandable tree for lists and environments

### Data Explorer

- Interactive data frame viewer launched via `View()` or the variables panel
- Column sorting, row filtering, column statistics
- Virtual scrolling (TanStack Virtual) for large data frames
- Column visibility toggle

### HTML Viewer

- Displays `show_html_file` output: htmlwidgets, R Markdown, etc.

### Pixi Environment Support

- Auto-discovers R binaries from `pixi.toml` in workspace or configured path
- Multi-candidate R binary picker when creating sessions

### Logging

- 5 independent output channels: Runtime, UI, Ark Kernel, LSP, Sidecar
- Per-channel log level configuration (none / error / warn / info / debug / trace)

### Doctor

- `Krarkode: Doctor` command checks R binary, Ark binary, sidecar, tmux, and Pixi environment status

---

## Implementation Status

| Feature | Status |
|---------|--------|
| Session management (create / attach / switch / stop) | ✅ |
| Code execution (selection, line, file, ranges) | ✅ |
| Smart multi-line expression detection | ✅ |
| Ark LSP with auto background kernel | ✅ |
| Plot viewer (history, zoom, save, dynamic resize) | ✅ |
| Help browser (F1 lookup, navigation) | ✅ |
| Variables panel | ✅ |
| Data explorer (sort, filter, stats, virtual scroll) | ✅ |
| HTML viewer | ✅ |
| Pixi environment support | ✅ |
| Logging (5 independent channels) | ✅ |
| Doctor diagnostics | ✅ |
| Console mode — tmux driver | ✅ |
| Debugger integration | ❌ may consider if DAP integration becomes available |

---

## Requirements

- **Ark** binary — build from [posit-dev/ark](https://github.com/posit-dev/ark) or extract from a [Positron](https://github.com/posit-dev/positron) release
- **R** 4.1+ (no additional R packages required for Ark session management)
- **tmux** — used for session management (tmux driver mode only)

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `krarkode.r.binaryPath` | `[]` | R executable path(s), string or array; leave empty to auto-detect |
| `krarkode.pixi.manifestPath` | `""` | Path to `pixi.toml` for R environment discovery |
| `krarkode.ark.path` | `""` | Ark executable path; leave empty for bundled or PATH |
| `krarkode.ark.logLevel` | `inherit` | Ark backend log level (inherit / error / warn / info / debug / trace) |
| `krarkode.ark.console.commandTemplate` | `{sidecarPath} console --connection-file {connectionFile}` | Console launch command template |
| `krarkode.ark.kernel.commandTemplate` | `{arkPath} --connection_file {connectionFile} --session-mode console --startup-file {startupFile}` | Ark kernel launch command template |
| `krarkode.ark.kernel.startupFileTemplate` | `{sessionsDir}/{name}/init-ark.R` | Startup R script path template |
| `krarkode.ark.sidecar.path` | `""` | Sidecar binary path; leave empty for bundled |
| `krarkode.ark.sidecar.timeoutMs` | `30000` | Sidecar startup timeout (ms) |
| `krarkode.ark.sidecar.ipAddress` | `127.0.0.1` | IP address for sidecar / LSP connections |
| `krarkode.ark.lsp.enabled` | `true` | Enable Ark LSP |
| `krarkode.ark.lsp.timeoutMs` | `15000` | LSP startup timeout (ms) |
| `krarkode.ark.tmux.path` | `tmux` | tmux executable path |
| `krarkode.ark.tmux.manageKernel` | `true` | Auto-start Ark kernel inside tmux |
| `krarkode.plot.viewColumn` | `Two` | Plot panel column (Active / Beside / One / Two / Three / Disable) |
| `krarkode.plot.maxHistory` | `50` | Maximum cached plots |
| `krarkode.html.viewColumn` | `Two` | HTML viewer panel column (Active / Beside / One / Two / Three) |
| `krarkode.source.encoding` | `UTF-8` | Encoding used for source() |
| `krarkode.source.echo` | `false` | Echo sourced code to console |
| `krarkode.terminal.bracketedPaste` | `true` | Use bracketed paste for terminal sends |
| `krarkode.terminal.sendDelay` | `8` | Per-line send delay (ms); only used when bracketedPaste is disabled |
| `krarkode.logging.runtime` | `error` | Runtime channel log level (session lifecycle, kernel startup, code execution) |
| `krarkode.logging.ui` | `error` | UI channel log level (plots, variables, data explorer, help, HTML) |
| `krarkode.logging.arkKernel` | `none` | Kernel channel log level (Ark kernel stdout/stderr) |
| `krarkode.logging.lsp` | `error` | LSP channel log level |
| `krarkode.logging.sidecar` | `error` | Sidecar channel log level |

Template variables available in command templates: `{sidecarPath}`, `{arkPath}`, `{connectionFile}`, `{startupFile}`, `{sessionsDir}`, `{name}`

Path settings support VS Code variable substitution: `${workspaceFolder}`, `${userHome}`, etc.

---

## Development

```bash
pnpm install
cargo build --release --manifest-path ark-sidecar/Cargo.toml

# Build
pnpm run build

# Quality
pnpm run typecheck && pnpm run lint && pnpm run test:unit

# Package
pnpm run build && pnpm run package
```

Sidecar smoke test (requires pixi + R environment):
```bash
pixi run -- node scripts/ark-sidecar-lsp-test.js
```

---

## License

MIT — see [LICENSE](LICENSE).

Ark is MIT licensed. Krarkode uses only Ark's public protocol surface and binary interface; no Positron source code is included.

---

## Related Projects

- [posit-dev/ark](https://github.com/posit-dev/ark) — The Ark R kernel this extension is built around (note: the Ark team recently announced [oak](https://github.com/posit-dev/ark/issues/1117), which extracts the LSP server from Ark. This project may evolve once oak matures.)
- [posit-dev/positron](https://github.com/posit-dev/positron) — Positron IDE, the primary consumer of Ark; source of inspiration for the UX this extension recreates
- [vscode-R](https://marketplace.visualstudio.com/items?itemName=REditorSupport.r) — The most classic VS Code R extension
