import * as fs from 'fs';
import * as path from 'path';
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
import { getActiveSessionName, getSessionDir } from '../ark/sessionRegistry';

type RowRangeRequest = {
    startIndex: number;
    endIndex: number;
};

const INITIAL_ROW_BLOCK_SIZE = 200;
/** How long to wait for R session to reconnect before disposing restored panels. */
const RESTORE_TIMEOUT_MS = 60_000;

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
    /** Display name of the dataset (used for persistence and reconnect matching). */
    public displayName: string | undefined;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly sidecarManager: ArkSidecarManager,
        private readonly commId: string,
        private readonly outputChannel: vscode.OutputChannel,
        existingPanel?: vscode.WebviewPanel,
    ) {
        if (existingPanel) {
            this.panel = existingPanel;
            // Restored panel shell — set proper webview options
            this.panel.webview.options = {
                enableScripts: true,
                localResourceRoots: [extensionUri],
            };
        } else {
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
        }

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
            this.displayName = state.display_name ?? this.displayName;
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

interface RestoredPanel {
    panel: vscode.WebviewPanel;
    displayName: string;
    timeout: NodeJS.Timeout;
}

interface PersistedPanelEntry {
    displayName: string;
}

export class DataExplorerManager implements vscode.Disposable {
    private readonly panels = new Map<string, DataExplorerPanel>();
    private readonly outputChannel = getLogger().createChannel('ui', LogCategory.DataExplorer);
    private readonly restoredPanels = new Map<string, RestoredPanel>();
    private sessionName: string | undefined;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly sidecarManager: ArkSidecarManager,
    ) {
        this.sessionName = getActiveSessionName();
    }

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

        const displayName = (data as Record<string, unknown>).title as string;
        this.outputChannel.appendLine(`Opening data explorer for comm ${commId} (${displayName}).`);

        // Check if there's a restored panel waiting for this dataset
        let existingPanel: vscode.WebviewPanel | undefined;
        const restored = this.restoredPanels.get(displayName);
        if (restored) {
            this.outputChannel.appendLine(
                `Reconnecting restored panel for "${displayName}" to comm ${commId}.`,
            );
            clearTimeout(restored.timeout);
            existingPanel = restored.panel;
            this.restoredPanels.delete(displayName);
        }

        const panel = new DataExplorerPanel(
            this.extensionUri,
            this.sidecarManager,
            commId,
            this.outputChannel,
            existingPanel,
        );
        panel.displayName = displayName;
        this.panels.set(commId, panel);
        this.scheduleSavePanelList();
    }

    /**
     * Restore a panel that VS Code deserialized after window reload.
     * Shows a placeholder until the R session reconnects and sends comm_open.
     */
    restorePanel(panel: vscode.WebviewPanel, state: unknown): void {
        const displayName = extractDisplayName(state);
        if (!displayName) {
            this.outputChannel.appendLine('Restored data explorer panel has no displayName; disposing.');
            panel.dispose();
            return;
        }

        this.outputChannel.appendLine(
            `Restoring data explorer placeholder for "${displayName}".`,
        );

        // Set placeholder HTML
        panel.webview.options = { enableScripts: false };
        panel.title = `Data: ${displayName}`;
        panel.webview.html = this.getPlaceholderHtml(displayName);

        // Set up timeout to dispose if session doesn't reconnect
        const timeout = setTimeout(() => {
            if (this.restoredPanels.has(displayName)) {
                this.outputChannel.appendLine(
                    `Restore timeout for "${displayName}"; disposing placeholder.`,
                );
                this.restoredPanels.delete(displayName);
                panel.dispose();
            }
        }, RESTORE_TIMEOUT_MS);

        panel.onDidDispose(() => {
            clearTimeout(timeout);
            this.restoredPanels.delete(displayName);
        });

        this.restoredPanels.set(displayName, { panel, displayName, timeout });
    }

    /**
     * Re-open restored data explorer panels by executing View() in R.
     * Called when the kernel becomes idle after session reconnect.
     * Sends execute_request through the sidecar so it runs in the background
     * without interfering with the user's active terminal.
     */
    reopenRestoredPanels(): void {
        if (this.restoredPanels.size === 0) {
            return;
        }
        const names = Array.from(this.restoredPanels.keys());
        this.outputChannel.appendLine(
            `Kernel ready — requesting View() for ${names.length} restored panel(s): ${names.join(', ')}`,
        );
        for (const displayName of names) {
            this.sidecarManager.sendExecuteRequest(`View(${displayName})`);
        }
    }

    /** Switch to a different session's data explorer state. */
    switchSession(newSessionName: string | undefined): void {
        if (newSessionName && newSessionName === this.sessionName) {
            return;
        }
        // Save current session's panel list before switching
        this.savePanelListSync();

        // Dispose all restored placeholder panels from previous session
        for (const [, restored] of this.restoredPanels) {
            clearTimeout(restored.timeout);
            restored.panel.dispose();
        }
        this.restoredPanels.clear();

        // Dispose live panels — their comm channels are invalidated on session switch
        for (const panel of this.panels.values()) {
            panel.dispose();
        }
        this.panels.clear();

        this.sessionName = newSessionName;

        // Restore placeholder panels from the new session's persisted state
        this.loadAndRestorePanels();
    }

    /**
     * Load the new session's persisted panel list and create placeholder panels
     * that will be reconnected when the kernel sends comm_open via View().
     */
    private loadAndRestorePanels(): void {
        const listPath = this.getPanelListPath();
        if (!listPath) {
            return;
        }
        try {
            if (!fs.existsSync(listPath)) {
                return;
            }
            const content = fs.readFileSync(listPath, 'utf8');
            const entries = JSON.parse(content) as PersistedPanelEntry[];
            if (!Array.isArray(entries) || entries.length === 0) {
                return;
            }
            this.outputChannel.appendLine(
                `Loading ${entries.length} persisted data explorer panel(s) for session "${this.sessionName}"`,
            );
            for (const entry of entries) {
                if (!entry.displayName) {
                    continue;
                }
                const panel = vscode.window.createWebviewPanel(
                    'krarkodeDataExplorer',
                    `Data: ${entry.displayName}`,
                    { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
                    { enableScripts: false },
                );
                panel.webview.html = this.getPlaceholderHtml(entry.displayName);

                const timeout = setTimeout(() => {
                    if (this.restoredPanels.has(entry.displayName)) {
                        this.outputChannel.appendLine(
                            `Restore timeout for "${entry.displayName}"; disposing placeholder.`,
                        );
                        this.restoredPanels.delete(entry.displayName);
                        panel.dispose();
                    }
                }, RESTORE_TIMEOUT_MS);

                panel.onDidDispose(() => {
                    clearTimeout(timeout);
                    this.restoredPanels.delete(entry.displayName);
                });

                this.restoredPanels.set(entry.displayName, { panel, displayName: entry.displayName, timeout });
            }
        } catch (err) {
            this.outputChannel.appendLine(`Failed to load persisted panel list: ${String(err)}`);
        }
    }

    dispose(): void {
        this.savePanelListSync();
        for (const panel of this.panels.values()) {
            panel.dispose();
        }
        this.panels.clear();
        for (const [, restored] of this.restoredPanels) {
            clearTimeout(restored.timeout);
            restored.panel.dispose();
        }
        this.restoredPanels.clear();
        this.outputChannel.dispose();
    }

    // -- Panel list persistence --

    private getPanelListPath(): string | undefined {
        if (!this.sessionName) {
            return undefined;
        }
        return path.join(getSessionDir(this.sessionName), 'data-explorer.json');
    }

    private saveTimeout?: NodeJS.Timeout;

    private scheduleSavePanelList(): void {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            this.saveTimeout = undefined;
            this.savePanelListSync();
        }, 500);
    }

    private savePanelListSync(): void {
        const listPath = this.getPanelListPath();
        if (!listPath) {
            return;
        }
        try {
            const entries: PersistedPanelEntry[] = [];
            for (const panel of this.panels.values()) {
                if (panel.displayName) {
                    entries.push({ displayName: panel.displayName });
                }
            }
            if (entries.length === 0) {
                if (fs.existsSync(listPath)) {
                    fs.unlinkSync(listPath);
                }
                return;
            }
            fs.writeFileSync(listPath, JSON.stringify(entries));
        } catch (err) {
            getLogger().log('ui', LogCategory.DataExplorer, 'warn',
                `Failed to save data explorer panel list: ${String(err)}`);
        }
    }

    private getPlaceholderHtml(displayName: string): string {
        const escaped = displayName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Data: ${escaped}</title>
    <style>
        body {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            font-family: var(--vscode-font-family, sans-serif);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .placeholder {
            text-align: center;
            opacity: 0.7;
        }
        .spinner {
            width: 24px;
            height: 24px;
            border: 3px solid var(--vscode-editorWidget-border, #555);
            border-top-color: var(--vscode-textLink-foreground, #007acc);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 12px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="placeholder">
        <div class="spinner"></div>
        <div>Waiting for R session to reconnect…</div>
        <div style="margin-top:4px;font-size:0.9em;opacity:0.6">${escaped}</div>
    </div>
</body>
</html>`;
    }
}

function isDataExplorerMetadata(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return typeof record.title === 'string' && record.title.length > 0;
}

function extractDisplayName(state: unknown): string | undefined {
    if (typeof state !== 'object' || state === null) {
        return undefined;
    }
    const record = state as Record<string, unknown>;
    if (typeof record.displayName === 'string' && record.displayName.length > 0) {
        return record.displayName;
    }
    return undefined;
}
