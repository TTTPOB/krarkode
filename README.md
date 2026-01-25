# Krarkode

Krarkode 是面向 Ark 内核的 VS Code 扩展，目标是在 VS Code 内提供接近 Positron 的 Ark 使用体验。

## 设计初衷

- Ark 已经具备独立的 Jupyter/comm 能力，因此需要一个专注 Ark 的 VS Code 扩展，而不是继续维护多后端兼容层。
- 用更轻量的方式复用 Ark 侧的协议与工作流，把 Plot、Help、Data Explorer 等体验带回 VS Code。
- 保持开发链路清晰：Ark 负责计算与协议，扩展负责 UI 与 VS Code 交互。

## 主要功能

- Ark 会话管理：创建/附加/切换/停止 Ark 会话，状态栏实时显示内核运行状态。
- R 代码执行：运行选区、行、文件；支持常用快捷命令（nrow/length/head 等）。
- Ark LSP：基于 Ark 的 LSP 通道提供 R 语言服务。
- Plot/HTML 预览：接收 display_data、ShowHtmlFile 并在 Plot 或 Viewer 中展示，支持保存与浏览器打开。
- Help 面板：在 VS Code 内浏览 Ark 帮助文档。
- 变量与 Data Explorer：变量列表与数据探查 Webview。

## 使用前提

- 需要可执行的 `ark` 与本地 R 环境。
- Console 模式默认使用 `tmux`，如需外部终端可通过设置切换。

## 重要设置

| 设置项 | 说明 |
| --- | --- |
| `krarkode.r.rBinaryPath` | 指定 R 可执行文件路径（无法自动发现时必需）。 |
| `krarkode.ark.path` | Ark 可执行文件路径（默认 `ark`）。 |
| `krarkode.ark.sessionMode` | Ark 会话模式（当前仅支持 `console`）。 |
| `krarkode.ark.console.driver` | Ark console 驱动（`tmux` 或 `external`）。 |
| `krarkode.ark.console.commandTemplate` | Console 启动命令模板。 |
| `krarkode.ark.kernel.commandTemplate` | Ark kernel 启动命令模板。 |
| `krarkode.ark.kernel.startupFileTemplate` | Ark kernel 启动脚本路径模板。 |
| `krarkode.ark.sidecarTimeoutMs` | Ark sidecar 超时时间（毫秒）。 |
| `krarkode.ark.lsp.enabled` | 是否启用 Ark LSP。 |
| `krarkode.ark.lspTimeoutMs` | LSP sidecar 启动超时（毫秒）。 |
| `krarkode.plot.viewColumn` | Plot 面板位置或禁用绘图。 |
| `krarkode.plot.maxHistory` | Plot 历史缓存数量。 |
| `krarkode.html.viewColumn` | HTML Viewer 面板位置。 |

## 授权说明

- 本仓库代码采用 MIT License。
- Ark 本体为 MIT License；Krarkode 仅使用其协议与二进制，不包含 Positron 源码。
