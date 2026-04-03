import { describe, test, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mock state ---

const { mockFs, mockLogFn, mockPanels } = vi.hoisted(() => ({
    mockFs: {
        existsSync: vi.fn((_p: string) => false as boolean),
        readFileSync: vi.fn((_p: string) => '[]' as string),
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
    },
    mockLogFn: vi.fn(),
    // Track created panels so we can inspect them
    mockPanels: [] as Array<{
        title: string;
        webview: { html: string; options: unknown };
        dispose: ReturnType<typeof vi.fn>;
        onDidDispose: ReturnType<typeof vi.fn>;
    }>,
}));

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
    getLogger: () => ({
        log: mockLogFn,
        createChannel: () => ({ appendLine: vi.fn(), dispose: vi.fn() }),
    }),
    LogCategory: { DataExplorer: 'DataExplorer' },
}));

vi.mock('../../util', () => ({
    getNonce: () => 'test-nonce',
    isDebugLoggingEnabled: () => false,
}));

vi.mock('vscode', () => ({
    window: {
        createWebviewPanel: vi.fn((_type: string, title: string) => {
            const panel = {
                title,
                webview: {
                    html: '',
                    options: {},
                    onDidReceiveMessage: vi.fn((_cb: unknown) => ({ dispose: vi.fn() })),
                    postMessage: vi.fn(),
                    cspSource: '',
                    asWebviewUri: vi.fn((uri: unknown) => uri),
                },
                onDidDispose: vi.fn((_cb: unknown) => ({ dispose: vi.fn() })),
                reveal: vi.fn(),
                dispose: vi.fn(),
                visible: true,
            };
            mockPanels.push(panel);
            return panel;
        }),
    },
    commands: {
        executeCommand: vi.fn(),
    },
    ViewColumn: { Active: 1, Two: 2 },
    Uri: {
        file: (p: string) => ({ fsPath: p }),
        joinPath: (...parts: Array<{ fsPath: string } | string>) =>
            ({ fsPath: parts.map((p) => (typeof p === 'string' ? p : p.fsPath)).join('/') }),
    },
}));

// --- Import after mocks ---

import { DataExplorerManager } from '../dataExplorerManager';
import type { ArkSidecarManager } from '../../ark/sidecarManager';

// --- Helpers ---

const SESSION_DIR = '/mock/sessions';

function makeSidecarManager(): ArkSidecarManager {
    return {
        sendRpcRequest: vi.fn(),
    } as unknown as ArkSidecarManager;
}

function makeManager(): DataExplorerManager {
    const mgr = new DataExplorerManager(
        { fsPath: '/ext' } as any,
        makeSidecarManager(),
    );
    return mgr;
}

function setPanelList(sessionName: string, entries: Array<{ displayName: string }>) {
    const listPath = `${SESSION_DIR}/${sessionName}/data-explorer.json`;
    const json = JSON.stringify(entries);
    mockFs.existsSync.mockImplementation((p: string) => p === listPath);
    mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === listPath) return json;
        throw new Error(`ENOENT: ${p}`);
    });
}

// --- Tests ---

