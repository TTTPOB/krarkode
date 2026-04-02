import { describe, test, expect } from 'vitest';
import { parsePixiEnvironmentNames, resolvePixiEnvironments } from '../pixiResolver';
import type { PixiResolverOptions } from '../pixiResolver';

// ---- parsePixiEnvironmentNames ----

describe('parsePixiEnvironmentNames', () => {
    test('extracts environment names from [environments] table, including implicit default', () => {
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
        expect(parsePixiEnvironmentNames(toml)).toEqual(['default', 'r44', 'r43']);
    });

    test('does not duplicate default when explicitly listed in [environments]', () => {
        const toml = `
[environments]
default = {solve-group = "default"}
custom = ["custom"]
`;
        expect(parsePixiEnvironmentNames(toml)).toEqual(['default', 'custom']);
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

    test('handles environments with full object syntax, including implicit default', () => {
        const toml = `
[environments]
prod = {features = ["prod"], solve-group = "default"}
test = {features = ["test"], no-default-feature = true}
`;
        expect(parsePixiEnvironmentNames(toml)).toEqual(['default', 'prod', 'test']);
    });

    test('returns ["default"] on invalid TOML', () => {
        const toml = `not valid {{ toml content`;
        expect(parsePixiEnvironmentNames(toml)).toEqual(['default']);
    });

    test('handles environments with hyphenated names, including implicit default', () => {
        const toml = `
[environments]
r-4-4 = ["r44"]
my-custom-env = ["custom"]
`;
        expect(parsePixiEnvironmentNames(toml)).toEqual(['default', 'r-4-4', 'my-custom-env']);
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

    test('returns empty array when manifest does not exist', () => {
        const result = resolvePixiEnvironments(
            makeOptions({
                fileExists: () => false,
            }),
        );
        expect(result).toEqual([]);
    });

    test('returns environments with R binary at expected pixi paths, including default', () => {
        const result = resolvePixiEnvironments(
            makeOptions({
                isExecutable: () => true,
            }),
        );
        expect(result).toEqual([
            { name: 'default', rBinaryPath: '/project/.pixi/envs/default/bin/R' },
            { name: 'r44', rBinaryPath: '/project/.pixi/envs/r44/bin/R' },
            { name: 'r43', rBinaryPath: '/project/.pixi/envs/r43/bin/R' },
        ]);
    });

    test('skips environments where R is not executable', () => {
        const result = resolvePixiEnvironments(
            makeOptions({
                isExecutable: (p) => p === '/project/.pixi/envs/r44/bin/R',
            }),
        );
        expect(result).toEqual([
            { name: 'r44', rBinaryPath: '/project/.pixi/envs/r44/bin/R' },
        ]);
    });

    test('returns empty array when no environment has R installed', () => {
        const result = resolvePixiEnvironments(
            makeOptions({
                isExecutable: () => false,
            }),
        );
        expect(result).toEqual([]);
    });

    test('uses default environment when no [environments] table', () => {
        const simpleManifest = `
[workspace]
name = "test"

[dependencies]
r-base = "4.4.*"
`;
        const result = resolvePixiEnvironments(
            makeOptions({
                readFile: () => simpleManifest,
                isExecutable: () => true,
            }),
        );
        expect(result).toEqual([
            { name: 'default', rBinaryPath: '/project/.pixi/envs/default/bin/R' },
        ]);
    });

    test('logs messages during resolution', () => {
        const logs: string[] = [];
        resolvePixiEnvironments(
            makeOptions({
                logger: (msg) => logs.push(msg),
                isExecutable: (p) => p === '/project/.pixi/envs/r44/bin/R',
            }),
        );
        expect(logs.some((l) => l.includes('pixi environments found'))).toBe(true);
        expect(logs.some((l) => l.includes('default'))).toBe(true);
        expect(logs.some((l) => l.includes('r44') && l.includes('R found'))).toBe(true);
        expect(logs.some((l) => l.includes('r43') && l.includes('not found'))).toBe(true);
    });

    test('returns empty array when readFile throws', () => {
        const result = resolvePixiEnvironments(
            makeOptions({
                readFile: () => { throw new Error('EACCES'); },
            }),
        );
        expect(result).toEqual([]);
    });

    test('constructs correct path relative to manifest directory', () => {
        const result = resolvePixiEnvironments(
            makeOptions({
                manifestPath: '/home/user/myproject/pixi.toml',
                isExecutable: () => true,
            }),
        );
        expect(result[0].rBinaryPath).toBe('/home/user/myproject/.pixi/envs/default/bin/R');
    });
});
