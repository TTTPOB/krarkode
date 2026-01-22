import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ArkSidecarManager } from '../ark/sidecarManager';
import { RefreshParams, UpdateParams, VariablesEvent } from './protocol';

type VariablesMessage = {
    jsonrpc?: string;
    id?: string;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: unknown;
};

export class VariablesService {
    private commId: string | undefined;
    private readonly outputChannel = vscode.window.createOutputChannel('Ark Variables');
    private readonly _onDidReceiveUpdate = new vscode.EventEmitter<VariablesEvent>();
    public readonly onDidReceiveUpdate = this._onDidReceiveUpdate.event;

    constructor(private readonly sidecarManager: ArkSidecarManager) {
        this.log('VariablesService initialized.');
        sidecarManager.onDidOpenVariablesComm((e) => {
            if (this.commId === e.commId) {
                return;
            }

            this.commId = e.commId;
            this.log(`Variables comm opened: ${e.commId}`);
            this.refresh();
        });

        this.commId = sidecarManager.getVariablesCommId();
        if (this.commId) {
            this.log(`Variables comm reused: ${this.commId}`);
            this.refresh();
        }

        sidecarManager.onDidReceiveCommMessage((e) => {
            if (e.commId === this.commId) {
                this.handleMessage(e.data);
            }
        });
    }

    private handleMessage(data: unknown) {
        const message = data as VariablesMessage;
        const method = message.method;
        this.log(`Received comm message: ${JSON.stringify(data)}`);

        if (method === 'refresh' || method === 'update') {
            this._onDidReceiveUpdate.fire({
                method,
                params: message.params as RefreshParams | UpdateParams,
            });
            return;
        }

        const result = message.result as RefreshParams | UpdateParams | undefined;
        if (result) {
            if ('variables' in result) {
                this.log('Dispatching refresh event.');
                this._onDidReceiveUpdate.fire({
                    method: 'refresh',
                    params: result as RefreshParams,
                });
                return;
            }

            if ('assigned' in result) {
                this.log('Dispatching update event.');
                this._onDidReceiveUpdate.fire({
                    method: 'update',
                    params: result as UpdateParams,
                });
            }
        }
    }

    private log(message: string) {
        this.outputChannel.appendLine(message);
    }

    private sendRpc(method: string, params?: Record<string, unknown>) {
        this.commId ??= this.sidecarManager.ensureVariablesCommOpen();
        if (!this.commId) {
            this.log(`Skipped RPC '${method}': variables comm unavailable.`);
            return;
        }

        const payload: VariablesMessage = {
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method,
        } as VariablesMessage;

        if (params) {
            payload.params = params;
        }

        this.log(`Sending RPC '${method}' on comm ${this.commId}.`);
        this.sidecarManager.sendCommMessage(this.commId, payload);
    }

    public refresh() {
        this.sendRpc('list');
    }

    public view(path: string[]) {
        this.sendRpc('view', { path });
    }
}
