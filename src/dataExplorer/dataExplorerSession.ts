import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ArkSidecarManager } from '../ark/sidecarManager';
import {
    ArraySelection,
    BackendState,
    ColumnSortKey,
    ColumnSelection,
    ColumnFilter,
    ColumnProfileRequest,
    ConvertedCode,
    CodeSyntaxName,
    DatasetImportOptions,
    ExportDataSelectionParams,
    ExportFormat,
    FilterResult,
    FormatOptions,
    OpenDatasetParams,
    OpenDatasetResult,
    RowFilter,
    SearchSchemaParams,
    SearchSchemaResult,
    SetDatasetImportOptionsResult,
    TableData,
    TableRowLabels,
    TableSchema,
    TableSelection,
} from './protocol';

type DataExplorerMessage = {
    jsonrpc?: string;
    id?: string;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: unknown;
};

export type DataExplorerFrontendEvent =
    | { method: 'schema_update' }
    | { method: 'data_update' }
    | { method: 'return_column_profiles'; params: unknown };

const REPLY_METHODS = {
    getState: 'GetStateReply',
    getSchema: 'GetSchemaReply',
    getDataValues: 'GetDataValuesReply',
    getRowLabels: 'GetRowLabelsReply',
    setSortColumns: 'SetSortColumnsReply',
    searchSchema: 'SearchSchemaReply',
    setColumnFilters: 'SetColumnFiltersReply',
    setRowFilters: 'SetRowFiltersReply',
    getColumnProfiles: 'GetColumnProfilesReply',
    exportDataSelection: 'ExportDataSelectionReply',
    convertToCode: 'ConvertToCodeReply',
    suggestCodeSyntax: 'SuggestCodeSyntaxReply',
    openDataset: 'OpenDatasetReply',
    setDatasetImportOptions: 'SetDatasetImportOptionsReply',
};

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
    large_num_digits: 2,
    small_num_digits: 4,
    max_integral_digits: 7,
    max_value_length: 100,
    thousands_sep: ',',
};

type PendingRequest<T> = {
    id: string;
    replyMethod: string;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
};

