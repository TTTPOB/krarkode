import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ArkSidecarManager } from '../ark/sidecarManager';
import { ConnectionParams, ErrorParams, InspectResult, RefreshParams, UpdateParams, VariablesEvent } from './protocol';
import { getLogger, LogCategory } from '../logging/logger';

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
    private lastErrorMessage: string | undefined;
    private lastErrorAt = 0;
    private readonly outputChannel = getLogger().createChannel('ark', LogCategory.Variables);
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
                this.reportError('Variables connection unavailable after sidecar start.', 'No comm id returned.');
                return;
            }
            this.commId = commId;
            this.updateConnectionState(true, 'sidecar started');
            this.refresh();
        });
    }

    private handleMessage(data: unknown) {
        if (!isVariablesMessage(data)) {
            this.log('Variables message is not an object.');
            return;
        }
        const message = data;
        const method = typeof message.method === 'string' ? message.method : undefined;
        this.log(`Received comm message: ${JSON.stringify(data)}`);

        if (message.error) {
            const detail = JSON.stringify(message.error);
            this.reportError('Variables request failed. Check the Krarkode Sidecar output for details.', detail);
        }

        if (method === 'refresh' || method === 'update') {
            const params = message.params;
            if (!isRecord(params)) {
                this.log(`Variables ${method} message missing params.`);
                return;
            }
            if (method === 'refresh') {
                if (!isRefreshParams(params)) {
                    this.log('Variables refresh params invalid.');
                    return;
                }
                this._onDidReceiveUpdate.fire({
                    method,
                    params,
                });
                this.clearError('refresh update received');
                return;
            }
            if (!isUpdateParams(params)) {
                this.log('Variables update params invalid.');
                return;
            }
            this._onDidReceiveUpdate.fire({
                method,
                params,
            });
            this.clearError('update received');
            return;
        }

        const result = isRecord(message.result) ? message.result : undefined;
        if (result) {
            if (isRefreshParams(result)) {
                this.log('Dispatching refresh event.');
                this._onDidReceiveUpdate.fire({
                    method: 'refresh',
                    params: result as RefreshParams,
                });
                this.clearError('refresh result received');
                return;
            }

            if (isUpdateParams(result)) {
                this.log('Dispatching update event.');
                this._onDidReceiveUpdate.fire({
                    method: 'update',
                    params: result as UpdateParams,
                });
                this.clearError('update result received');
                return;
            }

            if (isInspectResult(result)) {
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
                this.clearError('inspect result received');
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
        if (connected) {
            this.clearError('connected');
        }
    }

    private sendRpc(method: string, params?: Record<string, unknown>) {
        this.commId ??= this.sidecarManager.ensureVariablesCommOpen();
        if (!this.commId) {
            this.log(`Skipped RPC '${method}': variables comm unavailable.`);
            this.reportError(
                'Variables connection unavailable. Start or attach an Ark session.',
                `RPC '${method}' skipped.`,
            );
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

    private reportError(message: string, detail?: string) {
        const now = Date.now();
        if (message === this.lastErrorMessage && now - this.lastErrorAt < 15000) {
            return;
        }
        this.lastErrorMessage = message;
        this.lastErrorAt = now;
        const detailForBanner = detail && detail.length > 160 ? `${detail.slice(0, 160)}…` : detail;
        const params: ErrorParams = { message, detail: detailForBanner };
        const detailSuffix = detail ? ` (${detail})` : '';
        this.log(`Variables error: ${message}${detailSuffix}`);
        this._onDidReceiveUpdate.fire({
            method: 'error',
            params,
        });
    }

    private clearError(reason: string) {
        if (!this.lastErrorMessage) {
            return;
        }
        this.lastErrorMessage = undefined;
        this.lastErrorAt = 0;
        this.log(`Clearing variables error (${reason}).`);
        const params: ErrorParams = {};
        this._onDidReceiveUpdate.fire({
            method: 'error',
            params,
        });
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isVariablesMessage(value: unknown): value is VariablesMessage {
    return isRecord(value);
}

function isRefreshParams(value: unknown): value is RefreshParams {
    return (
        isRecord(value) &&
        Array.isArray(value.variables) &&
        typeof value.length === 'number' &&
        typeof value.version === 'number'
    );
}

function isUpdateParams(value: unknown): value is UpdateParams {
    return (
        isRecord(value) &&
        Array.isArray(value.assigned) &&
        Array.isArray(value.removed) &&
        typeof value.version === 'number'
    );
}

function isInspectResult(value: unknown): value is InspectResult {
    return (
        isRecord(value) &&
        Array.isArray(value.path) &&
        Array.isArray(value.children) &&
        typeof value.length === 'number'
    );
}
