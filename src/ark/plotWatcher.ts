import * as cp from 'child_process';
import * as fs from 'fs';
import * as readline from 'readline';
import * as vscode from 'vscode';
import * as util from '../util';

interface SidecarEvent {
    event: 'display_data' | 'update_display_data' | 'error' | 'httpgd_url' | 'comm_open' | 'comm_msg' | 'comm_close';
    data?: unknown;
    display_id?: string | null;
    message?: string;
    url?: string;
    comm_id?: string;
}

export class ArkSidecarManager implements vscode.Disposable {
    private proc: cp.ChildProcessWithoutNullStreams | undefined;
    private rl: readline.Interface | undefined;
    private connectionFile: string | undefined;
    private readonly outputChannel = vscode.window.createOutputChannel('Ark Sidecar');
    private readonly viewer = new ArkPlotViewer();

    private readonly _onDidOpenPlotComm = new vscode.EventEmitter<{ commId: string; data: unknown }>();
    public readonly onDidOpenPlotComm = this._onDidOpenPlotComm.event;

    private readonly _onDidReceiveCommMessage = new vscode.EventEmitter<{ commId: string; data: unknown }>();
    public readonly onDidReceiveCommMessage = this._onDidReceiveCommMessage.event;

    private readonly _onDidClosePlotComm = new vscode.EventEmitter<{ commId: string }>();
    public readonly onDidClosePlotComm = this._onDidClosePlotComm.event;

    private readonly _onDidReceiveHttpgdUrl = new vscode.EventEmitter<string>();
    public readonly onDidReceiveHttpgdUrl = this._onDidReceiveHttpgdUrl.event;

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
            return;
        }
        const msg = { command: 'comm_msg', comm_id: commId, data };
        try {
            this.proc.stdin.write(JSON.stringify(msg) + '\n');
        } catch (error) {
            this.outputChannel.appendLine(`Failed to send comm message: ${error}`);
        }
    }

    dispose(): void {
        this.stop();
        this.outputChannel.dispose();
        this.viewer.dispose();
        this._onDidOpenPlotComm.dispose();
        this._onDidReceiveCommMessage.dispose();
        this._onDidClosePlotComm.dispose();
        this._onDidReceiveHttpgdUrl.dispose();
    }

    private start(connectionFile: string): void {
        const sidecarPath = this.resolveSidecarPath();
        const timeoutMs = this.getTimeoutMs();
        const args = ['--watch-plot', '--connection-file', connectionFile, '--timeout-ms', String(timeoutMs)];
        const proc = cp.spawn(sidecarPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        this.proc = proc;

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

        if (!msg.data) {
            return;
        }

        const base64 = await this.normalizePngData(msg.data as string);
        if (!base64) {
            return;
        }

        this.viewer.updatePlot(base64, msg.display_id ?? undefined);
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

class ArkPlotViewer implements vscode.Disposable {
    private panels = new Map<string, vscode.WebviewPanel>();
    private readonly defaultDisplayId = 'latest';

    public updatePlot(base64: string, displayId?: string): void {
        const configured = util.config().get<string>('krarkode.plot.viewColumn');
        if (configured === 'Disable') {
            return;
        }

        const id = displayId ?? this.defaultDisplayId;
        const panel = this.getOrCreatePanel(id);
        panel.webview.html = this.renderHtml(base64);
        panel.reveal(this.getViewColumn(), true);
    }

    dispose(): void {
        for (const panel of this.panels.values()) {
            panel.dispose();
        }
        this.panels.clear();
    }

    private getViewColumn(): vscode.ViewColumn {
        const configured = util.config().get<string>('krarkode.plot.viewColumn');
        return this.asViewColumn(configured, vscode.ViewColumn.Two);
    }

    private asViewColumn(value: string | undefined, defaultColumn: vscode.ViewColumn): vscode.ViewColumn {
        switch (value) {
            case 'Active':
                return vscode.ViewColumn.Active;
            case 'Beside':
                return vscode.ViewColumn.Beside;
            case 'One':
                return vscode.ViewColumn.One;
            case 'Two':
                return vscode.ViewColumn.Two;
            case 'Three':
                return vscode.ViewColumn.Three;
            default:
                return defaultColumn;
        }
    }

    private getOrCreatePanel(displayId: string): vscode.WebviewPanel {
        const existing = this.panels.get(displayId);
        if (existing) {
            return existing;
        }
        const viewColumn = this.getViewColumn();
        const title = displayId === this.defaultDisplayId ? 'Ark Plot' : `Ark Plot (${displayId})`;
        const panel = vscode.window.createWebviewPanel(
            'arkPlot',
            title,
            {
                preserveFocus: true,
                viewColumn,
            },
            {
                enableScripts: true,
                enableFindWidget: true,
                retainContextWhenHidden: true,
            }
        );
        panel.onDidDispose(() => {
            this.panels.delete(displayId);
        });
        this.panels.set(displayId, panel);
        return panel;
    }

    private renderHtml(base64: string): string {
        return `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            margin: 0;
            padding: 0;
            background: var(--vscode-editor-background);
        }
        img {
            display: block;
            max-width: 100%;
            max-height: 100vh;
            margin: 0 auto;
        }
    </style>
</head>
<body>
    <img src="data:image/png;base64,${base64}" />
</body>
</html>`;
    }
}
