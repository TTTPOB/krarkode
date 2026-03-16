import { describe, test, expect } from 'vitest';
import { parsePixiEnvironmentNames, resolvePixiEnvironments } from '../pixiResolver';
import type { PixiResolverOptions, ExecResult } from '../pixiResolver';

// Helper to create a mock exec function
function mockExec(responses: Record<string, ExecResult>): (cmd: string, args: string[]) => Promise<ExecResult> {
    return async (cmd: string, args: string[]): Promise<ExecResult> => {
        const key = `${cmd} ${args.join(' ')}`;
        for (const [pattern, result] of Object.entries(responses)) {
            if (key.includes(pattern)) {
                return result;
            }
        }
        return { status: 1, stdout: '', stderr: `command not found: ${cmd}` };
    };
}

const OK: ExecResult = { status: 0, stdout: '', stderr: '' };
const FAIL: ExecResult = { status: 1, stdout: '', stderr: '' };

// ---- parsePixiEnvironmentNames ----

describe('parsePixiEnvironmentNames', () => {
    test('extracts environment names from [environments] table', () => {
        const toml = `
[workspace]
name = "myproject"
channels = ["conda-forge"]
platforms = ["linux-64"]

[feature.r44.dependencies]
r-base = "4.4.*"

[feature.r43.dependencies]
r-base = "4.3.*"

[environments]
r44 = ["r44"]
r43 = ["r43"]
`;
        expect(parsePixiEnvironmentNames(toml)).toEqual(['r44', 'r43']);
    });

    test('returns ["default"] when no [environments] table', () => {
        const toml = `
[workspace]
name = "myproject"
channels = ["conda-forge"]
platforms = ["linux-64"]

[dependencies]
r-base = "4.4.*"
`;
        expect(parsePixiEnvironmentNames(toml)).toEqual(['default']);
    });

    test('returns ["default"] when [environments] table is empty', () => {
        const toml = `
[workspace]
name = "myproject"

[environments]
`;
        expect(parsePixiEnvironmentNames(toml)).toEqual(['default']);
    });

    test('handles environments with full object syntax', () => {
        const toml = `
[environments]
prod = {features = ["prod"], solve-group = "default"}
test = {features = ["test"], no-default-feature = true}
`;
        expect(parsePixiEnvironmentNames(toml)).toEqual(['prod', 'test']);
    });

    test('returns ["default"] on invalid TOML', () => {
        const toml = `not valid {{ toml content`;
        expect(parsePixiEnvironmentNames(toml)).toEqual(['default']);
    });

    test('handles environments with hyphenated names', () => {
        const toml = `
[environments]
r-4-4 = ["r44"]
my-custom-env = ["custom"]
`;
        expect(parsePixiEnvironmentNames(toml)).toEqual(['r-4-4', 'my-custom-env']);
    });
});

// ---- resolvePixiEnvironments ----

