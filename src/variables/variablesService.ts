import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ArkSidecarManager } from '../ark/sidecarManager';
import { ConnectionParams, InspectResult, RefreshParams, UpdateParams, VariablesEvent } from './protocol';
import { getLogger } from '../logging/logger';

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
    private connected = false;
    private readonly outputChannel = getLogger().createChannel('ark', 'variables');
    private readonly pendingInspectPaths: string[][] = [];
    private readonly _onDidReceiveUpdate = new vscode.EventEmitter<VariablesEvent>();
    public readonly onDidReceiveUpdate = this._onDidReceiveUpdate.event;

    constructor(private readonly sidecarManager: ArkSidecarManager) {
        this.log('VariablesService initialized.');
        sidecarManager.onDidOpenVariablesComm((e) => {
            if (this.commId === e.commId) {
                return;
            }

            this.commId = e.commId;
            this.updateConnectionState(true, 'comm opened');
            this.log(`Variables comm opened: ${e.commId}`);
            this.refresh();
        });

        this.commId = sidecarManager.getVariablesCommId();
        if (this.commId) {
            this.updateConnectionState(true, 'comm reused');
            this.log(`Variables comm reused: ${this.commId}`);
            this.refresh();
        }

        sidecarManager.onDidReceiveCommMessage((e) => {
            if (e.commId === this.commId) {
                this.handleMessage(e.data);
            }
        });

        sidecarManager.onDidStart(() => {
            this.log('Sidecar started; ensuring variables comm is open.');
            const commId = this.sidecarManager.ensureVariablesCommOpen();
            if (!commId) {
                this.log('Variables comm not available after sidecar start.');
                return;
            }
            this.commId = commId;
            this.updateConnectionState(true, 'sidecar started');
            this.refresh();
        });
    }

    private handleMessage(data: unknown) {
        const message = data as VariablesMessage;
        const method = message.method;
        this.log(`Received comm message: ${JSON.stringify(data)}`);

        if (message.error) {
            this.log(`Variables RPC error: ${JSON.stringify(message.error)}`);
        }

        if (method === 'refresh' || method === 'update') {
            this._onDidReceiveUpdate.fire({
                method,
                params: message.params as RefreshParams | UpdateParams,
            });
            return;
        }

        const result = message.result as RefreshParams | UpdateParams | InspectResult | undefined;
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
                return;
            }

            if ('children' in result) {
                const path = this.pendingInspectPaths.shift();
                if (!path) {
                    this.log('Inspect reply received without pending path.');
                    return;
                }
                this.log(`Dispatching inspect event for ${JSON.stringify(path)}.`);
                this._onDidReceiveUpdate.fire({
                    method: 'inspect',
                    params: {
                        path,
                        children: result.children ?? [],
                        length: result.length ?? 0,
                    },
                });
            }
        }
    }

    private log(message: string) {
        this.outputChannel.appendLine(message);
    }

    private updateConnectionState(connected: boolean, reason: string) {
        if (this.connected === connected) {
            return;
        }
        this.connected = connected;
        const params: ConnectionParams = { connected };
        this.log(`Variables connection state updated: ${connected ? 'connected' : 'disconnected'} (${reason}).`);
        this._onDidReceiveUpdate.fire({
            method: 'connection',
            params,
        });
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

    public inspect(path: string[]) {
        this.pendingInspectPaths.push(path);
        this.sendRpc('inspect', { path });
    }

    public view(path: string[]) {
        this.sendRpc('view', { path });
    }

    public disconnect(reason = 'session disconnected') {
        this.commId = undefined;
        this.pendingInspectPaths.length = 0;
        this.updateConnectionState(false, reason);
    }

    public isConnected(): boolean {
        return this.connected;
    }
}
