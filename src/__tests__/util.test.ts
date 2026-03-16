import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
    mockShowErrorMessage,
    mockResolvePixiEnvironments,
    mockDebug,
    mockFsAccessSync,
    mockFsExistsSync,
    mockFsStatSync,
    mockState,
} = vi.hoisted(() => {
    const state = {
        rBinaryPath: [] as string[],
        pixiManifestPath: '',
        workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    };

    return {
        mockShowErrorMessage: vi.fn(),
        mockResolvePixiEnvironments: vi.fn(),
        mockDebug: vi.fn(),
        mockFsAccessSync: vi.fn(),
        mockFsExistsSync: vi.fn(() => false),
        mockFsStatSync: vi.fn(() => ({ isFile: () => true })),
        mockState: state,
    };
});

vi.mock('fs', () => ({
    statSync: mockFsStatSync,
    accessSync: mockFsAccessSync,
    existsSync: mockFsExistsSync,
    constants: {
        X_OK: 1,
    },
}));

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: (section?: string) => ({
            get: (key: string) => {
                if (section === 'krarkode.r' && key === 'binaryPath') {
                    return mockState.rBinaryPath;
                }
                if (section === 'krarkode.pixi' && key === 'manifestPath') {
                    return mockState.pixiManifestPath;
                }
                return undefined;
            },
        }),
        workspaceFolders: mockState.workspaceFolders,
    },
    window: {
        showErrorMessage: mockShowErrorMessage,
    },
}));

vi.mock('../context', () => ({
    getExtensionContext: vi.fn(() => ({
        asAbsolutePath: (value: string) => value,
    })),
}));

vi.mock('../logging/logger', () => ({
    getLogger: () => ({
        debug: mockDebug,
    }),
    LogCategory: {
        Core: 'core',
    },
}));

vi.mock('../pixi/pixiResolver', () => ({
    resolvePixiEnvironments: mockResolvePixiEnvironments,
}));

import { getRBinaryPath } from '../util';

describe('getRBinaryPath', () => {
    const originalPath = process.env.PATH;

    beforeEach(() => {
        process.env.PATH = '';
        mockState.rBinaryPath = [];
        mockState.pixiManifestPath = '';
        mockResolvePixiEnvironments.mockReset();
        mockShowErrorMessage.mockReset();
        mockDebug.mockReset();
        mockFsAccessSync.mockReset();
        mockFsExistsSync.mockReset();
        mockFsExistsSync.mockReturnValue(false);
        mockFsStatSync.mockReset();
        mockFsStatSync.mockReturnValue({ isFile: () => true });
    });

    afterEach(() => {
        process.env.PATH = originalPath;
    });

    test('uses pixi-detected R when no explicit binary path is configured', async () => {
        mockResolvePixiEnvironments.mockResolvedValue([
            { name: 'default', rBinaryPath: '/pixi/envs/default/bin/R' },
        ]);

        const rPath = await getRBinaryPath();

        expect(rPath).toBe('/pixi/envs/default/bin/R');
        expect(mockResolvePixiEnvironments).toHaveBeenCalledWith({
            manifestPath: '/workspace/pixi.toml',
            logger: expect.any(Function),
        });
        expect(mockShowErrorMessage).not.toHaveBeenCalled();
    });
});
