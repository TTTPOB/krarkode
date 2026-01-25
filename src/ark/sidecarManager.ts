import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as vscode from 'vscode';
import * as util from '../util';
import { getLogger, isDebugLoggingEnabled, type LogLevel } from '../logging/logger';
import { formatSidecarLogLevel, getArkLogLevel } from './arkLogLevel';
import * as sessionRegistry from './sessionRegistry';

interface SidecarEvent {
    event: 'display_data' | 'update_display_data' | 'error' | 'httpgd_url' | 'comm_open' | 'comm_msg' | 'comm_close' | 'ui_comm_open' | 'show_html_file' | 'help_comm_open' | 'show_help' | 'variables_comm_open' | 'data_explorer_comm_open' | 'kernel_status';
    data?: unknown;
    display_id?: string | null;
    message?: string;
    url?: string;
    comm_id?: string;
    status?: string;
}

const VARIABLES_COMM_TARGET = 'positron.variables';
const SIDECAR_LOG_RELOAD_COMMAND = 'reload_log_level';
const SIDECAR_LOG_LEVEL_RE = /\b(TRACE|DEBUG|INFO|WARN|ERROR)\b/;

export interface ShowHtmlFileParams {
    path: string;
    title: string;
    destination: 'plot' | 'viewer' | 'editor';
    height: number;
}

export interface PlotDataParams {
    base64Data: string;
    mimeType: string;
    displayId?: string;
}

export class ArkSidecarManager implements vscode.Disposable {
    private proc: cp.ChildProcessWithoutNullStreams | undefined;
    private rl: readline.Interface | undefined;
    private connectionFile: string | undefined;
    private readonly outputChannel = getLogger().createChannel('sidecar');
    private readonly disposables: vscode.Disposable[] = [];
    private variablesCommId: string | undefined;

    private readonly _onDidOpenPlotComm = new vscode.EventEmitter<{ commId: string; data: unknown }>();
    public readonly onDidOpenPlotComm = this._onDidOpenPlotComm.event;

    private readonly _onDidReceiveCommMessage = new vscode.EventEmitter<{ commId: string; data: unknown }>();
    public readonly onDidReceiveCommMessage = this._onDidReceiveCommMessage.event;

    private readonly _onDidClosePlotComm = new vscode.EventEmitter<{ commId: string }>();
    public readonly onDidClosePlotComm = this._onDidClosePlotComm.event;

    private readonly _onDidReceiveHttpgdUrl = new vscode.EventEmitter<string>();
    public readonly onDidReceiveHttpgdUrl = this._onDidReceiveHttpgdUrl.event;

    private readonly _onDidShowHtmlFile = new vscode.EventEmitter<ShowHtmlFileParams>();
    public readonly onDidShowHtmlFile = this._onDidShowHtmlFile.event;

    private readonly _onDidReceivePlotData = new vscode.EventEmitter<PlotDataParams>();
    public readonly onDidReceivePlotData = this._onDidReceivePlotData.event;

    private readonly _onDidChangeKernelStatus = new vscode.EventEmitter<string>();
    public readonly onDidChangeKernelStatus = this._onDidChangeKernelStatus.event;

    private readonly _onDidStart = new vscode.EventEmitter<void>();
    public readonly onDidStart = this._onDidStart.event;

    private readonly _onDidOpenHelpComm = new vscode.EventEmitter<{ commId: string }>();
    public readonly onDidOpenHelpComm = this._onDidOpenHelpComm.event;

    private readonly _onDidOpenVariablesComm = new vscode.EventEmitter<{ commId: string }>();
    public readonly onDidOpenVariablesComm = this._onDidOpenVariablesComm.event;

    private readonly _onDidOpenDataExplorerComm = new vscode.EventEmitter<{ commId: string; data: unknown }>();
    public readonly onDidOpenDataExplorerComm = this._onDidOpenDataExplorerComm.event;

