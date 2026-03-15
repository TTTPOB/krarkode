# Krarkode

面向 Ark 内核的 VS Code 扩展，在原生 VS Code 中复现接近 Positron 的 R 开发体验。

> **v0.1.0 — 核心 R 交互工作流已功能完整，当前仅支持 console 模式。**

[English](README.md)

---

## 这是什么？

过去，在 VS Code 中使用 R 需要依赖 [vscode-R 扩展](https://marketplace.visualstudio.com/items?itemName=REditorSupport.r)。这是一个很优秀的扩展，但有一些我不太满意的地方：Plot 预览的后端格式支持、Language Server 的性能与正确性、数据浏览体验等。此外，vscode-R 的 LSP 服务器和 Plot 预览还需要单独安装 R 包才能使用。

[Ark](https://github.com/posit-dev/ark) 是 Posit 开发的全功能 R 内核，内置 LSP 服务器、Jupyter comm 协议支持与绘图设备。然而，在原生 VS Code 中直接使用 Ark 目前并不可行——它只能在 [Positron](https://github.com/posit-dev/positron)（Posit 基于 Electron 开发的 IDE）中工作。

这就是我构建 Krarkode 的原因：将 Ark 强大的 R 内核体验带入 VS Code。这个项目带有强烈的个人偏好；部分设计决策服务于我自己的工作流，而非通用场景。我（在一定程度上）是一名生物信息学研究者，主要用 R 做数据分析和可视化，而非包开发。我完全不使用 R Markdown，因此包开发和 R Markdown 相关功能目前不在范围内。我的关注点在于交互式工作流：代码执行、Plot 预览、数据浏览和语言智能补全。

由于时间有限，我选择将多个现有工具拼合在一起，而非从零优雅地构建一切。例如，代码执行直接使用官方 `jupyter console`（毕竟 Ark 本身就是一个 Jupyter 内核），会话管理则依赖 `tmux`。实现方式谈不上优雅，但能用。未来某个时间点，我可能会实现一个直接连接 Ark 的 R 终端，但目前基于 `tmux` 的会话管理加 `jupyter console` 已经够用了。这是我第一个稍具规模的项目——它有很多粗糙的地方，测试覆盖率也很低（我不擅长写测试），大部分代码借助了 `Claude Code` 和 `Codex` 生成。但我认为设计层面投入了足够的人类智识，对 AI 的参与并不感到羞愧。

名字有点难念，意思是：把 `ark` 从 Positron 中 `crack`（破解）出来，放进 VS `Code`。

Ark 开发团队近期宣布了 [oak](https://github.com/posit-dev/ark/issues/1117)——一个将 LSP 服务器从 Ark 中独立出来的项目。oak 成熟后，本项目可能会随之演进。

**Ark 负责计算与协议，Krarkode 负责 UI 与 VS Code 集成。**

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
- 快捷检查：`nrow()`、`length()`、`head()`、`names()`、`View()`

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

### 环境诊断
- `Krarkode: Doctor` 命令检查 R 二进制、Ark 二进制、sidecar 及连接状态

---

## 实现状态

| 功能 | 状态 |
|------|------|
| 会话管理（创建 / 附加 / 切换 / 停止） | ✅ |
| 代码执行（选区、行、文件、范围） | ✅ |
| 智能多行表达式检测 | ✅ |
| Ark LSP + 自动后台内核 | ✅ |
| Plot 预览（历史、缩放、保存、动态重渲染） | ✅ |
| Help 面板（F1 查找、导航） | ✅ |
| 变量面板 | ✅ |
| Data Explorer（排序、过滤、统计、虚拟滚动） | ✅ |
| HTML 查看器 | ✅ |
| 环境诊断 | ✅ |
| Console 模式 — tmux 驱动 | ✅ |
| Console 模式 — 外部终端驱动 | ✅ |
| Notebook / 后台会话模式 | ❌ 未实现 |
| 调试器集成 | ❌ 未实现 |

---

## 前置要求

- **Ark** 二进制 — 从 [posit-dev/ark](https://github.com/posit-dev/ark) 编译，或从 [Positron](https://github.com/posit-dev/positron) 发布包中提取
- **R** 4.1+ 且已安装 `jsonlite`（`install.packages("jsonlite")`）
- **tmux**（默认 console 驱动；可通过配置切换为外部终端）

---

## 配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `krarkode.r.rBinaryPath` | `R` | R 可执行文件路径 |
| `krarkode.ark.path` | `ark` | Ark 可执行文件路径 |
| `krarkode.ark.sessionMode` | `console` | 会话模式（v0.1.0 仅支持 `console`） |
| `krarkode.ark.console.driver` | `tmux` | Console 驱动：`tmux` 或 `external` |
| `krarkode.ark.console.commandTemplate` | — | Console 启动命令模板 |
| `krarkode.ark.kernel.commandTemplate` | — | Ark 内核启动命令模板 |
| `krarkode.ark.kernel.startupFileTemplate` | — | 启动 R 脚本路径模板 |
| `krarkode.ark.sidecar.path` | 内置 | Sidecar 二进制路径 |
| `krarkode.ark.sidecar.timeoutMs` | `10000` | Sidecar 启动超时（毫秒） |
| `krarkode.ark.lsp.enabled` | `true` | 是否启用 Ark LSP |
| `krarkode.ark.lsp.timeoutMs` | `15000` | LSP 启动超时（毫秒） |
| `krarkode.plot.viewColumn` | `Two` | Plot 面板位置（或 `disable`） |
| `krarkode.plot.maxHistory` | `50` | 最大 Plot 缓存数量 |
| `krarkode.html.viewColumn` | `Two` | HTML 查看器面板位置 |
| `krarkode.source.echo` | `false` | Source 文件时是否回显代码 |
| `krarkode.terminal.bracketedPaste` | `true` | 终端发送是否使用 bracketed paste |

命令模板中可用的变量：`{arkPath}`、`{connectionFile}`、`{sessionMode}`、`{startupFile}`、`{sessionsDir}`、`{name}`

---

## 开发

```bash
pnpm install
cargo build --release --manifest-path ark-sidecar/Cargo.toml

# 构建
pnpm run build

# 监听模式（分开终端运行）
pnpm run watch:extension
pnpm run watch:data-explorer

# 质量检查
pnpm run typecheck && pnpm run lint && pnpm run test:unit

# 打包
pnpm run build && pnpm run package
```

Sidecar 烟雾测试（需要 pixi + R 环境）：
```bash
pixi run -- node scripts/ark-sidecar-lsp-test.js
```

---

## 授权

MIT — 详见 [LICENSE](LICENSE)。

Ark 本体为 MIT License；Krarkode 仅使用 Ark 的公开协议接口与二进制，不包含任何 Positron 源码。

---

## 相关项目

- [posit-dev/ark](https://github.com/posit-dev/ark) — 本扩展所依赖的 Ark R 内核
- [posit-dev/positron](https://github.com/posit-dev/positron) — Positron IDE，Ark 的主要消费方；本扩展 UX 的灵感来源
- [vscode-R](https://marketplace.visualstudio.com/items?itemName=REditorSupport.r) — 经典的 VS Code R 扩展
