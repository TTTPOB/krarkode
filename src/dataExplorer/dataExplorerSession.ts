import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ArkSidecarManager } from '../ark/sidecarManager';
import {
    ArraySelection,
    BackendState,
    ColumnSortKey,
    ColumnSelection,
    FormatOptions,
    TableData,
    TableRowLabels,
    TableSchema,
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
};

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
    large_num_digits: 2,
    small_num_digits: 4,
    max_integral_digits: 7,
    max_value_length: 100,
    thousands_sep: ',',
};

type PendingRequest<T> = {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
};

export class DataExplorerSession implements vscode.Disposable {
    private readonly pendingByReply = new Map<string, Array<PendingRequest<unknown>>>();
    private readonly _onDidReceiveEvent = new vscode.EventEmitter<DataExplorerFrontendEvent>();
    public readonly onDidReceiveEvent = this._onDidReceiveEvent.event;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly sidecarManager: ArkSidecarManager,
        private readonly commId: string,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.disposables.push(
            sidecarManager.onDidReceiveCommMessage((e) => {
                if (e.commId === this.commId) {
                    this.handleMessage(e.data);
                }
            })
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

    private sendRpc<T>(method: string, replyMethod: string, params?: Record<string, unknown>): Promise<T> {
        const payload: DataExplorerMessage = {
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method,
        };

        if (params && Object.keys(params).length > 0) {
            payload.params = params;
        }

        const queue = this.pendingByReply.get(replyMethod) ?? [];
        this.pendingByReply.set(replyMethod, queue);

        this.log(`Sending RPC '${method}' on comm ${this.commId}.`);
        this.sidecarManager.sendCommMessage(this.commId, payload);

        return new Promise<T>((resolve, reject) => {
            queue.push({ resolve: resolve as (value: unknown) => void, reject });
        });
    }

    private handleMessage(data: unknown) {
        const message = data as DataExplorerMessage;
        const method = message.method;

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
            pending.resolve(message.result as unknown);
        }
    }

    private log(message: string) {
        this.outputChannel.appendLine(message);
    }
}
