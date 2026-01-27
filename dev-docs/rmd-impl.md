# Krarkode 的 R 代码块（Code Cell）支持实现方案（参考 vscode-R）

本文目标：在 krarkode 中为 R 代码块提供"可执行代码块（chunk）"的编辑器体验，支持：

- `.Rmd/.rmd` 文件中的 fenced code block（```` ```{r}```` … ```` ``` ````）
- `.R` 文件中的 `# %%` 风格代码块分隔符（与 RStudio 兼容）
实现方式优先对齐 vscode-R（CodeLens + chunk 解析 + 终端执行），并与 krarkode 现有的 Ark session / CodeExecutor 复用。

## 1. 范围与非目标

### 范围（第一阶段 MVP）

- 在 `.Rmd/.rmd` 中识别 fenced code block：` ```{r ...}` … ` ``` `。
- 在 `.R` 文件中识别 `# %%` 风格的代码块分隔符（与 RStudio 兼容）。
- 在 R chunk 上显示 CodeLens：Run Chunk / Run Above / Run Below / Run All / Go Next / Go Prev / Select 等。
- 执行 chunk：将 chunk 内容发送到 krarkode 当前 Ark 会话对应的交互终端（复用现有 `krarkode.runCommand` 或 CodeExecutor 能力）。
- 基础编辑器增强：
    - chunk 折叠（FoldingRangeProvider）。
    - knitr chunk option 自动补全（CompletionItemProvider）。
    - chunk 背景高亮 / 当前 chunk 边框提示（Decoration）。

### 非目标（先不做，作为后续）

- 完整 R Markdown “Knit/Render” 工作流（`rmarkdown::render()`）、多格式输出、模板创建。
- Notebook API（原生 `.ipynb` 风格 cell 输出）。
- 把 chunk 输出捕获并回填到编辑器（这需要更强的执行通道与输出解析）。

## 2. 为什么选 vscode-R 的方式（而不是 VS Code 原生 Notebook API）

VS Code 确实提供 Notebook API（serializer/controller/renderer），但它适合“文件本身就是 notebook（cells 是一等公民）”的格式；而 R Markdown 是“文本文件里嵌入代码块”。

vscode-R 采用的方式是：

- 把 `.Rmd` 当普通文本编辑器文档。
- 自己解析 chunk range。
- 用 CodeLens + 命令实现“像 cell 一样的交互”。

这条路径实现成本低、侵入小、且可与 krarkode 现有的“把代码发送到 Ark console 的终端”模型自然契合。

## 3. 依赖与前置假设

### 3.1 语言 ID（关键点）

krarkode 会在 `package.json` 的 `contributes.languages` 中声明 `rmd` 语言 ID，并关联 `.rmd` / `.Rmd` 文件扩展名。

建议声明方式（参考 vscode-R）：

```json
{
    "languages": [
        {
            "id": "rmd",
            "extensions": [".rmd", ".Rmd"],
            "aliases": ["R Markdown"],
            "configuration": "./language-configuration/rmd.json"
        }
    ],
    "grammars": [
        {
            "language": "rmd",
            "scopeName": "text.html.rmarkdown",
            "path": "./syntaxes/rmarkdown.tmLanguage.json",
            "embeddedLanguages": {
                "meta.embedded.block.r": "r"
            }
        }
    ]
}
```

语法高亮方面：

- 直接复用 VS Code 内置的 Markdown grammar（`markdown-basics` 扩展提供）即可，无需自建。
- 通过 `embeddedLanguages` 配置，让 fenced code block 内的 R 代码获得 R 语法高亮。
- 如果没有自定义 grammar 需求，甚至可以不声明 `grammars`，只声明 `languages`，让编辑器退化为 plain text 高亮也可以接受（但 R 代码块高亮会丢失）。

krarkode 的执行逻辑只需要 `languageId === 'rmd'` 来判断文件类型。

### 3.2 执行通道

krarkode 当前的执行模型在 `src/ark/codeExecutor.ts`：将文本发送到活动终端（jupyter console）来执行。

因此本方案的 chunk 执行应复用：

- 直接调用命令 `vscode.commands.executeCommand('krarkode.runCommand', code)`；或
- 抽出一个可复用的 `runText(code: string)` API（如果你准备改代码结构）。

## 4. vscode-R 的参考实现（关键文件）

