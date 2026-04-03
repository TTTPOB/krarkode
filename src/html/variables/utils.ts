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

export function isComplexVariable(variable: Variable): boolean {
    return variable.has_children || ['table', 'map', 'collection', 'class'].includes(variable.kind);
}

export function buildMetaText(variable: Variable): string | undefined {
    const parts: string[] = [];
    if (variable.type_info && variable.type_info !== variable.display_type) {
        parts.push(variable.type_info);
    }

    if (variable.length > 0) {
        parts.push(formatLength(variable));
    }

    if (variable.size > 0) {
        parts.push(formatBytes(variable.size));
    }

    if (parts.length === 0) {
        return undefined;
    }

    return parts.join(' \u2022 ');
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
