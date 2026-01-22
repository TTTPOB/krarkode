import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ArkSidecarManager } from '../ark/sidecarManager';
import { RefreshParams, UpdateParams, VariablesEvent } from './protocol';

type VariablesMessage = {
    id?: string;
    method?: string;
    params?: unknown;
    result?: unknown;
};

export class VariablesService {
    private commId: string | undefined;
    private readonly _onDidReceiveUpdate = new vscode.EventEmitter<VariablesEvent>();
    public readonly onDidReceiveUpdate = this._onDidReceiveUpdate.event;

    constructor(private readonly sidecarManager: ArkSidecarManager) {
        sidecarManager.onDidOpenVariablesComm((e) => {
            this.commId = e.commId;
            this.refresh();
        });

        sidecarManager.onDidReceiveCommMessage((e) => {
            if (e.commId === this.commId) {
                this.handleMessage(e.data);
            }
        });
    }

    private handleMessage(data: unknown) {
        const message = data as VariablesMessage;
        const method = message.method;

        if (method === 'refresh' || method === 'update') {
            this._onDidReceiveUpdate.fire({
                method,
                params: message.params as RefreshParams | UpdateParams,
            });
            return;
        }

        if (method === 'list' && message.result) {
            const result = message.result as RefreshParams;
            this._onDidReceiveUpdate.fire({
                method: 'refresh',
                params: result,
            });
        }
    }

    public refresh() {
        if (this.commId) {
            this.sidecarManager.sendCommMessage(this.commId, {
                id: crypto.randomUUID(),
                method: 'list',
            });
        }
    }

    public view(path: string[]) {
        if (this.commId) {
            this.sidecarManager.sendCommMessage(this.commId, {
                id: crypto.randomUUID(),
                method: 'view',
                params: { path },
            });
        }
    }
}
