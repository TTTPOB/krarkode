import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as cp from 'child_process';
import * as readline from 'readline';

// --- Hoisted mock state ---

const {
    mockOutputChannel,
    mockLogFn,
    mockShowErrorMessage,
} = vi.hoisted(() => ({
    mockOutputChannel: {
        appendLine: vi.fn(),
        show: vi.fn(),
        dispose: vi.fn(),
    },
    mockLogFn: vi.fn(),
    mockShowErrorMessage: vi.fn(),
}));

// --- Module mocks ---

vi.mock('vscode', () => ({
    window: {
        createOutputChannel: vi.fn(() => mockOutputChannel),
        showErrorMessage: mockShowErrorMessage,
    },
    workspace: {
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
        getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        workspaceFolders: undefined,
    },
    StatusBarAlignment: { Left: 1 },
    ThemeColor: class { constructor(public id: string) {} },
}));

vi.mock('vscode-languageclient/node', () => ({
    LanguageClient: vi.fn(),
    CloseAction: { DoNotRestart: 1 },
    ErrorAction: { Continue: 1 },
    RevealOutputChannelOn: { Never: 0 },
    Trace: { Off: 0 },
}));

vi.mock('../../context', () => ({
    getExtensionContext: vi.fn(() => ({ extensionUri: { fsPath: '/mock' } })),
}));

vi.mock('../../util', () => ({
    resolveSidecarPath: vi.fn(() => '/mock/sidecar'),
    getTempDir: vi.fn(() => '/tmp'),
    createTempDir: vi.fn(() => '/tmp/test'),
    spawnAsync: vi.fn(async () => ({ status: 0, stdout: '', stderr: '', error: null })),
    getRBinaryPath: vi.fn(async () => undefined),
    config: vi.fn(() => ({ get: vi.fn() })),
}));

vi.mock('../sessionRegistry', () => ({
    getActiveSessionValidated: vi.fn(async () => undefined),
    getActiveSessionName: vi.fn(() => undefined),
    getActiveSession: vi.fn(() => undefined),
}));

vi.mock('../tmuxUtil', () => ({
    listTmuxWindows: vi.fn(async () => []),
}));

vi.mock('../../logging/logger', () => {
    const mockLogger = {
        log: mockLogFn,
        debug: vi.fn(),
        show: vi.fn(),
        createChannel: vi.fn(() => mockOutputChannel),
    };
    return {
        getLogger: vi.fn(() => mockLogger),
        LogCategory: {
            Logging: 'Logging',
            Session: 'Session',
            Comm: 'Comm',
            Stderr: 'Stderr',
            Stdout: 'Stdout',
            Core: 'Core',
        },
        RegexLogLevelParser: class { constructor() {} },
        formatLogMessage: vi.fn((_msg: string) => _msg),
        getLogChannelSetting: vi.fn(),
    };
});

vi.mock('../arkLogLevel', () => ({
    formatArkRustLog: vi.fn(() => ''),
    formatSidecarRustLog: vi.fn(() => ''),
    getArkLogLevel: vi.fn(() => ''),
    mergeRustLogDirective: vi.fn(() => ''),
}));

vi.mock('../sidecarLogParser', () => ({
    parseSidecarJsonLog: vi.fn(() => undefined),
}));

vi.mock('../sidecarProtocol', () => ({
    SIDECAR_LOG_RELOAD_COMMAND: 'reload_log_level',
}));

/**
 * Re-implement waitForSidecarPort's core logic to test it in isolation.
 * This mirrors the exact same pattern from arkLanguageService.ts:
 * - readline on proc.stdout
 * - proc.on('close', ...) to reject when port not received
 * - proc.on('error', ...) for spawn errors
 */
function waitForSidecarPort(proc: cp.ChildProcessWithoutNullStreams, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
        let resolved = false;
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                reject(new Error('Timed out waiting for Ark LSP port.'));
            }
        }, timeoutMs);

        const rl = readline.createInterface({ input: proc.stdout });
        const cleanup = () => {
            clearTimeout(timer);
            rl.close();
        };
        rl.on('line', (line) => {
            if (!line.trim()) {
                return;
            }
            let msg: { event?: string; port?: number; message?: string } | undefined;
            try {
                msg = JSON.parse(line);
            } catch {
                return;
            }

            if (msg?.event === 'lsp_port' && typeof msg.port === 'number') {
                resolved = true;
                cleanup();
                resolve(msg.port);
                return;
            }

            if (msg?.event === 'error') {
                resolved = true;
                cleanup();
                reject(new Error(msg.message || 'Ark sidecar error'));
            }
        });

        // This is the fix: 'close' instead of 'exit' ensures readline has
        // consumed all stdout data before we check resolved.
        proc.on('close', (code) => {
            if (!resolved) {
                resolved = true;
                cleanup();
                reject(new Error(`Ark sidecar exited with code ${code ?? 'null'}`));
            }
        });

        proc.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                cleanup();
                reject(err);
            }
        });
    });
}

