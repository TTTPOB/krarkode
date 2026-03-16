# Krarkode

A focused VS Code extension that brings Positron-quality Ark kernel integration to vanilla VS Code.

> **v0.1.0 released, ready for daily interactive use.**

[中文](README.cn.md)

---

## What Is This?

Previously, using R in VS Code required the [vscode-R extension](https://marketplace.visualstudio.com/items?itemName=REditorSupport.r). It is a great extension, but it has some limitations I don't quite like: plot viewer backend format support, language server performance and correctness, data explorer experience, and more. Additionally, vscode-R's LSP server and plot viewer require separate packages to work.

[Ark](https://github.com/posit-dev/ark) is a full-featured R kernel built by Posit. It ships with an LSP server, Jupyter comm protocol support, and a built-in plot device. However, using Ark natively in VS Code is currently not possible — it only works in [Positron](https://github.com/posit-dev/positron), the Electron-based IDE built by Posit.

That is why I built Krarkode: to bring Ark's R kernel experience into VS Code. This project has a strong personal bias; most design decisions serve my preferred workflow rather than being designed for generic use cases. I am (partly) a bioinformatician, mainly using R for data analysis and visualization rather than package development. I don't use R Markdown at all, so package development and R Markdown-related features are out of scope for now.

Because my time is limited, I chose to glue multiple existing tools together instead of building everything elegantly from scratch. For example, session management relies on `tmux`. The implementation is not the most elegant, but it works. This is my first somewhat "big" project — it has many rough edges, test coverage is very limited (I am a poor test writer), and most of the code was generated with the help of `Claude Code` and `Codex`. But I have put enough human intelligence into the design, and I won't be ashamed of the AI involvement.

The name, though seemingly hard to pronounce, means I `cracked` `ark` out of Positron and put it into VS `Code`.

**Ark owns computation and protocol. Krarkode owns UI and VS Code glue.**

See [docs/design.md](docs/design.md) for design rationale and [docs/architecture.md](docs/architecture.md) for the full system diagram.

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
- Quick-inspect: `nrow()`, `length()`, `head()`, `names()`, `View()`

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

### Doctor

- `Krarkode: Doctor` command checks R binary, Ark binary, sidecar, and connection health

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
| Doctor diagnostics | ✅ |
| Console mode — tmux driver | ✅ |
| Console mode — external terminal driver | ✅ |
| Debugger integration | ❌ may consider if DAP integration becomes available |

---

## Requirements

- **Ark** binary — build from [posit-dev/ark](https://github.com/posit-dev/ark) or extract from a [Positron](https://github.com/posit-dev/positron) release
- **R** 4.1+ with `jsonlite` (`install.packages("jsonlite")`)
- **tmux** — used for session management

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `krarkode.r.rBinaryPath` | `R` | R executable path |
| `krarkode.ark.path` | `ark` | Ark executable path |
| `krarkode.ark.console.driver` | `tmux` | Console driver: `tmux` or `external` |
| `krarkode.ark.console.commandTemplate` | — | Console launch command template |
| `krarkode.ark.kernel.commandTemplate` | — | Ark kernel launch command template |
| `krarkode.ark.kernel.startupFileTemplate` | — | Startup R script path template |
| `krarkode.ark.sidecar.path` | bundled | Sidecar binary path |
| `krarkode.ark.sidecar.timeoutMs` | `10000` | Sidecar startup timeout (ms) |
| `krarkode.ark.lsp.enabled` | `true` | Enable Ark LSP |
| `krarkode.ark.lsp.timeoutMs` | `15000` | LSP startup timeout (ms) |
| `krarkode.plot.viewColumn` | `Two` | Plot panel column (or `disable`) |
| `krarkode.plot.maxHistory` | `50` | Maximum cached plots |
| `krarkode.html.viewColumn` | `Two` | HTML viewer panel column |
| `krarkode.source.echo` | `false` | Echo sourced code to console |
| `krarkode.terminal.bracketedPaste` | `true` | Use bracketed paste for terminal sends |

Template variables available in command templates: `{arkPath}`, `{connectionFile}`, `{startupFile}`, `{sessionsDir}`, `{name}`

---

## Development

```bash
pnpm install
cargo build --release --manifest-path ark-sidecar/Cargo.toml

# Build
pnpm run build

# Watch (separate terminals)
pnpm run watch:extension
pnpm run watch:data-explorer

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
