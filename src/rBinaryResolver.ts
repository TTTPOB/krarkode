import * as path from 'path';
import * as vscode from 'vscode';
import { substituteVariables, getRfromEnvPath, isExecutableFile } from './util';
import { resolvePixiEnvironments } from './pixi/pixiResolver';
import { getLogger, LogCategory } from './logging/logger';

/**
 * A candidate R binary from one of the supported sources.
 */
export interface RBinaryCandidate {
    label: string;
    rBinaryPath: string;
    source: 'setting' | 'pixi' | 'path';
    detail?: string;
}

/**
 * Collect R binary candidates from all configured sources:
 * 1. User setting (krarkode.r.binaryPath)
 * 2. Pixi environments (krarkode.pixi.manifestPath → pixi.toml)
 * 3. System PATH
 *
 * Results are deduplicated by rBinaryPath.
 */
export async function collectRBinaryCandidates(): Promise<RBinaryCandidate[]> {
    const log = getLogger();
    const candidates: RBinaryCandidate[] = [];
    const seen = new Set<string>();

    const addCandidate = (candidate: RBinaryCandidate) => {
        if (!seen.has(candidate.rBinaryPath)) {
            seen.add(candidate.rBinaryPath);
            candidates.push(candidate);
        }
    };

    // 1. User-configured R binary path
    const rConfig = vscode.workspace.getConfiguration('krarkode.r');
    let userRPath = rConfig.get<string>('binaryPath') || '';
    if (userRPath) {
        userRPath = substituteVariables(userRPath);
        if (isExecutableFile(userRPath)) {
            log.debug('runtime', LogCategory.Core, `R candidate from setting: ${userRPath}`);
            addCandidate({
                label: 'User setting',
                rBinaryPath: userRPath,
                source: 'setting',
                detail: userRPath,
            });
        } else {
            log.debug('runtime', LogCategory.Core, `R setting path not executable: ${userRPath}`);
        }
    }

    // 2. Pixi environments
    const pixiManifestPath = resolvePixiManifestPath();
    if (pixiManifestPath) {
        log.debug('runtime', LogCategory.Core, `Resolving pixi environments from: ${pixiManifestPath}`);
        try {
            const pixiEnvs = await resolvePixiEnvironments({
                manifestPath: pixiManifestPath,
                logger: (msg) => log.debug('runtime', LogCategory.Core, msg),
            });
            for (const env of pixiEnvs) {
                addCandidate({
                    label: `pixi: ${env.name}`,
                    rBinaryPath: env.rBinaryPath,
                    source: 'pixi',
                    detail: env.rBinaryPath,
                });
            }
        } catch (error) {
            log.debug('runtime', LogCategory.Core, `pixi resolution error: ${error}`);
        }
    }

    // 3. System PATH
    const pathR = getRfromEnvPath();
    if (pathR) {
        log.debug('runtime', LogCategory.Core, `R candidate from PATH: ${pathR}`);
        addCandidate({
            label: 'System PATH',
            rBinaryPath: pathR,
            source: 'path',
            detail: pathR,
        });
    }

    log.debug('runtime', LogCategory.Core, `Total R binary candidates: ${candidates.length}`);
    return candidates;
}

/**
 * Resolve the pixi manifest path from settings, defaulting to workspace root.
 */
function resolvePixiManifestPath(): string | undefined {
    const config = vscode.workspace.getConfiguration('krarkode.pixi');
    let manifestPath = config.get<string>('manifestPath') || '';

    if (manifestPath) {
        manifestPath = substituteVariables(manifestPath);
        return manifestPath;
    }

    // Default: pixi.toml at workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        return path.join(workspaceFolders[0].uri.fsPath, 'pixi.toml');
    }

    return undefined;
}
