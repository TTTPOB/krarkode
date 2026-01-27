each atomic change need to be commited.
each commit message should be semantic.
before you do any task, check bd status to see if it has been created as an issue, if not, create it.
after you've done a task, update the bd issue with what you've done.
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
*   **Use `jsonlite`**: When generating R scripts (e.g., `init-ark.R`) that embed JSON or complex strings, **ALWAYS** use `jsonlite::toJSON()` inside the R code or pre-serialize in TS. NEVER use manual string concatenation/escaping for JSON payloads in R, as it is prone to escaping errors.

## Toolchain & Standards
*   **Node**: Use `pnpm exec` or `pnpx` instead of `npx`.
*   **TypeScript**: Keep webview sources as TypeScript (`src/html/**/*.ts`) and compile them via `tsconfig`. Do not write raw JS for complex webviews.

- Ark sidecar smoke test
  - 通过 pixi 的 R 4.4 环境运行：`pixi run -- node scripts/ark-sidecar-lsp-test.js`

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues (beads, atomic issue) for anything that needs follow-up (meaning simple qa do not need issues)
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