describe('resolvePixiEnvironments', () => {
    const MANIFEST_PATH = '/project/pixi.toml';
    const MANIFEST_CONTENT = `
[workspace]
name = "test"
channels = ["conda-forge"]
platforms = ["linux-64"]

[feature.r44.dependencies]
r-base = "4.4.*"

[feature.r43.dependencies]
r-base = "4.3.*"

[environments]
r44 = ["r44"]
r43 = ["r43"]
`;

    function makeOptions(overrides: Partial<PixiResolverOptions> = {}): PixiResolverOptions {
        return {
            manifestPath: MANIFEST_PATH,
            fileExists: () => true,
            readFile: () => MANIFEST_CONTENT,
            isExecutable: () => true,
            logger: () => {},
            ...overrides,
        };
    }

    test('returns empty array when manifest does not exist', async () => {
        const result = await resolvePixiEnvironments(
            makeOptions({
                fileExists: () => false,
            }),
        );
        expect(result).toEqual([]);
    });

    test('returns empty array when pixi CLI is not in PATH', async () => {
        const result = await resolvePixiEnvironments(
            makeOptions({
                exec: mockExec({}), // no responses → all fail
            }),
        );
        expect(result).toEqual([]);
    });

    test('returns environments with resolved R binary paths', async () => {
        const result = await resolvePixiEnvironments(
            makeOptions({
                exec: mockExec({
                    'which pixi': { status: 0, stdout: '/usr/bin/pixi\n', stderr: '' },
                    '-e r44': { status: 0, stdout: '/envs/r44/bin/R\n', stderr: '' },
                    '-e r43': { status: 0, stdout: '/envs/r43/bin/R\n', stderr: '' },
                }),
            }),
        );
        expect(result).toEqual([
            { name: 'r44', rBinaryPath: '/envs/r44/bin/R' },
            { name: 'r43', rBinaryPath: '/envs/r43/bin/R' },
        ]);
    });

    test('skips environments where R is not found without affecting others', async () => {
        const result = await resolvePixiEnvironments(
            makeOptions({
                exec: mockExec({
                    'which pixi': { status: 0, stdout: '/usr/bin/pixi\n', stderr: '' },
                    '-e r44': { status: 0, stdout: '/envs/r44/bin/R\n', stderr: '' },
                    '-e r43': FAIL,
                }),
            }),
        );
        expect(result).toEqual([
            { name: 'r44', rBinaryPath: '/envs/r44/bin/R' },
        ]);
    });

    test('skips environments where R path is not executable', async () => {
        const result = await resolvePixiEnvironments(
            makeOptions({
                exec: mockExec({
                    'which pixi': { status: 0, stdout: '/usr/bin/pixi\n', stderr: '' },
                    '-e r44': { status: 0, stdout: '/envs/r44/bin/R\n', stderr: '' },
                    '-e r43': { status: 0, stdout: '/envs/r43/bin/R\n', stderr: '' },
                }),
                isExecutable: (p) => p === '/envs/r44/bin/R',
            }),
        );
        expect(result).toEqual([
            { name: 'r44', rBinaryPath: '/envs/r44/bin/R' },
        ]);
    });

    test('skips environments with empty R path output', async () => {
        const result = await resolvePixiEnvironments(
            makeOptions({
                exec: mockExec({
                    'which pixi': { status: 0, stdout: '/usr/bin/pixi\n', stderr: '' },
                    '-e r44': { status: 0, stdout: '  \n', stderr: '' },
                }),
            }),
        );
        expect(result).toEqual([]);
    });

    test('uses default environment when no [environments] table', async () => {
        const simpleManifest = `
[workspace]
name = "test"

[dependencies]
r-base = "4.4.*"
`;
        const result = await resolvePixiEnvironments(
            makeOptions({
                readFile: () => simpleManifest,
                exec: mockExec({
                    'which pixi': { status: 0, stdout: '/usr/bin/pixi\n', stderr: '' },
                    '-e default': { status: 0, stdout: '/envs/default/bin/R\n', stderr: '' },
                }),
            }),
        );
        expect(result).toEqual([
            { name: 'default', rBinaryPath: '/envs/default/bin/R' },
        ]);
    });

    test('logs messages during resolution', async () => {
        const logs: string[] = [];
        await resolvePixiEnvironments(
            makeOptions({
                logger: (msg) => logs.push(msg),
                exec: mockExec({
                    'which pixi': { status: 0, stdout: '/usr/bin/pixi\n', stderr: '' },
                    '-e r44': { status: 0, stdout: '/envs/r44/bin/R\n', stderr: '' },
                    '-e r43': FAIL,
                }),
            }),
        );
        expect(logs.some((l) => l.includes('pixi environments found'))).toBe(true);
        expect(logs.some((l) => l.includes('pixi CLI found'))).toBe(true);
        expect(logs.some((l) => l.includes('r44'))).toBe(true);
        expect(logs.some((l) => l.includes('r43'))).toBe(true);
    });

    test('returns empty array when readFile throws', async () => {
        const result = await resolvePixiEnvironments(
            makeOptions({
                readFile: () => { throw new Error('EACCES'); },
            }),
        );
        expect(result).toEqual([]);
    });
});
