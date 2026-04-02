import { getRfromEnvPath, isExecutableFile, getConfiguredRBinaryPaths, resolvePixiManifestPath } from './util';
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

// --- Cache layer ---

interface RBinaryCache {
    candidates: RBinaryCandidate[];
    configSnapshot: string;
    timestamp: number;
}

let candidateCache: RBinaryCache | undefined;

const CACHE_TTL_MS = 60_000; // 1 minute safety-net TTL

function buildConfigSnapshot(): string {
    return JSON.stringify({
        rBinaryPath: getConfiguredRBinaryPaths(),
        pixiManifestPath: resolvePixiManifestPath(),
    });
}

/**
 * Invalidate the R binary candidate cache.
 * Call when relevant configuration changes (r.binaryPath, pixi.manifestPath).
 */
export function invalidateRBinaryCache(): void {
    if (candidateCache) {
        getLogger().debug('runtime', LogCategory.RBinary, 'Cache invalidated');
    }
    candidateCache = undefined;
}

/**
 * Collect R binary candidates from all configured sources:
 * 1. User setting (krarkode.r.binaryPath)
 * 2. Pixi environments (krarkode.pixi.manifestPath → pixi.toml)
 * 3. System PATH
 *
 * Results are deduplicated by rBinaryPath and cached within the extension
 * lifetime.  The cache is invalidated on config change or after TTL.
 */
export async function collectRBinaryCandidates(): Promise<RBinaryCandidate[]> {
    const log = getLogger();
    const currentSnapshot = buildConfigSnapshot();

    if (candidateCache) {
        const age = Date.now() - candidateCache.timestamp;
        const configMatch = candidateCache.configSnapshot === currentSnapshot;

        if (configMatch && age < CACHE_TTL_MS) {
            log.debug('runtime', LogCategory.RBinary,
                `Using cached candidates (${candidateCache.candidates.length} entries, age=${age}ms)`);
            return candidateCache.candidates;
        }

        log.debug('runtime', LogCategory.RBinary,
            `Cache stale: configMatch=${configMatch}, age=${age}ms`);
    }

    log.debug('runtime', LogCategory.RBinary, 'Running full R binary discovery');
    const candidates = await collectRBinaryCandidatesUncached();

    candidateCache = {
        candidates,
        configSnapshot: currentSnapshot,
        timestamp: Date.now(),
    };

    log.debug('runtime', LogCategory.RBinary,
        `Cached ${candidates.length} R binary candidates`);
    return candidates;
}

// --- Uncached discovery implementation ---

async function collectRBinaryCandidatesUncached(): Promise<RBinaryCandidate[]> {
    const log = getLogger();
    const candidates: RBinaryCandidate[] = [];
    const seen = new Set<string>();

    const addCandidate = (candidate: RBinaryCandidate) => {
        if (!seen.has(candidate.rBinaryPath)) {
            seen.add(candidate.rBinaryPath);
            candidates.push(candidate);
        }
    };

    // 1. User-configured R binary paths (string or array)
    const configuredPaths = getConfiguredRBinaryPaths();
    for (const userRPath of configuredPaths) {
        if (isExecutableFile(userRPath)) {
            log.debug('runtime', LogCategory.RBinary, `R candidate from setting: ${userRPath}`);
            addCandidate({
                label: 'User setting',
                rBinaryPath: userRPath,
                source: 'setting',
                detail: userRPath,
            });
        } else {
            log.debug('runtime', LogCategory.RBinary, `R setting path not executable: ${userRPath}`);
        }
    }

    // 2. Pixi environments
    const pixiManifestPath = resolvePixiManifestPath();
    if (pixiManifestPath) {
        log.debug('runtime', LogCategory.RBinary, `Resolving pixi environments from: ${pixiManifestPath}`);
        try {
            const pixiEnvs = resolvePixiEnvironments({
                manifestPath: pixiManifestPath,
                logger: (msg) => log.debug('runtime', LogCategory.RBinary, msg),
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
            log.debug('runtime', LogCategory.RBinary, `pixi resolution error: ${error}`);
        }
    }

    // 3. System PATH
    const pathR = getRfromEnvPath();
    if (pathR) {
        log.debug('runtime', LogCategory.RBinary, `R candidate from PATH: ${pathR}`);
        addCandidate({
            label: 'System PATH',
            rBinaryPath: pathR,
            source: 'path',
            detail: pathR,
        });
    }

    log.debug('runtime', LogCategory.RBinary, `Total R binary candidates: ${candidates.length}`);
    return candidates;
}
