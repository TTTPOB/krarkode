import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as vscode from 'vscode';
import * as util from '../util';
import { formatLogMessage, getLogger, isDebugLoggingEnabled, LogCategory, type LogContext } from '../logging/logger';
import { formatSidecarRustLog, getArkLogLevel } from './arkLogLevel';
import { parseSidecarJsonLog } from './sidecarLogParser';
import type { SidecarEvent } from './sidecarProtocol.generated';
import { SIDECAR_LOG_RELOAD_COMMAND } from './sidecarProtocol';
import * as sessionRegistry from './sessionRegistry';

const VARIABLES_COMM_TARGET = 'positron.variables';
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
        private readonly getTimeoutMs: () => number,
    ) {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('krarkode.ark.logLevel')) {
                    this.sendLogReload();
                }
            }),
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
            getLogger().log(
                'sidecar',
                LogCategory.Comm,
                'error',
                this.formatLogMessage(`Failed to send comm message: ${error}`),
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
            getLogger().log(
                'sidecar',
                LogCategory.Comm,
                'error',
                this.formatLogMessage(`Failed to send comm_open message: ${error}`),
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
            getLogger().log(
                'sidecar',
                LogCategory.Comm,
                'error',
                this.formatLogMessage(`Failed to send comm_close message: ${error}`),
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
            getLogger().log(
                'sidecar',
                LogCategory.Logging,
                'error',
                this.formatLogMessage(`Failed to spawn sidecar: ${err.message}`),
            );
        });

        if (proc.pid) {
            this._onDidStart.fire();
        } else {
            getLogger().log(
                'sidecar',
                LogCategory.Logging,
                'error',
                this.formatLogMessage('Sidecar spawn failed (no PID)'),
            );
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
                getLogger().log(
                    'sidecar',
                    LogCategory.Event,
                    'warn',
                    this.formatLogMessage(`Sidecar exited with signal ${signal}.`),
                );
            } else {
                const level = code === 0 ? 'info' : 'warn';
                getLogger().log(
                    'sidecar',
                    LogCategory.Event,
                    level,
                    this.formatLogMessage(`Sidecar exited with code ${code ?? 'null'}.`),
                );
            }
        });
    }

    private getLogContext(): LogContext {
        return {
            sessionName: sessionRegistry.getActiveSessionName(),
            connectionFile: this.connectionFile,
            pid: this.proc?.pid,
        };
    }

    private formatLogMessage(message: string): string {
        return formatLogMessage(message, this.getLogContext());
    }

    private buildSidecarEnv(): NodeJS.ProcessEnv {
        const env = { ...process.env };
        const logLevel = getArkLogLevel(vscode.workspace.getConfiguration('krarkode.ark'));
        const sidecarRustLog = formatSidecarRustLog(logLevel);
        if (sidecarRustLog) {
            env.RUST_LOG = sidecarRustLog;
            getLogger().debug(
                'sidecar',
                LogCategory.Logging,
                this.formatLogMessage(`Sidecar log level set to ${sidecarRustLog}.`),
            );
        }
        return env;
    }

    private sendLogReload(): void {
        if (!this.proc) {
            return;
        }
        const logLevel = getArkLogLevel(vscode.workspace.getConfiguration('krarkode.ark'));
        const msg = { command: SIDECAR_LOG_RELOAD_COMMAND, log_level: logLevel };
        try {
            this.proc.stdin.write(JSON.stringify(msg) + '\n');
            getLogger().debug(
                'sidecar',
                LogCategory.Logging,
                this.formatLogMessage(`Sent log reload command to sidecar (level: ${logLevel}).`),
            );
        } catch (error) {
            getLogger().log(
                'sidecar',
                LogCategory.Logging,
                'warn',
                this.formatLogMessage(`Failed to reload sidecar log level: ${error}`),
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
            const parsed = JSON.parse(trimmed) as unknown;
            if (!isSidecarEvent(parsed)) {
                this.outputChannel.appendLine(this.formatLogMessage(`Unexpected sidecar message: ${trimmed}`));
                return;
            }
            msg = parsed;
        } catch {
            this.outputChannel.appendLine(this.formatLogMessage(trimmed));
            return;
        }

        if (msg.event === 'error') {
            getLogger().log(
                'sidecar',
                LogCategory.Event,
                'error',
                this.formatLogMessage(`Sidecar error: ${msg.message ?? 'unknown error'}`),
            );
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
                    LogCategory.Comm,
                    this.formatLogMessage(`Received comm_msg ${msg.comm_id ?? 'unknown'}: ${payload}`),
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

        if (msg.event !== 'display_data' && msg.event !== 'update_display_data') {
            return;
        }

        const base64 = await this.normalizePngData(msg.data);
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

        const filePath = payload.startsWith('file://') ? vscode.Uri.parse(payload).fsPath : payload;

        if (fs.existsSync(filePath)) {
            try {
                const content = await fs.promises.readFile(filePath);
                return content.toString('base64');
            } catch (err) {
                getLogger().log(
                    'sidecar',
                    LogCategory.Plot,
                    'error',
                    this.formatLogMessage(`Failed to read plot file: ${filePath}`),
                );
                return undefined;
            }
        }

        return payload.replace(/\s+/g, '');
    }

    private logSidecarStderr(message: string): void {
        const parsed = parseSidecarJsonLog(message);
        if (!parsed) {
            getLogger().debug(
                'sidecar',
                LogCategory.Logging,
                this.formatLogMessage(`Failed to parse sidecar JSON log: ${message}`),
            );
            getLogger().log('sidecar', LogCategory.Stderr, 'info', this.formatLogMessage(message));
            return;
        }
        getLogger().log('sidecar', LogCategory.Stderr, parsed.level, this.formatLogMessage(parsed.message));
    }
}

const SIDECAR_EVENTS = new Set<SidecarEvent['event']>([
    'display_data',
    'update_display_data',
    'error',
    'alive',
    'lsp_port',
    'comm_open',
    'comm_msg',
    'comm_close',
    'ui_comm_open',
    'show_html_file',
    'help_comm_open',
    'show_help',
    'variables_comm_open',
    'data_explorer_comm_open',
    'kernel_status',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isSidecarEvent(value: unknown): value is SidecarEvent {
    if (!isRecord(value)) {
        return false;
    }
    const event = value.event;
    return typeof event === 'string' && SIDECAR_EVENTS.has(event as SidecarEvent['event']);
}
