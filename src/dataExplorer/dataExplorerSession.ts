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
    ConvertToCodeParams,
    DatasetImportOptions,
    ExportDataSelectionParams,
    ExportFormat,
    FilterResult,
    FormatOptions,
    GetColumnProfilesParams,
    GetDataValuesParams,
    GetRowLabelsParams,
    GetSchemaParams,
    OpenDatasetParams,
    OpenDatasetResult,
    RowFilter,
    SearchSchemaParams,
    SearchSchemaResult,
    SetColumnFiltersParams,
    SetDatasetImportOptionsParams,
    SetDatasetImportOptionsResult,
    SetRowFiltersParams,
    SetSortColumnsParams,
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

const RPC_DEFINITIONS = {
    get_state: { replyMethod: 'GetStateReply' },
    get_schema: { replyMethod: 'GetSchemaReply' },
    get_data_values: { replyMethod: 'GetDataValuesReply' },
    get_row_labels: { replyMethod: 'GetRowLabelsReply' },
    set_sort_columns: { replyMethod: 'SetSortColumnsReply' },
    search_schema: { replyMethod: 'SearchSchemaReply' },
    set_column_filters: { replyMethod: 'SetColumnFiltersReply' },
    set_row_filters: { replyMethod: 'SetRowFiltersReply' },
    get_column_profiles: { replyMethod: 'GetColumnProfilesReply' },
    export_data_selection: { replyMethod: 'ExportDataSelectionReply' },
    convert_to_code: { replyMethod: 'ConvertToCodeReply' },
    suggest_code_syntax: { replyMethod: 'SuggestCodeSyntaxReply' },
    open_dataset: { replyMethod: 'OpenDatasetReply' },
    set_dataset_import_options: { replyMethod: 'SetDatasetImportOptionsReply' },
} as const;

type DataExplorerRpcMap = {
    get_state: {
        params?: undefined;
        result: BackendState;
        replyMethod: typeof RPC_DEFINITIONS.get_state.replyMethod;
    };
    get_schema: {
        params: GetSchemaParams;
        result: TableSchema;
        replyMethod: typeof RPC_DEFINITIONS.get_schema.replyMethod;
    };
    get_data_values: {
        params: GetDataValuesParams;
        result: TableData;
        replyMethod: typeof RPC_DEFINITIONS.get_data_values.replyMethod;
    };
    get_row_labels: {
        params: GetRowLabelsParams;
        result: TableRowLabels;
        replyMethod: typeof RPC_DEFINITIONS.get_row_labels.replyMethod;
    };
    set_sort_columns: {
        params: SetSortColumnsParams;
        result: void;
        replyMethod: typeof RPC_DEFINITIONS.set_sort_columns.replyMethod;
    };
    search_schema: {
        params: SearchSchemaParams;
        result: SearchSchemaResult;
        replyMethod: typeof RPC_DEFINITIONS.search_schema.replyMethod;
    };
    set_column_filters: {
        params: SetColumnFiltersParams;
        result: void;
        replyMethod: typeof RPC_DEFINITIONS.set_column_filters.replyMethod;
    };
    set_row_filters: {
        params: SetRowFiltersParams;
        result: FilterResult;
        replyMethod: typeof RPC_DEFINITIONS.set_row_filters.replyMethod;
    };
    get_column_profiles: {
        params: GetColumnProfilesParams;
        result: void;
        replyMethod: typeof RPC_DEFINITIONS.get_column_profiles.replyMethod;
    };
    export_data_selection: {
        params: ExportDataSelectionParams;
        result: { data: string; format: ExportFormat };
        replyMethod: typeof RPC_DEFINITIONS.export_data_selection.replyMethod;
    };
    convert_to_code: {
        params: ConvertToCodeParams;
        result: ConvertedCode;
        replyMethod: typeof RPC_DEFINITIONS.convert_to_code.replyMethod;
    };
    suggest_code_syntax: {
        params?: undefined;
        result: CodeSyntaxName;
        replyMethod: typeof RPC_DEFINITIONS.suggest_code_syntax.replyMethod;
    };
    open_dataset: {
        params: OpenDatasetParams;
        result: OpenDatasetResult;
        replyMethod: typeof RPC_DEFINITIONS.open_dataset.replyMethod;
    };
    set_dataset_import_options: {
        params: SetDatasetImportOptionsParams;
        result: SetDatasetImportOptionsResult;
        replyMethod: typeof RPC_DEFINITIONS.set_dataset_import_options.replyMethod;
    };
};

