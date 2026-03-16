# Design Choices

## Guiding Principle

Ark already does the hard work: kernel execution, LSP, plot device, comm protocol. Krarkode's job is to surface that work inside VS Code—nothing more. Every design decision flows from this constraint.

---

## 1. Rust Sidecar Instead of TypeScript ZeroMQ Bindings

**The problem**: Jupyter's wire protocol runs over ZeroMQ. TypeScript ZeroMQ bindings (`zeromq.js`) exist but are native addons that complicate packaging, platform support, and VS Code's extension sandbox.

**The choice**: A small Rust binary (`ark-sidecar`) owns all socket work. The extension spawns it as a child process and exchanges newline-delimited JSON over stdin/stdout.

**Trade-offs**:
- ✅ Zero native addon complexity in the extension bundle
- ✅ Rust's async runtime (tokio) handles ZeroMQ I/O efficiently
- ✅ Sidecar can be independently tested and smoke-tested (`ark-sidecar-lsp-test.js`)
- ✅ Clean process isolation: sidecar crash doesn't take down the extension
- ⚠️ Binary must be distributed/built separately from the extension JS bundle
- ⚠️ Adds a Rust toolchain requirement for contributors

---

## 2. Comm Protocol Over Custom IPC

**The problem**: Ark exposes its UI surface (variables, help, data explorer, plots) through Jupyter's comm protocol. We need to reach those surfaces from the extension.

**The choice**: Use comm natively rather than inventing a parallel channel. The sidecar opens comms on behalf of the extension and proxies messages.

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
- ✅ Clean, minimal codebase—no backend detection or capability negotiation
- ✅ Can exploit Ark-specific protocol details (e.g., `statementRange` LSP method)
- ❌ Does not work with IRkernel or other R kernels

---

## 4. Template-Based Session Configuration

**The problem**: Users have wildly different setups—Ark installed via Positron, built from source, managed by pixi, or wrapped in a container. Console mode might use tmux, an external terminal, or a custom launcher.

**The choice**: All launch commands are Go-style templates with named substitution variables:

```
{arkPath} {connectionFile} {startupFile} {sessionsDir} {name}
```

Users override the default templates in settings to match their environment.

**Why not auto-discovery?**
Auto-discovery works for simple cases but breaks in non-standard setups (pixi environments, NixOS, Docker, remote SSH). Templates make the failure mode explicit and user-controlled.

---

## 5. Generated Startup Script (`init-ark.R`)

Each session generates a per-session R startup script rather than embedding R code as escaped strings in TypeScript.

**The constraint**: The startup script often contains JSON payloads. Manual string escaping in R is error-prone and breaks on nested quotes or special characters.

**The choice**: Use a shared minimal serializer helper inside the generated R code for the announce payload—or pre-serialize in TypeScript and embed the result—instead of writing ad hoc JSON concatenation at each call site.

This is a hard rule: **never construct JSON payloads ad hoc in R startup scripts. Use the shared serializer helper or pre-serialize in TypeScript.**

---

## 6. Svelte 5 for Data Explorer Only

The data explorer has significant interactive complexity: virtual scrolling, column sorting, row filtering, column statistics, selection state, export. This justified using a reactive framework.

All other webviews (variables, plot viewer, help) are vanilla TypeScript. Their state is simple enough that a framework would add build complexity without benefit.

Svelte 5 was chosen over React or Vue because:
- Smaller output bundle (matters for webview load time)
- Compile-time reactivity—no virtual DOM overhead for table re-renders
- Runes API makes state flow explicit at large component count

---

## 7. Background LSP Kernel

The Ark LSP runs inside the kernel process. If there is no active session, code completion would be unavailable.

**The choice**: `ArkLanguageService` automatically spawns a background Ark instance solely for LSP when no session is active. When a real session starts, the LSP client switches to use that session's kernel.

This means the editor stays fully featured (completions, diagnostics, hover) even when no interactive session is running.
