import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DataExplorerSession, DEFAULT_FORMAT_OPTIONS } from './dataExplorerSession';
import { LogCategory, logWebviewMessage } from '../logging/logger';
import {
    BackendState,
    ColumnFilter,
    ColumnHistogramParamsMethod,
    ColumnProfileSpec,
    ColumnProfileRequest,
    ColumnProfileType,
    ColumnSortKey,
    ExportFormat,
    ReturnColumnProfilesParams,
    RowFilter,
    SearchSchemaSortOrder,
    TableSelectionKind,
    TableSchema,
    ColumnSelection,
} from './protocol';

const DEFAULT_HISTOGRAM_NUM_BINS = 20;
const DEFAULT_FREQUENCY_TABLE_LIMIT = 10;

type HistogramParamsInput = {
    method?: string;
    num_bins?: number;
    quantiles?: number[];
};

type FrequencyParamsInput = {
    limit?: number;
};

export interface DataExplorerPanelContext {
    readonly session: DataExplorerSession;
    readonly webview: vscode.Webview;
    state: BackendState | undefined;
    schema: TableSchema | undefined;
    sortInFlight: boolean;
    filterInFlight: boolean;
    exportInFlight: boolean;
    readonly pendingProfileCallbacks: Map<string, { columnIndex: number }>;
    log(message: string): void;
    initialize(): Promise<void>;
}

export class DataExplorerMessageHandler {
    constructor(private readonly ctx: DataExplorerPanelContext) {}

    handleWebviewMessage(message: { type?: string; [key: string]: unknown }): void {
        switch (message.type) {
            case 'log': {
                const logMessage = typeof message.message === 'string' ? message.message : 'Webview log message.';
                const payload = message.payload;
                const detail = payload !== undefined ? JSON.stringify(payload) : undefined;
                logWebviewMessage('ui', LogCategory.DataExplorer, logMessage, detail);
                return;
            }
            case 'ready':
                void this.ctx.initialize();
                return;
            case 'refresh':
                void this.ctx.initialize();
                return;
            case 'setSort': {
                const sortKey = this.parseSortKey(message.sortKey);
                void this.applySort(sortKey);
                return;
            }
            case 'searchSchema': {
                if (!Array.isArray(message.filters)) {
                    this.ctx.log('Search schema request missing filters.');
                    return;
                }
                const filters = message.filters as ColumnFilter[];
                const sortOrder = this.resolveSearchSchemaSortOrder(message.sortOrder);
                void this.searchSchema(filters, sortOrder);
                return;
            }
            case 'setColumnFilters': {
                if (!Array.isArray(message.filters)) {
                    this.ctx.log('Column filter request missing filters.');
                    return;
                }
                const filters = message.filters as ColumnFilter[];
                void this.applyColumnFilters(filters);
                return;
            }
            case 'setRowFilters': {
                if (!Array.isArray(message.filters)) {
                    this.ctx.log('Row filter request missing filters.');
                    return;
                }
                const filters = message.filters as RowFilter[];
                void this.applyRowFilters(filters);
                return;
            }
            case 'getColumnProfiles': {
                if (typeof message.columnIndex !== 'number' || !Array.isArray(message.profileTypes)) {
                    this.ctx.log('Column profiles request missing required fields.');
                    return;
                }
                const columnIndex = message.columnIndex;
                const profileTypes = message.profileTypes as string[];
                const histogramParams = isRecord(message.histogramParams)
                    ? (message.histogramParams as HistogramParamsInput)
                    : undefined;
                const frequencyParams = isRecord(message.frequencyParams)
                    ? (message.frequencyParams as FrequencyParamsInput)
                    : undefined;
                void this.getColumnProfiles(columnIndex, profileTypes, histogramParams, frequencyParams);
                return;
            }
            case 'exportData': {
                if (typeof message.format !== 'string') {
                    this.ctx.log('Export request missing format.');
                    return;
                }
                const format = message.format as ExportFormat;
                void this.exportData(format);
                return;
            }
            case 'convertToCode': {
                if (typeof message.syntax !== 'string') {
                    this.ctx.log('Convert to code request missing syntax.');
                    return;
                }
                const syntax = message.syntax;
                void this.convertToCode(syntax);
                return;
            }
            case 'suggestCodeSyntax': {
                void this.suggestCodeSyntax();
                return;
            }
        }
    }

