import * as util from '../util';
import { getLogger, LogCategory } from '../logging/logger';

const DEFAULT_TMUX_PATH = 'tmux';
const DEFAULT_TMUX_SESSION_NAME = 'krarkode-ark';

export function getTmuxPath(): string {
    const configured = util.substituteVariables((util.config().get<string>('krarkode.ark.tmux.path') || '').trim());
    return configured || DEFAULT_TMUX_PATH;
}

export function getTmuxSessionName(): string {
    return DEFAULT_TMUX_SESSION_NAME;
}

export async function runTmux(command: string, args: string[]): Promise<util.SpawnResult> {
    const result = await util.spawnAsync(command, args, { env: process.env });
    if (result.error) {
        getLogger().log('runtime', LogCategory.Session, 'error', `tmux error: ${String(result.error)}`);
    }
    return result;
}

export async function tmuxHasSession(sessionName: string): Promise<boolean> {
    const result = await runTmux(getTmuxPath(), ['has-session', '-t', sessionName]);
    return result.status === 0;
}

export async function listTmuxWindows(sessionName: string): Promise<string[]> {
    const result = await runTmux(getTmuxPath(), [
        'list-windows',
        '-t',
        sessionName,
        '-F',
        '#{window_name}',
    ]);
    if (result.status !== 0) {
        return [];
    }
    return (result.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

export async function killTmuxWindow(sessionName: string, windowName: string): Promise<void> {
    const target = `${sessionName}:${windowName}`;
    const result = await runTmux(getTmuxPath(), ['kill-window', '-t', target]);
    if (result.status !== 0) {
        const message = result.stderr || result.stdout || result.error?.message || 'Unknown error';
        getLogger().log('runtime', LogCategory.Session, 'error', `Failed to kill tmux window ${target}: ${message}`);
    }
}

export async function getFirstTmuxWindowTarget(sessionName: string): Promise<string | undefined> {
    const result = await runTmux(getTmuxPath(), [
        'list-windows',
        '-t',
        sessionName,
        '-F',
        '#{window_index}',
    ]);
    if (result.status !== 0) {
        return undefined;
    }
    const lines = (result.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (lines.length === 0) {
        return undefined;
    }
    return `${sessionName}:${lines[0]}`;
}

export async function getTmuxPanePid(sessionName: string, windowName: string): Promise<number | undefined> {
    const target = `${sessionName}:${windowName}`;
    const result = await runTmux(getTmuxPath(), [
        'list-panes',
        '-t',
        target,
        '-F',
        '#{pane_pid}',
    ]);
    if (result.status !== 0) {
        return undefined;
    }
    const lines = (result.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (lines.length === 0) {
        return undefined;
    }
    const pid = parseInt(lines[0], 10);
    return isNaN(pid) ? undefined : pid;
}

export async function renameTmuxWindow(target: string, name: string): Promise<void> {
    const result = await runTmux(getTmuxPath(), ['rename-window', '-t', target, name]);
    if (result.status !== 0) {
        const message = result.stderr || result.stdout || result.error?.message || 'Unknown error';
        getLogger().log('runtime', LogCategory.Session, 'warning', `Failed to rename tmux window: ${message}`);
    }
}
