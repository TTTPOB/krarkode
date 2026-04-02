# Krarkode

面向 Ark 内核的 VS Code 扩展，在原生 VS Code 中复现接近 Positron 的 R 开发体验。

> **v0.1.0 发布，可以满足交互式日常使用。**

[English](README.md)

---

## 这是什么？

过去，在 VS Code 中使用 R 的首选是 [vscode-R 扩展](https://marketplace.visualstudio.com/items?itemName=REditorSupport.r)。它挺优秀的但我对它还是有点不满意：Plot 预览的后端格式支持、Language Server 的性能与正确性、Data Explorer体验等。此外，它的 LSP 服务器和 Plot 预览还需要单独安装 R 包才能使用。

[Ark](https://github.com/posit-dev/ark) 是 Posit 开发的全功能 R 内核，内置 LSP 服务器、Jupyter comm 协议支持与绘图设备。然而，在原生 VS Code 中直接使用 Ark 目前并不可行——它只能在 [Positron](https://github.com/posit-dev/positron)（Posit 基于 Electron 开发的 IDE）中工作。

这就是我写 Krarkode 的原因：将 Ark 的 R 内核体验带入 VS Code。这个项目带有强烈的个人偏好；大部分设计决策服务于我自己的工作流，而非通用场景。我是一名生物信息学研究者，主要用 R 做数据分析和可视化，而非包开发。我完全不使用 R Markdown。因此包开发和 R Markdown 相关功能目前不在范围内。

由于时间有限，我选择将多个现有工具拼合在一起（会话管理甚至直接用的 `tmux`），这些实现方式谈不上优雅，但反正能用。大部分代码借助了 `Claude Code` 和 `Codex` 生成。但我在设计层面投入了足够的人类智慧，对 AI 的参与并不感到羞愧。

名字有点难念，意思是：把 `ark` 从 Positron 中 `crack`（破解）出来，放进 VS `Code`。

系统架构详见 [docs/architecture.md](docs/architecture.md)，设计思路详见 [docs/design.md](docs/design.md)。

---

## 功能（v0.1.0）

### 会话管理

- 创建、附加、切换、停止、中断 Ark 会话
- 状态栏实时显示内核状态：`idle` / `busy` / `starting` / `reconnecting`
- 会话跨编辑器重启持久化（注册表 + 连接文件）

### 代码执行

- 运行选区或当前行（`Ctrl+Enter` / `Cmd+Enter`）
- Source 文件，可选回显（`Ctrl+Shift+S`）
- 从当前行运行到末尾 / 从开头运行到当前行
- 基于 Ark LSP `statementRange` 的智能多行表达式检测
- 快捷检查：`nrow()`、`length()`、`head()`、`t(head())`、`names()`、`View()`

### 语言服务器

- 完整 R 语言智能：补全、诊断、悬停提示、跳转定义
- 无活跃会话时自动启动后台 Ark 实例，保持 LSP 可用

### Plot 预览

- 捕获来自 base R、ggplot2 等的 `display_data` 并渲染
- 历史导航、缩放控制、适应窗口
- 保存到文件、在浏览器打开
- 面板尺寸变化时动态重渲染（通过 `positron.ui` comm）

### Help 面板

- VS Code 内置 R 帮助查看器，支持前进/后退/主页导航
- 面板内搜索
- `F1` 查找光标处函数的帮助文档
- `Ctrl+Shift+H` 打开

### 变量面板

- 通过 `positron.variables` comm 实时同步工作区变量
- 列表、环境等嵌套结构可展开

### Data Explorer

- `View()` 或变量面板触发的交互式数据框查看器
- 列排序、行过滤、列统计
- TanStack Virtual 虚拟滚动，支持大型数据框
- 列可见性切换

### HTML 查看器

- 显示 `show_html_file` 输出：htmlwidgets、R Markdown 等

### Pixi 环境支持

- 从工作区或指定路径的 `pixi.toml` 自动发现 R 二进制
- 创建会话时多候选 R 二进制选择器

### 日志系统

- 5 个独立输出通道：Runtime、UI、Ark Kernel、LSP、Sidecar
- 每个通道可独立配置日志级别（none / error / warn / info / debug / trace）

### 环境诊断

- `Krarkode: Doctor` 命令检查 R 二进制、Ark 二进制、sidecar、tmux 及 Pixi 环境状态

---

## 实现状态

| 功能                           | 状态                   |
| ---------------------------- | -------------------- |
| 会话管理（创建 / 附加 / 切换 / 停止）      | ✅                    |
| 代码执行（选区、行、文件、范围）             | ✅                    |
| 智能多行表达式检测                    | ✅                    |
| Ark LSP + 自动后台内核             | ✅                    |
| Plot 预览（历史、缩放、保存、动态重渲染）      | ✅                    |
| Help 面板（F1 查找、导航）            | ✅                    |
| 变量面板                         | ✅                    |
| Data Explorer（排序、过滤、统计、虚拟滚动） | ✅                    |
| HTML 查看器                     | ✅                    |
| Pixi 环境支持                    | ✅                    |
| 日志系统（5 通道独立配置）               | ✅                    |
| 环境诊断                         | ✅                    |
| Console 模式 — tmux 驱动         | ✅                    |
| 调试器集成                        | ❌ 将来如果有 DAP 集成的话可以考虑 |

---

## 前置要求

- **Ark** 二进制 — 从 [posit-dev/ark](https://github.com/posit-dev/ark) 编译，或从 [Positron](https://github.com/posit-dev/positron) 发布包中提取
- **R** 4.1+（Ark session 管理不需要额外安装 R 包）
- **tmux** — 用来做会话管理（仅 tmux 驱动模式需要）

---

## 配置项

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `krarkode.r.binaryPath` | `[]` | R 可执行文件路径，字符串或数组，留空自动检测 |
| `krarkode.pixi.manifestPath` | `""` | `pixi.toml` 路径，用于 R 环境发现 |
| `krarkode.ark.path` | `""` | Ark 可执行文件路径，留空使用内置或 PATH |
| `krarkode.ark.logLevel` | `inherit` | Ark 后端日志级别（inherit / error / warn / info / debug / trace） |
| `krarkode.ark.console.commandTemplate` | `{sidecarPath} console --connection-file {connectionFile}` | Console 启动命令模板 |
| `krarkode.ark.kernel.commandTemplate` | `{arkPath} --connection_file {connectionFile} --session-mode console --startup-file {startupFile}` | Ark 内核启动命令模板 |
| `krarkode.ark.kernel.startupFileTemplate` | `{sessionsDir}/{name}/init-ark.R` | 启动 R 脚本路径模板 |
| `krarkode.ark.sidecar.path` | `""` | Sidecar 二进制路径，留空使用内置 |
| `krarkode.ark.sidecar.timeoutMs` | `30000` | Sidecar 启动超时（毫秒） |
| `krarkode.ark.sidecar.ipAddress` | `127.0.0.1` | Sidecar / LSP 连接 IP 地址 |
| `krarkode.ark.lsp.enabled` | `true` | 是否启用 Ark LSP |
| `krarkode.ark.lsp.timeoutMs` | `15000` | LSP 启动超时（毫秒） |
| `krarkode.ark.tmux.path` | `tmux` | tmux 可执行文件路径 |
| `krarkode.ark.tmux.manageKernel` | `true` | 是否在 tmux 中自动启动 Ark 内核 |
| `krarkode.plot.viewColumn` | `Two` | Plot 面板位置（Active / Beside / One / Two / Three / Disable） |
| `krarkode.plot.maxHistory` | `50` | 最大 Plot 缓存数量 |
| `krarkode.html.viewColumn` | `Two` | HTML 查看器面板位置（Active / Beside / One / Two / Three） |
| `krarkode.source.encoding` | `UTF-8` | Source 文件编码 |
| `krarkode.source.echo` | `false` | Source 文件时是否回显代码 |
| `krarkode.terminal.bracketedPaste` | `true` | 终端发送是否使用 bracketed paste |
| `krarkode.terminal.sendDelay` | `8` | 逐行发送延迟（毫秒），仅在 bracketedPaste 禁用时生效 |
| `krarkode.logging.runtime` | `error` | Runtime 通道日志级别（会话生命周期、内核启动、代码执行） |
| `krarkode.logging.ui` | `error` | UI 通道日志级别（Plot、变量、Data Explorer、Help、HTML） |
| `krarkode.logging.arkKernel` | `none` | Kernel 通道日志级别（Ark 内核 stdout/stderr） |
| `krarkode.logging.lsp` | `error` | LSP 通道日志级别 |
| `krarkode.logging.sidecar` | `error` | Sidecar 通道日志级别 |

命令模板中可用的变量：`{sidecarPath}`、`{arkPath}`、`{connectionFile}`、`{startupFile}`、`{sessionsDir}`、`{name}`

路径类配置支持 `${workspaceFolder}`、`${userHome}` 等 VS Code 变量替换。

---

## 开发

```bash
pnpm install
cargo build --release --manifest-path ark-sidecar/Cargo.toml

# 构建
pnpm run build

# 质量检查
pnpm run typecheck && pnpm run lint && pnpm run test:unit

# 打包
pnpm run build && pnpm run package
```

Sidecar smoke test（需要 pixi + R 环境）：

```bash
pixi run -- node scripts/ark-sidecar-lsp-test.js
```

---

## 授权

MIT — 详见 [LICENSE](LICENSE)。

Ark 本体为 MIT License；Krarkode 仅使用 Ark 的公开协议接口与二进制，不包含任何 Positron 源码。

---

## 相关项目

- [posit-dev/ark](https://github.com/posit-dev/ark) — 本扩展所依赖的 Ark R 内核（注意，Ark 开发团队近期宣布了 [oak](https://github.com/posit-dev/ark/issues/1117)——一个将 LSP 服务器从 Ark 中独立出来的项目。oak 成熟后，本项目可能会随之演进。）
- [posit-dev/positron](https://github.com/posit-dev/positron) — Positron IDE，Ark 的主要消费方；本扩展 UX 的灵感来源
- [vscode-R](https://marketplace.visualstudio.com/items?itemName=REditorSupport.r) — 经典的 VS Code R 扩展