    handleReturnColumnProfiles(params: unknown): void {
        if (!params || typeof params !== 'object') {
            this.ctx.log('Column profiles response missing params.');
            return;
        }

        const payload = params as ReturnColumnProfilesParams;
        const callbackId = payload.callback_id;
        if (!callbackId) {
            this.ctx.log('Column profiles response missing callback_id.');
            return;
        }

        const pending = this.ctx.pendingProfileCallbacks.get(callbackId);
        if (!pending) {
            this.ctx.log(`Unexpected column profiles callback: ${callbackId}.`);
            return;
        }

        this.ctx.pendingProfileCallbacks.delete(callbackId);
        const errorMessage = payload.error_message;
        if (errorMessage) {
            this.ctx.log(`Column profiles error: ${errorMessage}`);
        }

        void this.ctx.webview.postMessage({
            type: 'columnProfilesResult',
            columnIndex: pending.columnIndex,
            profiles: payload.profiles ?? [],
            errorMessage,
        });
    }

    // --- Private helpers ---

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

    private resolveSearchSchemaSortOrder(value: unknown): SearchSchemaSortOrder {
        if (typeof value !== 'string') {
            return SearchSchemaSortOrder.Original;
        }
        const allowed = Object.values(SearchSchemaSortOrder);
        if (allowed.includes(value as SearchSchemaSortOrder)) {
            return value as SearchSchemaSortOrder;
        }
        return SearchSchemaSortOrder.Original;
    }

    private isSortSupported(): boolean {
        const supportStatus = this.ctx.state?.supported_features?.set_sort_columns?.support_status;
        if (!supportStatus) {
            return true;
        }
        return supportStatus === 'supported';
    }

    private isFeatureSupported(featureKey: string): boolean {
        const features = this.ctx.state?.supported_features as Record<string, { support_status?: string }> | undefined;
        const supportStatus = features?.[featureKey]?.support_status;
        if (!supportStatus) {
            return true;
        }
        return supportStatus === 'supported';
    }

    // --- Backend operations ---

    private async applySort(sortKey: { columnIndex: number; direction: 'asc' | 'desc' } | null): Promise<void> {
        if (!this.ctx.state) {
            return;
        }
        if (!this.isSortSupported()) {
            this.ctx.log('Sort request ignored; backend does not support set_sort_columns.');
            return;
        }
        if (this.ctx.sortInFlight) {
            this.ctx.log('Sort request ignored; sort already in flight.');
            return;
        }

        const sortKeys: ColumnSortKey[] = sortKey
            ? [{ column_index: sortKey.columnIndex, ascending: sortKey.direction === 'asc' }]
            : [];

        const description = sortKey ? `column ${sortKey.columnIndex} ${sortKey.direction}` : 'cleared';
        this.ctx.log(`Applying sort: ${description}.`);

        this.ctx.sortInFlight = true;
        try {
            await this.ctx.session.setSortColumns(sortKeys);
            await this.ctx.initialize();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.ctx.log(`Failed to apply sort: ${message}`);
            void this.ctx.webview.postMessage({ type: 'error', message });
        } finally {
            this.ctx.sortInFlight = false;
        }
    }

