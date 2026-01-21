import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import * as util from '../util';
import * as sessionRegistry from './sessionRegistry';
import type { ArkConsoleDriver, ArkSessionEntry } from './sessionRegistry';

type ArkSessionMode = 'console' | 'notebook' | 'background';

interface ArkAnnouncePayload {
    sessionName?: string;
    connectionFilePath?: string;
    pid?: number;
    startedAt?: string;
}

const DEFAULT_SIGNATURE_SCHEME = 'hmac-sha256';
const DEFAULT_SESSION_MODE: ArkSessionMode = 'console';
const DEFAULT_ARK_PATH = 'ark';
const DEFAULT_TMUX_PATH = 'tmux';
const DEFAULT_TMUX_SESSION_NAME = 'krarkode-ark';

function nowIso(): string {
    return new Date().toISOString();
}

function normalizeSessionName(value: string): string {
    return value.trim().replace(/[\\/]/g, '-').replace(/\s+/g, '-');
}

function shellEscape(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function rStringLiteral(value: string): string {
    const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
    return `"${escaped}"`;
}

function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
        return values[key] ?? '';
    });
}

function renderShellTemplate(template: string, values: Record<string, string>): string {
    const escaped: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
        escaped[key] = shellEscape(value);
    }
    return renderTemplate(template, escaped);
}

