import { describe, test, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mock state ---

const { mockFs, mockPanel, mockLogFn } = vi.hoisted(() => {
    const panel = {
        webview: {
            html: '',
            options: {},
            onDidReceiveMessage: vi.fn((_cb: unknown) => ({ dispose: vi.fn() })),
            postMessage: vi.fn(),
            cspSource: '',
            asWebviewUri: vi.fn((uri: unknown) => uri),
        },
        onDidDispose: vi.fn((_cb: unknown) => ({ dispose: vi.fn() })),
        onDidChangeViewState: vi.fn((_cb: unknown) => ({ dispose: vi.fn() })),
        reveal: vi.fn(),
        dispose: vi.fn(),
        visible: true,
        title: '',
    };
    return {
        mockFs: {
            existsSync: vi.fn((_p: string) => false as boolean),
            readFileSync: vi.fn((_p: string) => '' as string),
            writeFileSync: vi.fn(),
            mkdirSync: vi.fn(),
            unlinkSync: vi.fn(),
        },
        mockPanel: panel,
        mockLogFn: vi.fn(),
    };
});

// --- Module mocks ---

vi.mock('fs', () => ({
    ...mockFs,
    default: mockFs,
}));

vi.mock('../../context', () => ({
    getExtensionContext: () => ({
        extensionUri: { fsPath: '/ext' },
        globalState: { get: vi.fn(), update: vi.fn() },
        globalStorageUri: { fsPath: '/mock/storage' },
    }),
}));

vi.mock('../sessionRegistry', () => ({
    getActiveSessionName: () => undefined,
    getSessionDir: (name: string) => `/mock/storage/ark-sessions/${name}`,
    getSessionsDir: () => '/mock/storage/ark-sessions',
}));

vi.mock('../../util', () => ({
    config: () => ({ get: () => undefined }),
    getNonce: () => 'test-nonce',
}));

vi.mock('../../logging/logger', () => ({
    getLogger: () => ({
        log: mockLogFn,
        createChannel: () => ({ appendLine: vi.fn(), dispose: vi.fn() }),
    }),
    LogCategory: { Plot: 'Plot' },
}));

vi.mock('vscode', () => ({
    window: {
        createWebviewPanel: vi.fn(() => mockPanel),
    },
    ViewColumn: { Two: 2, Active: 1 },
    Uri: {
        file: (p: string) => ({ fsPath: p }),
        joinPath: (...parts: Array<{ fsPath: string } | string>) =>
            ({ fsPath: parts.map((p) => (typeof p === 'string' ? p : p.fsPath)).join('/') }),
    },
    EventEmitter: class {
        private listeners = new Set<(v: unknown) => void>();
        event = (l: (v: unknown) => void) => {
            this.listeners.add(l);
            return { dispose: () => this.listeners.delete(l) };
        };
        fire(v: unknown) { this.listeners.forEach((l) => l(v)); }
        dispose() { this.listeners.clear(); }
    },
}));

// --- Import after mocks ---

import { PlotManager } from '../plotManager';

// --- Helpers ---

const SESSION_DIR = '/mock/storage/ark-sessions';

function makePlotHistory(plots: Array<{ id: string; base64Data: string; mimeType: string }>, currentIndex?: number) {
    return JSON.stringify({
        plots,
        currentIndex: currentIndex ?? plots.length - 1,
        zoom: 100,
    });
}

function setSessionPlots(sessionName: string, plots: Array<{ id: string; base64Data: string; mimeType: string }>) {
    const historyPath = `${SESSION_DIR}/${sessionName}/plot-history.json`;
    const json = makePlotHistory(plots);
    mockFs.existsSync.mockImplementation((p: string) => p === historyPath);
    mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === historyPath) return json;
        throw new Error(`ENOENT: ${p}`);
    });
}

// --- Tests ---

describe('PlotManager.switchSession', () => {
    let manager: PlotManager;

    beforeEach(() => {
        vi.clearAllMocks();
        mockFs.existsSync.mockReturnValue(false);
        mockPanel.dispose.mockReset();
        manager = new PlotManager();
    });

    test('saves current session before switching', () => {
        // Set up session with a plot via addPlot
        (manager as any).sessionName = 's1';
        (manager as any).plots.push({ id: 'p1', base64Data: 'AAAA', mimeType: 'image/png', timestamp: 1 });
        (manager as any).currentIndex = 0;

        manager.switchSession('s2');

        // Should have written s1's history
        expect(mockFs.writeFileSync).toHaveBeenCalledWith(
            `${SESSION_DIR}/s1/plot-history.json`,
            expect.any(String),
        );
        const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        expect(written.plots).toHaveLength(1);
        expect(written.plots[0].id).toBe('p1');
    });

    test('loads plots from new session persistence', () => {
        const plots = [
            { id: 'p1', base64Data: 'AAAA', mimeType: 'image/png' },
            { id: 'p2', base64Data: 'BBBB', mimeType: 'image/png' },
        ];
        setSessionPlots('s2', plots);

        manager.switchSession('s2');

        expect(manager.getPlotCount()).toBe(2);
    });

    test('closes panel when new session has no plots', () => {
        // Simulate existing panel
        (manager as any).panel = mockPanel;
        mockFs.existsSync.mockReturnValue(false);

        manager.switchSession('empty-session');

        expect(mockPanel.dispose).toHaveBeenCalledOnce();
        expect(manager.getPlotCount()).toBe(0);
    });

    test('renders webview when new session has plots', () => {
        (manager as any).panel = mockPanel;
        setSessionPlots('s2', [{ id: 'p1', base64Data: 'AAAA', mimeType: 'image/png' }]);

        manager.switchSession('s2');

        // Panel should not be disposed
        expect(mockPanel.dispose).not.toHaveBeenCalled();
        // Webview HTML should have been set (renderWebview was called)
        expect(mockPanel.webview.html).not.toBe('');
    });

    test('clears in-memory state before loading new session', () => {
        (manager as any).sessionName = 's1';
        (manager as any).plots.push({ id: 'old', base64Data: 'OLD', mimeType: 'image/png', timestamp: 1 });
        (manager as any).currentIndex = 0;

        mockFs.existsSync.mockReturnValue(false);
        manager.switchSession('s2');

        expect(manager.getPlotCount()).toBe(0);
    });

    test('skips switch when session name is the same', () => {
        (manager as any).sessionName = 's1';
        (manager as any).plots.push({ id: 'p1', base64Data: 'AAAA', mimeType: 'image/png', timestamp: 1 });
        (manager as any).currentIndex = 0;

        manager.switchSession('s1');

        // Plots should remain unchanged
        expect(manager.getPlotCount()).toBe(1);
        expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    test('handles switch to undefined session', () => {
        (manager as any).sessionName = 's1';
        (manager as any).panel = mockPanel;

        manager.switchSession(undefined);

        // No session → no plots → panel closed
        expect(mockPanel.dispose).toHaveBeenCalledOnce();
    });
});
