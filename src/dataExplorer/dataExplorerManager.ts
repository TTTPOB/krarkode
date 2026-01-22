import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ArkSidecarManager } from '../ark/sidecarManager';
import { DataExplorerSession, DEFAULT_FORMAT_OPTIONS } from './dataExplorerSession';
import {
    BackendState,
    ColumnFilter,
    ColumnProfileRequest,
    ColumnProfileType,
    ColumnSelection,
    ColumnSortKey,
    ExportFormat,
    ReturnColumnProfilesParams,
    RowFilter,
    TableSchema,
} from './protocol';

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
    private sortInFlight = false;
    private filterInFlight = false;
    private exportInFlight = false;
    private readonly pendingProfileCallbacks = new Map<string, { columnIndex: number }>();
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
                    return;
                }
                if (event.method === 'return_column_profiles') {
                    this.handleReturnColumnProfiles(event.params);
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
            case 'setSort': {
                const sortKey = this.parseSortKey(message.sortKey);
                void this.applySort(sortKey);
                return;
            }
            case 'searchSchema': {
                const filters = message.filters as ColumnFilter[];
                const sortOrder = message.sortOrder as string;
                void this.searchSchema(filters, sortOrder);
                return;
            }
            case 'setColumnFilters': {
                const filters = message.filters as ColumnFilter[];
                void this.applyColumnFilters(filters);
                return;
            }
            case 'setRowFilters': {
                const filters = message.filters as RowFilter[];
                void this.applyRowFilters(filters);
                return;
            }
            case 'getColumnProfiles': {
                const columnIndex = message.columnIndex as number;
                const profileTypes = message.profileTypes as string[];
                void this.getColumnProfiles(columnIndex, profileTypes);
                return;
            }
            case 'exportData': {
                const format = message.format as ExportFormat;
                void this.exportData(format);
                return;
            }
            case 'convertToCode': {
                const syntax = message.syntax as string;
                void this.convertToCode(syntax);
                return;
            }
            case 'suggestCodeSyntax': {
                void this.suggestCodeSyntax();
                return;
            }
        }
    }

    private parseSortKey(value: unknown): { columnIndex: number; direction: 'asc' | 'desc' } | null {
        if (!value || typeof value !== 'object') {
            return null;
        }
        const candidate = value as { columnIndex?: unknown; direction?: unknown };
        if (typeof candidate.columnIndex !== 'number') {
            return null;
        }
        if (candidate.direction !== 'asc' && candidate.direction !== 'desc') {
            return null;
        }
        return { columnIndex: candidate.columnIndex, direction: candidate.direction };
    }

    private async applySort(sortKey: { columnIndex: number; direction: 'asc' | 'desc' } | null): Promise<void> {
        if (!this.state) {
            return;
        }
        if (!this.isSortSupported()) {
            this.log('Sort request ignored; backend does not support set_sort_columns.');
            return;
        }
        if (this.sortInFlight) {
            this.log('Sort request ignored; sort already in flight.');
            return;
        }

        const sortKeys: ColumnSortKey[] = sortKey
            ? [{ column_index: sortKey.columnIndex, ascending: sortKey.direction === 'asc' }]
            : [];

        const description = sortKey
            ? `column ${sortKey.columnIndex} ${sortKey.direction}`
            : 'cleared';
        this.log(`Applying sort: ${description}.`);

        this.sortInFlight = true;
        try {
            await this.session.setSortColumns(sortKeys);
            await this.initialize();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.log(`Failed to apply sort: ${message}`);
            void this.panel.webview.postMessage({
                type: 'error',
                message,
            });
        } finally {
            this.sortInFlight = false;
        }
    }

    private isSortSupported(): boolean {
        const supportStatus = this.state?.supported_features?.set_sort_columns?.support_status;
        if (!supportStatus) {
            return true;
        }
        return supportStatus === 'supported';
    }

    private isFeatureSupported(featureKey: string): boolean {
        const features = this.state?.supported_features as Record<string, { support_status?: string }> | undefined;
        const supportStatus = features?.[featureKey]?.support_status;
        if (!supportStatus) {
            return true;
        }
        return supportStatus === 'supported';
    }

    private handleReturnColumnProfiles(params: unknown): void {
        if (!params || typeof params !== 'object') {
            this.log('Column profiles response missing params.');
            return;
        }

        const payload = params as ReturnColumnProfilesParams;
        const callbackId = payload.callback_id;
        if (!callbackId) {
            this.log('Column profiles response missing callback_id.');
            return;
        }

        const pending = this.pendingProfileCallbacks.get(callbackId);
        if (!pending) {
            this.log(`Unexpected column profiles callback: ${callbackId}.`);
            return;
        }

        this.pendingProfileCallbacks.delete(callbackId);
        const errorMessage = payload.error_message;
        if (errorMessage) {
            this.log(`Column profiles error: ${errorMessage}`);
        }

        void this.panel.webview.postMessage({
            type: 'columnProfilesResult',
            columnIndex: pending.columnIndex,
            profiles: payload.profiles ?? [],
            errorMessage,
        });
    }

    private async searchSchema(filters: ColumnFilter[], sortOrder: string): Promise<void> {
        if (!this.state) {
            return;
        }
        if (!this.isFeatureSupported('search_schema')) {
            this.log('Search schema ignored; backend does not support search_schema.');
            return;
        }
        const resolvedSortOrder = sortOrder || 'original';
        this.log(`Searching schema with ${filters.length} filters, sort: ${resolvedSortOrder}`);
        try {
            const result = await this.session.searchSchema(filters, resolvedSortOrder);
            void this.panel.webview.postMessage({
                type: 'searchSchemaResult',
                matches: result.matches,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.log(`Failed to search schema: ${message}`);
            void this.panel.webview.postMessage({
                type: 'error',
                message,
            });
        }
    }

    private async applyColumnFilters(filters: ColumnFilter[]): Promise<void> {
        if (!this.state) {
            return;
        }
        if (!this.isFeatureSupported('set_column_filters')) {
            this.log('Column filter request ignored; backend does not support set_column_filters.');
            return;
        }
        if (this.filterInFlight) {
            this.log('Column filter request ignored; filter already in flight.');
            return;
        }
        this.log(`Applying ${filters.length} column filters.`);
        this.filterInFlight = true;
        try {
            await this.session.setColumnFilters(filters);
            await this.initialize();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.log(`Failed to apply column filters: ${message}`);
            void this.panel.webview.postMessage({
                type: 'error',
                message,
            });
        } finally {
            this.filterInFlight = false;
        }
    }

    private async applyRowFilters(filters: RowFilter[]): Promise<void> {
        if (!this.state) {
            return;
        }
        if (!this.isFeatureSupported('set_row_filters')) {
            this.log('Row filter request ignored; backend does not support set_row_filters.');
            return;
        }
        if (this.filterInFlight) {
            this.log('Row filter request ignored; filter already in flight.');
            return;
        }
        this.log(`Applying ${filters.length} row filters.`);
        this.filterInFlight = true;
        try {
            const result = await this.session.setRowFilters(filters);
            this.log(`Row filter applied, ${result.selected_num_rows} rows selected.`);
            await this.initialize();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.log(`Failed to apply row filters: ${message}`);
            void this.panel.webview.postMessage({
                type: 'error',
                message,
            });
        } finally {
            this.filterInFlight = false;
        }
    }

    private async getColumnProfiles(columnIndex: number, profileTypes: string[]): Promise<void> {
        if (!this.state) {
            return;
        }
        if (!this.isFeatureSupported('get_column_profiles')) {
            this.log('Column profiles request ignored; backend does not support get_column_profiles.');
            return;
        }
        if (profileTypes.length === 0) {
            this.log('Column profiles request ignored; no profile types selected.');
            void this.panel.webview.postMessage({
                type: 'error',
                message: 'Please select at least one profile type.',
            });
            return;
        }
        this.log(`Getting column profiles for column ${columnIndex}: ${profileTypes.join(', ')}`);
        const callbackId = crypto.randomUUID();
        const profiles: ColumnProfileRequest[] = [{
            column_index: columnIndex,
            profiles: profileTypes.map((pt) => ({ profile_type: pt as ColumnProfileType })),
        }];
        try {
            this.pendingProfileCallbacks.set(callbackId, { columnIndex });
            await this.session.getColumnProfiles(callbackId, profiles, DEFAULT_FORMAT_OPTIONS);
        } catch (error) {
            this.pendingProfileCallbacks.delete(callbackId);
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.log(`Failed to get column profiles: ${message}`);
            void this.panel.webview.postMessage({
                type: 'error',
                message,
            });
        }
    }

    private async exportData(format: ExportFormat): Promise<void> {
        if (!this.state) {
            return;
        }
        if (!this.isFeatureSupported('export_data_selection')) {
            this.log('Export request ignored; backend does not support export_data_selection.');
            return;
        }
        if (this.exportInFlight) {
            this.log('Export request ignored; export already in flight.');
            return;
        }
        if (this.state.table_shape.num_rows === 0) {
            this.log('Export request ignored; table has no rows.');
            void this.panel.webview.postMessage({
                type: 'error',
                message: 'No rows available to export.',
            });
            return;
        }
        this.log(`Exporting data as ${format}.`);
        this.exportInFlight = true;
        try {
            const selection = {
                kind: 'row_range' as const,
                selection: {
                    first_index: 0,
                    last_index: this.state.table_shape.num_rows - 1,
                },
            };
            const result = await this.session.exportDataSelection(selection, format);
            this.log(`Export complete, ${result.data.length} characters.`);
            void this.panel.webview.postMessage({
                type: 'exportResult',
                data: result.data,
                format: result.format,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.log(`Failed to export data: ${message}`);
            void this.panel.webview.postMessage({
                type: 'error',
                message,
            });
        } finally {
            this.exportInFlight = false;
        }
    }

    private async convertToCode(syntax: string): Promise<void> {
        if (!this.state) {
            return;
        }
        if (!this.isFeatureSupported('convert_to_code')) {
            this.log('Convert to code ignored; backend does not support convert_to_code.');
            return;
        }
        this.log(`Converting current view to ${syntax} code.`);
        try {
            const columnFilters = this.state.column_filters ?? [];
            const rowFilters = this.state.row_filters ?? [];
            const sortKeys = this.state.sort_keys ?? [];
            const result = await this.session.convertToCode(
                columnFilters,
                rowFilters,
                sortKeys,
                { code_syntax_name: syntax }
            );
            const code = result.converted_code.join('\n');
            this.log(`Converted to ${syntax}, ${code.length} characters.`);
            void this.panel.webview.postMessage({
                type: 'convertToCodeResult',
                code,
                syntax,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.log(`Failed to convert to code: ${message}`);
            void this.panel.webview.postMessage({
                type: 'error',
                message,
            });
        }
    }

    private async suggestCodeSyntax(): Promise<void> {
        this.log('Requesting code syntax suggestion.');
        try {
            const result = await this.session.suggestCodeSyntax();
            void this.panel.webview.postMessage({
                type: 'suggestCodeSyntaxResult',
                syntax: result.code_syntax_name,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.log(`Failed to suggest code syntax: ${message}`);
            void this.panel.webview.postMessage({
                type: 'error',
                message,
            });
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
                    <div class="toolbar-actions">
                        <button class="action" id="filter-btn" title="Filter Columns">Filter</button>
                        <button class="action" id="stats-btn" title="Column Statistics">Stats</button>
                        <div class="dropdown">
                            <button class="action" id="export-btn">Export ▾</button>
                            <div class="dropdown-content" id="export-dropdown">
                                <button data-format="csv">Export as CSV</button>
                                <button data-format="tsv">Export as TSV</button>
                                <button data-format="html">Export as HTML</button>
                            </div>
                        </div>
                        <button class="action" id="code-btn" title="Convert to Code">Code</button>
                        <button class="action" id="refresh-btn">Refresh</button>
                    </div>
                </div>
                <div class="side-panel" id="filter-panel">
                    <div class="panel-header">
                        <span>Column Filter</span>
                        <button class="close-btn" id="close-filter">&times;</button>
                    </div>
                    <div class="panel-content">
                        <div class="filter-section">
                            <label>Search Columns</label>
                            <input type="text" id="column-search" placeholder="Column name...">
                        </div>
                        <div class="filter-section">
                            <label>Sort Order</label>
                            <select id="sort-order">
                                <option value="original">Original</option>
                                <option value="ascending_name">Name (A-Z)</option>
                                <option value="descending_name">Name (Z-A)</option>
                                <option value="ascending_type">Type (A-Z)</option>
                                <option value="descending_type">Type (Z-A)</option>
                            </select>
                        </div>
                        <div class="filter-actions">
                            <button class="action" id="apply-filter">Apply</button>
                            <button class="action secondary" id="clear-filter">Clear</button>
                        </div>
                        <div class="filter-status" id="filter-status"></div>
                    </div>
                </div>
                <div class="side-panel" id="stats-panel">
                    <div class="panel-header">
                        <span>Column Statistics</span>
                        <button class="close-btn" id="close-stats">&times;</button>
                    </div>
                    <div class="panel-content">
                        <div class="stats-section">
                            <label>Select Column</label>
                            <select id="stats-column">
                                <option value="">Choose column...</option>
                            </select>
                        </div>
                        <div class="stats-section">
                            <label>Statistics</label>
                            <div class="checkbox-group">
                                <label><input type="checkbox" id="stat-null-count" checked> Null Count</label>
                                <label><input type="checkbox" id="stat-summary"> Summary Stats</label>
                                <label><input type="checkbox" id="stat-histogram"> Histogram</label>
                                <label><input type="checkbox" id="stat-frequency"> Frequency</label>
                            </div>
                        </div>
                        <div class="filter-actions">
                            <button class="action" id="get-stats">Get Stats</button>
                        </div>
                        <div class="stats-results" id="stats-results"></div>
                    </div>
                </div>
                <div class="modal" id="code-modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <span>Convert to Code</span>
                            <button class="close-btn" id="close-code">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="code-section">
                                <label>Syntax</label>
                                <select id="code-syntax">
                                    <option value="pandas">Python (pandas)</option>
                                    <option value="polars">Python (polars)</option>
                                    <option value="dplyr">R (dplyr)</option>
                                    <option value="data.table">R (data.table)</option>
                                </select>
                            </div>
                            <div class="code-actions">
                                <button class="action" id="convert-code">Convert</button>
                                <button class="action secondary" id="copy-code">Copy to Clipboard</button>
                            </div>
                            <pre id="code-preview"></pre>
                        </div>
                    </div>
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
