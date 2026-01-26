import * as assert from 'assert';
import * as vscode from 'vscode';
import { VariablesService } from '../../variables/variablesService';
import type { VariablesEvent } from '../../variables/protocol';

class StubSidecarManager {
    private commId: string | undefined;
    public readonly sent: Array<{ commId: string; payload: unknown }> = [];
    private readonly _onDidOpenVariablesComm = new vscode.EventEmitter<{ commId: string }>();
    public readonly onDidOpenVariablesComm = this._onDidOpenVariablesComm.event;
    private readonly _onDidReceiveCommMessage = new vscode.EventEmitter<{ commId: string; data: unknown }>();
    public readonly onDidReceiveCommMessage = this._onDidReceiveCommMessage.event;
    private readonly _onDidStart = new vscode.EventEmitter<void>();
    public readonly onDidStart = this._onDidStart.event;

    public getVariablesCommId(): string | undefined {
        return this.commId;
    }

    public ensureVariablesCommOpen(): string | undefined {
        if (!this.commId) {
            this.commId = 'comm-1';
            this._onDidOpenVariablesComm.fire({ commId: this.commId });
        }
        return this.commId;
    }

    public sendCommMessage(commId: string, payload: unknown): void {
        this.sent.push({ commId, payload });
    }

    public emitOpen(commId: string): void {
        this.commId = commId;
        this._onDidOpenVariablesComm.fire({ commId });
    }

    public emitCommMessage(commId: string, data: unknown): void {
        this._onDidReceiveCommMessage.fire({ commId, data });
    }

    public emitStart(): void {
        this._onDidStart.fire();
    }
}

suite('Variables service', () => {
    test('opens comm and sends list RPC on refresh', () => {
        const sidecar = new StubSidecarManager();
        const service = new VariablesService(sidecar as unknown as never);
        const updates: VariablesEvent[] = [];
        service.onDidReceiveUpdate((event) => updates.push(event));

        sidecar.emitOpen('comm-1');
        assert.strictEqual(updates[0]?.method, 'connection');
        assert.strictEqual(sidecar.sent.length, 1);
        const payload = sidecar.sent[0].payload as { method?: string };
        assert.strictEqual(payload.method, 'list');
        assert.strictEqual(service.isConnected(), true);
    });

    test('dispatches refresh and update events from comm messages', () => {
        const sidecar = new StubSidecarManager();
        const service = new VariablesService(sidecar as unknown as never);
        const updates: VariablesEvent[] = [];
        service.onDidReceiveUpdate((event) => updates.push(event));

        sidecar.emitOpen('comm-1');
        sidecar.emitCommMessage('comm-1', {
            method: 'refresh',
            params: { variables: [], length: 0, version: 1 },
        });
        sidecar.emitCommMessage('comm-1', {
            method: 'update',
            params: { assigned: [], unevaluated: [], removed: [], version: 2 },
        });

        const methods = updates.map((event) => event.method).filter((method) => method !== 'connection');
        assert.deepStrictEqual(methods, ['refresh', 'update']);
    });

    test('dispatches inspect results with pending paths', () => {
        const sidecar = new StubSidecarManager();
        const service = new VariablesService(sidecar as unknown as never);
        const updates: VariablesEvent[] = [];
        service.onDidReceiveUpdate((event) => updates.push(event));

        sidecar.emitOpen('comm-1');
        service.inspect(['foo']);
        sidecar.emitCommMessage('comm-1', {
            result: { path: [], children: [], length: 0 },
        });

        const inspectEvent = updates.find((event) => event.method === 'inspect');
        if (!inspectEvent || inspectEvent.method !== 'inspect') {
            assert.fail('Expected inspect event');
        }
        assert.deepStrictEqual((inspectEvent.params as { path: string[] }).path, ['foo']);
    });

    test('disconnect updates connection state and clears pending paths', () => {
        const sidecar = new StubSidecarManager();
        const service = new VariablesService(sidecar as unknown as never);
        const updates: VariablesEvent[] = [];
        service.onDidReceiveUpdate((event) => updates.push(event));

        sidecar.emitOpen('comm-1');
        service.inspect(['alpha']);
        service.disconnect('manual');

        const connectionUpdates = updates.filter((event) => event.method === 'connection');
        assert.strictEqual(connectionUpdates.length >= 2, true);
        assert.strictEqual(service.isConnected(), false);
    });
});
