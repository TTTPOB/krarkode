import * as fs from 'fs';
import * as path from 'path';
import * as util from '../util';
import { getExtensionContext } from '../context';
import { getTmuxSessionName, listTmuxWindows, tmuxHasSession } from './tmuxUtil';
import { getLogger, LogCategory } from '../logging/logger';

export type ArkConsoleDriver = 'tmux';

export interface ArkSessionEntry {
    name: string;
    mode: ArkConsoleDriver;
    connectionFilePath: string;
    tmuxSessionName?: string;
    tmuxWindowName?: string;
    pid?: number;
    rBinaryPath?: string;
    createdAt: string;
    lastAttachedAt?: string;
}

const ACTIVE_SESSION_KEY = 'ark.activeSessionName';

export function getSessionsDir(): string {
    const configured = util.substituteVariables((util.config().get<string>('ark.sessionsDir') || '').trim());
    const baseDir = configured || path.join(getExtensionContext().globalStorageUri.fsPath, 'ark-sessions');
    fs.mkdirSync(baseDir, { recursive: true });
    return baseDir;
}

export function getSessionDir(sessionName: string): string {
    const dir = path.join(getSessionsDir(), sessionName);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function getRegistryPath(): string {
    return path.join(getSessionsDir(), 'registry.json');
}

export function loadRegistry(): ArkSessionEntry[] {
    const registryPath = getRegistryPath();
    if (!fs.existsSync(registryPath)) {
        return [];
    }
    try {
        const content = fs.readFileSync(registryPath, 'utf8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            return parsed as ArkSessionEntry[];
        }
    } catch {
        return [];
    }
    return [];
}

export function saveRegistry(entries: ArkSessionEntry[]): void {
    const registryPath = getRegistryPath();
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(entries, null, 2));
}

export function upsertSession(entry: ArkSessionEntry): void {
    const registry = loadRegistry();
    const idx = registry.findIndex((item) => item.name === entry.name);
    if (idx >= 0) {
        registry[idx] = entry;
    } else {
        registry.push(entry);
    }
    saveRegistry(registry);
}

export function updateSessionAttachment(name: string, time: string): void {
    const registry = loadRegistry();
    const idx = registry.findIndex((item) => item.name === name);
    if (idx >= 0) {
        registry[idx].lastAttachedAt = time;
        saveRegistry(registry);
    }
}

export function setActiveSessionName(name: string | undefined): void {
    if (name) {
        void getExtensionContext().globalState.update(ACTIVE_SESSION_KEY, name);
    } else {
        void getExtensionContext().globalState.update(ACTIVE_SESSION_KEY, undefined);
    }
}

export function getActiveSessionName(): string | undefined {
    return getExtensionContext().globalState.get<string>(ACTIVE_SESSION_KEY);
}

export function getActiveSession(): ArkSessionEntry | undefined {
    const activeName = getActiveSessionName();
    if (!activeName) {
        return undefined;
    }
    return loadRegistry().find((entry) => entry.name === activeName);
}

export function findSession(name: string): ArkSessionEntry | undefined {
    return loadRegistry().find((entry) => entry.name === name);
}

// --- Async validated variants: intersect registry with live tmux windows ---

/**
 * Load registry and prune tmux entries whose windows no longer exist.
 * External-mode entries are kept unconditionally.
 * Pruned results are persisted back to disk.
 */
export async function loadRegistryValidated(): Promise<ArkSessionEntry[]> {
    const entries = loadRegistry();
    if (entries.length === 0) {
        return entries;
    }

    // Only query tmux if there are tmux-mode entries
    const hasTmuxEntries = entries.some((e) => e.mode === 'tmux');
    if (!hasTmuxEntries) {
        return entries;
    }

    const tmuxSessionName = getTmuxSessionName();
    const aliveWindows = await listTmuxWindows(tmuxSessionName);

    // If tmux returned no windows, check whether the tmux session itself
    // still exists.  If the session is gone (e.g. last kernel exited via
    // q()), all tmux entries are dead and should be pruned.  Only skip
    // pruning when the session exists but we got an unexpected empty list.
    if (aliveWindows.length === 0) {
        const sessionExists = await tmuxHasSession(tmuxSessionName);
        if (sessionExists) {
            getLogger().log(
                'runtime',
                LogCategory.Session,
                'warn',
                'tmux session exists but returned no windows; skipping registry pruning to avoid data loss.',
            );
            return entries;
        }
        getLogger().log(
            'runtime',
            LogCategory.Session,
            'info',
            'tmux session is gone; pruning all tmux entries from registry.',
        );
        // Fall through — aliveSet is empty so all tmux entries will be pruned
    }

    const aliveSet = new Set(aliveWindows);

    const validated = entries.filter((entry) => {
        if (!entry.tmuxWindowName) {
            return false;
        }
        return aliveSet.has(entry.tmuxWindowName);
    });

    if (validated.length !== entries.length) {
        const pruned = entries.filter((e) => !validated.includes(e));
        const sessionsDir = getSessionsDir();
        for (const dead of pruned) {
            getLogger().log(
                'runtime',
                LogCategory.Session,
                'info',
                `Pruned dead tmux session from registry: ${dead.name} (window: ${dead.tmuxWindowName})`,
            );
            // Clean up stale session directory to prevent blocking re-creation
            const sessionDir = path.join(sessionsDir, dead.name);
            try {
                if (fs.existsSync(sessionDir)) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                    getLogger().log(
                        'runtime',
                        LogCategory.Session,
                        'info',
                        `Removed stale session directory: ${sessionDir}`,
                    );
                }
            } catch (err) {
                getLogger().log(
                    'runtime',
                    LogCategory.Session,
                    'warn',
                    `Failed to remove stale session directory ${sessionDir}: ${err}`,
                );
            }
        }
        saveRegistry(validated);
    }

    return validated;
}

export async function findSessionValidated(name: string): Promise<ArkSessionEntry | undefined> {
    const registry = await loadRegistryValidated();
    return registry.find((entry) => entry.name === name);
}

export async function getActiveSessionValidated(): Promise<ArkSessionEntry | undefined> {
    const activeName = getActiveSessionName();
    if (!activeName) {
        return undefined;
    }
    const registry = await loadRegistryValidated();
    const entry = registry.find((e) => e.name === activeName);
    if (!entry) {
        // Active session was pruned — clear stale globalState
        setActiveSessionName(undefined);
    }
    return entry;
}

export async function upsertSessionValidated(entry: ArkSessionEntry): Promise<void> {
    const registry = await loadRegistryValidated();
    const idx = registry.findIndex((item) => item.name === entry.name);
    if (idx >= 0) {
        registry[idx] = entry;
    } else {
        registry.push(entry);
    }
    saveRegistry(registry);
}

export async function updateSessionAttachmentValidated(name: string, time: string): Promise<void> {
    const registry = await loadRegistryValidated();
    const idx = registry.findIndex((item) => item.name === name);
    if (idx >= 0) {
        registry[idx].lastAttachedAt = time;
        saveRegistry(registry);
    }
}
