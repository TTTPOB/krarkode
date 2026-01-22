# 新建 Ark 专用 VSCode 插件方案（基于 vscode-r 与 Positron 的复用）

> 本文面向 **“不再维护双后端兼容层”** 的新方向：在 VSCode 中打造 **Ark 专用插件**，让 Ark 在 VSCode 里有“Positron 级”的使用体验。
> 参考基线：`dev-docs/vscode-ark.md`（此前是“把 Ark 接到 vscode-r”）。

---

需要补充说明的是，当前vscode-r中的ark部分也属于草稿状态 也有很多功能未完成或者未测试，很可能存在错误，移植时需要鉴别。

## 1. 背景与目标

### 背景
- 维护 **vscode-r（原生 R 语言服务器）** 与 **Ark（Jupyter/comm）** 的兼容层成本过高。
- Ark 的 Console 模式/comm 生态与传统 R LSP/terminal 模式存在根本差异。

### 目标
- 新建 **Ark 专用 VSCode 插件**，不再承担“原生 R LSP + Ark”的双后端兼容。
- 通过“**复用 vscode-r 可运行代码 + 复用 Positron 前端/协议**”，实现：
  - LSP（`positron.lsp`）
  - Plots（`positron.plot`）
  - HTML / Viewer（`ShowHtmlFile`）
  - Data Explorer（`positron.dataExplorer`）
  - 稳定的 Ark Console 模式交互体验
- 最小化重复造轮子：优先 **“抽取/搬运已验证组件”**。

---

## 2. 与原计划的关系

`dev-docs/vscode-ark.md` 的思路是：**在 vscode-r 里新增 Ark backend**。

本方案改为：**新建“Ark 专用插件”**，核心变化：
- **不再维护终端 + languageserver 的旧路径**。
- 以 Ark + Jupyter/comm 为唯一核心协议。
- 功能来自“vscode-r 的 Ark 部分 + Positron 的 UI/协议实现”。

---

## 3. 架构草图（新插件）

```
┌──────────────────────────────────────────────────────────┐
│ VSCode: Ark 插件                                         │
│  - 会话管理 (attach/create)                              │
│  - LSP client (positron.lsp)                             │
│  - Plots / Viewer / Data Explorer (Positron UI 复用)     │
│  - Ark sidecar (Jupyter client/comm, Rust)               │
└──────────────────────────────────────────────────────────┘
                 │                    ▲
                 │ Jupyter ZMQ/comm   │
                 ▼                    │
┌──────────────────────────────────────────────────────────┐
│ Ark kernel (Console mode 推荐)                           │
└──────────────────────────────────────────────────────────┘
                 ▲
                 │ (optional)
                 ▼
┌──────────────────────────────────────────────────────────┐
│ jupyter console / tmux (可选 REPL 前端)                   │
└──────────────────────────────────────────────────────────┘
```

核心原则：
- **Ark Console 模式是默认集成路径**（与 Positron 一致）。
- VSCode 插件作为 **第二前端** 连接同一 kernel。
- Jupyter/ZMQ/comm 细节交给 **Rust sidecar**。

---

## 4. 复用清单（vscode-r 侧）

以下内容可直接作为“新插件的骨架/实现起点”：

### 4.1 Ark 会话与命令流程
- `src/backends/ark.ts`：
  - 创建/附加 Ark session
  - 生成 connection file / startup file
  - tmux driver 支持
  - 运行 selection / source / command 的执行流

### 4.2 会话注册表
- `src/ark/sessionRegistry.ts`：
  - session registry 持久化逻辑
  - active session 管理

### 4.3 Rust sidecar（Jupyter/comm）
- `ark-sidecar/src/main.rs`：
  - `positron.lsp` 通道
  - execute 请求
  - plot watcher
  - sidecar check

### 4.4 Plot 侧处理（基础版）
- `src/ark/sidecarManager.ts`
- `src/plotViewer/backends/arkComm.ts`

> 这些代码是“可运行/可测试”的现成实现，适合直接拷贝到新插件并进行清理。

---

## 5. 复用清单（Positron 侧）

这些是 **“体验差距最大、最值得借用的部分”**。建议根据许可策略做“模块级搬运”。

### 5.1 Comm / UI 协议定义
- `repo_ref/positron/src/vs/workbench/api/common/positron/extHostTypes.positron.ts`
  - `RuntimeClientType`（`positron.lsp` / `positron.plot` / `positron.dataExplorer`）
- `repo_ref/positron/src/vs/workbench/services/languageRuntime/common/positronUiComm.ts`
  - `ShowHtmlFile`、`ShowHtmlFileDestination`、`UiFrontendEvent` 等 UI comm 事件

