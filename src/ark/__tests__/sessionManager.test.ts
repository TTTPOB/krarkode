import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ArkSessionEntry } from '../sessionRegistry';

// --- Hoisted mock state ---

const {
    mockShowWarningMessage,
    mockShowInformationMessage,
    mockShowErrorMessage,
    mockStatusBarItem,
    MockMarkdownString,
    mockGetSessionsDir,
    mockUpsertSessionValidated,
    mockGetActiveSession,
    mockGetTmuxPanePid,
    mockFsExistsSync,
    mockFsReadFileSync,
    mockLogFn,
} = vi.hoisted(() => {
    const statusBarItem = {
        command: undefined as string | undefined,
        text: '',
        tooltip: undefined as unknown,
        backgroundColor: undefined as unknown,
        show: vi.fn(),
        dispose: vi.fn(),
    };
    return {
        mockShowWarningMessage: vi.fn(),
        mockShowInformationMessage: vi.fn(),
        mockShowErrorMessage: vi.fn(),
        mockStatusBarItem: statusBarItem,
        MockMarkdownString: class {
            value: string;
            isTrusted = false;
            supportThemeIcons = false;
            constructor(value?: string) {
                this.value = value ?? '';
            }
        },
        mockGetSessionsDir: vi.fn(() => '/mock/sessions'),
        mockUpsertSessionValidated: vi.fn(async () => {}),
        mockGetActiveSession: vi.fn(() => undefined),
        mockGetTmuxPanePid: vi.fn(async () => undefined as number | undefined),
        mockFsExistsSync: vi.fn((_p: string) => false as boolean),
        mockFsReadFileSync: vi.fn((_p: string) => '' as string),
        mockLogFn: vi.fn(),
    };
});

// --- Module mocks ---

vi.mock('vscode', () => ({
    window: {
        createStatusBarItem: vi.fn(() => mockStatusBarItem),
        showWarningMessage: mockShowWarningMessage,
        showInformationMessage: mockShowInformationMessage,
        showErrorMessage: mockShowErrorMessage,
        showQuickPick: vi.fn(),
        showInputBox: vi.fn(),
        createQuickPick: vi.fn(() => ({
            show: vi.fn(),
            hide: vi.fn(),
            dispose: vi.fn(),
            onDidAccept: vi.fn(),
            onDidHide: vi.fn(),
        })),
        activeTerminal: undefined,
        createTerminal: vi.fn(),
    },
    commands: { registerCommand: vi.fn() },
    StatusBarAlignment: { Right: 2 },
    ThemeColor: vi.fn(),
    MarkdownString: MockMarkdownString,
    QuickPickItemKind: { Separator: -1 },
    env: { clipboard: { writeText: vi.fn() } },
}));

vi.mock('../sessionRegistry', () => ({
    getSessionsDir: mockGetSessionsDir,
    getActiveSession: mockGetActiveSession,
    getActiveSessionName: vi.fn(),
    setActiveSessionName: vi.fn(),
    loadRegistryValidated: vi.fn(async () => []),
    upsertSessionValidated: mockUpsertSessionValidated,
    findSessionValidated: vi.fn(async () => undefined),
    getActiveSessionValidated: vi.fn(async () => undefined),
    updateSessionAttachmentValidated: vi.fn(async () => {}),
    loadRegistry: vi.fn(() => []),
    saveRegistry: vi.fn(),
}));

vi.mock('../tmuxUtil', () => ({
    getTmuxPanePid: mockGetTmuxPanePid,
    getTmuxPath: vi.fn(() => 'tmux'),
    getTmuxSessionName: vi.fn(() => 'krarkode-ark'),
    listTmuxWindows: vi.fn(async () => []),
    killTmuxWindow: vi.fn(async () => {}),
    runTmux: vi.fn(async () => ({ status: 0, stdout: '', stderr: '' })),
    tmuxHasSession: vi.fn(async () => false),
    getFirstTmuxWindowTarget: vi.fn(async () => undefined),
    renameTmuxWindow: vi.fn(async () => {}),
}));

vi.mock('fs', () => ({
    existsSync: mockFsExistsSync,
    readFileSync: mockFsReadFileSync,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    unlinkSync: vi.fn(),
    promises: { readFile: vi.fn(async () => '{}') },
}));

vi.mock('net', () => ({
    createServer: vi.fn(),
}));

