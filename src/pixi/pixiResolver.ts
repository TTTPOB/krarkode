import * as fs from 'fs';
import * as path from 'path';
import { parse as parseToml } from 'smol-toml';

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
    readFile?: (filePath: string) => string;
    fileExists?: (filePath: string) => boolean;
    isExecutable?: (filePath: string) => boolean;
    logger?: (message: string) => void;
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
 * Checks the expected filesystem path `.pixi/envs/<env>/bin/R` for each
 * environment rather than spawning `pixi run which R`, which would inherit
 * the outer shell PATH and could report a system R instead of the pixi one.
 */
export function resolvePixiEnvironments(options: PixiResolverOptions): PixiEnvironment[] {
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

    // Resolve R binary for each environment by checking expected pixi path
    const manifestDir = path.dirname(options.manifestPath);
    const results: PixiEnvironment[] = [];
    for (const envName of envNames) {
        const rPath = path.join(manifestDir, '.pixi', 'envs', envName, 'bin', 'R');
        if (!checkExecutable(rPath)) {
            log(`pixi env "${envName}": R not found or not executable at ${rPath}`);
            continue;
        }
        log(`pixi env "${envName}": R found at ${rPath}`);
        results.push({ name: envName, rBinaryPath: rPath });
    }

    return results;
}
