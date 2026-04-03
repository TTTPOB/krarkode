import { beforeEach, describe, expect, test, vi } from 'vitest';

// --- Hoisted mock state ---

const { mockFs, MockEventEmitter, mockLogFn } = vi.hoisted(() => {
    class HoistedEventEmitter<T> {
        private readonly listeners = new Set<(value: T) => void>();
        readonly event = (listener: (value: T) => void) => {
            this.listeners.add(listener);
            return { dispose: () => { this.listeners.delete(listener); } };
        };
        fire(value: T): void { this.listeners.forEach((l) => l(value)); }
        dispose(): void { this.listeners.clear(); }
    }

    return {
        mockFs: {
            existsSync: vi.fn((_p: string) => false as boolean),
            readFileSync: vi.fn((_p: string) => '' as string),
            writeFileSync: vi.fn(),
            unlinkSync: vi.fn(),
        },
        MockEventEmitter: HoistedEventEmitter,
        mockLogFn: vi.fn(),
    };
});

// --- Module mocks ---

vi.mock('fs', () => ({
    ...mockFs,
    default: mockFs,
}));

vi.mock('../../ark/sessionRegistry', () => ({
    getActiveSessionName: () => undefined,
    getSessionDir: (name: string) => `/mock/sessions/${name}`,
}));

vi.mock('../../logging/logger', () => ({
    getLogger: () => ({ log: mockLogFn }),
    LogCategory: { Help: 'Help' },
}));

vi.mock('vscode', () => ({
    commands: { executeCommand: vi.fn() },
    EventEmitter: MockEventEmitter,
    Uri: { file: (p: string) => ({ fsPath: p }) },
}));

// --- Import after mocks ---

import * as vscode from 'vscode';
import { HelpService } from '../helpService';

// --- Helpers ---

const SESSION_DIR = '/mock/sessions';

function makeHelpState(title: string, content: string) {
    return JSON.stringify({ title, content, kind: 'html', scrollPosition: 0 });
}

function setHelpState(sessionName: string, title: string, content: string) {
    const statePath = `${SESSION_DIR}/${sessionName}/help-state.json`;
    const json = makeHelpState(title, content);
    mockFs.existsSync.mockImplementation((p: string) => p === statePath);
    mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === statePath) return json;
        throw new Error(`ENOENT: ${p}`);
    });
}

function createService(): HelpService {
    return new HelpService(vscode.Uri.file('/ext') as unknown as vscode.Uri, vi.fn());
}

// --- Tests ---

describe('HelpService.switchSession', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFs.existsSync.mockReturnValue(false);
    });

    test('saves current session state before switching', () => {
        const service = createService();
        // Manually set session and push an entry
        (service as any).sessionName = 's1';
        (service as any).helpEntriesStack.push({
            id: 'e1', topic: '', title: 'mean', content: '<p>Help</p>',
            kind: 'html', entryType: 'help', scrollPosition: 42,
        });
        (service as any).currentIndex = 0;

        service.switchSession('s2');

        expect(mockFs.writeFileSync).toHaveBeenCalledWith(
            `${SESSION_DIR}/s1/help-state.json`,
            expect.any(String),
        );
        const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        expect(written.title).toBe('mean');
        expect(written.scrollPosition).toBe(42);
    });

    test('loads help state from new session', () => {
        setHelpState('s2', 'summary', '<h1>Summary</h1>');
        const service = createService();

        service.switchSession('s2');

        expect(service.hasEntries).toBe(true);
        expect(service.currentHelpEntry?.title).toBe('summary');
        expect(service.currentHelpEntry?.content).toBe('<h1>Summary</h1>');
    });

    test('hasEntries is false when new session has no state', () => {
        mockFs.existsSync.mockReturnValue(false);
        const service = createService();

        service.switchSession('empty');

        expect(service.hasEntries).toBe(false);
        expect(service.currentHelpEntry).toBeUndefined();
    });

    test('fires onDidChangeHelpEntry on switch', () => {
        const service = createService();
        const listener = vi.fn();
        service.onDidChangeHelpEntry(listener);

        service.switchSession('s2');

        expect(listener).toHaveBeenCalledOnce();
    });

    test('clears in-memory state before loading', () => {
        const service = createService();
        (service as any).sessionName = 's1';
        (service as any).helpEntriesStack.push({
            id: 'e1', topic: '', title: 'old', content: 'old content',
            kind: 'html', entryType: 'help', scrollPosition: 0,
        });
        (service as any).currentIndex = 0;
        (service as any).baseUrl = 'http://127.0.0.1:1234';

        mockFs.existsSync.mockReturnValue(false);
        service.switchSession('s2');

        expect(service.hasEntries).toBe(false);
        expect((service as any).baseUrl).toBeUndefined();
    });

    test('skips switch when session name is the same', () => {
        const service = createService();
        (service as any).sessionName = 's1';
        (service as any).helpEntriesStack.push({
            id: 'e1', topic: '', title: 'stay', content: 'content',
            kind: 'html', entryType: 'help', scrollPosition: 0,
        });
        (service as any).currentIndex = 0;

        service.switchSession('s1');

        // State should not be cleared
        expect(service.hasEntries).toBe(true);
        expect(service.currentHelpEntry?.title).toBe('stay');
        expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    test('removes stale state file when current entry is empty', () => {
        const service = createService();
        (service as any).sessionName = 's1';
        // No entries — nothing to save

        const statePath = `${SESSION_DIR}/s1/help-state.json`;
        mockFs.existsSync.mockImplementation((p: string) => p === statePath);

        service.switchSession('s2');

        expect(mockFs.unlinkSync).toHaveBeenCalledWith(statePath);
    });

    test('handles switch to undefined session', () => {
        const service = createService();
        (service as any).sessionName = 's1';

        service.switchSession(undefined);

        expect(service.hasEntries).toBe(false);
    });
});
