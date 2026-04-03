/**
 * Pure helper functions for the Variables webview.
 */

import type { Variable } from './types';

export function getIconForKind(kind: string): string {
    switch (kind) {
        case 'table':
            return '◫';
        case 'string':
            return 'abc';
        case 'number':
            return '#';
        case 'boolean':
            return '☑';
        case 'function':
            return 'λ';
        default:
            return '?';
    }
}

export function buildDimensionsText(variable: Variable): string {
    if (variable.length <= 0) {
        return '';
    }
    return formatLength(variable);
}

export function formatLength(variable: Variable): string {
    if (variable.kind === 'table') {
        return `${variable.length} columns`;
    }
    if (variable.kind === 'map') {
        return `${variable.length} entries`;
    }
    return `${variable.length} items`;
}

export function formatBytes(size: number): string {
    if (size < 1024) {
        return `${size} B`;
    }
    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
