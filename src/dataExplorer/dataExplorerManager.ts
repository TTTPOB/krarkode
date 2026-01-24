import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ArkSidecarManager } from '../ark/sidecarManager';
import { DataExplorerSession, DEFAULT_FORMAT_OPTIONS } from './dataExplorerSession';
import { getNonce, isDebugLoggingEnabled } from '../util';
import {
    BackendState,
    ColumnFilter,
    ColumnHistogramParamsMethod,
    ColumnProfileSpec,
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

const DEFAULT_HISTOGRAM_NUM_BINS = 20;
const DEFAULT_FREQUENCY_TABLE_LIMIT = 10;
const INITIAL_ROW_BLOCK_SIZE = 200;

type HistogramParamsInput = {
    method?: string;
    num_bins?: number;
    quantiles?: number[];
};

type FrequencyParamsInput = {
    limit?: number;
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

    private handleWebviewMessage(message: { type?: string; [key: string]: unknown }): void {
        switch (message.type) {
            case 'log': {
                if (!isDebugLoggingEnabled()) {
                    return;
                }
                const logMessage = typeof message.message === 'string' ? message.message : 'Webview log message.';
                const payload = message.payload;
                if (payload !== undefined) {
                    this.outputChannel.appendLine(`[dataExplorer:webview] ${logMessage} ${JSON.stringify(payload)}`);
                } else {
                    this.outputChannel.appendLine(`[dataExplorer:webview] ${logMessage}`);
                }
                return;
            }
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
                const histogramParams = message.histogramParams as HistogramParamsInput | undefined;
                const frequencyParams = message.frequencyParams as FrequencyParamsInput | undefined;
                void this.getColumnProfiles(columnIndex, profileTypes, histogramParams, frequencyParams);
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

    private async getColumnProfiles(
        columnIndex: number,
        profileTypes: string[],
        histogramParams?: HistogramParamsInput,
        frequencyParams?: FrequencyParamsInput
    ): Promise<void> {
        if (!this.state) {
            return;
        }
        if (!this.isFeatureSupported('get_column_profiles')) {
            this.log('Column profiles request ignored; backend does not support get_column_profiles.');
            return;
        }
        const resolvedProfileTypes = profileTypes.filter((profileType): profileType is ColumnProfileType =>
            Object.values(ColumnProfileType).includes(profileType as ColumnProfileType)
        );
        if (resolvedProfileTypes.length === 0) {
            this.log('Column profiles request ignored; no profile types selected.');
            void this.panel.webview.postMessage({
                type: 'error',
                message: 'Please select at least one profile type.',
            });
            return;
        }
        this.log(`Getting column profiles for column ${columnIndex}: ${resolvedProfileTypes.join(', ')}`);
        if (histogramParams || frequencyParams) {
            this.log('Column profile params', { histogramParams, frequencyParams });
        }
        const callbackId = crypto.randomUUID();
        const profiles: ColumnProfileRequest[] = [{
            column_index: columnIndex,
            profiles: resolvedProfileTypes.map((profileType) =>
                this.buildColumnProfileSpec(profileType, histogramParams, frequencyParams)
            ),
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

    private buildColumnProfileSpec(
        profileType: ColumnProfileType,
        histogramParams?: HistogramParamsInput,
        frequencyParams?: FrequencyParamsInput
    ): ColumnProfileSpec {
        if (profileType === ColumnProfileType.SmallHistogram || profileType === ColumnProfileType.LargeHistogram) {
            const resolvedHistogramParams = this.resolveHistogramParams(histogramParams);
            return {
                profile_type: profileType,
                params: resolvedHistogramParams,
            };
        }
        if (profileType === ColumnProfileType.SmallFrequencyTable || profileType === ColumnProfileType.LargeFrequencyTable) {
            return {
                profile_type: profileType,
                params: {
                    limit: this.resolveFrequencyLimit(frequencyParams),
                },
            };
        }
        return { profile_type: profileType };
    }

    private resolveHistogramParams(histogramParams?: HistogramParamsInput): {
        method: ColumnHistogramParamsMethod;
        num_bins: number;
        quantiles?: number[];
    } {
        const method = this.resolveHistogramMethod(histogramParams?.method);
        const numBins = this.resolveHistogramBins(histogramParams?.num_bins);
        const quantiles = Array.isArray(histogramParams?.quantiles)
            ? histogramParams?.quantiles.filter((quantile) => typeof quantile === 'number' && quantile >= 0 && quantile <= 1)
            : undefined;
        return {
            method,
            num_bins: numBins,
            ...(quantiles && quantiles.length > 0 ? { quantiles } : {}),
        };
    }

    private resolveHistogramMethod(method?: string): ColumnHistogramParamsMethod {
        switch (method) {
            case ColumnHistogramParamsMethod.Sturges:
                return ColumnHistogramParamsMethod.Sturges;
            case ColumnHistogramParamsMethod.Scott:
                return ColumnHistogramParamsMethod.Scott;
            case ColumnHistogramParamsMethod.Fixed:
                return ColumnHistogramParamsMethod.Fixed;
            case ColumnHistogramParamsMethod.FreedmanDiaconis:
            default:
                return ColumnHistogramParamsMethod.FreedmanDiaconis;
        }
    }

    private resolveHistogramBins(numBins?: number): number {
        if (typeof numBins !== 'number' || !Number.isFinite(numBins)) {
            return DEFAULT_HISTOGRAM_NUM_BINS;
        }
        return Math.max(5, Math.round(numBins));
    }

    private resolveFrequencyLimit(frequencyParams?: FrequencyParamsInput): number {
        const limit = frequencyParams?.limit;
        if (typeof limit !== 'number' || !Number.isFinite(limit)) {
            return DEFAULT_FREQUENCY_TABLE_LIMIT;
        }
        return Math.max(5, Math.round(limit));
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
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'html', 'dataExplorer', 'dataExplorer.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'src', 'html', 'dataExplorer', 'dataExplorer.css')
        );
        const codiconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
        );
        const nonce = getNonce();
        const debugEnabled = isDebugLoggingEnabled();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <link href="${codiconUri}" rel="stylesheet">
                <title>Data Explorer</title>
            </head>
            <body>
                <div id="svelte-root"></div>
                <script nonce="${nonce}">window.__krarkodeDebug = ${debugEnabled ? 'true' : 'false'};</script>
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

    open(commId: string, data?: unknown): void {
        if (!isDataExplorerMetadata(data)) {
            this.outputChannel.appendLine(
                `Ignoring data explorer comm_open ${commId}; missing dataset metadata.`
            );
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isDataExplorerMetadata(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    return typeof value.title === 'string' && value.title.length > 0;
}