type RpcMethodsWithParams = {
    [Key in keyof DataExplorerRpcMap]: DataExplorerRpcMap[Key]['params'] extends undefined ? never : Key;
}[keyof DataExplorerRpcMap];

type RpcMethodsWithoutParams = Exclude<keyof DataExplorerRpcMap, RpcMethodsWithParams>;

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
        return this.sendRpc('get_state');
    }

    async getSchema(columnIndices: number[]): Promise<TableSchema> {
        return this.sendRpc('get_schema', { column_indices: columnIndices });
    }

    async getDataValues(columns: ColumnSelection[], formatOptions: FormatOptions): Promise<TableData> {
        return this.sendRpc('get_data_values', { columns, format_options: formatOptions });
    }

    async getRowLabels(selection: ArraySelection, formatOptions: FormatOptions): Promise<TableRowLabels> {
        return this.sendRpc('get_row_labels', { selection, format_options: formatOptions });
    }

    async setSortColumns(sortKeys: ColumnSortKey[]): Promise<void> {
        await this.sendRpc('set_sort_columns', { sort_keys: sortKeys });
    }

    async searchSchema(
        filters: ColumnFilter[],
        sortOrder: SearchSchemaParams['sort_order'],
    ): Promise<SearchSchemaResult> {
        return this.sendRpc('search_schema', { filters, sort_order: sortOrder });
    }

    async setColumnFilters(filters: ColumnFilter[]): Promise<void> {
        await this.sendRpc('set_column_filters', { filters });
    }

    async setRowFilters(filters: RowFilter[]): Promise<FilterResult> {
        return this.sendRpc('set_row_filters', { filters });
    }

    async getColumnProfiles(
        callbackId: string,
        profiles: ColumnProfileRequest[],
        formatOptions: FormatOptions,
    ): Promise<void> {
        await this.sendRpc('get_column_profiles', {
            callback_id: callbackId,
            profiles,
            format_options: formatOptions,
        });
    }

    async exportDataSelection(
        selection: TableSelection,
        format: ExportFormat,
    ): Promise<{ data: string; format: ExportFormat }> {
        return this.sendRpc('export_data_selection', { selection, format });
    }

    async convertToCode(
        columnFilters: ColumnFilter[],
        rowFilters: RowFilter[],
        sortKeys: ColumnSortKey[],
        codeSyntaxName: string,
    ): Promise<ConvertedCode> {
        return this.sendRpc('convert_to_code', {
            column_filters: columnFilters,
            row_filters: rowFilters,
            sort_keys: sortKeys,
            code_syntax_name: codeSyntaxName,
        });
    }

    async suggestCodeSyntax(): Promise<CodeSyntaxName> {
        return this.sendRpc('suggest_code_syntax');
    }

    async openDataset(uri: string): Promise<OpenDatasetResult> {
        return this.sendRpc('open_dataset', { uri });
    }

    async setDatasetImportOptions(options: DatasetImportOptions): Promise<SetDatasetImportOptionsResult> {
        return this.sendRpc('set_dataset_import_options', { options });
    }

    private sendRpc<K extends RpcMethodsWithoutParams>(method: K): Promise<DataExplorerRpcMap[K]['result']>;
    private sendRpc<K extends RpcMethodsWithParams>(
        method: K,
        params: DataExplorerRpcMap[K]['params'],
    ): Promise<DataExplorerRpcMap[K]['result']>;
    private sendRpc<K extends keyof DataExplorerRpcMap>(
        method: K,
        params?: DataExplorerRpcMap[K]['params'],
    ): Promise<DataExplorerRpcMap[K]['result']> {
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

        const replyMethod = RPC_DEFINITIONS[method].replyMethod;

        return new Promise<DataExplorerRpcMap[K]['result']>((resolve, reject) => {
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
        if (!isDataExplorerMessage(data)) {
            this.log('Data explorer message is not an object.');
            return;
        }
        const message = data;
        const method = typeof message.method === 'string' ? message.method : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isDataExplorerMessage(value: unknown): value is DataExplorerMessage {
    return isRecord(value);
}
