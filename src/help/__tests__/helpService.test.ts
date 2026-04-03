import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockExecuteCommand, MockEventEmitter } = vi.hoisted(() => {
    class HoistedEventEmitter<T> {
        private readonly listeners = new Set<(value: T) => void>();
        readonly event = (listener: (value: T) => void) => {
            this.listeners.add(listener);
            return {
                dispose: () => {
                    this.listeners.delete(listener);
                },
            };
        };

        fire(value: T): void {
            this.listeners.forEach((listener) => listener(value));
        }

        dispose(): void {
            this.listeners.clear();
        }
    }

    return {
        mockExecuteCommand: vi.fn(),
        MockEventEmitter: HoistedEventEmitter,
    };
});

vi.mock('../../ark/sessionRegistry', () => ({
    getActiveSessionName: () => undefined,
    getSessionDir: () => '/tmp/test-session',
}));

vi.mock('../../logging/logger', () => ({
    getLogger: () => ({
        log: vi.fn(),
    }),
    LogCategory: { Help: 'Help' },
}));

vi.mock('vscode', () => ({
    commands: {
        executeCommand: mockExecuteCommand,
    },
    EventEmitter: MockEventEmitter,
    Uri: {
        file: (fsPath: string) => ({ fsPath }),
    },
}));

import * as vscode from 'vscode';
import { HelpService, type HelpRpcRequest } from '../helpService';

describe('HelpService', () => {
    beforeEach(() => {
        mockExecuteCommand.mockReset();
    });

    test('showHelpTopic sends an RPC request with a top-level id', async () => {
        const sendRpcRequest = vi.fn<(request: HelpRpcRequest) => void>();
        const service = new HelpService(vscode.Uri.file('/tmp') as unknown as vscode.Uri, sendRpcRequest);

        await service.showHelpTopic('mean');

        expect(sendRpcRequest).toHaveBeenCalledTimes(1);
        expect(sendRpcRequest).toHaveBeenCalledWith({
            id: expect.stringMatching(/^help-/),
            method: 'show_help_topic',
            params: { topic: 'mean' },
        });
    });
});