    private async searchSchema(filters: ColumnFilter[], sortOrder: SearchSchemaSortOrder): Promise<void> {
        if (!this.ctx.state) {
            return;
        }
        if (!this.isFeatureSupported('search_schema')) {
            this.ctx.log('Search schema ignored; backend does not support search_schema.');
            return;
        }
        this.ctx.log(`Searching schema with ${filters.length} filters, sort: ${sortOrder}`);
        try {
            const result = await this.ctx.session.searchSchema(filters, sortOrder);
            void this.ctx.webview.postMessage({
                type: 'searchSchemaResult',
                matches: result.matches,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.ctx.log(`Failed to search schema: ${message}`);
            void this.ctx.webview.postMessage({ type: 'error', message });
        }
    }

    private async applyColumnFilters(filters: ColumnFilter[]): Promise<void> {
        if (!this.ctx.state) {
            return;
        }
        if (!this.isFeatureSupported('set_column_filters')) {
            this.ctx.log('Column filter request ignored; backend does not support set_column_filters.');
            return;
        }
        if (this.ctx.filterInFlight) {
            this.ctx.log('Column filter request ignored; filter already in flight.');
            return;
        }
        this.ctx.log(`Applying ${filters.length} column filters.`);
        this.ctx.filterInFlight = true;
        try {
            await this.ctx.session.setColumnFilters(filters);
            await this.ctx.initialize();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.ctx.log(`Failed to apply column filters: ${message}`);
            void this.ctx.webview.postMessage({ type: 'error', message });
        } finally {
            this.ctx.filterInFlight = false;
        }
    }

    private async applyRowFilters(filters: RowFilter[]): Promise<void> {
        if (!this.ctx.state) {
            return;
        }
        if (!this.isFeatureSupported('set_row_filters')) {
            this.ctx.log('Row filter request ignored; backend does not support set_row_filters.');
            return;
        }
        if (this.ctx.filterInFlight) {
            this.ctx.log('Row filter request ignored; filter already in flight.');
            return;
        }
        this.ctx.log(`Applying ${filters.length} row filters.`);
        this.ctx.filterInFlight = true;
        try {
            const result = await this.ctx.session.setRowFilters(filters);
            this.ctx.log(`Row filter applied, ${result.selected_num_rows} rows selected.`);
            await this.ctx.initialize();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.ctx.log(`Failed to apply row filters: ${message}`);
            void this.ctx.webview.postMessage({ type: 'error', message });
        } finally {
            this.ctx.filterInFlight = false;
        }
    }

    private async getColumnProfiles(
        columnIndex: number,
        profileTypes: string[],
        histogramParams?: HistogramParamsInput,
        frequencyParams?: FrequencyParamsInput,
    ): Promise<void> {
        if (!this.ctx.state) {
            return;
        }
        if (!this.isFeatureSupported('get_column_profiles')) {
            this.ctx.log('Column profiles request ignored; backend does not support get_column_profiles.');
            return;
        }
        const resolvedProfileTypes = profileTypes.filter((profileType): profileType is ColumnProfileType =>
            Object.values(ColumnProfileType).includes(profileType as ColumnProfileType),
        );
        if (resolvedProfileTypes.length === 0) {
            this.ctx.log('Column profiles request ignored; no profile types selected.');
            void this.ctx.webview.postMessage({
                type: 'error',
                message: 'Please select at least one profile type.',
            });
            return;
        }
        this.ctx.log(`Getting column profiles for column ${columnIndex}: ${resolvedProfileTypes.join(', ')}`);
        if (histogramParams || frequencyParams) {
            this.ctx.log(
                `Column profile params histogram=${JSON.stringify(histogramParams ?? {})} frequency=${JSON.stringify(frequencyParams ?? {})}`,
            );
        }
        const callbackId = crypto.randomUUID();
        const profiles: ColumnProfileRequest[] = [
            {
                column_index: columnIndex,
                profiles: resolvedProfileTypes.map((profileType) =>
                    this.buildColumnProfileSpec(profileType, histogramParams, frequencyParams),
                ),
            },
        ];
        try {
            this.ctx.pendingProfileCallbacks.set(callbackId, { columnIndex });
            await this.ctx.session.getColumnProfiles(callbackId, profiles, DEFAULT_FORMAT_OPTIONS);
        } catch (error) {
            this.ctx.pendingProfileCallbacks.delete(callbackId);
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.ctx.log(`Failed to get column profiles: ${message}`);
            void this.ctx.webview.postMessage({ type: 'error', message });
        }
    }

    private async exportData(format: ExportFormat): Promise<void> {
        if (!this.ctx.state) {
            return;
        }
        if (!this.isFeatureSupported('export_data_selection')) {
            this.ctx.log('Export request ignored; backend does not support export_data_selection.');
            return;
        }
        if (this.ctx.exportInFlight) {
            this.ctx.log('Export request ignored; export already in flight.');
            return;
        }
        if (this.ctx.state.table_shape.num_rows === 0) {
            this.ctx.log('Export request ignored; table has no rows.');
            void this.ctx.webview.postMessage({
                type: 'error',
                message: 'No rows available to export.',
            });
            return;
        }
        this.ctx.log(`Exporting data as ${format}.`);
        this.ctx.exportInFlight = true;
        try {
            const selection = {
                kind: TableSelectionKind.RowRange,
                selection: {
                    first_index: 0,
                    last_index: this.ctx.state.table_shape.num_rows - 1,
                },
            };
            const result = await this.ctx.session.exportDataSelection(selection, format);
            this.ctx.log(`Export complete, ${result.data.length} characters.`);
            void this.ctx.webview.postMessage({
                type: 'exportResult',
                data: result.data,
                format: result.format,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.ctx.log(`Failed to export data: ${message}`);
            void this.ctx.webview.postMessage({ type: 'error', message });
        } finally {
            this.ctx.exportInFlight = false;
        }
    }

    private async convertToCode(syntax: string): Promise<void> {
        if (!this.ctx.state) {
            return;
        }
        if (!this.isFeatureSupported('convert_to_code')) {
            this.ctx.log('Convert to code ignored; backend does not support convert_to_code.');
            return;
        }
        this.ctx.log(`Converting current view to ${syntax} code.`);
        try {
            const columnFilters = this.ctx.state.column_filters ?? [];
            const rowFilters = this.ctx.state.row_filters ?? [];
            const sortKeys = this.ctx.state.sort_keys ?? [];
            const result = await this.ctx.session.convertToCode(columnFilters, rowFilters, sortKeys, syntax);
            const code = result.converted_code.join('\n');
            this.ctx.log(`Converted to ${syntax}, ${code.length} characters.`);
            void this.ctx.webview.postMessage({
                type: 'convertToCodeResult',
                code,
                syntax,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.ctx.log(`Failed to convert to code: ${message}`);
            void this.ctx.webview.postMessage({ type: 'error', message });
        }
    }

    private async suggestCodeSyntax(): Promise<void> {
        this.ctx.log('Requesting code syntax suggestion.');
        try {
            const result = await this.ctx.session.suggestCodeSyntax();
            void this.ctx.webview.postMessage({
                type: 'suggestCodeSyntaxResult',
                syntax: result.code_syntax_name,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.ctx.log(`Failed to suggest code syntax: ${message}`);
            void this.ctx.webview.postMessage({ type: 'error', message });
        }
    }

    // --- Profile spec builders ---

    private buildColumnProfileSpec(
        profileType: ColumnProfileType,
        histogramParams?: HistogramParamsInput,
        frequencyParams?: FrequencyParamsInput,
    ): ColumnProfileSpec {
        if (profileType === ColumnProfileType.SmallHistogram || profileType === ColumnProfileType.LargeHistogram) {
            return {
                profile_type: profileType,
                params: this.resolveHistogramParams(histogramParams),
            };
        }
        if (
            profileType === ColumnProfileType.SmallFrequencyTable ||
            profileType === ColumnProfileType.LargeFrequencyTable
        ) {
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
            ? histogramParams?.quantiles.filter(
                  (quantile) => typeof quantile === 'number' && quantile >= 0 && quantile <= 1,
              )
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
