import * as vscode from 'vscode';
import { ArkSidecarManager } from '../ark/sidecarManager';
import { DataExplorerSession, DEFAULT_FORMAT_OPTIONS } from './dataExplorerSession';
import { getNonce, isDebugLoggingEnabled } from '../util';
import { getLogger, LogCategory } from '../logging/logger';
import {
    BackendState,
    ColumnSelection,
    TableSchema,
} from './protocol';
import { DataExplorerMessageHandler, type DataExplorerPanelContext } from './dataExplorerMessageHandler';

type RowRangeRequest = {
    startIndex: number;
    endIndex: number;
};

const INITIAL_ROW_BLOCK_SIZE = 200;

class DataExplorerPanel implements vscode.Disposable {
    private readonly panel: vscode.WebviewPanel;
    readonly session: DataExplorerSession;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly messageHandler: DataExplorerMessageHandler;
    state: BackendState | undefined;
    schema: TableSchema | undefined;
    sortInFlight = false;
    filterInFlight = false;
    exportInFlight = false;
    readonly pendingProfileCallbacks = new Map<string, { columnIndex: number }>();
    private pendingRanges: RowRangeRequest[] = [];
    private requestInFlight = false;
    private disposed = false;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly sidecarManager: ArkSidecarManager,
        private readonly commId: string,
        private readonly outputChannel: vscode.OutputChannel,
    ) {
        this.panel = vscode.window.createWebviewPanel(
            'krarkodeDataExplorer',
            'Data Explorer',
            { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            },
        );

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
        this.session = new DataExplorerSession(sidecarManager, commId, outputChannel);

        const ctx: DataExplorerPanelContext = {
            session: this.session,
            webview: this.panel.webview,
            get state() { return self.state; },
            set state(v) { self.state = v; },
            get schema() { return self.schema; },
            set schema(v) { self.schema = v; },
            get sortInFlight() { return self.sortInFlight; },
            set sortInFlight(v) { self.sortInFlight = v; },
            get filterInFlight() { return self.filterInFlight; },
            set filterInFlight(v) { self.filterInFlight = v; },
            get exportInFlight() { return self.exportInFlight; },
            set exportInFlight(v) { self.exportInFlight = v; },
            pendingProfileCallbacks: this.pendingProfileCallbacks,
            log: (msg) => this.log(msg),
            initialize: () => this.initialize(),
        };
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- needed for getter/setter delegation in ctx
        const self = this;
        this.messageHandler = new DataExplorerMessageHandler(ctx);

        this.disposables.push(
            this.panel.onDidDispose(() => this.cleanup()),
            this.panel.webview.onDidReceiveMessage((message) => {
                // Handle row requests directly (they use the panel's queue)
                if (message.type === 'requestRows' && typeof message.startIndex === 'number' && typeof message.endIndex === 'number') {
                    void this.enqueueRowRequest({
                        startIndex: message.startIndex,
                        endIndex: message.endIndex,
                    });
                    return;
                }
                this.messageHandler.handleWebviewMessage(message);
            }),
            this.session.onDidReceiveEvent((event) => {
                if (event.method === 'schema_update' || event.method === 'data_update') {
                    this.log(`Received ${event.method}; refreshing.`);
                    void this.initialize();
                    return;
                }
                if (event.method === 'return_column_profiles') {
                    this.messageHandler.handleReturnColumnProfiles(event.params);
                }
            }),
        );
    }

    get webview(): vscode.Webview {
        return this.panel.webview;
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

    async initialize(): Promise<void> {
        try {
            this.log(`Initializing data explorer for comm ${this.commId}.`);
            const state = await this.session.getState();
            this.applyRowFilterConditionSupport(state);
            this.state = state;
            this.panel.title = state.display_name ? `Data: ${state.display_name}` : 'Data Explorer';

            const columnCount = state.table_shape.num_columns;
            const columnIndices = Array.from({ length: columnCount }, (_, index) => index);
            const schema = await this.session.getSchema(columnIndices);
            this.schema = schema;

            this.pendingRanges = [];
            this.requestInFlight = false;

            void this.panel.webview.postMessage({
                type: 'init',
                state,
                schema: schema.columns,
                formatOptions: DEFAULT_FORMAT_OPTIONS,
            });

            if (state.table_shape.num_rows > 0) {
                const endIndex = Math.min(state.table_shape.num_rows - 1, INITIAL_ROW_BLOCK_SIZE - 1);
                this.log(`Queueing initial rows ${0}-${endIndex} after init.`);
                void this.enqueueRowRequest({
                    startIndex: 0,
                    endIndex,
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.log(`Failed to initialize data explorer: ${message}`);
            void this.panel.webview.postMessage({
                type: 'error',
                message,
            });
        }
    }

    private async enqueueRowRequest(range: RowRangeRequest): Promise<void> {
        this.pendingRanges = this.mergeRowRanges(this.pendingRanges, range);
        this.log(`Queued row request ${range.startIndex}-${range.endIndex}; pending=${this.pendingRanges.length}.`);
        if (this.requestInFlight) {
            return;
        }

        while (this.pendingRanges.length > 0) {
            const next = this.pendingRanges.shift();
            if (!next) {
                break;
            }
            this.requestInFlight = true;
            await this.fetchRows(next);
            this.requestInFlight = false;
        }
    }

    private mergeRowRanges(existing: RowRangeRequest[], next: RowRangeRequest): RowRangeRequest[] {
        const merged = [...existing, next].sort((a, b) => a.startIndex - b.startIndex);
        if (merged.length <= 1) {
            return merged;
        }
        const result: RowRangeRequest[] = [];
        for (const range of merged) {
            const last = result[result.length - 1];
            if (!last || range.startIndex > last.endIndex + 1) {
                result.push({ ...range });
                continue;
            }
            last.endIndex = Math.max(last.endIndex, range.endIndex);
        }
        return result;
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
            this.log(`Rows delivered to webview ${startIndex}-${endIndex}.`);
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
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'html', 'dataExplorer', 'dataExplorer.js'),
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'html', 'dataExplorer', 'dataExplorer.css'),
        );
        const nonce = getNonce();
        const debugEnabled = isDebugLoggingEnabled('ui');

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <title>Data Explorer</title>
            </head>
            <body>
                <div id="svelte-root"></div>
                <script nonce="${nonce}">window.__krarkodeDebug = ${debugEnabled ? 'true' : 'false'};</script>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    log(message: string): void {
        this.outputChannel.appendLine(message);
    }

    private applyRowFilterConditionSupport(state: BackendState): void {
        const rowFilterSupport = state.supported_features?.set_row_filters as
            | { support_status?: string; supports_conditions?: string }
            | undefined;
        if (!rowFilterSupport || rowFilterSupport.support_status !== 'supported') {
            return;
        }
        if (rowFilterSupport.supports_conditions === 'unsupported') {
            rowFilterSupport.supports_conditions = 'supported';
            this.log('Row filter conditions reported unsupported; enabling AND/OR support in UI.');
        }
    }
}

export class DataExplorerManager implements vscode.Disposable {
    private readonly panels = new Map<string, DataExplorerPanel>();
    private readonly outputChannel = getLogger().createChannel('ui', LogCategory.DataExplorer);

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly sidecarManager: ArkSidecarManager,
    ) {}

    open(commId: string, data?: unknown): void {
        if (!isDataExplorerMetadata(data)) {
            this.outputChannel.appendLine(`Ignoring data explorer comm_open ${commId}; missing dataset metadata.`);
            return;
        }
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

function isDataExplorerMetadata(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return typeof record.title === 'string' && record.title.length > 0;
}
