import * as vscode from 'vscode';
import { ArkSidecarManager } from '../ark/sidecarManager';
import { VariablesEvent } from './protocol';

export class VariablesService {
    private commId: string | undefined;
    private readonly _onDidReceiveUpdate = new vscode.EventEmitter<VariablesEvent>();
    public readonly onDidReceiveUpdate = this._onDidReceiveUpdate.event;

    constructor(private readonly sidecarManager: ArkSidecarManager) {
        sidecarManager.onDidOpenVariablesComm((e) => {
            this.commId = e.commId;
            console.log('Variables Comm Opened:', this.commId);
            // Request initial list
            this.refresh();
        });

        sidecarManager.onDidReceiveCommMessage((e) => {
            if (e.commId === this.commId) {
                this.handleMessage(e.data);
            }
        });
    }

    private handleMessage(data: unknown) {
        const event = data as VariablesEvent;
        if (event.method === 'refresh' || event.method === 'update') {
            this._onDidReceiveUpdate.fire(event);
        }
    }

    public refresh() {
        if (this.commId) {
            this.sidecarManager.sendCommMessage(this.commId, { method: 'list' });
        }
    }

    public view(path: string[]) {
        if (this.commId) {
            this.sidecarManager.sendCommMessage(this.commId, { 
                method: 'view', 
                params: { path } 
            });
        }
    }
}
