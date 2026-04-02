import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ArkSessionEntry } from '../sessionRegistry';

// --- Hoisted mock state ---

const { mockFs, mockListTmuxWindows, mockGlobalState, mockLogFn } = vi.hoisted(() => ({
    mockFs: {
        existsSync: vi.fn((_p: string) => false as boolean),
        readFileSync: vi.fn((_p: string) => '[]' as string),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
        rmSync: vi.fn(),
    },
    mockListTmuxWindows: vi.fn(async () => [] as string[]),
    mockGlobalState: { get: vi.fn(), update: vi.fn() },
    mockLogFn: vi.fn(),
}));

// --- Module mocks ---

vi.mock('fs', () => ({
    ...mockFs,
    default: mockFs,
}));

vi.mock('../../context', () => ({
    getExtensionContext: () => ({
        globalState: mockGlobalState,
        globalStorageUri: { fsPath: '/mock/storage' },
    }),
}));

vi.mock('../../util', () => ({
    config: () => ({ get: () => '' }),
    substituteVariables: (s: string) => s,
}));

vi.mock('../tmuxUtil', () => ({
    getTmuxSessionName: () => 'krarkode-ark',
    listTmuxWindows: mockListTmuxWindows,
}));

vi.mock('../../logging/logger', () => ({
    getLogger: () => ({ log: mockLogFn }),
    LogCategory: { Session: 'session' },
}));

// --- Import after mocks ---

import {
    loadRegistry,
    saveRegistry,
    upsertSession,
    loadRegistryValidated,
} from '../sessionRegistry';

// --- Helpers ---

const REGISTRY_PATH = '/mock/storage/ark-sessions/registry.json';
const SESSIONS_DIR = '/mock/storage/ark-sessions';

function makeEntry(overrides?: Partial<ArkSessionEntry>): ArkSessionEntry {
    return {
        name: 'test',
        mode: 'tmux',
        connectionFilePath: `${SESSIONS_DIR}/test/connection.json`,
        tmuxSessionName: 'krarkode-ark',
        tmuxWindowName: 'test',
        createdAt: '2025-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function setRegistryOnDisk(entries: ArkSessionEntry[]): void {
    const json = JSON.stringify(entries);
    mockFs.existsSync.mockImplementation((p: string) => {
        if (p === REGISTRY_PATH) return true;
        // Session directories
        if (p.startsWith(SESSIONS_DIR) && !p.endsWith('.json')) return true;
        return false;
    });
    mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === REGISTRY_PATH) return json;
        throw new Error(`ENOENT: ${p}`);
    });
}

// --- Tests ---

beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('[]');
    mockListTmuxWindows.mockResolvedValue([]);
});

describe('loadRegistry', () => {
    test('returns empty array when registry file does not exist', () => {
        mockFs.existsSync.mockReturnValue(false);
        expect(loadRegistry()).toEqual([]);
    });

    test('parses valid JSON and returns entries', () => {
        const entries = [makeEntry({ name: 'a' }), makeEntry({ name: 'b' })];
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(entries));
        expect(loadRegistry()).toEqual(entries);
    });

    test('returns empty array on malformed JSON', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('not json{{{');
        expect(loadRegistry()).toEqual([]);
    });
});

describe('upsertSession', () => {
    test('adds new entry to empty registry', () => {
        mockFs.existsSync.mockReturnValue(false);
        const entry = makeEntry({ name: 'new' });
        upsertSession(entry);
        expect(mockFs.writeFileSync).toHaveBeenCalledOnce();
        const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        expect(written).toHaveLength(1);
        expect(written[0].name).toBe('new');
    });

    test('updates existing entry by name', () => {
        const existing = [makeEntry({ name: 'a', pid: 100 })];
        setRegistryOnDisk(existing);
        upsertSession(makeEntry({ name: 'a', pid: 999 }));
        const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        expect(written).toHaveLength(1);
        expect(written[0].pid).toBe(999);
    });
});

describe('loadRegistryValidated', () => {
    test('prunes dead tmux entries, keeps alive ones', async () => {
        const entries = [
            makeEntry({ name: 'alive', tmuxWindowName: 'alive' }),
            makeEntry({ name: 'dead', tmuxWindowName: 'dead' }),
            makeEntry({ name: 'also-alive', tmuxWindowName: 'also-alive' }),
        ];
        setRegistryOnDisk(entries);
        mockListTmuxWindows.mockResolvedValue(['alive', 'also-alive']);

        const result = await loadRegistryValidated();

        expect(result).toHaveLength(2);
        expect(result.map((e) => e.name)).toEqual(['alive', 'also-alive']);
        // Registry was persisted without the dead entry
        expect(mockFs.writeFileSync).toHaveBeenCalledOnce();
        const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        expect(written.map((e: ArkSessionEntry) => e.name)).toEqual(['alive', 'also-alive']);
    });

    test('skips pruning when tmux returns empty array', async () => {
        const entries = [
            makeEntry({ name: 'a', tmuxWindowName: 'a' }),
            makeEntry({ name: 'b', tmuxWindowName: 'b' }),
        ];
        setRegistryOnDisk(entries);
        mockListTmuxWindows.mockResolvedValue([]);

        const result = await loadRegistryValidated();

        // All entries preserved
        expect(result).toHaveLength(2);
        // No write (no pruning occurred)
        // writeFileSync is called by saveRegistry but NOT called for pruning here
        // The only call would be from setRegistryOnDisk's readFileSync, not writeFileSync
        expect(mockFs.writeFileSync).not.toHaveBeenCalled();
        // Warning logged
        expect(mockLogFn).toHaveBeenCalledWith(
            'runtime',
            expect.anything(),
            'warn',
            expect.stringContaining('skipping registry pruning'),
        );
    });

    test('removes stale session directories when pruning', async () => {
        const entries = [
            makeEntry({ name: 'alive', tmuxWindowName: 'alive' }),
            makeEntry({ name: 'stale', tmuxWindowName: 'stale' }),
        ];
        setRegistryOnDisk(entries);
        mockListTmuxWindows.mockResolvedValue(['alive']);

        await loadRegistryValidated();

        // stale session directory should be removed
        expect(mockFs.rmSync).toHaveBeenCalledWith(
            expect.stringContaining('/stale'),
            { recursive: true, force: true },
        );
        // alive directory should NOT be removed
        const rmCalls = mockFs.rmSync.mock.calls.map((c) => c[0] as string);
        expect(rmCalls.every((p: string) => !p.includes('/alive'))).toBe(true);
    });

    test('prunes entries without tmuxWindowName', async () => {
        const entries = [
            makeEntry({ name: 'tmux-alive', mode: 'tmux', tmuxWindowName: 'tmux-alive' }),
            makeEntry({ name: 'no-window', mode: 'tmux', tmuxWindowName: undefined }),
        ];
        setRegistryOnDisk(entries);
        mockListTmuxWindows.mockResolvedValue(['tmux-alive']);

        const result = await loadRegistryValidated();

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('tmux-alive');
    });

    test('returns empty array immediately for empty registry', async () => {
        mockFs.existsSync.mockReturnValue(false);

        const result = await loadRegistryValidated();

        expect(result).toEqual([]);
        expect(mockListTmuxWindows).not.toHaveBeenCalled();
    });
});