    private readonly _onDidShowHelp = new vscode.EventEmitter<{ content: string; kind: string; focus: boolean }>();
    public readonly onDidShowHelp = this._onDidShowHelp.event;

    constructor(
        private readonly resolveSidecarPath: () => string,
        private readonly getTimeoutMs: () => number
    ) {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('krarkode.ark.logLevel')) {
                    this.sendLogReload();
                }
            })
        );
    }

    public attach(connectionFile: string): void {
        if (this.connectionFile === connectionFile && this.proc) {
            return;
        }
        this.stop();
        this.connectionFile = connectionFile;
        this.start(connectionFile);
    }

    public stop(): void {
        this.connectionFile = undefined;
        this.variablesCommId = undefined;
        if (this.rl) {
            this.rl.close();
            this.rl = undefined;
        }
        if (this.proc && !this.proc.killed) {
            this.proc.kill('SIGKILL');
        }
        this.proc = undefined;
    }

    public sendCommMessage(commId: string, data: unknown): void {
        if (!this.proc) {
            return;
        }
        const msg = { command: 'comm_msg', comm_id: commId, data };
        try {
            this.proc.stdin.write(JSON.stringify(msg) + '\n');
        } catch (error) {
            this.outputChannel.appendLine(
                this.formatLogMessage(`Failed to send comm message: ${error}`)
            );
        }
    }

    public sendCommOpen(commId: string, targetName: string, data: unknown): void {
        if (!this.proc) {
            return;
        }
        const msg = { command: 'comm_open', comm_id: commId, target_name: targetName, data };
        try {
            this.proc.stdin.write(JSON.stringify(msg) + '\n');
        } catch (error) {
            this.outputChannel.appendLine(
                this.formatLogMessage(`Failed to send comm_open message: ${error}`)
            );
        }
    }

    public sendCommClose(commId: string, data: unknown = {}): void {
        if (!this.proc) {
            return;
        }
        const msg = { command: 'comm_close', comm_id: commId, data };
        try {
            this.proc.stdin.write(JSON.stringify(msg) + '\n');
        } catch (error) {
            this.outputChannel.appendLine(
                this.formatLogMessage(`Failed to send comm_close message: ${error}`)
            );
        }
    }

    public getVariablesCommId(): string | undefined {
        return this.variablesCommId;
    }

    public ensureVariablesCommOpen(): string | undefined {
        if (this.variablesCommId) {
            return this.variablesCommId;
        }

        if (!this.proc) {
            return undefined;
        }

        const commId = crypto.randomUUID();
        this.variablesCommId = commId;
        this.sendCommOpen(commId, VARIABLES_COMM_TARGET, {});
        this._onDidOpenVariablesComm.fire({ commId });
        return commId;
    }

    dispose(): void {
        this.stop();
        this.outputChannel.dispose();
        this.disposables.forEach((disposable) => disposable.dispose());
        this.disposables.length = 0;
        this._onDidOpenPlotComm.dispose();
        this._onDidReceiveCommMessage.dispose();
        this._onDidClosePlotComm.dispose();
        this._onDidReceiveHttpgdUrl.dispose();
        this._onDidShowHtmlFile.dispose();
        this._onDidShowHelp.dispose();
        this._onDidReceivePlotData.dispose();
        this._onDidStart.dispose();
        this._onDidChangeKernelStatus.dispose();
        this._onDidOpenHelpComm.dispose();
        this._onDidOpenVariablesComm.dispose();
        this._onDidOpenDataExplorerComm.dispose();
    }

    private start(connectionFile: string): void {
        const sidecarPath = this.resolveSidecarPath();
        const timeoutMs = this.getTimeoutMs();
        const args = ['--watch-plot', '--connection-file', connectionFile, '--timeout-ms', String(timeoutMs)];
        const proc = cp.spawn(sidecarPath, args, { stdio: ['pipe', 'pipe', 'pipe'], env: this.buildSidecarEnv() });
        this.proc = proc;

        proc.on('error', (err) => {
            this.outputChannel.appendLine(
                this.formatLogMessage(`Failed to spawn sidecar: ${err.message}`)
            );
        });

        if (proc.pid) {
            this._onDidStart.fire();
        } else {
            this.outputChannel.appendLine(this.formatLogMessage('Sidecar spawn failed (no PID)'));
        }

        proc.stderr?.on('data', (chunk: Buffer) => {
            const lines = chunk
                .toString()
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0);
            for (const line of lines) {
                this.logSidecarStderr(line);
            }
        });

        const rl = readline.createInterface({ input: proc.stdout });
        this.rl = rl;
        rl.on('line', (line) => {
            void this.handleLine(line);
        });

        proc.on('exit', (code, signal) => {
            if (signal) {
                this.outputChannel.appendLine(
                    this.formatLogMessage(`Sidecar exited with signal ${signal}.`)
                );
            } else {
                this.outputChannel.appendLine(
                    this.formatLogMessage(`Sidecar exited with code ${code ?? 'null'}.`)
                );
            }
        });
    }

    private formatLogMessage(message: string): string {
        const segments: string[] = [];
        const sessionName = sessionRegistry.getActiveSessionName();
        if (sessionName) {
            segments.push(`session=${sessionName}`);
        }
        if (this.connectionFile) {
            segments.push(`conn=${path.basename(this.connectionFile)}`);
        }
        if (this.proc?.pid) {
            segments.push(`pid=${this.proc.pid}`);
        }
        if (segments.length === 0) {
            return message;
        }
        return `[${segments.join(' ')}] ${message}`;
    }

    private buildSidecarEnv(): NodeJS.ProcessEnv {
        const env = { ...process.env };
        const logLevel = getArkLogLevel(vscode.workspace.getConfiguration('krarkode.ark'));
        const sidecarLogLevel = formatSidecarLogLevel(logLevel);
        if (sidecarLogLevel) {
            env.ARK_SIDECAR_LOG = sidecarLogLevel;
            env.RUST_LOG = sidecarLogLevel;
            getLogger().debug(
                'sidecar',
                'logging',
                this.formatLogMessage(`Sidecar log level set to ${sidecarLogLevel}.`)
            );
        }
        return env;
    }

    private sendLogReload(): void {
        if (!this.proc) {
            return;
        }
        const msg = { command: SIDECAR_LOG_RELOAD_COMMAND };
        try {
            this.proc.stdin.write(JSON.stringify(msg) + '\n');
            getLogger().debug('sidecar', 'logging', this.formatLogMessage('Sent log reload command to sidecar.'));
        } catch (error) {
            this.outputChannel.appendLine(
                this.formatLogMessage(`Failed to reload sidecar log level: ${error}`)
            );
        }
    }

    private async handleLine(line: string): Promise<void> {
        const trimmed = line.trim();
        if (!trimmed) {
            return;
        }

        let msg: SidecarEvent;
        try {
            msg = JSON.parse(trimmed) as SidecarEvent;
        } catch {
            this.outputChannel.appendLine(this.formatLogMessage(trimmed));
            return;
        }

        if (msg.event === 'error') {
            getLogger().log(
                'sidecar',
                'event',
                'error',
                this.formatLogMessage(`Sidecar error: ${msg.message ?? 'unknown error'}`)
            );
            return;
        }

        if (msg.event === 'httpgd_url' && msg.url) {
            this._onDidReceiveHttpgdUrl.fire(msg.url);
            return;
        }

        if (msg.event === 'kernel_status') {
            const status = typeof msg.status === 'string' ? msg.status : 'unknown';
            this.outputChannel.appendLine(this.formatLogMessage(`Kernel status update: ${status}`));
            this._onDidChangeKernelStatus.fire(status);
            return;
        }

        if (msg.event === 'comm_open') {
            if (msg.comm_id) {
                this._onDidOpenPlotComm.fire({ commId: msg.comm_id, data: msg.data });
            }
            return;
        }

        if (msg.event === 'ui_comm_open') {
            if (msg.comm_id) {
                util.logDebug(`UI comm opened: ${msg.comm_id}`);
            }
            return;
        }

        if (msg.event === 'help_comm_open') {
            if (msg.comm_id) {
                this._onDidOpenHelpComm.fire({ commId: msg.comm_id });
            }
            return;
        }

        if (msg.event === 'variables_comm_open') {
            if (msg.comm_id) {
                if (!this.variablesCommId) {
                    this.variablesCommId = msg.comm_id;
                }
                this._onDidOpenVariablesComm.fire({ commId: msg.comm_id });
            }
            return;
        }

        if (msg.event === 'data_explorer_comm_open') {
            if (msg.comm_id) {
                this._onDidOpenDataExplorerComm.fire({ commId: msg.comm_id, data: msg.data });
            }
            return;
        }

        if (msg.event === 'comm_msg') {
            if (isDebugLoggingEnabled('sidecar')) {
                const payload = JSON.stringify(msg.data);
                getLogger().debug(
                    'sidecar',
                    'comm',
                    this.formatLogMessage(`Received comm_msg ${msg.comm_id ?? 'unknown'}: ${payload}`)
                );
            }
            if (msg.comm_id) {
                this._onDidReceiveCommMessage.fire({ commId: msg.comm_id, data: msg.data });
            }
            return;
        }

        if (msg.event === 'comm_close') {
            if (msg.comm_id) {
                this._onDidClosePlotComm.fire({ commId: msg.comm_id });
            }
            return;
        }

        if (msg.event === 'show_html_file') {
            const data = msg.data as Record<string, unknown> | undefined;
            if (data?.params) {
                const params = data.params as ShowHtmlFileParams;
                this._onDidShowHtmlFile.fire(params);
            }
            return;
        }

        if (msg.event === 'show_help') {
            const data = msg.data as Record<string, unknown> | undefined;
            if (data?.params) {
                const params = data.params as { content: string; kind: string; focus: boolean };
                this._onDidShowHelp.fire(params);
            }
            return;
        }

        if (!msg.data) {
            return;
        }

        const base64 = await this.normalizePngData(msg.data as string);
        if (!base64) {
            return;
        }

        this._onDidReceivePlotData.fire({
            base64Data: base64,
            mimeType: 'image/png',
            displayId: msg.display_id ?? undefined,
        });
    }

    private async normalizePngData(payload: string): Promise<string | undefined> {
        if (!payload) {
            return undefined;
        }

        if (payload.startsWith('data:image/png;base64,')) {
            return payload.slice('data:image/png;base64,'.length);
        }

        const filePath = payload.startsWith('file://')
            ? vscode.Uri.parse(payload).fsPath
            : payload;

        if (fs.existsSync(filePath)) {
            try {
                const content = await fs.promises.readFile(filePath);
                return content.toString('base64');
            } catch (err) {
                this.outputChannel.appendLine(
                    this.formatLogMessage(`Failed to read plot file: ${filePath}`)
                );
                return undefined;
            }
        }

        return payload.replace(/\s+/g, '');
    }

    private logSidecarStderr(message: string): void {
        const level = this.parseSidecarLogLevel(message);
        getLogger().log('sidecar', 'stderr', level, this.formatLogMessage(message));
    }

    private parseSidecarLogLevel(message: string): LogLevel {
        const match = SIDECAR_LOG_LEVEL_RE.exec(message);
        if (!match) {
            return 'info';
        }
        switch (match[1].toLowerCase()) {
            case 'trace':
                return 'trace';
            case 'debug':
                return 'debug';
            case 'warn':
                return 'warn';
            case 'error':
                return 'error';
            default:
                return 'info';
        }
    }
}
