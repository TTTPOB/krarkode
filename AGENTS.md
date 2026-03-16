each atomic change need to be commited.
each commit message should be semantic.
you can use gh cli tool to search code on github and i have gh cat extension installed to help you read code files.
each commit touched side car, should run `cargo check` in sidecar dir to ensure pass.
when implementing a feature the first time, add verbose logging to aid debugging.

positron repo: posit-dev/positron, locally available at repo_ref/positron
ark repo: posit-dev/ark, locally available at repo_ref/ark
vscode-R repo, where we have done some ark related work before this separate krarkode repo: tttpob/vscode-R, locally available at repo_ref/vscode-R

CRITICAL RULES

1. ALWAYS use relative paths starting with repo_ref/
   ✅ CORRECT:
   read filePath: "repo_ref/ark/crates/amalthea/src/socket/iopub.rs"
   grep path: "repo_ref/ark"
   bash command: "git -C repo_ref/ark log..."
   ❌ WRONG (will cause permission errors):
   read filePath: "/home/tpob/playground/vscode-R/repo_ref/ark/..."
   read filePath: "/home/tpob/playground/vscode-R/repo_ref/ark/..."
2. NEVER use cd command to navigate
   ❌ WRONG:
   bash command: "cd repo_ref/ark && git log..."
   bash command: "cd /home/tpob/playground/vscode-R/repo_ref/ark && ls"
   ✅ CORRECT:
   bash command: "git -C repo_ref/ark log..."
   bash command: "ls repo_ref/ark/"
   Why This Matters
   The repo_ref/ directory contains symlinks:

- repo_ref/ark → /home/tpob/playground/vscode-R/repo_ref/ark
- repo_ref/positron → /home/tpob/playground/vscode-R/repo_ref/positron
- repo_ref/vscode-R → /home/tpob/playground/vscode-R
  Using absolute paths or cd breaks symlink resolution and causes permission issues.
  Quick Reference
  | Action | Command Pattern |
  |--------|-----------------|
  | Read file | read filePath: "repo_ref/ark/..." |
  | Search code | grep path: "repo_ref/ark" pattern: "..." |
  | Git operations | git -C repo_ref/ark <command> |
  | List directory | ls repo_ref/ark/ |
  | Bash in directory | bash command: "..." workdir: "repo_ref/ark" |
  Remember: Always use repo_ref/<project>/ as the prefix. Never use absolute paths or cd.

## Architectural Notes (Critical)

### Ark Dynamic Plots & Comm Protocol

1. **Enabling Dynamic Plots**: Ark only enables dynamic plots (re-rendering on resize) if `positron.ui` comm is connected. The extension MUST send a `comm_open` message with `target_name: "positron.ui"` upon connection.
2. **RPC Messages**: For Ark to recognize a `comm_msg` as an RPC request (e.g., for `render` method), the payload **MUST** contain an `id` field. Without this, Ark treats it as a standard data message and ignores the request.
3. **Sidecar Responsibilities**: The sidecar acts as a bidirectional bridge. It must forward `comm_open` and `comm_msg` from stdin to the kernel shell socket.

### R Code Generation

- **Use the shared serializer helper**: When generating R scripts (e.g., `init-ark.R`) that embed JSON or complex strings, **ALWAYS** use the shared minimal serializer helper already defined for announce payloads, or pre-serialize in TS. NEVER write ad hoc JSON concatenation/escaping at the call site in R.

## pnpm Scripts Reference

All scripts are run via `pnpm run <script>`. Never use `npm run` or `yarn`.

### Code Generation
| Script | Description |
|--------|-------------|
| `generate:data-explorer-types` | Generate TypeScript types from data explorer JSON schema |
| `generate:sidecar-event-types` | Generate TypeScript types from sidecar event definitions |
| `generate:types` | Run both type generators above |

### Build
| Script | Description |
|--------|-------------|
| `clean` | Remove `dist/` directory (via rimraf) |
| `build:webview-static` | Copy static webview assets to dist |
| `build:extension` | Build the main extension via `vite build` (vite.config.ts) |
| `build:dataexplorer` | Build data explorer webview via `vite build --config vite.dataexplorer.config.ts` |
| `build:variables` | Build variables webview via `vite build --config vite.variables.config.ts` |
| `build:plotviewer` | Build plot viewer webview via `vite build --config vite.plotviewer.config.ts` |
| `build` | **Full build**: generate types → build static → build extension → build all webviews |
| `compile` | Alias for `build` |
| `compile:dev` | Alias for `build` |

### Watch (Development)
| Script | Description |
|--------|-------------|
| `watch:extension` | Watch-mode build for the main extension |
| `watch:data-explorer` | Watch-mode build for data explorer webview |
| `watch:variables` | Watch-mode build for variables webview |
| `watch:plotviewer` | Watch-mode build for plot viewer webview |

### Quality
| Script | Description |
|--------|-------------|
| `typecheck` | Run `tsc --noEmit` for type checking (no output emitted) |
| `lint` | Run ESLint on `src/**/*.{ts,svelte}` |
| `format` | Run Prettier on the entire project |

### Testing
| Script | Description |
|--------|-------------|
| `test:unit` | Run unit tests once via vitest (config: `vitest.config.mts`) |
| `test:unit:watch` | Run unit tests in watch mode |
| `test:unit:coverage` | Run unit tests with coverage report |
| `test:compile` | Compile integration tests via `tsc -p tsconfig.test.json` |
| `test` | **Full test pipeline**: unit tests → build → compile integration tests → run integration tests |

### Packaging & Publishing
| Script | Description |
|--------|-------------|
| `package` | Package the extension as a `.vsix` file (via `vsce package --no-dependencies`) |
| `vscode:prepublish` | Pre-publish hook (runs `compile`), triggered automatically by `vsce` |

### Common Workflows
- **Quick dev iteration**: Run `pnpm run watch:extension` + `pnpm run watch:data-explorer` in separate terminals
- **Before committing**: `pnpm run typecheck && pnpm run lint && pnpm run test:unit`
- **Full CI-like check**: `pnpm run test` (runs unit tests, full build, then integration tests)
- **Produce installable VSIX**: `pnpm run build && pnpm run package`

## Toolchain & Standards

- **Node**: Use `pnpm exec` or `pnpx` instead of `npx`.
- **TypeScript**: Keep webview sources as TypeScript (`src/html/**/*.ts`) and compile them via `tsconfig`. Do not write raw JS for complex webviews.

* Ark sidecar smoke test
    - 通过 pixi 的 R 4.4 环境运行：`pixi run -- node scripts/ark-sidecar-lsp-test.js`