export class DataExplorerSession implements vscode.Disposable {
    private readonly pendingByReply = new Map<string, Array<PendingRequest<unknown>>>();
    private readonly pendingById = new Map<string, PendingRequest<unknown>>();
    private readonly _onDidReceiveEvent = new vscode.EventEmitter<DataExplorerFrontendEvent>();
    public readonly onDidReceiveEvent = this._onDidReceiveEvent.event;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly sidecarManager: ArkSidecarManager,
        private readonly commId: string,
        private readonly outputChannel: vscode.OutputChannel,
    ) {
        this.disposables.push(
            sidecarManager.onDidReceiveCommMessage((e) => {
                if (e.commId === this.commId) {
                    this.handleMessage(e.data);
                }
            }),
        );
    }

    dispose(): void {
        this.disposables.forEach((item) => item.dispose());
        this.disposables.length = 0;
        this._onDidReceiveEvent.dispose();
    }

    async getState(): Promise<BackendState> {
        return this.sendRpc<BackendState>('get_state', REPLY_METHODS.getState);
    }

    async getSchema(columnIndices: number[]): Promise<TableSchema> {
        return this.sendRpc<TableSchema>('get_schema', REPLY_METHODS.getSchema, {
            column_indices: columnIndices,
        });
    }

    async getDataValues(columns: ColumnSelection[], formatOptions: FormatOptions): Promise<TableData> {
        return this.sendRpc<TableData>('get_data_values', REPLY_METHODS.getDataValues, {
            columns,
            format_options: formatOptions,
        });
    }

    async getRowLabels(selection: ArraySelection, formatOptions: FormatOptions): Promise<TableRowLabels> {
        return this.sendRpc<TableRowLabels>('get_row_labels', REPLY_METHODS.getRowLabels, {
            selection,
            format_options: formatOptions,
        });
    }

    async setSortColumns(sortKeys: ColumnSortKey[]): Promise<void> {
        await this.sendRpc<void>('set_sort_columns', REPLY_METHODS.setSortColumns, {
            sort_keys: sortKeys,
        });
    }

    async searchSchema(filters: ColumnFilter[], sortOrder: string): Promise<SearchSchemaResult> {
        return this.sendRpc<SearchSchemaResult>('search_schema', REPLY_METHODS.searchSchema, {
            filters,
            sort_order: sortOrder,
        });
    }

    async setColumnFilters(filters: ColumnFilter[]): Promise<void> {
        await this.sendRpc<void>('set_column_filters', REPLY_METHODS.setColumnFilters, {
            filters,
        });
    }

    async setRowFilters(filters: RowFilter[]): Promise<FilterResult> {
        return this.sendRpc<FilterResult>('set_row_filters', REPLY_METHODS.setRowFilters, {
            filters,
        });
    }

    async getColumnProfiles(
        callbackId: string,
        profiles: ColumnProfileRequest[],
        formatOptions: FormatOptions,
    ): Promise<void> {
        await this.sendRpc<void>('get_column_profiles', REPLY_METHODS.getColumnProfiles, {
            callback_id: callbackId,
            profiles,
            format_options: formatOptions,
        });
    }

    async exportDataSelection(
        selection: TableSelection,
        format: ExportFormat,
    ): Promise<{ data: string; format: ExportFormat }> {
        return this.sendRpc<{ data: string; format: ExportFormat }>(
            'export_data_selection',
            REPLY_METHODS.exportDataSelection,
            {
                selection,
                format,
            },
        );
    }

    async convertToCode(
        columnFilters: ColumnFilter[],
        rowFilters: RowFilter[],
        sortKeys: ColumnSortKey[],
        codeSyntaxName: CodeSyntaxName,
    ): Promise<ConvertedCode> {
        return this.sendRpc<ConvertedCode>('convert_to_code', REPLY_METHODS.convertToCode, {
            column_filters: columnFilters,
            row_filters: rowFilters,
            sort_keys: sortKeys,
            code_syntax_name: codeSyntaxName,
        });
    }

    async suggestCodeSyntax(): Promise<CodeSyntaxName> {
        return this.sendRpc<CodeSyntaxName>('suggest_code_syntax', REPLY_METHODS.suggestCodeSyntax);
    }

    async openDataset(uri: string): Promise<OpenDatasetResult> {
        return this.sendRpc<OpenDatasetResult>('open_dataset', REPLY_METHODS.openDataset, {
            uri,
        });
    }

    async setDatasetImportOptions(options: DatasetImportOptions): Promise<SetDatasetImportOptionsResult> {
        return this.sendRpc<SetDatasetImportOptionsResult>(
            'set_dataset_import_options',
            REPLY_METHODS.setDatasetImportOptions,
            {
                options,
            },
        );
    }

    private sendRpc<T>(method: string, replyMethod: string, params?: Record<string, unknown>): Promise<T> {
        const id = crypto.randomUUID();
        const payload: DataExplorerMessage = {
            jsonrpc: '2.0',
            id,
            method,
        };

        if (params && Object.keys(params).length > 0) {
            payload.params = params;
        }

        this.log(`Sending RPC '${method}' on comm ${this.commId}.`);
        this.sidecarManager.sendCommMessage(this.commId, payload);

        return new Promise<T>((resolve, reject) => {
            const pending: PendingRequest<unknown> = {
                id,
                replyMethod,
                resolve: resolve as (value: unknown) => void,
                reject,
            };
            const queue = this.pendingByReply.get(replyMethod) ?? [];
            queue.push(pending);
            this.pendingByReply.set(replyMethod, queue);
            this.pendingById.set(id, pending);
        });
    }

    private handleMessage(data: unknown) {
        const message = data as DataExplorerMessage;
        const method = message.method;
        const messageId = typeof message.id === 'string' ? message.id : undefined;

        this.log(`Received comm message: ${JSON.stringify(data)}`);

        if (!method) {
            this.log('Data explorer message missing method.');
            return;
        }

        if (message.error) {
            this.log(`Data explorer RPC error: ${JSON.stringify(message.error)}`);
        }

        if (method === 'schema_update' || method === 'data_update') {
            this._onDidReceiveEvent.fire({ method });
            return;
        }

        if (method === 'return_column_profiles') {
            this._onDidReceiveEvent.fire({ method, params: message.params });
            return;
        }

        if (messageId) {
            const pendingById = this.pendingById.get(messageId);
            if (pendingById) {
                this.pendingById.delete(messageId);
                this.removePendingFromReplyQueue(pendingById);
                this.log(`Resolved RPC ${messageId} from reply ${pendingById.replyMethod}.`);
                pendingById.resolve(message.result as unknown);
                return;
            }
        }

        if (method.endsWith('Reply')) {
            const queue = this.pendingByReply.get(method);
            if (!queue || queue.length === 0) {
                this.log(`Unexpected reply '${method}' with no pending request.`);
                return;
            }
            const pending = queue.shift();
            if (!pending) {
                return;
            }
            this.pendingById.delete(pending.id);
            pending.resolve(message.result as unknown);
        }
    }

    private removePendingFromReplyQueue(pending: PendingRequest<unknown>): void {
        const queue = this.pendingByReply.get(pending.replyMethod);
        if (!queue) {
            return;
        }
        const index = queue.findIndex((entry) => entry.id === pending.id);
        if (index >= 0) {
            queue.splice(index, 1);
        }
        if (queue.length === 0) {
            this.pendingByReply.delete(pending.replyMethod);
        }
    }

    private log(message: string) {
        this.outputChannel.appendLine(message);
    }
}
