/**
 * Schema helper utilities for the Data Explorer.
 * Pure functions for resolving and filtering column schemas.
 */

import type { ColumnSchema } from '../types';

/**
 * Resolve schema matches from various match formats.
 * Handles numeric indices, string names, and object matches.
 */
export function resolveSchemaMatches(
    fullSchema: ColumnSchema[],
    matches: Array<number | string | Record<string, unknown>>
): ColumnSchema[] {
    if (!fullSchema.length || matches.length === 0) {
        return [];
    }
    const lookup = new Map(fullSchema.map((column) => [column.column_index, column]));
    const resolved: ColumnSchema[] = [];
    const seen = new Set<number>();
    const numericMatches: number[] = [];
    const nameMatches: string[] = [];

    const resolveIndex = (match: number | string | Record<string, unknown>): number | null => {
        if (typeof match === 'number' && Number.isFinite(match)) {
            return match;
        }
        if (typeof match === 'string') {
            const numeric = Number(match);
            if (Number.isFinite(numeric)) {
                return numeric;
            }
            nameMatches.push(match);
            return null;
        }
        if (match && typeof match === 'object') {
            const record = match as Record<string, unknown>;
            const candidate = record.column_index ?? record.columnIndex ?? record.index;
            if (typeof candidate === 'number' && Number.isFinite(candidate)) {
                return candidate;
            }
            if (typeof candidate === 'string') {
                const numeric = Number(candidate);
                if (Number.isFinite(numeric)) {
                    return numeric;
                }
            }
            const name = record.column_name ?? record.column_label;
            if (typeof name === 'string') {
                nameMatches.push(name);
            }
        }
        return null;
    };

    for (const match of matches) {
        const matchIndex = resolveIndex(match);
        if (matchIndex === null) {
            continue;
        }
        numericMatches.push(matchIndex);
    }

    for (const matchIndex of numericMatches) {
        const column = lookup.get(matchIndex) ?? fullSchema[matchIndex];
        if (!column || seen.has(column.column_index)) {
            continue;
        }
        resolved.push(column);
        seen.add(column.column_index);
    }

    if (resolved.length > 0) {
        return resolved;
    }

    if (nameMatches.length === 0) {
        return [];
    }

    const normalizedNames = new Set(nameMatches.map((name) => name.trim().toLowerCase()).filter(Boolean));
    return fullSchema.filter((column) => {
        const columnName = column.column_name?.toLowerCase();
        const columnLabel = column.column_label?.toLowerCase();
        return (columnName && normalizedNames.has(columnName))
            || (columnLabel && normalizedNames.has(columnLabel));
    });
}

/**
 * Compute displayed columns for the visibility panel.
 * Pure function with explicit parameters for Svelte reactivity tracking.
 */
export function computeDisplayedColumns(
    schemaList: ColumnSchema[],
    matches: Array<number | string | Record<string, unknown>> | null,
    searchTerm: string
): ColumnSchema[] {
    if (!schemaList.length) {
        return [];
    }
    if (!matches || matches.length === 0) {
        return schemaList;
    }
    const resolvedMatches = resolveSchemaMatches(schemaList, matches);
    if (resolvedMatches.length > 0) {
        return resolvedMatches;
    }
    // Fallback: filter locally by search term if matches couldn't be resolved
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
        return schemaList;
    }
    return schemaList.filter((column) => {
        const columnName = column.column_name?.toLowerCase();
        const columnLabel = column.column_label?.toLowerCase();
        return (columnName && columnName.includes(term))
            || (columnLabel && columnLabel.includes(term));
    });
}

/**
 * Resolve visible schema from full schema, filter matches, and hidden indices.
 */
export function resolveVisibleSchema(
    fullSchema: ColumnSchema[],
    columnFilterMatches: Array<number | string | Record<string, unknown>> | null,
    hiddenColumnIndices: Set<number>,
    isSetColumnFiltersSupported: boolean
): ColumnSchema[] {
    const baseSchema = columnFilterMatches && !isSetColumnFiltersSupported
        ? resolveSchemaMatches(fullSchema, columnFilterMatches)
        : fullSchema;
    return baseSchema.filter((column) => !hiddenColumnIndices.has(column.column_index));
}