vi.mock('../../util', () => ({
    config: () => ({ get: () => '' }),
    substituteVariables: (s: string) => s,
    resolveArkPath: vi.fn(() => '/mock/ark'),
    resolveSidecarPath: vi.fn(() => '/mock/sidecar'),
    getRBinaryPath: vi.fn(async () => '/mock/R'),
    delay: vi.fn(async () => {}),
    spawnAsync: vi.fn(async () => ({ status: 0, stdout: '', stderr: '' })),
}));

vi.mock('../../logging/logger', () => ({
    getLogger: () => ({
        log: mockLogFn,
        createChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn() })),
    }),
    LogCategory: { Session: 'session' },
}));

vi.mock('../../rBinaryResolver', () => ({
    collectRBinaryCandidates: vi.fn(async () => []),
}));

vi.mock('../arkLogLevel', () => ({
    formatArkRustLog: vi.fn(),
    getArkLogLevel: vi.fn(() => 'info'),
}));

// --- Import after mocks ---

import { ArkSessionManager } from '../sessionManager';

// --- Helpers ---

function makeEntry(overrides?: Partial<ArkSessionEntry>): ArkSessionEntry {
    return {
        name: 'test',
        mode: 'tmux',
        connectionFilePath: '/mock/sessions/test/connection.json',
        tmuxSessionName: 'krarkode-ark',
        tmuxWindowName: 'test',
        createdAt: '2025-01-01T00:00:00.000Z',
        ...overrides,
    };
}

// --- Tests ---

let manager: ArkSessionManager;

beforeEach(() => {
    vi.clearAllMocks();
    manager = new ArkSessionManager();
});

describe('interruptSessionEntry', () => {
    test('sends SIGINT when PID is present', async () => {
        const entry = makeEntry({ pid: 99999 });
        const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

        await (manager as any).interruptSessionEntry(entry);

        expect(killSpy).toHaveBeenCalledWith(99999, 'SIGINT');
        killSpy.mockRestore();
    });

    test('recovers PID from announce file when missing', async () => {
        const entry = makeEntry({ pid: undefined });
        const announceFile = '/mock/sessions/test/announce.json';

        mockFsExistsSync.mockImplementation((p: string) => p === announceFile);
        mockFsReadFileSync.mockImplementation((p: string) => {
            if (p === announceFile) return JSON.stringify({ pid: 54321 });
            throw new Error('ENOENT');
        });

        const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

        await (manager as any).interruptSessionEntry(entry);

        expect(killSpy).toHaveBeenCalledWith(54321, 'SIGINT');
        expect(mockUpsertSessionValidated).toHaveBeenCalledWith(
            expect.objectContaining({ pid: 54321 }),
        );
        killSpy.mockRestore();
    });

    test('recovers PID from tmux pane when announce file absent', async () => {
        const entry = makeEntry({ pid: undefined });
        mockFsExistsSync.mockReturnValue(false);
        mockGetTmuxPanePid.mockResolvedValue(67890);

        const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

        await (manager as any).interruptSessionEntry(entry);

        expect(mockGetTmuxPanePid).toHaveBeenCalledWith('krarkode-ark', 'test');
        expect(killSpy).toHaveBeenCalledWith(67890, 'SIGINT');
        killSpy.mockRestore();
    });

    test('shows warning when PID recovery fails completely', async () => {
        const entry = makeEntry({ pid: undefined });
        mockFsExistsSync.mockReturnValue(false);
        mockGetTmuxPanePid.mockResolvedValue(undefined);

        const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

        await (manager as any).interruptSessionEntry(entry);

        expect(killSpy).not.toHaveBeenCalled();
        expect(mockShowWarningMessage).toHaveBeenCalledWith(
            expect.stringContaining('does not have a PID'),
        );
        killSpy.mockRestore();
    });
});

describe('buildStatusTooltip', () => {
    const status = { icon: '$(check)', label: 'Idle' };

    test('includes Interrupt link when PID is present', () => {
        const entry = makeEntry({ pid: 12345 });
        const md = (manager as any).buildStatusTooltip(entry, status);
        expect(md.value).toContain('Interrupt');
    });

    test('excludes Interrupt link when PID is missing', () => {
        const entry = makeEntry({ pid: undefined });
        const md = (manager as any).buildStatusTooltip(entry, status);
        expect(md.value).not.toContain('Interrupt');
    });

    test('shows "No active session" when entry is undefined', () => {
        const md = (manager as any).buildStatusTooltip(undefined, status);
        expect(md.value).toContain('No active session');
    });
});