vscode-R 的 Rmd chunk 支持主要由这些文件构成：

- `repo_ref/vscode-R/src/rmarkdown/chunks.ts`
    - 扫描文档，计算每个 chunk 的 `chunkRange` / `codeRange`。
    - 实现 runCurrentChunk / runAllChunks / goToNextChunk 等逻辑。
- `repo_ref/vscode-R/src/rmarkdown/index.ts`
    - CodeLensProvider：生成 CodeLens、做 decoration 高亮。
    - CompletionItemProvider：knitr chunk options 自动补全。
    - FoldingRangeProvider：折叠 chunk。
- `repo_ref/vscode-R/src/rTerminal.ts`
    - `runChunksInTerm()`：把多个 range 的文本拼接后发送到终端。

krarkode 可以 1:1 复用这些结构，只需要把“runChunksInTerm”替换成 krarkode 的执行通道。

## 5. krarkode 中的模块设计（建议）

建议新增目录：`src/rmarkdown/`

```
src/rmarkdown/
  chunks.ts            # 解析与 chunk 操作（核心算法）
  providers.ts         # CodeLens / Completion / Folding providers
  commands.ts          # 注册命令（run chunk / nav / select）
  index.ts             # 统一的 register(context) 入口
```

并在 `src/extension.ts` 的 `activate()` 中调用：

```ts
import { registerRMarkdown } from './rmarkdown';

export function activate(context: vscode.ExtensionContext) {
    // ... existing init
    registerRMarkdown(context);
}
```

## 6. Chunk 解析算法（与 vscode-R 对齐）

### 6.1 识别 chunk 边界

vscode-R 同时支持两种 chunk 标记风格：

**风格 1：R Markdown（.Rmd）**