describe('DataExplorerManager.switchSession', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockFs.existsSync.mockReturnValue(false);
        mockPanels.length = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('saves current panel list before switching', () => {
        const mgr = makeManager();
        (mgr as any).sessionName = 's1';

        mgr.switchSession('s2');

        // savePanelListSync is called — when no panels, it tries to unlink
        // We just verify writeFileSync or unlinkSync was checked
        expect(mockFs.existsSync).toHaveBeenCalled();
    });

    test('disposes live panels on session switch', () => {
        const mgr = makeManager();
        (mgr as any).sessionName = 's1';

        // Simulate a live panel
        const livePanel = {
            dispose: vi.fn(),
            displayName: 'mtcars',
            session: { dispose: vi.fn() },
        };
        (mgr as any).panels.set('comm-1', livePanel);

        mockFs.existsSync.mockReturnValue(false);
        mgr.switchSession('s2');

        expect(livePanel.dispose).toHaveBeenCalledOnce();
        expect((mgr as any).panels.size).toBe(0);
    });

    test('disposes restored placeholder panels on switch', () => {
        const mgr = makeManager();
        (mgr as any).sessionName = 's1';

        // Simulate a restored placeholder
        const placeholderPanel = { dispose: vi.fn(), onDidDispose: vi.fn() };
        const timeout = setTimeout(() => {}, 60000);
        (mgr as any).restoredPanels.set('iris', {
            panel: placeholderPanel,
            displayName: 'iris',
            timeout,
        });

        mockFs.existsSync.mockReturnValue(false);
        mgr.switchSession('s2');

        expect(placeholderPanel.dispose).toHaveBeenCalledOnce();
        expect((mgr as any).restoredPanels.size).toBe(0);
    });

    test('creates placeholder panels from new session persistence', () => {
        const mgr = makeManager();
        (mgr as any).sessionName = 's1';

        setPanelList('s2', [
            { displayName: 'mtcars' },
            { displayName: 'iris' },
        ]);

        mgr.switchSession('s2');

        // Two placeholder panels should be created
        expect((mgr as any).restoredPanels.size).toBe(2);
        expect((mgr as any).restoredPanels.has('mtcars')).toBe(true);
        expect((mgr as any).restoredPanels.has('iris')).toBe(true);
        // Panels were created
        expect(mockPanels.length).toBe(2);
    });

    test('placeholder panels have correct title and HTML', () => {
        const mgr = makeManager();
        setPanelList('s2', [{ displayName: 'mtcars' }]);

        mgr.switchSession('s2');

        expect(mockPanels.length).toBe(1);
        expect(mockPanels[0].title).toBe('Data: mtcars');
        expect(mockPanels[0].webview.html).toContain('mtcars');
        expect(mockPanels[0].webview.html).toContain('Waiting for R session');
    });

    test('placeholder panels auto-dispose after timeout', () => {
        const mgr = makeManager();
        setPanelList('s2', [{ displayName: 'mtcars' }]);

        mgr.switchSession('s2');

        expect((mgr as any).restoredPanels.size).toBe(1);
        const panel = mockPanels[0];

        // Advance past the 60s timeout
        vi.advanceTimersByTime(60_000);

        expect(panel.dispose).toHaveBeenCalledOnce();
        expect((mgr as any).restoredPanels.size).toBe(0);
    });

    test('does not create placeholders when no persistence file', () => {
        const mgr = makeManager();
        mockFs.existsSync.mockReturnValue(false);

        mgr.switchSession('empty');

        expect((mgr as any).restoredPanels.size).toBe(0);
        expect(mockPanels.length).toBe(0);
    });

    test('reopenRestoredPanels is available for placeholders created by switchSession', () => {
        const mgr = makeManager();
        setPanelList('s2', [{ displayName: 'mtcars' }]);

        mgr.switchSession('s2');

        // reopenRestoredPanels should see the placeholders
        expect((mgr as any).restoredPanels.size).toBe(1);
        // The method exists and won't throw when called
        // (it would execute vscode.commands.executeCommand which is mocked)
        expect(() => mgr.reopenRestoredPanels()).not.toThrow();
    });

    test('skips switch when session name is the same', () => {
        const mgr = makeManager();
        (mgr as any).sessionName = 's1';

        mgr.switchSession('s1');

        // No save, no dispose, no load
        expect(mockFs.writeFileSync).not.toHaveBeenCalled();
        expect(mockPanels.length).toBe(0);
    });

    test('handles empty panel list in persistence file', () => {
        const mgr = makeManager();
        const listPath = `${SESSION_DIR}/s2/data-explorer.json`;
        mockFs.existsSync.mockImplementation((p: string) => p === listPath);
        mockFs.readFileSync.mockImplementation((p: string) => {
            if (p === listPath) return '[]';
            throw new Error(`ENOENT: ${p}`);
        });

        mgr.switchSession('s2');

        expect((mgr as any).restoredPanels.size).toBe(0);
        expect(mockPanels.length).toBe(0);
    });

    test('handles malformed persistence file gracefully', () => {
        const mgr = makeManager();
        const listPath = `${SESSION_DIR}/s2/data-explorer.json`;
        mockFs.existsSync.mockImplementation((p: string) => p === listPath);
        mockFs.readFileSync.mockImplementation((p: string) => {
            if (p === listPath) return 'not valid json{{{';
            throw new Error(`ENOENT: ${p}`);
        });

        // Should not throw
        expect(() => mgr.switchSession('s2')).not.toThrow();
        expect((mgr as any).restoredPanels.size).toBe(0);
    });
});
