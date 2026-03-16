import * as vscode from 'vscode';

export type ArkLogLevelSetting = 'inherit' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const DEFAULT_ARK_LOG_LEVEL: ArkLogLevelSetting = 'inherit';

export function getArkLogLevel(config?: vscode.WorkspaceConfiguration): ArkLogLevelSetting {
    const value = (config ?? vscode.workspace.getConfiguration('krarkode.ark')).get<string>('logLevel');
    if (
        value === 'inherit' ||
        value === 'error' ||
        value === 'warn' ||
        value === 'info' ||
        value === 'debug' ||
        value === 'trace'
    ) {
        return value;
    }
    return DEFAULT_ARK_LOG_LEVEL;
}

export function formatArkRustLog(level: ArkLogLevelSetting): string | undefined {
    if (level === 'inherit') {
        return undefined;
    }
    return `ark=${level}`;
}

const SIDECAR_RUST_LOG_TARGET = 'vscode_r_ark_sidecar';

export function formatSidecarRustLog(level: ArkLogLevelSetting): string | undefined {
    if (level === 'inherit') {
        return undefined;
    }
    return `${SIDECAR_RUST_LOG_TARGET}=${level}`;
}

/**
 * Merge a target=level directive into an existing RUST_LOG string.
 * If the target already has a directive, replace it. Otherwise append.
 */
export function mergeRustLogDirective(
    existingRustLog: string | undefined,
    target: string,
    level: string,
): string {
    const directive = `${target}=${level}`;
    if (!existingRustLog) {
        return directive;
    }
    // Remove any existing directive for this target, then append
    const re = new RegExp(`(^|,)${target}=[a-zA-Z]+(,|$)`, 'g');
    const cleaned = existingRustLog.replace(re, (_match, before: string, after: string) => {
        // Keep one comma if removing from between two directives
        return before && after ? ',' : '';
    });
    if (!cleaned) {
        return directive;
    }
    return `${cleaned},${directive}`;
}