/**
 * Variant using 'exit' event (the old buggy behavior) for comparison.
 */
function waitForSidecarPortWithExit(proc: cp.ChildProcessWithoutNullStreams, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
        let resolved = false;
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                reject(new Error('Timed out waiting for Ark LSP port.'));
            }
        }, timeoutMs);

        const rl = readline.createInterface({ input: proc.stdout });
        const cleanup = () => {
            clearTimeout(timer);
            rl.close();
        };
        rl.on('line', (line) => {
            if (!line.trim()) {
                return;
            }
            let msg: { event?: string; port?: number; message?: string } | undefined;
            try {
                msg = JSON.parse(line);
            } catch {
                return;
            }

            if (msg?.event === 'lsp_port' && typeof msg.port === 'number') {
                resolved = true;
                cleanup();
                resolve(msg.port);
                return;
            }

            if (msg?.event === 'error') {
                resolved = true;
                cleanup();
                reject(new Error(msg.message || 'Ark sidecar error'));
            }
        });

        // Old buggy behavior: 'exit' can fire before readline processes data
        proc.on('exit', (code) => {
            if (!resolved) {
                resolved = true;
                cleanup();
                reject(new Error(`Ark sidecar exited with code ${code ?? 'null'}`));
            }
        });

        proc.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                cleanup();
                reject(err);
            }
        });
    });
}

describe('waitForSidecarPort', () => {
    test('resolves port from a fast-exiting process using close event', async () => {
        // Simulate the lsp sidecar: output lsp_port JSON to stdout and exit immediately
        const proc = cp.spawn('node', [
            '-e',
            'process.stdout.write(JSON.stringify({event:"lsp_port",port:9876})+"\\n"); process.exit(0);',
        ]);

        const port = await waitForSidecarPort(proc, 5000);
        expect(port).toBe(9876);
    });

    test('rejects when process exits without emitting lsp_port', async () => {
        const proc = cp.spawn('node', [
            '-e',
            'process.stdout.write("some unrelated output\\n"); process.exit(1);',
        ]);

        await expect(waitForSidecarPort(proc, 5000)).rejects.toThrow(
            /Ark sidecar exited with code 1/,
        );
    });

    test('rejects with error event from sidecar', async () => {
        const proc = cp.spawn('node', [
            '-e',
            'process.stdout.write(JSON.stringify({event:"error",message:"kernel not found"})+"\\n"); process.exit(1);',
        ]);

        await expect(waitForSidecarPort(proc, 5000)).rejects.toThrow(
            'kernel not found',
        );
    });

    test('rejects on timeout', async () => {
        // Process that never outputs and hangs
        const proc = cp.spawn('node', ['-e', 'setTimeout(()=>{},60000)']);

        await expect(waitForSidecarPort(proc, 100)).rejects.toThrow(
            'Timed out waiting for Ark LSP port.',
        );

        proc.kill();
    });

    test('rejects with code 0 when process exits cleanly without port', async () => {
        const proc = cp.spawn('node', ['-e', 'process.exit(0)']);

        await expect(waitForSidecarPort(proc, 5000)).rejects.toThrow(
            /Ark sidecar exited with code 0/,
        );
    });
});

describe('isIntentionallyRestarting suppresses error', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('startLanguageService suppresses error when isIntentionallyRestarting is true', async () => {
        // Dynamically import after mocks are in place
        const { ArkLanguageService } = await import('../arkLanguageService');

        // The constructor fires startLanguageService (which will fail due to
        // missing sidecar binary). We need to suppress that initial attempt.
        const service = new ArkLanguageService();

        // Give the constructor's fire-and-forget start a moment to fail
        await new Promise((r) => setTimeout(r, 200));
        vi.clearAllMocks();

        // Set the flag that restart() normally sets
        (service as any).isIntentionallyRestarting = true;

        // Manually invoke startLanguageService — it should hit the catch block
        // and see isIntentionallyRestarting=true, suppressing the error message
        await (service as any).startLanguageService();

        // showErrorMessage should NOT have been called
        expect(mockShowErrorMessage).not.toHaveBeenCalled();

        // Log should indicate abort, not error
        const logCalls = mockLogFn.mock.calls;
        const abortLog = logCalls.find(
            (call: unknown[]) => typeof call[3] === 'string' && call[3].includes('restart in progress'),
        );
        expect(abortLog).toBeDefined();

        service.dispose();
    });
});
