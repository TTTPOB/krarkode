each atomic change need to be commited.
each commit message should be semantic.
before you do any task, check bd status to see if it has been created as an issue, if not, create it.
after you've done a task, update the bd issue with what you've done.
you can use gh cli tool to search code on github and i have gh cat extension installed to help you read code files.
each commit touched side car, should run `cargo check` in sidecar dir to ensure pass.

positron repo: posit-dev/positron, locally available at ${workspaceroot}/repo_ref/positron
ark repo: posit-dev/ark, locally available at ${workspaceroot}/repo_ref/ark

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
