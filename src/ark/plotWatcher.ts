import * as cp from 'child_process';
import * as fs from 'fs';
import * as readline from 'readline';
import * as vscode from 'vscode';
import * as util from '../util';

interface SidecarEvent {
    event: 'display_data' | 'update_display_data' | 'error' | 'httpgd_url' | 'comm_open' | 'comm_msg' | 'comm_close' | 'ui_comm_open' | 'show_html_file';
    data?: unknown;
    display_id?: string | null;
    message?: string;
    url?: string;
    comm_id?: string;
}

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
    private readonly outputChannel = vscode.window.createOutputChannel('Ark Sidecar');

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

    constructor(
        private readonly resolveSidecarPath: () => string,
        private readonly getTimeoutMs: () => number
    ) {}

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
            this.outputChannel.appendLine(`[sidecar] Cannot send comm: no process`);
            return;
        }
        const msg = { command: 'comm_msg', comm_id: commId, data };
        try {
            const msgStr = JSON.stringify(msg);
            this.outputChannel.appendLine(`[sidecar] Sending comm_msg to ${commId}: ${msgStr.slice(0, 200)}`);
            this.proc.stdin.write(msgStr + '\n');
        } catch (error) {
            this.outputChannel.appendLine(`[sidecar] Failed to send comm message: ${error}`);
        }
    }

    dispose(): void {
        this.stop();
        this.outputChannel.dispose();
        this._onDidOpenPlotComm.dispose();
        this._onDidReceiveCommMessage.dispose();
        this._onDidClosePlotComm.dispose();
        this._onDidReceiveHttpgdUrl.dispose();
        this._onDidShowHtmlFile.dispose();
        this._onDidReceivePlotData.dispose();
    }

    private start(connectionFile: string): void {
        const sidecarPath = this.resolveSidecarPath();
        const timeoutMs = this.getTimeoutMs();
        const args = ['--watch-plot', '--connection-file', connectionFile, '--timeout-ms', String(timeoutMs)];
        const proc = cp.spawn(sidecarPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        this.proc = proc;

        proc.on('error', (err) => {
            this.outputChannel.appendLine(`Failed to spawn sidecar: ${err.message}`);
        });

        proc.stderr?.on('data', (chunk: Buffer) => {
            this.outputChannel.appendLine(`[sidecar] ${chunk.toString().trim()}`);
        });

        const rl = readline.createInterface({ input: proc.stdout });
        this.rl = rl;
        rl.on('line', (line) => {
            void this.handleLine(line);
        });

        proc.on('exit', (code, signal) => {
            if (signal) {
                this.outputChannel.appendLine(`Sidecar exited with signal ${signal}.`);
            } else {
                this.outputChannel.appendLine(`Sidecar exited with code ${code ?? 'null'}.`);
            }
        });
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
            this.outputChannel.appendLine(`[sidecar] ${trimmed}`);
            return;
        }

        if (msg.event === 'error') {
            this.outputChannel.appendLine(`Sidecar error: ${msg.message ?? 'unknown error'}`);
            return;
        }

        if (msg.event === 'httpgd_url' && msg.url) {
            this._onDidReceiveHttpgdUrl.fire(msg.url);
            return;
        }

        if (msg.event === 'comm_open') {
            if (msg.comm_id) {
                this._onDidOpenPlotComm.fire({ commId: msg.comm_id, data: msg.data });
            }
            return;
        }

        if (msg.event === 'comm_msg') {
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
                this.outputChannel.appendLine(`Failed to read plot file: ${filePath}`);
                return undefined;
            }
        }

        return payload.replace(/\s+/g, '');
    }
}
