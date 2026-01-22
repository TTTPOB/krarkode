import * as vscode from 'vscode';
import { ArkSidecarManager } from '../ark/sidecarManager';
import { DataExplorerSession, DEFAULT_FORMAT_OPTIONS } from './dataExplorerSession';
import { BackendState, ColumnSelection, TableSchema } from './protocol';

type RowRangeRequest = {
    startIndex: number;
    endIndex: number;
};

class DataExplorerPanel implements vscode.Disposable {
    private readonly panel: vscode.WebviewPanel;
    private readonly session: DataExplorerSession;
    private readonly disposables: vscode.Disposable[] = [];
    private state: BackendState | undefined;
    private schema: TableSchema | undefined;
    private pendingRange: RowRangeRequest | undefined;
    private requestInFlight = false;
    private disposed = false;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly sidecarManager: ArkSidecarManager,
        private readonly commId: string,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.panel = vscode.window.createWebviewPanel(
            'krarkodeDataExplorer',
            'Data Explorer',
            { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            }
        );

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
        this.session = new DataExplorerSession(sidecarManager, commId, outputChannel);

        this.disposables.push(
            this.panel.onDidDispose(() => this.cleanup()),
            this.panel.webview.onDidReceiveMessage((message) => this.handleWebviewMessage(message)),
            this.session.onDidReceiveEvent((event) => {
                if (event.method === 'schema_update' || event.method === 'data_update') {
                    this.log(`Received ${event.method}; refreshing.`);
                    void this.initialize();
                }
            })
        );
    }

    reveal(): void {
        this.panel.reveal();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.panel.dispose();
        this.cleanup();
    }

    private cleanup(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.disposables.forEach((item) => item.dispose());
        this.disposables.length = 0;
        this.session.dispose();
    }

    private async initialize(): Promise<void> {
        try {
            this.log(`Initializing data explorer for comm ${this.commId}.`);
            const state = await this.session.getState();
            this.state = state;
            this.panel.title = state.display_name ? `Data: ${state.display_name}` : 'Data Explorer';

            const columnCount = state.table_shape.num_columns;
            const columnIndices = Array.from({ length: columnCount }, (_, index) => index);
            const schema = await this.session.getSchema(columnIndices);
            this.schema = schema;

            this.pendingRange = undefined;
            this.requestInFlight = false;

            void this.panel.webview.postMessage({
                type: 'init',
                state,
                schema: schema.columns,
                formatOptions: DEFAULT_FORMAT_OPTIONS,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.log(`Failed to initialize data explorer: ${message}`);
            void this.panel.webview.postMessage({
                type: 'error',
                message,
            });
        }
    }

    private handleWebviewMessage(message: { type?: string; [key: string]: unknown }): void {
        switch (message.type) {
            case 'ready':
                void this.initialize();
                return;
            case 'refresh':
                void this.initialize();
                return;
            case 'requestRows':
                if (typeof message.startIndex === 'number' && typeof message.endIndex === 'number') {
                    void this.enqueueRowRequest({
                        startIndex: message.startIndex,
                        endIndex: message.endIndex,
                    });
                }
                return;
        }
    }

    private async enqueueRowRequest(range: RowRangeRequest): Promise<void> {
        this.pendingRange = range;
        if (this.requestInFlight) {
            this.log(`Queued row request ${range.startIndex}-${range.endIndex}.`);
            return;
        }

        while (this.pendingRange) {
            const next = this.pendingRange;
            this.pendingRange = undefined;
            this.requestInFlight = true;
            await this.fetchRows(next);
            this.requestInFlight = false;
        }
    }

    private async fetchRows(range: RowRangeRequest): Promise<void> {
        if (!this.state || !this.schema) {
            return;
        }

        const totalRows = this.state.table_shape.num_rows;
        const startIndex = Math.max(0, range.startIndex);
        const endIndex = Math.min(range.endIndex, Math.max(totalRows - 1, 0));
        if (endIndex < startIndex) {
            return;
        }

        const selection = {
            first_index: startIndex,
            last_index: endIndex,
        };
        const columns: ColumnSelection[] = this.schema.columns.map((column) => ({
            column_index: column.column_index,
            spec: selection,
        }));

        this.log(`Requesting rows ${startIndex}-${endIndex}.`);

        try {
            const data = await this.session.getDataValues(columns, DEFAULT_FORMAT_OPTIONS);
            let rowLabels: string[] | undefined;
            if (this.state.has_row_labels) {
                const labels = await this.session.getRowLabels(selection, DEFAULT_FORMAT_OPTIONS);
                rowLabels = labels.row_labels[0] ?? [];
            }

            void this.panel.webview.postMessage({
                type: 'rows',
                startIndex,
                endIndex,
                columns: data.columns,
                rowLabels: rowLabels ?? [],
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.log(`Failed to fetch rows: ${message}`);
            void this.panel.webview.postMessage({
                type: 'error',
                message,
            });
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'html', 'dataExplorer', 'dataExplorer.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'src', 'html', 'dataExplorer', 'dataExplorer.css')
        );
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <title>Data Explorer</title>
            </head>
            <body>
                <div class="toolbar">
                    <div class="title" id="table-title">Data Explorer</div>
                    <div class="meta" id="table-meta"></div>
                    <button class="action" id="refresh-btn">Refresh</button>
                </div>
                <div class="table-container">
                    <div class="table-header" id="table-header"></div>
                    <div class="table-body" id="table-body"></div>
                </div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private log(message: string): void {
        this.outputChannel.appendLine(message);
    }
}

export class DataExplorerManager implements vscode.Disposable {
    private readonly panels = new Map<string, DataExplorerPanel>();
    private readonly outputChannel = vscode.window.createOutputChannel('Ark Data Explorer');

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly sidecarManager: ArkSidecarManager
    ) {}

    open(commId: string): void {
        const existing = this.panels.get(commId);
        if (existing) {
            existing.reveal();
            return;
        }

        this.outputChannel.appendLine(`Opening data explorer for comm ${commId}.`);
        const panel = new DataExplorerPanel(this.extensionUri, this.sidecarManager, commId, this.outputChannel);
        this.panels.set(commId, panel);
    }

    dispose(): void {
        for (const panel of this.panels.values()) {
            panel.dispose();
        }
        this.panels.clear();
        this.outputChannel.dispose();
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
