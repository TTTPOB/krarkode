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
