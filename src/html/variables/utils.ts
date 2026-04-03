/**
 * Pure helper functions for the Variables webview.
 */

import type { Variable } from './types';

export function getIconForKind(kind: string, displayType?: string): string {
    switch (kind) {
        case 'table':
        case 'dataframe':
            return '◫';
        case 'string':
            return 'abc';
        case 'number':
            return '#';
        case 'boolean':
            return '☑';
        case 'function':
            return 'λ';
        case 'map':
            return '{}';
        case 'bytes':
            return '0x';
        case 'collection':
            // Derive icon from the R type for vectors
            return getIconForRType(displayType ?? '');
        case 'empty':
            return '∅';
        default:
            return '?';
    }
}

/**
 * Map R type names (from display_type) to icons.
 */
function getIconForRType(displayType: string): string {
    const t = displayType.toLowerCase();
    if (t.startsWith('int') || t.startsWith('dbl') || t.startsWith('double') || t.startsWith('num') || t.startsWith('complex')) {
        return '#';
    }
    if (t.startsWith('chr') || t.startsWith('char')) {
        return 'abc';
    }
    if (t.startsWith('lgl') || t.startsWith('logical')) {
        return '☑';
    }
    if (t.startsWith('raw')) {
        return '0x';
    }
    if (t.startsWith('factor')) {
        return 'abc';
    }
    return '?';
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

/**
 * Strip trailing dimension info like " [10]" or " [10, 2]" from display_type.
 * Ark includes dimensions in display_type (e.g. "integer [10]", "data.frame [10, 2]")
 * but we now show dimensions in a separate column.
 */
export function cleanDisplayType(displayType: string): string {
    return displayType.replace(/\s*\[[\d, ?]+\]$/, '');
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