export class ArkSessionManager {
    private readonly outputChannel = vscode.window.createOutputChannel('Ark');
    private onActiveSessionChanged?: (entry: ArkSessionEntry | undefined) => void;

    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('krarkode.createArkSession', () => this.createSession()),
            vscode.commands.registerCommand('krarkode.attachArkSession', () => this.attachSession()),
            vscode.commands.registerCommand('krarkode.stopArkSession', () => this.stopSession())
        );
    }

    dispose(): void {
        this.outputChannel.dispose();
    }

    setActiveSessionHandler(handler: (entry: ArkSessionEntry | undefined) => void): void {
        this.onActiveSessionChanged = handler;
    }

    private getArkPath(): string {
        return (util.config().get<string>('krarkode.ark.path') || '').trim() || DEFAULT_ARK_PATH;
    }

    private getSessionMode(): ArkSessionMode {
        const configured = (util.config().get<string>('krarkode.ark.sessionMode') || DEFAULT_SESSION_MODE).trim() as ArkSessionMode;
        if (configured !== 'console') {
            void vscode.window.showWarningMessage('Ark console backend 仅支持 console 模式，已强制使用 console。');
            return 'console';
        }
        return configured;
    }

    private getConsoleDriver(): ArkConsoleDriver {
        const configured = (util.config().get<string>('krarkode.ark.console.driver') || 'tmux').trim();
        if (configured === 'external') {
            return 'external';
        }
        return 'tmux';
    }

    private getConsoleCommandTemplate(): string {
        return util.config().get<string>('krarkode.ark.console.commandTemplate')
            || 'jupyter console --existing {connectionFile}';
    }

    private getKernelCommandTemplate(): string {
        return util.config().get<string>('krarkode.ark.kernel.commandTemplate')
            || '{arkPath} --connection_file {connectionFile} --session-mode {sessionMode} --startup-file {startupFile}';
    }

    private getStartupFileTemplate(): string {
        return util.config().get<string>('krarkode.ark.kernel.startupFileTemplate')
            || '{sessionsDir}/{name}/init-ark.R';
    }

    private getTmuxPath(): string {
        const configured = util.substituteVariables((util.config().get<string>('krarkode.ark.tmux.path') || '').trim());
        return configured || DEFAULT_TMUX_PATH;
    }

    private getTmuxSessionName(): string {
        return DEFAULT_TMUX_SESSION_NAME;
    }

    private getTmuxWindowName(name: string): string {
        const normalized = normalizeSessionName(name);
        return normalized || 'ark';
    }

    private getManageKernel(): boolean {
        return util.config().get<boolean>('krarkode.ark.tmux.manageKernel') ?? true;
    }

    private getActiveTerminal(): vscode.Terminal | undefined {
        return vscode.window.activeTerminal;
    }

    private getActiveTerminalOrCreate(name: string): vscode.Terminal {
        const existing = vscode.window.activeTerminal;
        if (existing) {
            return existing;
        }
        const terminal = vscode.window.createTerminal({ name });
        terminal.show(true);
        return terminal;
    }

    private async createSession(): Promise<void> {
        if (process.platform === 'win32') {
            void vscode.window.showErrorMessage('Ark console backend 暂不支持 Windows。');
            return;
        }

        const nameInput = await vscode.window.showInputBox({
            prompt: 'Ark session name',
            placeHolder: 'analysis',
            ignoreFocusOut: true,
            validateInput: (value) => value.trim().length === 0 ? 'Name is required.' : undefined
        });
        if (!nameInput) {
            return;
        }

        const sessionName = normalizeSessionName(nameInput);
        const sessionsDir = sessionRegistry.getSessionsDir();
        const sessionDir = path.join(sessionsDir, sessionName);
        if (fs.existsSync(sessionDir)) {
            const choice = await vscode.window.showWarningMessage(
                `Session "${sessionName}" already exists. Attach instead?`,
                'Attach',
                'Cancel'
            );
            if (choice === 'Attach') {
                const existing = sessionRegistry.findSession(sessionName);
                if (existing) {
                    await this.openConsoleForEntry(existing);
                } else {
                    void vscode.window.showWarningMessage('未找到会话注册信息，请使用 Attach 重新绑定。');
                }
            }
            return;
        }
        fs.mkdirSync(sessionDir, { recursive: true });

        const connectionFile = path.join(sessionDir, 'connection.json');
        await this.writeConnectionFile(connectionFile);

        const announceFile = path.join(sessionDir, 'announce.json');
        const startupFile = this.resolveStartupFile(sessionName, sessionsDir);
        this.writeStartupFile(startupFile, sessionName, announceFile);

        const driver = this.getConsoleDriver();
        let tmuxSessionName: string | undefined;
        let tmuxWindowName: string | undefined;

        if (driver === 'tmux') {
            const ensured = await this.ensureTmuxSession();
            if (!ensured) {
                return;
            }
            tmuxSessionName = ensured.name;
            const windowName = await this.createKernelWindow(ensured, sessionName, connectionFile, startupFile);
            if (!windowName) {
                return;
            }
            tmuxWindowName = windowName;
        }

        const entry: ArkSessionEntry = {
            name: sessionName,
            mode: driver,
            connectionFilePath: connectionFile,
            tmuxSessionName,
            tmuxWindowName,
            createdAt: nowIso(),
            lastAttachedAt: nowIso(),
        };

        sessionRegistry.upsertSession(entry);

        if (driver === 'tmux') {
            await this.openConsoleForEntry(entry);
        } else {
            void vscode.window.showInformationMessage('已生成 Ark connection file，请手动启动 Ark kernel 与 console。');
        }
        sessionRegistry.setActiveSessionName(sessionName);
        this.onActiveSessionChanged?.(entry);
    }

    private async attachSession(): Promise<void> {
        const terminal = this.getActiveTerminal();
        if (!terminal) {
            void vscode.window.showWarningMessage('请先在当前终端打开一个已连接 Ark 的 Jupyter console。');
            return;
        }

        const sessionsDir = sessionRegistry.getSessionsDir();
        const announceFile = path.join(sessionsDir, `announce-${Date.now()}.json`);
        const announceScript = path.join(sessionsDir, `announce-${Date.now()}.R`);
        this.writeAnnounceScript(announceScript, announceFile);
        terminal.sendText(`source(${rStringLiteral(announceScript)})`, true);

        try {
            const timeoutMs = 15000;
            const payload = await this.waitForAnnounce(announceFile, timeoutMs);
            if (!payload?.connectionFilePath) {
                void vscode.window.showErrorMessage('未能从当前 console 获取 Ark connection file。请确认 ARK_CONNECTION_FILE 已设置。');
                return;
            }

            const connectionFile = payload.connectionFilePath.trim();
            if (!connectionFile) {
                void vscode.window.showErrorMessage('当前 console 返回了空的 connection file。');
                return;
            }

            const derivedName = normalizeSessionName(path.basename(path.dirname(connectionFile)) || 'ark');
            const sessionName = payload.sessionName?.trim() || derivedName;
            const registry = sessionRegistry.loadRegistry();
            const existing = registry.find((entry) => entry.connectionFilePath === connectionFile || entry.name === sessionName);

            sessionRegistry.upsertSession({
                name: sessionName,
                mode: existing?.mode ?? 'external',
                connectionFilePath: connectionFile,
                tmuxSessionName: existing?.tmuxSessionName,
                tmuxWindowName: existing?.tmuxWindowName,
                createdAt: existing?.createdAt ?? nowIso(),
                lastAttachedAt: nowIso(),
            });

            sessionRegistry.setActiveSessionName(sessionName);
            this.onActiveSessionChanged?.(sessionRegistry.findSession(sessionName));
        } finally {
            if (fs.existsSync(announceFile)) {
                fs.unlinkSync(announceFile);
            }
        }
    }

    private async stopSession(): Promise<void> {
        const registry = sessionRegistry.loadRegistry();
        if (registry.length === 0) {
            void vscode.window.showInformationMessage('No Ark sessions found.');
            return;
        }
        const selected = await vscode.window.showQuickPick(
            registry.map((entry) => ({ label: entry.name, description: entry.tmuxSessionName ?? entry.mode })),
            { placeHolder: 'Select an Ark session to stop' }
        );
        if (!selected) {
            return;
        }

        const entry = registry.find((item) => item.name === selected.label);
        if (!entry) {
            return;
        }

        if (entry.mode === 'tmux') {
            if (entry.tmuxSessionName && entry.tmuxWindowName) {
                await this.killTmuxWindow(entry.tmuxSessionName, entry.tmuxWindowName);
            } else {
                void vscode.window.showWarningMessage('缺少 tmux window 信息，无法停止该 Ark kernel。');
            }
        }

        const nextRegistry = registry.filter((item) => item.name !== entry.name);
        sessionRegistry.saveRegistry(nextRegistry);
        if (sessionRegistry.getActiveSessionName() === entry.name) {
            sessionRegistry.setActiveSessionName(undefined);
        }
        this.onActiveSessionChanged?.(sessionRegistry.getActiveSession());
        void vscode.window.showInformationMessage(`Stopped Ark session "${entry.name}".`);
    }

    private async openConsoleForEntry(entry: ArkSessionEntry): Promise<void> {
        const terminal = this.getActiveTerminalOrCreate(`Ark Console: ${entry.name}`);
        const consoleTemplate = this.getConsoleCommandTemplate();
        const command = renderTemplate(consoleTemplate, { connectionFile: entry.connectionFilePath });
        terminal.sendText(command, true);
        terminal.show(true);
        sessionRegistry.updateSessionAttachment(entry.name, nowIso());
        sessionRegistry.setActiveSessionName(entry.name);
    }

    private resolveStartupFile(name: string, sessionsDir: string): string {
        const template = this.getStartupFileTemplate();
        return renderTemplate(template, { name, sessionsDir });
    }

    private writeStartupFile(startupFile: string, sessionName: string, announceFile: string): void {
        fs.mkdirSync(path.dirname(startupFile), { recursive: true });
        const content = [
            `Sys.setenv(TERM_PROGRAM = "vscode")`,
            `announce_path <- ${rStringLiteral(announceFile)}`,
            `session_name <- ${rStringLiteral(sessionName)}`,
            `connection_file <- Sys.getenv("ARK_CONNECTION_FILE")`,
            `json_escape <- function(x) {`,
            `  x <- gsub("\\\\", "\\\\\\\\", x)`,
            `  x <- gsub("\"", "\\\\\"", x)`,
            `  x <- gsub("\\n", "\\\\n", x)`,
            `  x <- gsub("\\r", "\\\\r", x)`,
            `  x <- gsub("\\t", "\\\\t", x)`,
            `  paste0("\"", x, "\"")`,
            `}`,
            `payload <- paste0(`,
            `  "{",`,
            `  "\\"sessionName\\":", json_escape(session_name), ",",`,
            `  "\\"connectionFilePath\\":", json_escape(connection_file), ",",`,
            `  "\\"pid\\":", Sys.getpid(), ",",`,
            `  "\\"startedAt\\":", json_escape(format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")),`,
            `  "}"`,
            `)`,
            `writeLines(payload, announce_path)`,
        ];
        fs.writeFileSync(startupFile, content.join('\n'));
    }

    private writeAnnounceScript(scriptPath: string, announceFile: string): void {
        fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
        const content = [
            `announce_path <- ${rStringLiteral(announceFile)}`,
            `script_path <- ${rStringLiteral(scriptPath)}`,
            `connection_file <- Sys.getenv("ARK_CONNECTION_FILE")`,
            `session_name <- basename(dirname(connection_file))`,
            `payload <- jsonlite::toJSON(list(`,
            `  sessionName = session_name,`,
            `  connectionFilePath = connection_file,`,
            `  pid = Sys.getpid(),`,
            `  startedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")`,
            `), auto_unbox = TRUE)`,
            `writeLines(payload, announce_path)`,
            `if (file.exists(script_path)) file.remove(script_path)`,
        ];
        fs.writeFileSync(scriptPath, content.join('\n'));
    }

    private async waitForAnnounce(announceFile: string, timeoutMs: number): Promise<ArkAnnouncePayload | undefined> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (fs.existsSync(announceFile)) {
                try {
                    const content = await fs.promises.readFile(announceFile, 'utf8');
                    return JSON.parse(content) as ArkAnnouncePayload;
                } catch (err) {
                    this.outputChannel.appendLine(`Failed to read announce file: ${String(err)}`);
                    return undefined;
                }
            }
            await util.delay(100);
        }
        return undefined;
    }

    private async ensureTmuxSession(): Promise<{ name: string; created: boolean } | undefined> {
        const tmuxPath = this.getTmuxPath();
        const tmuxSessionName = this.getTmuxSessionName();
        const exists = await this.tmuxHasSession(tmuxSessionName);
        if (exists) {
            return { name: tmuxSessionName, created: false };
        }
        const createResult = await this.runTmux(tmuxPath, ['new-session', '-d', '-s', tmuxSessionName]);
        if (createResult.status !== 0) {
            const message = createResult.stderr || createResult.stdout || createResult.error?.message || 'Unknown error';
            void vscode.window.showErrorMessage(`Failed to create tmux session: ${message}`);
            return undefined;
        }
        return { name: tmuxSessionName, created: true };
    }

    private async createKernelWindow(
        tmuxSession: { name: string; created: boolean },
        name: string,
        connectionFile: string,
        startupFile: string
    ): Promise<string | undefined> {
        const tmuxPath = this.getTmuxPath();
        const tmuxSessionName = tmuxSession.name;
        const windowName = this.getTmuxWindowName(name);
        const windows = await this.listTmuxWindows(tmuxSessionName);
        if (windows.includes(windowName)) {
            void vscode.window.showWarningMessage(`tmux window "${windowName}" 已存在，请先使用 Attach 绑定。`);
            return undefined;
        }

        const manageKernel = this.getManageKernel();
        if (tmuxSession.created) {
            const baseTarget = await this.getFirstTmuxWindowTarget(tmuxSessionName);
            if (!baseTarget) {
                void vscode.window.showWarningMessage('未能找到 tmux 初始窗口。');
                return undefined;
            }
            if (!manageKernel) {
                const result = await this.runTmux(tmuxPath, ['rename-window', '-t', baseTarget, windowName]);
                if (result.status !== 0) {
                    const message = result.stderr || result.stdout || result.error?.message || 'Unknown error';
                    void vscode.window.showWarningMessage(`Failed to rename tmux window: ${message}`);
                    return undefined;
                }
                void vscode.window.showWarningMessage('ark.tmux.manageKernel=false: 请手动在该窗口启动 Ark kernel。');
                return windowName;
            }
            const kernelCommandWithEnv = await this.buildKernelCommand(connectionFile, startupFile);
            const result = await this.runTmux(tmuxPath, [
                'respawn-window',
                '-k',
                '-t',
                baseTarget,
                'sh',
                '-lc',
                kernelCommandWithEnv,
            ]);
            if (result.status !== 0) {
                const message = result.stderr || result.stdout || result.error?.message || 'Unknown error';
                void vscode.window.showWarningMessage(`Failed to start Ark in tmux window: ${message}`);
                return undefined;
            }
            await this.renameTmuxWindow(baseTarget, windowName);
            return windowName;
        }

        if (!manageKernel) {
            const result = await this.runTmux(tmuxPath, ['new-window', '-t', tmuxSessionName, '-n', windowName]);
            if (result.status !== 0) {
                const message = result.stderr || result.stdout || result.error?.message || 'Unknown error';
                void vscode.window.showWarningMessage(`Failed to create tmux window: ${message}`);
                return undefined;
            }
            void vscode.window.showWarningMessage('ark.tmux.manageKernel=false: 请手动在该窗口启动 Ark kernel。');
            return windowName;
        }
        const kernelCommandWithEnv = await this.buildKernelCommand(connectionFile, startupFile);
        const createResult = await this.runTmux(tmuxPath, [
            'new-window',
            '-t',
            tmuxSessionName,
            '-n',
            windowName,
            'sh',
            '-lc',
            kernelCommandWithEnv,
        ]);
        if (createResult.status !== 0) {
            const message = createResult.stderr || createResult.stdout || createResult.error?.message || 'Unknown error';
            void vscode.window.showErrorMessage(`Failed to create tmux window: ${message}`);
            return undefined;
        }

        return windowName;
    }

    private async tmuxHasSession(sessionName: string): Promise<boolean> {
        const result = await this.runTmux(this.getTmuxPath(), ['has-session', '-t', sessionName]);
        return result.status === 0;
    }

    private async killTmuxWindow(sessionName: string, windowName: string): Promise<void> {
        const target = `${sessionName}:${windowName}`;
        const result = await this.runTmux(this.getTmuxPath(), ['kill-window', '-t', target]);
        if (result.status !== 0) {
            const message = result.stderr || result.stdout || result.error?.message || 'Unknown error';
            void vscode.window.showWarningMessage(`Failed to kill tmux window ${target}: ${message}`);
        }
    }

    private async runTmux(command: string, args: string[]): Promise<util.SpawnResult> {
        const result = await util.spawnAsync(command, args, { env: process.env });
        if (result.error) {
            this.outputChannel.appendLine(`tmux error: ${String(result.error)}`);
        }
        return result;
    }

    private async listTmuxWindows(sessionName: string): Promise<string[]> {
        const result = await this.runTmux(this.getTmuxPath(), ['list-windows', '-t', sessionName, '-F', '#{window_name}']);
        if (result.status !== 0) {
            return [];
        }
        return (result.stdout || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    }

    private async writeConnectionFile(connectionFile: string): Promise<void> {
        const ipAddress = '127.0.0.1';
        const ports = await this.allocatePorts(ipAddress, 5);
        const payload = {
            shell_port: ports[0],
            iopub_port: ports[1],
            stdin_port: ports[2],
            control_port: ports[3],
            hb_port: ports[4],
            ip: ipAddress,
            key: '',
            transport: 'tcp',
            signature_scheme: DEFAULT_SIGNATURE_SCHEME,
        };
        fs.writeFileSync(connectionFile, JSON.stringify(payload, null, 2));
    }

    private async buildKernelCommand(connectionFile: string, startupFile: string): Promise<string> {
        const arkPath = this.getArkPath();
        const sessionMode = this.getSessionMode();
        const kernelTemplate = this.getKernelCommandTemplate();
        const kernelCommand = renderShellTemplate(kernelTemplate, {
            arkPath,
            connectionFile,
            sessionMode,
            startupFile,
        });

        const envParts: string[] = [
            `ARK_CONNECTION_FILE=${shellEscape(connectionFile)}`,
        ];

        return `${envParts.join(' ')} ${kernelCommand}`;
    }

    private async getFirstTmuxWindowTarget(sessionName: string): Promise<string | undefined> {
        const result = await this.runTmux(this.getTmuxPath(), ['list-windows', '-t', sessionName, '-F', '#{window_index}']);
        if (result.status !== 0) {
            return undefined;
        }
        const lines = (result.stdout || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        if (lines.length === 0) {
            return undefined;
        }
        return `${sessionName}:${lines[0]}`;
    }

    private async renameTmuxWindow(target: string, name: string): Promise<void> {
        const result = await this.runTmux(this.getTmuxPath(), ['rename-window', '-t', target, name]);
        if (result.status !== 0) {
            const message = result.stderr || result.stdout || result.error?.message || 'Unknown error';
            void vscode.window.showWarningMessage(`Failed to rename tmux window: ${message}`);
        }
    }

    private async allocatePorts(host: string, count: number): Promise<number[]> {
        const ports: number[] = [];
        for (let i = 0; i < count; i += 1) {
            ports.push(await this.getAvailablePort(host));
        }
        return ports;
    }

    private async getAvailablePort(host: string): Promise<number> {
        return await new Promise((resolve, reject) => {
            const server = net.createServer();
            server.once('error', (err) => {
                reject(err);
            });
            server.listen(0, host, () => {
                const address = server.address();
                if (!address || typeof address === 'string') {
                    server.close(() => reject(new Error('Failed to allocate port.')));
                    return;
                }
                const port = address.port;
                server.close(() => resolve(port));
            });
        });
    }
}
