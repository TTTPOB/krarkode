import * as fs from 'fs';
import * as cp from 'child_process';
import { parse as parseToml } from 'smol-toml';

/**
 * Minimal spawn result type (mirrors util.SpawnResult without importing vscode-dependent util).
 */
export interface ExecResult {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
}

/**
 * A resolved pixi environment with its R binary path.
 */
export interface PixiEnvironment {
    name: string;
    rBinaryPath: string;
}

/**
 * Options for the pixi resolver. IO operations are injectable for testability.
 */
export interface PixiResolverOptions {
    manifestPath: string;
    exec?: (cmd: string, args: string[]) => Promise<ExecResult>;
    readFile?: (filePath: string) => string;
    fileExists?: (filePath: string) => boolean;
    isExecutable?: (filePath: string) => boolean;
    logger?: (message: string) => void;
}

function defaultExec(cmd: string, args: string[]): Promise<ExecResult> {
    return new Promise((resolve) => {
        const child = cp.spawn(cmd, args, { stdio: 'pipe' });
        let stdout = '';
        let stderr = '';

        if (child.stdout) {
            child.stdout.on('data', (data) => { stdout += data.toString(); });
        }
        if (child.stderr) {
            child.stderr.on('data', (data) => { stderr += data.toString(); });
        }

        child.on('error', (error) => {
            resolve({ status: null, stdout, stderr, error });
        });
        child.on('close', (code) => {
            resolve({ status: code, stdout, stderr });
        });
    });
}

function defaultIsExecutable(filePath: string): boolean {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
            return false;
        }
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Parse pixi.toml content and extract environment names from the [environments] table.
 * If no [environments] table exists, returns ["default"] since pixi always has a default env.
 */
export function parsePixiEnvironmentNames(tomlContent: string): string[] {
    try {
        const parsed = parseToml(tomlContent);
        const environments = parsed['environments'];
        if (environments && typeof environments === 'object' && !Array.isArray(environments)) {
            const keys = Object.keys(environments as Record<string, unknown>);
            if (keys.length > 0) {
                // Always include 'default' — pixi implicitly creates it
                if (!keys.includes('default')) {
                    return ['default', ...keys];
                }
                return keys;
            }
        }
        return ['default'];
    } catch {
        return ['default'];
    }
}

/**
 * Resolve R binary paths from pixi environments defined in a pixi.toml manifest.
 *
 * For each environment, runs `pixi run -e <env> --manifest-path <path> which R`
 * to discover the R binary path.
 */
export async function resolvePixiEnvironments(options: PixiResolverOptions): Promise<PixiEnvironment[]> {
    const exec = options.exec ?? defaultExec;
    const readFile = options.readFile ?? ((p: string) => fs.readFileSync(p, 'utf8'));
    const fileExists = options.fileExists ?? ((p: string) => fs.existsSync(p));
    const checkExecutable = options.isExecutable ?? defaultIsExecutable;
    const log = options.logger ?? (() => {});

    // Check manifest exists
    if (!fileExists(options.manifestPath)) {
        log(`pixi manifest not found at: ${options.manifestPath}`);
        return [];
    }

    // Parse manifest to get environment names
    let envNames: string[];
    try {
        const content = readFile(options.manifestPath);
        envNames = parsePixiEnvironmentNames(content);
        log(`pixi environments found: ${envNames.join(', ')}`);
    } catch (error) {
        log(`Failed to read pixi manifest: ${error}`);
        return [];
    }

    // Check pixi CLI is available
    const whichResult = await exec('which', ['pixi']);
    if (whichResult.status !== 0 || !whichResult.stdout.trim()) {
        log('pixi CLI not found in PATH');
        return [];
    }
    log(`pixi CLI found at: ${whichResult.stdout.trim()}`);

    // Resolve R binary for each environment
    const results: PixiEnvironment[] = [];
    for (const envName of envNames) {
        try {
            const result = await exec('pixi', [
                'run',
                '-e', envName,
                '--manifest-path', options.manifestPath,
                'which', 'R',
            ]);

            if (result.status !== 0) {
                log(`pixi env "${envName}": R not found (exit ${result.status})`);
                continue;
            }

            const rPath = result.stdout.trim();
            if (!rPath) {
                log(`pixi env "${envName}": empty R path from which`);
                continue;
            }

            if (!checkExecutable(rPath)) {
                log(`pixi env "${envName}": R at "${rPath}" is not executable`);
                continue;
            }

            log(`pixi env "${envName}": R found at ${rPath}`);
            results.push({ name: envName, rBinaryPath: rPath });
        } catch (error) {
            log(`pixi env "${envName}": error resolving R: ${error}`);
        }
    }

    return results;
}
