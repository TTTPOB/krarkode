import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import * as util from '../util';
import * as sessionRegistry from './sessionRegistry';
import type { ArkConsoleDriver, ArkSessionEntry } from './sessionRegistry';
import { getRBinaryPath } from '../util';
import { collectRBinaryCandidates } from '../rBinaryResolver';
import type { RBinaryCandidate } from '../rBinaryResolver';
import { getLogger, LogCategory } from '../logging/logger';
import { formatArkRustLog, getArkLogLevel } from './arkLogLevel';
import * as tmuxUtil from './tmuxUtil';

type ArkKernelStatus = 'idle' | 'busy' | 'starting' | 'reconnecting' | 'unknown';

type StatusMenuItem = vscode.QuickPickItem & { action?: () => Promise<void> };

interface ArkAnnouncePayload {
    sessionName?: string;
    connectionFilePath?: string;
    pid?: number;
    startedAt?: string;
}

const DEFAULT_SIGNATURE_SCHEME = 'hmac-sha256';

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
    private readonly outputChannel = getLogger().createChannel('runtime', LogCategory.Session);
    private readonly statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    private onActiveSessionChanged?: (entry: ArkSessionEntry | undefined) => void;
    private kernelStatus: ArkKernelStatus | undefined;
    private statusQuickPick: vscode.QuickPick<StatusMenuItem> | undefined;

    constructor() {
        this.statusBarItem.command = 'krarkode.showArkSessionMenu';
        this.updateStatusBar(undefined);
        this.statusBarItem.show();
    }

    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('krarkode.createArkSession', () => this.createSession()),
            vscode.commands.registerCommand('krarkode.attachArkSession', () => this.attachSession()),
            vscode.commands.registerCommand('krarkode.openArkConsole', () => this.openConsole()),
            vscode.commands.registerCommand('krarkode.stopArkSession', () => this.stopSession()),
            vscode.commands.registerCommand('krarkode.interruptArkSession', () => this.interruptSession()),
            vscode.commands.registerCommand('krarkode.showArkSessionMenu', () => this.showStatusMenu()),
            vscode.commands.registerCommand('krarkode.switchArkSession', () => this.switchSession()),
            vscode.commands.registerCommand('krarkode.interruptActiveArkSession', () => this.interruptActiveSession()),
            vscode.commands.registerCommand('krarkode.stopActiveArkSession', () => this.stopActiveSession()),
            vscode.commands.registerCommand('krarkode.copyArkConnectionFile', () => this.copyActiveConnectionFile()),
        );
    }

    private async openConsole(): Promise<void> {
        const registry = await sessionRegistry.loadRegistryValidated();
        if (registry.length === 0) {
            void vscode.window.showInformationMessage('No Ark sessions found. Use "Create Ark session" first.');
            return;
        }
        const selected = await vscode.window.showQuickPick(
            registry.map((entry) => ({ label: entry.name })),
            {
                placeHolder: 'Select an Ark session',
            },
        );
        if (!selected) {
            return;
        }

        const entry = registry.find((item) => item.name === selected.label);
        if (!entry) {
            return;
        }

        await this.openConsoleForEntry(entry);
    }

    dispose(): void {
        this.outputChannel.dispose();
        this.statusBarItem.dispose();
        this.statusQuickPick?.dispose();
    }

    async setActiveSessionHandler(handler: (entry: ArkSessionEntry | undefined) => void): Promise<void> {
        this.onActiveSessionChanged = handler;
        // Initialize with current active session
        const current = await sessionRegistry.getActiveSessionValidated();
        if (current) {
            this.updateStatusBar(current);
            handler(current);
        }
    }

    public setKernelStatus(status: string | undefined): void {
        const normalized = this.normalizeKernelStatus(status);
        if (this.kernelStatus === normalized) {
            return;
        }
        this.kernelStatus = normalized;
        this.outputChannel.appendLine(`Kernel status updated: ${normalized ?? 'unknown'}`);
        this.updateStatusBar(sessionRegistry.getActiveSession());
        this.updateStatusQuickPick();
    }

    private updateStatusBar(entry: ArkSessionEntry | undefined): void {
        if (entry) {
            const status = this.formatKernelStatus();
            this.statusBarItem.text = `${status.icon} Ark: ${entry.name} ${status.label}`;
            this.statusBarItem.tooltip = this.buildStatusTooltip(entry, status);
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = `$(circle-slash) Ark: No Session`;
            this.statusBarItem.tooltip = this.buildStatusTooltip(undefined, this.formatKernelStatus());
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        this.statusBarItem.show();
    }

    private buildStatusTooltip(
        entry: ArkSessionEntry | undefined,
        status: { icon: string; label: string },
    ): vscode.MarkdownString {
        const pidLabel = entry?.pid ? String(entry.pid) : 'unknown';
        const nameLabel = entry?.name ?? 'No active session';
        const connectionFile = entry?.connectionFilePath;
        const actions = [
            `[$(plug) Attach](command:krarkode.attachArkSession)`,
            `[$(arrow-swap) Switch](command:krarkode.switchArkSession)`,
        ];
        if (entry?.pid) {
            actions.push(`[$(debug-pause) Interrupt](command:krarkode.interruptActiveArkSession)`);
        }
        actions.push(`[$(stop-circle) Kill](command:krarkode.stopActiveArkSession)`);
        const md = new vscode.MarkdownString(
            `**Ark Session**\n\n` +
                `- Status: ${status.label}\n` +
                `- Session: ${nameLabel}\n` +
                `- PID: ${pidLabel}\n` +
                `- Connection: ${connectionFile ? '[Copy connection file](command:krarkode.copyArkConnectionFile)' : 'Not available'}\n\n` +
                actions.join(' | '),
        );
        md.isTrusted = true;
        md.supportThemeIcons = true;
        return md;
    }

    private async copyActiveConnectionFile(): Promise<void> {
        const entry = await sessionRegistry.getActiveSessionValidated();
        if (!entry?.connectionFilePath) {
            void vscode.window.showWarningMessage('No active Ark connection file to copy.');
            return;
        }

        this.outputChannel.appendLine(`Copying connection file for ${entry.name}.`);
        await vscode.env.clipboard.writeText(entry.connectionFilePath);
        void vscode.window.showInformationMessage('Ark connection file path copied to clipboard.');
    }

    private async showStatusMenu(): Promise<void> {
        this.outputChannel.appendLine('Opening Ark status popup.');
        if (this.statusQuickPick) {
            this.updateStatusQuickPick();
            this.statusQuickPick.show();
            return;
        }

        const quickPick = vscode.window.createQuickPick<StatusMenuItem>();
        quickPick.title = 'Ark Status';
        quickPick.placeholder = 'Ark session actions';
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.ignoreFocusOut = true;
        quickPick.items = this.buildStatusMenuItems();

        quickPick.onDidAccept(async () => {
            const selection = quickPick.selectedItems[0];
            if (!selection?.action) {
                this.outputChannel.appendLine('Status popup: no action selected.');
                quickPick.hide();
                return;
            }

            this.outputChannel.appendLine(`Status popup action: ${selection.label}`);
            quickPick.busy = true;
            try {
                await selection.action();
            } finally {
                quickPick.busy = false;
            }
            quickPick.hide();
        });

        quickPick.onDidHide(() => {
            this.outputChannel.appendLine('Ark status popup hidden.');
            quickPick.dispose();
            if (this.statusQuickPick === quickPick) {
                this.statusQuickPick = undefined;
            }
        });

        this.statusQuickPick = quickPick;
        quickPick.show();
    }

    private updateStatusQuickPick(): void {
        if (!this.statusQuickPick) {
            return;
        }
        this.outputChannel.appendLine('Refreshing Ark status popup.');
        this.statusQuickPick.items = this.buildStatusMenuItems();
    }

    private buildStatusMenuItems(): StatusMenuItem[] {
        const activeSession = sessionRegistry.getActiveSession();
        const status = this.formatKernelStatus();
        const pidLabel = activeSession?.pid ? String(activeSession.pid) : 'unknown';
        const connectionFile = activeSession?.connectionFilePath ?? 'N/A';
        const items: StatusMenuItem[] = [];

        if (activeSession) {
            items.push({
                label: `$(info) ${activeSession.name}`,
                description: `Status: ${status.label}`,
                detail: `PID: ${pidLabel} | ${connectionFile}`,
            });
        } else {
            items.push({
                label: 'No active Ark session',
                detail: 'Attach or switch a session to connect.',
            });
        }

        items.push({ label: 'Actions', kind: vscode.QuickPickItemKind.Separator });
        items.push({
            label: 'Attach current console',
            description: 'Use active terminal',
            action: async () => {
                this.outputChannel.appendLine('Status popup: attach current console.');
                await this.attachSession();
            },
        });
        items.push({
            label: 'Switch session',
            description: 'Choose from registry',
            action: async () => {
                this.outputChannel.appendLine('Status popup: switch session.');
                await this.switchSession();
            },
        });

        if (activeSession) {
            items.push({ label: 'Active Session', kind: vscode.QuickPickItemKind.Separator });
            items.push({
                label: 'Interrupt active session',
                description: 'Send Ctrl+C',
                action: async () => {
                    this.outputChannel.appendLine('Status popup: interrupt active session.');
                    await this.interruptActiveSession();
                },
            });
            items.push({
                label: 'Kill active session',
                description: 'Stop kernel',
                action: async () => {
                    this.outputChannel.appendLine('Status popup: kill active session.');
                    await this.stopActiveSession();
                },
            });
        }

        return items;
    }

    private normalizeKernelStatus(status: string | undefined): ArkKernelStatus | undefined {
        if (!status) {
            return undefined;
        }
        switch (status) {
            case 'idle':
            case 'busy':
            case 'starting':
            case 'reconnecting':
            case 'unknown':
                return status;
            default:
                return 'unknown';
        }
    }

    private formatKernelStatus(): { icon: string; label: string } {
        const status = this.kernelStatus ?? 'unknown';
        switch (status) {
            case 'idle':
                return { icon: '$(check)', label: 'Idle' };
            case 'busy':
                return { icon: '$(sync~spin)', label: 'Busy' };
            case 'starting':
                return { icon: '$(clock)', label: 'Starting' };
            case 'reconnecting':
                return { icon: '$(sync)', label: 'Reconnecting' };
            default:
                return { icon: '$(question)', label: 'Unknown' };
        }
    }

    private getArkPath(): string {
        return util.resolveArkPath();
    }

    private getConsoleDriver(): ArkConsoleDriver {
        const configured = (util.config().get<string>('krarkode.ark.console.driver') || 'tmux').trim();
        if (configured === 'external') {
            return 'external';
        }
        return 'tmux';
    }

    private getConsoleCommandTemplate(): string {
        return (
            util.config().get<string>('krarkode.ark.console.commandTemplate') ||
            '{sidecarPath} console --connection-file {connectionFile}'
        );
    }

    private getKernelCommandTemplate(): string {
        return (
            util.config().get<string>('krarkode.ark.kernel.commandTemplate') ||
            '{arkPath} --connection_file {connectionFile} --session-mode console --startup-file {startupFile}'
        );
    }

    private getStartupFileTemplate(): string {
        return (
            util.config().get<string>('krarkode.ark.kernel.startupFileTemplate') || '{sessionsDir}/{name}/init-ark.R'
        );
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

    private setActiveSession(entry: ArkSessionEntry | undefined): void {
        sessionRegistry.setActiveSessionName(entry?.name);
        this.kernelStatus = undefined;
        this.updateStatusBar(entry);
        this.updateStatusQuickPick();
        this.onActiveSessionChanged?.(entry);
    }

    private async createSession(): Promise<void> {
        const nameInput = await vscode.window.showInputBox({
            prompt: 'Ark session name',
            placeHolder: 'analysis',
            ignoreFocusOut: true,
            validateInput: (value) => (value.trim().length === 0 ? 'Name is required.' : undefined),
        });
        if (!nameInput) {
            return;
        }

        const sessionName = normalizeSessionName(nameInput);

        // Collect R binary candidates and let user choose
        const selectedRBinary = await this.selectRBinary();
        if (!selectedRBinary) {
            return;
        }
        this.outputChannel.appendLine(`R binary selected: ${selectedRBinary} for session "${sessionName}"`);

        const sessionsDir = sessionRegistry.getSessionsDir();
        const sessionDir = path.join(sessionsDir, sessionName);
        if (fs.existsSync(sessionDir)) {
            const existing = await sessionRegistry.findSessionValidated(sessionName);
            if (existing) {
                // Session is live — offer to attach
                const choice = await vscode.window.showWarningMessage(
                    `Session "${sessionName}" already exists. Attach instead?`,
                    'Attach',
                    'Cancel',
                );
                if (choice === 'Attach') {
                    await this.openConsoleForEntry(existing);
                }
                return;
            }
            // Stale directory without registry entry — clean up and proceed
            this.outputChannel.appendLine(`Removing stale session directory for "${sessionName}".`);
            fs.rmSync(sessionDir, { recursive: true, force: true });
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
            const windowName = await this.createKernelWindow(ensured, sessionName, connectionFile, startupFile, selectedRBinary);
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
            rBinaryPath: selectedRBinary,
            createdAt: nowIso(),
            lastAttachedAt: nowIso(),
        };

        // Try to get PID from startup announce
        const payload = await this.waitForAnnounce(announceFile, 5000);
        if (payload?.pid) {
            entry.pid = payload.pid;
        }

        await sessionRegistry.upsertSessionValidated(entry);

        if (driver === 'tmux') {
            await this.openConsoleForEntry(entry);
        } else {
            void vscode.window.showInformationMessage('Ark connection file generated. Please start the Ark kernel and console manually.');
            this.setActiveSession(entry);
        }
    }

    /**
     * Collect R binary candidates and present a QuickPick if multiple are available.
     * Returns the selected R binary path, or undefined if cancelled / none found.
     */
    private async selectRBinary(): Promise<string | undefined> {
        this.outputChannel.appendLine('Collecting R binary candidates...');
        const candidates = await collectRBinaryCandidates();

        if (candidates.length === 0) {
            void vscode.window.showErrorMessage(
                'No R binary found. Configure krarkode.r.binaryPath, add pixi.toml with R, or ensure R is in PATH.',
            );
            return undefined;
        }

        if (candidates.length === 1) {
            this.outputChannel.appendLine(`Single R binary candidate, using directly: ${candidates[0].rBinaryPath}`);
            return candidates[0].rBinaryPath;
        }

        // Multiple candidates: show QuickPick
        this.outputChannel.appendLine(`${candidates.length} R binary candidates found, showing picker`);
        const items = candidates.map((c) => ({
            label: c.label,
            detail: c.detail,
            rBinaryPath: c.rBinaryPath,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select R binary for this session',
            ignoreFocusOut: true,
        });

        return selected?.rBinaryPath;
    }

    private async attachSession(): Promise<void> {
        const terminal = this.getActiveTerminal();
        if (!terminal) {
            void vscode.window.showWarningMessage('Please open a Jupyter console connected to Ark in the current terminal first.');
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
                void vscode.window.showErrorMessage(
                    'Failed to get Ark connection file from the current console. Please verify ARK_CONNECTION_FILE is set.',
                );
                return;
            }

            const connectionFile = payload.connectionFilePath.trim();
            if (!connectionFile) {
                void vscode.window.showErrorMessage('The current console returned an empty connection file.');
                return;
            }

            const derivedName = normalizeSessionName(path.basename(path.dirname(connectionFile)) || 'ark');
            const sessionName = payload.sessionName?.trim() || derivedName;
            const registry = await sessionRegistry.loadRegistryValidated();
            const existing = registry.find(
                (entry) => entry.connectionFilePath === connectionFile || entry.name === sessionName,
            );

            await sessionRegistry.upsertSessionValidated({
                name: sessionName,
                mode: existing?.mode ?? 'external',
                connectionFilePath: connectionFile,
                tmuxSessionName: existing?.tmuxSessionName,
                tmuxWindowName: existing?.tmuxWindowName,
                pid: payload.pid,
                createdAt: existing?.createdAt ?? nowIso(),
                lastAttachedAt: nowIso(),
            });

            const activeSession = await sessionRegistry.findSessionValidated(sessionName);
            this.setActiveSession(activeSession);
        } finally {
            if (fs.existsSync(announceFile)) {
                fs.unlinkSync(announceFile);
            }
        }
    }

    private async stopSession(): Promise<void> {
        const registry = await sessionRegistry.loadRegistryValidated();
        if (registry.length === 0) {
            void vscode.window.showInformationMessage('No Ark sessions found.');
            return;
        }
        const selected = await vscode.window.showQuickPick(
            registry.map((entry) => ({ label: entry.name, description: entry.tmuxSessionName ?? entry.mode })),
            { placeHolder: 'Select an Ark session to stop' },
        );
        if (!selected) {
            return;
        }

        const entry = registry.find((item) => item.name === selected.label);
        if (!entry) {
            return;
        }
        await this.stopSessionEntry(entry);
    }

    private async interruptSession(): Promise<void> {
        const registry = await sessionRegistry.loadRegistryValidated();
        if (registry.length === 0) {
            void vscode.window.showInformationMessage('No Ark sessions found.');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            registry.map((entry) => ({
                label: entry.name,
                description: entry.tmuxSessionName ?? entry.mode,
                detail: entry.pid ? `PID: ${entry.pid}` : 'PID: unknown',
            })),
            { placeHolder: 'Select an Ark session to interrupt' },
        );
        if (!selected) {
            return;
        }

        const entry = registry.find((item) => item.name === selected.label);
        if (!entry) {
            return;
        }
        await this.interruptSessionEntry(entry);
    }

    private async interruptActiveSession(): Promise<void> {
        const entry = await sessionRegistry.getActiveSessionValidated();
        if (!entry) {
            void vscode.window.showWarningMessage('No active Ark session to interrupt.');
            return;
        }

        await this.interruptSessionEntry(entry);
    }

    private async stopActiveSession(): Promise<void> {
        const entry = await sessionRegistry.getActiveSessionValidated();
        if (!entry) {
            void vscode.window.showWarningMessage('No active Ark session to stop.');
            return;
        }

        await this.stopSessionEntry(entry);
    }

    private async switchSession(): Promise<void> {
        const registry = await sessionRegistry.loadRegistryValidated();
        if (registry.length === 0) {
            void vscode.window.showInformationMessage('No Ark sessions found.');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            registry.map((entry) => ({
                label: entry.name,
                description: entry.tmuxSessionName ?? entry.mode,
                detail: entry.connectionFilePath,
            })),
            { placeHolder: 'Select an Ark session to activate' },
        );
        if (!selected) {
            return;
        }

        const entry = registry.find((item) => item.name === selected.label);
        if (!entry) {
            return;
        }

        await sessionRegistry.updateSessionAttachmentValidated(entry.name, nowIso());
        this.setActiveSession(entry);
        this.outputChannel.appendLine(`Switched active Ark session to ${entry.name}.`);
    }

    /**
     * Try to recover PID for a session from announce file or tmux pane.
     * Updates the registry if a PID is found.
     */
    private async refreshSessionPid(entry: ArkSessionEntry): Promise<number | undefined> {
        // Try announce file first
        const sessionsDir = sessionRegistry.getSessionsDir();
        const announceFile = path.join(sessionsDir, entry.name, 'announce.json');
        if (fs.existsSync(announceFile)) {
            try {
                const content = fs.readFileSync(announceFile, 'utf8');
                const payload = JSON.parse(content) as ArkAnnouncePayload;
                if (payload.pid) {
                    this.outputChannel.appendLine(`Recovered PID ${payload.pid} for session ${entry.name} from announce file.`);
                    entry.pid = payload.pid;
                    await sessionRegistry.upsertSessionValidated(entry);
                    return payload.pid;
                }
            } catch {
                // Fall through to tmux fallback
            }
        }

        // Fallback: get PID from tmux pane
        if (entry.mode === 'tmux' && entry.tmuxSessionName && entry.tmuxWindowName) {
            const pid = await tmuxUtil.getTmuxPanePid(entry.tmuxSessionName, entry.tmuxWindowName);
            if (pid) {
                this.outputChannel.appendLine(`Recovered PID ${pid} for session ${entry.name} from tmux pane.`);
                entry.pid = pid;
                await sessionRegistry.upsertSessionValidated(entry);
                return pid;
            }
        }

        return undefined;
    }

    private async interruptSessionEntry(entry: ArkSessionEntry): Promise<void> {
        if (!entry.pid) {
            this.outputChannel.appendLine(`PID missing for session ${entry.name}, attempting recovery...`);
            const recovered = await this.refreshSessionPid(entry);
            if (!recovered) {
                getLogger().log(
                    'runtime',
                    LogCategory.Session,
                    'warn',
                    `Interrupt requested for ${entry.name}, but PID is missing and recovery failed.`,
                );
                void vscode.window.showWarningMessage(`Ark session "${entry.name}" does not have a PID to interrupt.`);
                return;
            }
        }

        this.outputChannel.appendLine(`Sending SIGINT to Ark session ${entry.name} (PID ${entry.pid}).`);
        try {
            process.kill(entry.pid, 'SIGINT');
            this.outputChannel.appendLine(`SIGINT delivered to Ark session ${entry.name}.`);
            void vscode.window.showInformationMessage(`Sent Ctrl+C to Ark session "${entry.name}".`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            getLogger().log(
                'runtime',
                LogCategory.Session,
                'error',
                `Failed to interrupt Ark session ${entry.name}: ${message}`,
            );
            void vscode.window.showErrorMessage(`Failed to interrupt Ark session "${entry.name}": ${message}`);
        }
    }

    private async stopSessionEntry(entry: ArkSessionEntry): Promise<void> {
        if (entry.mode === 'tmux') {
            if (entry.tmuxSessionName && entry.tmuxWindowName) {
                await tmuxUtil.killTmuxWindow(entry.tmuxSessionName, entry.tmuxWindowName);
            } else {
                void vscode.window.showWarningMessage('Missing tmux window info. Cannot stop the Ark kernel.');
            }
        }

        try {
            const sessionsDir = sessionRegistry.getSessionsDir();
            const sessionDir = path.join(sessionsDir, entry.name);
            if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
        } catch (err) {
            getLogger().log('runtime', LogCategory.Session, 'error', `Failed to remove session directory: ${err}`);
        }

        const registry = await sessionRegistry.loadRegistryValidated();
        const nextRegistry = registry.filter((item) => item.name !== entry.name);
        sessionRegistry.saveRegistry(nextRegistry);

        let nextActive: ArkSessionEntry | undefined;
        if (sessionRegistry.getActiveSessionName() !== entry.name) {
            nextActive = await sessionRegistry.getActiveSessionValidated();
        }
        this.setActiveSession(nextActive);

        void vscode.window.showInformationMessage(`Stopped Ark session "${entry.name}".`);
    }

    private async openConsoleForEntry(entry: ArkSessionEntry): Promise<void> {
        const terminal = this.getActiveTerminalOrCreate(`Ark Console: ${entry.name}`);
        const consoleTemplate = this.getConsoleCommandTemplate();
        const sidecarPath = util.resolveSidecarPath();
        let command = renderTemplate(consoleTemplate, { sidecarPath, connectionFile: entry.connectionFilePath });
        if (entry.rBinaryPath) {
            command += ` --r-binary-path ${shellEscape(entry.rBinaryPath)}`;
        }
        terminal.sendText(command, true);
        terminal.show(true);
        await sessionRegistry.updateSessionAttachmentValidated(entry.name, nowIso());
        this.setActiveSession(entry);
    }

    private resolveStartupFile(name: string, sessionsDir: string): string {
        const template = this.getStartupFileTemplate();
        return renderTemplate(template, { name, sessionsDir });
    }

    private writeStartupFile(startupFile: string, sessionName: string, announceFile: string): void {
        fs.mkdirSync(path.dirname(startupFile), { recursive: true });
        const content = [
            `Sys.setenv(TERM_PROGRAM = "vscode")`,
            `local({`,
            `  .krarkode_announce_path <- ${rStringLiteral(announceFile)}`,
            `  .krarkode_session_name <- ${rStringLiteral(sessionName)}`,
            `  .krarkode_connection_file <- Sys.getenv("ARK_CONNECTION_FILE")`,
            `  if (!requireNamespace("jsonlite", quietly = TRUE)) {`,
            `    stop("jsonlite package is required for Ark session management")`,
            `  }`,
            `  .krarkode_payload <- jsonlite::toJSON(list(`,
            `    sessionName = .krarkode_session_name,`,
            `    connectionFilePath = .krarkode_connection_file,`,
            `    pid = Sys.getpid(),`,
            `    startedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")`,
            `  ), auto_unbox = TRUE)`,
            `  writeLines(.krarkode_payload, .krarkode_announce_path)`,
            `})`,
        ];
        fs.writeFileSync(startupFile, content.join('\n'));
    }

    private writeAnnounceScript(scriptPath: string, announceFile: string): void {
        fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
        const content = [
            `local({`,
            `  .krarkode_announce_path <- ${rStringLiteral(announceFile)}`,
            `  .krarkode_script_path <- ${rStringLiteral(scriptPath)}`,
            `  .krarkode_connection_file <- Sys.getenv("ARK_CONNECTION_FILE")`,
            `  .krarkode_session_name <- basename(dirname(.krarkode_connection_file))`,
            `  if (!requireNamespace("jsonlite", quietly = TRUE)) {`,
            `    stop("jsonlite package is required for Ark session management")`,
            `  }`,
            `  .krarkode_payload <- jsonlite::toJSON(list(`,
            `    sessionName = .krarkode_session_name,`,
            `    connectionFilePath = .krarkode_connection_file,`,
            `    pid = Sys.getpid(),`,
            `    startedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")`,
            `  ), auto_unbox = TRUE)`,
            `  writeLines(.krarkode_payload, .krarkode_announce_path)`,
            `  if (file.exists(.krarkode_script_path)) file.remove(.krarkode_script_path)`,
            `})`,
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
                    getLogger().log('runtime', LogCategory.Session, 'warn', `Failed to read announce file: ${String(err)}`);
                    return undefined;
                }
            }
            await util.delay(100);
        }
        return undefined;
    }

    private async ensureTmuxSession(): Promise<{ name: string; created: boolean } | undefined> {
        const tmuxPath = tmuxUtil.getTmuxPath();
        const tmuxSessionName = tmuxUtil.getTmuxSessionName();
        const exists = await tmuxUtil.tmuxHasSession(tmuxSessionName);
        if (exists) {
            return { name: tmuxSessionName, created: false };
        }
        const createResult = await tmuxUtil.runTmux(tmuxPath, ['new-session', '-d', '-s', tmuxSessionName]);
        if (createResult.status !== 0) {
            const message =
                createResult.stderr || createResult.stdout || createResult.error?.message || 'Unknown error';
            void vscode.window.showErrorMessage(`Failed to create tmux session: ${message}`);
            return undefined;
        }
        return { name: tmuxSessionName, created: true };
    }

    private async createKernelWindow(
        tmuxSession: { name: string; created: boolean },
        name: string,
        connectionFile: string,
        startupFile: string,
        rBinaryPath?: string,
    ): Promise<string | undefined> {
        const tmuxPath = tmuxUtil.getTmuxPath();
        const tmuxSessionName = tmuxSession.name;
        const windowName = this.getTmuxWindowName(name);
        const windows = await tmuxUtil.listTmuxWindows(tmuxSessionName);
        if (windows.includes(windowName)) {
            void vscode.window.showWarningMessage(`tmux window "${windowName}" already exists. Please use Attach to bind first.`);
            return undefined;
        }

        const manageKernel = this.getManageKernel();
        if (tmuxSession.created) {
            const baseTarget = await tmuxUtil.getFirstTmuxWindowTarget(tmuxSessionName);
            if (!baseTarget) {
                void vscode.window.showWarningMessage('Failed to find the initial tmux window.');
                return undefined;
            }
            if (!manageKernel) {
                const result = await tmuxUtil.runTmux(tmuxPath, ['rename-window', '-t', baseTarget, windowName]);
                if (result.status !== 0) {
                    const message = result.stderr || result.stdout || result.error?.message || 'Unknown error';
                    void vscode.window.showWarningMessage(`Failed to rename tmux window: ${message}`);
                    return undefined;
                }
                void vscode.window.showWarningMessage('ark.tmux.manageKernel=false: Please start the Ark kernel manually in this window.');
                return windowName;
            }
            const kernelCommandWithEnv = await this.buildKernelCommand(connectionFile, startupFile, rBinaryPath);
            const result = await tmuxUtil.runTmux(tmuxPath, [
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
            await tmuxUtil.renameTmuxWindow(baseTarget, windowName);
            return windowName;
        }

        if (!manageKernel) {
            const result = await tmuxUtil.runTmux(tmuxPath, ['new-window', '-t', tmuxSessionName, '-n', windowName]);
            if (result.status !== 0) {
                const message = result.stderr || result.stdout || result.error?.message || 'Unknown error';
                void vscode.window.showWarningMessage(`Failed to create tmux window: ${message}`);
                return undefined;
            }
            void vscode.window.showWarningMessage('ark.tmux.manageKernel=false: Please start the Ark kernel manually in this window.');
            return windowName;
        }
        const kernelCommandWithEnv = await this.buildKernelCommand(connectionFile, startupFile, rBinaryPath);
        const createResult = await tmuxUtil.runTmux(tmuxPath, [
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
            const message =
                createResult.stderr || createResult.stdout || createResult.error?.message || 'Unknown error';
            void vscode.window.showErrorMessage(`Failed to create tmux window: ${message}`);
            return undefined;
        }

        return windowName;
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

    private async buildKernelCommand(connectionFile: string, startupFile: string, rBinaryPath?: string): Promise<string> {
        const arkPath = this.getArkPath();
        const kernelTemplate = this.getKernelCommandTemplate();
        const kernelCommand = renderShellTemplate(kernelTemplate, {
            arkPath,
            connectionFile,
            startupFile,
        });

        const envParts: string[] = [`ARK_CONNECTION_FILE=${shellEscape(connectionFile)}`];

        const arkLogLevel = getArkLogLevel();
        const rustLog = formatArkRustLog(arkLogLevel);
        if (rustLog) {
            // Use shell parameter expansion to merge with login shell's RUST_LOG
            // rather than replacing it entirely. This preserves base-level and
            // other crate directives the user may have configured.
            envParts.push(`RUST_LOG="\${RUST_LOG:+\${RUST_LOG},}${rustLog}"`);
            this.outputChannel.appendLine(`Ark backend log level set to ${arkLogLevel}.`);
        }

        const rHome = await this.resolveRHome(rBinaryPath);
        if (rHome) {
            envParts.push(`R_HOME=${shellEscape(rHome)}`);
        }

        return `${envParts.join(' ')} ${kernelCommand}`;
    }

    private async resolveRHome(rBinaryPath?: string): Promise<string | undefined> {
        const rPath = rBinaryPath ?? await getRBinaryPath();
        if (!rPath) {
            return undefined;
        }

        this.outputChannel.appendLine(`Resolving R_HOME from: ${rPath}`);
        const result = await util.spawnAsync(rPath, ['RHOME'], { env: process.env });
        const lines = (result.stdout || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        if (lines.length > 0) {
            return lines[lines.length - 1];
        }

        return path.resolve(path.dirname(rPath), '..');
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