- chunk start：`^\s*```+\s*\{\w+\s*.*$`
    - 典型：`{r, echo=FALSE}`
- chunk end：`^\s*```+\s*$`

**风格 2：R 脚本（.R）中的 `# %%` 标记**

- chunk start：`^#+\s*%%.*$`（如 `# %%`、`## %% section`）
- chunk end：遇到下一个 `# %%`、章节标题行（`^#+\s*.*[-#+=*]{4,}`）、或文件末尾

提取信息：

- language：
    - `.Rmd`：从 `{r, ...}` 的 `r` 得到（转小写）。
    - `.R`：固定为 `'r'`。
- options：
    - `.Rmd`：从 `{r, <options>}` 中提取 `<options>` 字符串。
    - `.R`：从 `# %%` 后的内容提取。
- eval：简单解析 `eval = FALSE/F`，决定 runAll/runAbove 时是否跳过。

vscode-R 的实现参考：`repo_ref/vscode-R/src/rmarkdown/chunks.ts`：

- `isRChunkLine()` / `isChunkStartLine()` / `isChunkEndLine()`
- `getChunkLanguage()` / `getChunkOptions()` / `getChunkEval()`
- `getChunks()` 扫描所有行并生成 `RMarkdownChunk[]`

### 6.2 codeRange vs chunkRange

保持与 vscode-R 相同的语义：

- **`.Rmd`**：
    - `chunkRange`：从 chunk start fence 行到 chunk end fence 行（包含 fence）。
    - `codeRange`：只包含内部代码行（不含 fence）。

- **`.R`（# %% 风格）**：
    - `chunkRange`：从 `# %%` 行到下一个 `# %%`/章节标题/文件末尾（包含起始行）。
    - `codeRange`：从 `# %%` 下一行到结束标记上一行（不含 `# %%` 行本身）。

这样 CodeLens 可以挂在 `chunkRange` 上，但执行时使用 `codeRange`。

### 6.3 仅对 R chunk 生效

与 vscode-R 一致：

- `.Rmd`：只对 `language === 'r'` 的 chunk 出 CodeLens（其它语言如 `python`/`bash` 不管）。
- `.R`：`# %%` 标记的代码块固定为 R，天然有效。

后续要扩展到多语言 chunk，可以在执行前检查当前 Ark kernel 能否理解该语言。

## 7. 命令与执行策略（建议与 krarkode 对齐）

### 7.1 新增命令（建议命名空间）

建议使用 `krarkode.rmarkdown.*` 前缀，避免与 `krarkode.runSelection` 混淆：

- `krarkode.rmarkdown.runCurrentChunk`
- `krarkode.rmarkdown.runAboveChunks`
- `krarkode.rmarkdown.runBelowChunks`
- `krarkode.rmarkdown.runCurrentAndBelowChunks`
- `krarkode.rmarkdown.runAllChunks`
- `krarkode.rmarkdown.goToPreviousChunk`
- `krarkode.rmarkdown.goToNextChunk`
- `krarkode.rmarkdown.selectCurrentChunk`

这些命令的内部逻辑可以直接搬运 vscode-R 的函数（同名函数在 `chunks.ts` 里都有），唯一差异是执行时调用 krarkode 的执行通道。

### 7.2 执行通道：复用 krarkode.runCommand

与 vscode-R 的 `runChunksInTerm()` 对齐，建议封装：

```ts
async function runRangesInArk(ranges: vscode.Range[]): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const text = ranges
        .map((r) => editor.document.getText(r).trim())
        .filter((t) => t.length > 0)
        .join('\n');
    if (!text) return;

    await vscode.commands.executeCommand('krarkode.runCommand', text);
}
```

优点：

- 不需要让 rmarkdown 模块直接依赖 `CodeExecutor` 实例。
- 复用现有 session 选择逻辑（`CodeExecutor.pickSessionForExecution()`）。

## 8. Providers（CodeLens / Folding / Completion / Decoration）

### 8.1 CodeLensProvider

参考 `repo_ref/vscode-R/src/rmarkdown/index.ts` 的 `RMarkdownCodeLensProvider`：

- `provideCodeLenses()`：
    - `getChunks(document)`
    - `getCodeLenses(chunks, token)`
    - 同时做 decoration（chunk background / active cell border）
- 监听 `onDidChangeTextEditorSelection`，用于更新"当前 chunk 边框"高亮。

在 krarkode 里建议 decoration 策略与 vscode-R 一致：

- `.Rmd`：高亮所有 chunk（背景色）。
- `.R`（# %% 风格）：高亮当前 chunk（上下边框），因为 # %% 同时用作 section 标记，不需要每个都高亮。

### 8.2 FoldingRangeProvider

与 vscode-R 的 `RChunkFoldingProvider` 一样：

- 每个 chunk 生成 `FoldingRange(startLine, endLine, Region)`。

### 8.3 CompletionItemProvider（knitr chunk options）

与 vscode-R 的 `RMarkdownCompletionItemProvider` 一样：

- 维护一份静态 `chunkOptions` 列表（来自 `names(knitr::opts_chunk$merge(NULL))`）。
- 仅当光标位于 chunk 头或 `#|` option comment 行时提供补全：
    - 参考 `repo_ref/vscode-R/src/rmarkdown/chunks.ts`：`shouldDisplayChunkOptions()`

### 8.4 chunk 背景色与当前 cell 边框

vscode-R 做法：

- `chunkBackgroundColor`：用 `TextEditorDecorationType({ isWholeLine: true, backgroundColor })`。
- “当前 cell 边框”：使用 `interactive.activeCodeBorder` 主题色，设置 top/bottom border。

krarkode 可以沿用同样的 ThemeColor，这样能跟 VS Code 内置的交互式体验风格一致。

## 9. 配置项（建议）

建议在 `package.json` 增加配置（对齐 vscode-R 的含义，但放在 krarkode 命名空间下）：

- `krarkode.rmarkdown.enableCodeLens`（boolean，默认 true）
- `krarkode.rmarkdown.codeLensCommands`（string[]，默认按常用顺序）
- `krarkode.rmarkdown.chunkBackgroundColor`（string | null，默认使用一个较淡的主题兼容色）

实现时读取方式对齐 krarkode 现有 `util.config()`：

- `util.config().get<boolean>('krarkode.rmarkdown.enableCodeLens')`

备注：vscode-R 是 `config().get('rmarkdown.*')`，krarkode 需要带上 `krarkode.` 前缀。

## 10. 激活与注册（在 krarkode 里怎么接）

### 10.1 activate() 中注册 providers

krarkode 的 chunk 支持同时作用于 `rmd` 和 `r` 两种语言（后者处理 # %% 标记）：

```ts
const rmdSelector: vscode.DocumentSelector = [{ language: 'rmd' }];
const rSelector: vscode.DocumentSelector = [{ language: 'r' }];

context.subscriptions.push(
    // Rmd 文件：CodeLens + Completion + Folding
    vscode.languages.registerCodeLensProvider(rmdSelector, new KrarkodeRMarkdownCodeLensProvider()),
    vscode.languages.registerCompletionItemProvider(
        'rmd',
        new KrarkodeRMarkdownCompletionItemProvider(),
        ' ',
        ',',
        '=',
    ),
    vscode.languages.registerFoldingRangeProvider(rmdSelector, new KrarkodeRChunkFoldingProvider()),

    // R 文件：# %% 代码块支持
    vscode.languages.registerCodeLensProvider(rSelector, new KrarkodeRMarkdownCodeLensProvider()),
    vscode.languages.registerFoldingRangeProvider(rSelector, new KrarkodeRChunkFoldingProvider()),
);
```

`KrarkodeRMarkdownCodeLensProvider` 内部会根据 `document.languageId` 决定 decoration 策略（`.Rmd` 高亮所有 vs `.R` 高亮当前）。

若你不想依赖 `languageId === 'rmd'`（因为语法高亮/语言来源不稳定），也可以：

- 仅对 `markdown` 注册 provider
- 在 provider 内部检查 `document.uri.fsPath.endsWith('.Rmd') || endsWith('.rmd')` 决定是否启用
- 并把 keybinding/when 从 `editorLangId == rmd` 改成 `resourceExtname == '.Rmd' || resourceExtname == '.rmd'`

### 10.2 注册命令

命令注册建议放在 `src/rmarkdown/commands.ts` 里，统一 `registerRMarkdownCommands(context)`。

## 11. 日志与可观测性（首次实现建议做“偏啰嗦”的 debug）

建议在以下位置打 debug 日志（对齐本仓库“首次实现要 verbose logging”习惯）：

- 每次 `getChunks(document)`：记录文档路径、chunk 数量、R chunk 数量。
- run\* 命令：记录当前行、目标 chunk id、最终发送代码的字符数/行数。
- `eval=FALSE` 被跳过时：记录被跳过的 chunk id。

建议使用现有 logger：`src/logging/logger.ts`（例如 `getLogger().createChannel('ark', ...)`），避免 `console.log`。

## 12. 测试建议（最小单测就够用）

建议对 chunk 解析写单测（不需要启动 VS Code 实例）：

- 输入一段 Rmd 文本（多 chunk、含 `eval=FALSE`、含非 r chunk）。
- 断言：
    - chunk 数量、每个 chunk 的 start/end 行、codeRange 的边界。
    - language/options/eval 的解析。

这类测试可以放在 `src/test/suite/`，仅依赖纯函数（把解析逻辑从 vscode API 最小化）。

## 13. 后续扩展（如果要做到“完整 Rmd 支持”）

### 13.1 Knit/Render

参考 vscode-R：

- `repo_ref/vscode-R/src/rmarkdown/knit.ts` + `repo_ref/vscode-R/R/rmarkdown/knit.R`

krarkode 可选实现路径：

1. 简版：直接向 Ark 会话发送 `rmarkdown::render(<path>)`，并在渲染后用 `vscode.env.openExternal()` 打开产物。
2. 完整版：做一个 webview preview（参考 `repo_ref/vscode-R/src/rmarkdown/preview.ts`），支持自动刷新、缩放、主题。

### 13.2 Quarto

如果后续要支持 `.qmd`，可以复用同一套 chunk 解析（Quarto 的 chunk 头也兼容 fenced block），但 option 风格可能更多样（含 `#|`）。

---

## 14. 实施清单（按提交粒度拆分的建议）

1. 纯解析：新增 `src/rmarkdown/chunks.ts` + 单测。
2. 命令：新增 `src/rmarkdown/commands.ts`，实现 run/go/select。
3. Providers：新增 `src/rmarkdown/providers.ts`，挂 CodeLens/Folding/Completion/Decoration。
4. wiring：在 `src/extension.ts` 中注册 `registerRMarkdown(context)`。
5. 配置/when：补全 `package.json` 的 commands、configuration、keybindings。

每一步都可以独立验证：

- 先在 `.Rmd` 打开文件，看是否出现 CodeLens。
- 点击 Run Chunk，看终端是否收到正确代码。