### 5.2 HTML/Viewer
- `repo_ref/positron/src/vs/workbench/contrib/positronPreview/browser/positronPreviewServiceImpl.ts`
- `repo_ref/positron/src/vs/workbench/contrib/positronPreview/browser/previewHtml.ts`

### 5.3 Plots
- `repo_ref/positron/src/vs/workbench/contrib/positronPlots/browser/positronPlotsService.ts`

### 5.4 Data Explorer
- `repo_ref/positron/src/vs/workbench/services/positronDataExplorer/browser/positronDataExplorerService.ts`
- `repo_ref/positron/src/vs/workbench/services/positronDataExplorer/browser/positronDataExplorerInstance.ts`
- `repo_ref/positron/src/vs/workbench/contrib/positronDataExplorerEditor/browser/*`

> Positron 的 UI 代码规模大，但功能完整。建议先抽取“最小可用层”（渲染 + comm 交互），再渐进引入功能。

---

## 6. 新插件的最小可用范围（MVP）

1) **会话管理**：create / attach / stop（支持 connection file 复用）
2) **LSP**：`positron.lsp` → `vscode-languageclient`
3) **Plot/Viewer 基础**：
   - `positron.plot` comm
   - `ShowHtmlFile`（Viewer/Plot 目的地）
4) **Data Explorer v1**：只实现基础网格渲染 + `GetState/GetSchema/GetDataValues`

---

## 7. Phase 计划（从“能跑”到“体验好”）

### Phase 0：插件骨架
- 新仓库/新扩展 ID
- 移植 `ark-sidecar` + 会话管理
- 最小 command/config 体系（`ark.createSession`, `ark.attachSession`, `ark.stopSession`）

### Phase 1：LSP
- 复用 sidecar 的 `positron.lsp` 逻辑
- `vscode-languageclient` 连接
- 最小诊断、补全、hover 验证

### Phase 2：Plots & Viewer
- 对齐 `positron.plot` comm
- `ShowHtmlFile`（Viewer/Plot）落地

### Phase 3：Data Explorer
- 从 Positron 搬运最小 UI + comm 代理
- 支持排序/过滤（可延后）

### Phase 4：体验优化
- 会话列表 UI
- 错误可视化/重连
- 性能调优（大表、复杂 plot）

---

## 8. 配置建议（新插件命名空间）

建议统一以 `ark.*` 为前缀：
- `ark.path`（默认 `ark`）
- `ark.sessionMode`（默认 `console`）
- `ark.sessionsDir`（默认 extension globalStorage）
- `ark.console.driver`（`tmux | external`）
- `ark.console.commandTemplate`
- `ark.kernel.commandTemplate`
- `ark.kernel.startupFileTemplate`
- `ark.tmux.path`
- `ark.tmux.manageKernel`

> 这些配置可直接借用 `src/backends/ark.ts` 的实现逻辑。

---

## 9. Console 模式的关键差异（必须适配）

对齐 `dev-docs/ark-session-types.md` 的结论：
- `ShowHtmlFile` 不走 `display_data`，必须单独处理
- 中途 autoprint 会产生多条输出
- 动态 plot 依赖 `positron.plot` comm
- **不要发送不完整输入**（Ark 会直接拒绝）

---

## 10. 测试与验证建议

- Ark sidecar smoke test（已有）：
  - `pixi run -- node scripts/ark-sidecar-lsp-test.js`
- 最小 LSP 验证：
  - `positron.lsp` comm → LSP 端口 → `vscode-languageclient` 启动
- 最小 Plot/Viewer 验证：
  - `ShowHtmlFile` 与 `positron.plot` 通道

---

## 11. 风险与边界

- **许可策略**：Positron 代码搬运需确认许可与可复用范围。
- **UI 复杂度**：Data Explorer/Plots UI 迁移成本高，建议先 MVP。
- **Console 体验**：是否内置 REPL 取决于资源；短期可继续依赖 `jupyter console + tmux`。

---

## 12. 下一步（建议执行顺序）

1) 新建扩展 repo 与最小命令/配置骨架
2) 迁移 `ark-sidecar` + 会话管理
3) LSP 先落地
4) Plot/Viewer
5) Data Explorer

---

## 13. 结论

将 Ark 从 vscode-r 中**解耦为专用插件**，是目前成本/体验最优的路径。
通过复用 **vscode-r 已验证的 Ark 管线** 与 **Positron 的 UI/协议能力**，可以在 VSCode 中实现高质量的 Ark 体验，同时避免继续维护双后端兼容层。
