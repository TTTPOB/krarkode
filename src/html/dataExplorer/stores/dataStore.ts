/**
 * Core data store for the Data Explorer.
 * Manages schema, row data, and data-related state.
 */

import { writable, derived, get } from 'svelte/store';
import type {
    BackendState,
    ColumnSchema,
    RowFilter,
    SortState,
    ColumnSortKey,
    SetRowFiltersFeatures,
    SearchSchemaFeatures,
    SetColumnFiltersFeatures,
} from '../types';
import { COLUMN_WIDTH } from '../types';

/**
 * Core backend state from the data provider.
 */
export const backendState = writable<BackendState | null>(null);

/**
 * Full schema including hidden columns.
 */
export const fullSchema = writable<ColumnSchema[]>([]);

/**
 * Set of hidden column indices.
 */
export const hiddenColumnIndices = writable<Set<number>>(new Set());

/**
 * Column filter matches from search_schema.
 */
export const columnFilterMatches = writable<Array<number | string | Record<string, unknown>> | null>(null);

/**
 * Column widths map.
 */
export const columnWidths = writable<Map<number, number>>(new Map());

/**
 * Active row filters.
 */
export const rowFilters = writable<RowFilter[]>([]);

/**
 * Active sort state.
 */
export const activeSort = writable<SortState | null>(null);

/**
 * Feature support states.
 */
export const rowFilterSupport = writable<SetRowFiltersFeatures | undefined>(undefined);
export const columnFilterSupport = writable<SearchSchemaFeatures | undefined>(undefined);
export const setColumnFilterSupport = writable<SetColumnFiltersFeatures | undefined>(undefined);

/**
 * Derived: visible schema (respects hidden columns and filters).
 */
export const visibleSchema = derived(
    [fullSchema, hiddenColumnIndices, columnFilterMatches, setColumnFilterSupport],
    ([$fullSchema, $hiddenColumnIndices, $columnFilterMatches, $setColumnFilterSupport]) => {
        const isSetColumnFiltersSupported = $setColumnFilterSupport?.support_status !== 'unsupported';
        
        // If we have filter matches and set_column_filters is not supported, use matches as base
        let baseSchema = $fullSchema;
        if ($columnFilterMatches && !isSetColumnFiltersSupported) {
            // Resolve matches to schema columns
            const lookup = new Map($fullSchema.map((col) => [col.column_index, col]));
            const resolved: ColumnSchema[] = [];
            const seen = new Set<number>();
            
            for (const match of $columnFilterMatches) {
                let index: number | null = null;
                if (typeof match === 'number') {
                    index = match;
                } else if (typeof match === 'string') {
                    const num = Number(match);
                    if (Number.isFinite(num)) {
                        index = num;
                    }
                } else if (match && typeof match === 'object') {
                    const candidate = (match as Record<string, unknown>).column_index;
                    if (typeof candidate === 'number') {
                        index = candidate;
                    }
                }
                if (index !== null && !seen.has(index)) {
                    const col = lookup.get(index);
                    if (col) {
                        resolved.push(col);
                        seen.add(index);
                    }
                }
            }
            if (resolved.length > 0) {
                baseSchema = resolved;
            }
        }
        
        return baseSchema.filter((col) => !$hiddenColumnIndices.has(col.column_index));
    }
);

/**
 * Derived: resolved column widths array.
 */
export const resolvedColumnWidths = derived(
    [visibleSchema, columnWidths],
    ([$visibleSchema, $columnWidths]) => {
        return $visibleSchema.map((column) => {
            const width = $columnWidths.get(column.column_index);
            if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
                return COLUMN_WIDTH;
            }
            return Math.max(80, Math.round(width));
        });
    }
);

/**
 * Derived: is row filter supported.
 */
export const isRowFilterSupportedStore = derived(
    rowFilterSupport,
    ($support) => {
        const status = $support?.support_status;
        return !status || status === 'supported';
    }
);

/**
 * Derived: is sort supported.
 */
export const isSortSupportedStore = derived(
    backendState,
    ($state) => {
        const status = $state?.supported_features?.set_sort_columns?.support_status;
        return !status || status === 'supported';
    }
);

/**
 * Resolve sort state from backend sort keys.
 */
export function resolveSortState(sortKeys?: ColumnSortKey[]): SortState | null {
    if (!sortKeys || sortKeys.length === 0) {
        return null;
    }
    const primary = sortKeys[0];
    return {
        columnIndex: primary.column_index,
        direction: primary.ascending ? 'asc' : 'desc',
    };
}

/**
 * Initialize data store from init message.
 */
export function initializeDataStore(state: BackendState, schema: ColumnSchema[]): void {
    backendState.set(state);
    fullSchema.set(schema);
    columnFilterMatches.set(null);
    hiddenColumnIndices.set(new Set());
    
    // Preserve existing column widths
    const currentWidths = get(columnWidths);
    const nextWidths = new Map<number, number>();
    schema.forEach((column) => {
        const width = currentWidths.get(column.column_index);
        if (width !== undefined) {
            nextWidths.set(column.column_index, width);
        }
    });
    columnWidths.set(nextWidths);
    
    activeSort.set(resolveSortState(state.sort_keys));
    rowFilters.set(state.row_filters ?? []);
    rowFilterSupport.set(state.supported_features?.set_row_filters);
    columnFilterSupport.set(state.supported_features?.search_schema);
    setColumnFilterSupport.set(state.supported_features?.set_column_filters);
}

/**
 * Hide a column by index.
 */
export function hideColumn(columnIndex: number): void {
    hiddenColumnIndices.update((indices) => {
        const next = new Set(indices);
        next.add(columnIndex);
        return next;
    });
}

/**
 * Show a column by index.
 */
export function showColumn(columnIndex: number): void {
    hiddenColumnIndices.update((indices) => {
        const next = new Set(indices);
        next.delete(columnIndex);
        return next;
    });
}

/**
 * Toggle column visibility.
 */
export function toggleColumnVisibility(columnIndex: number): void {
    const schema = get(visibleSchema);
    const hidden = get(hiddenColumnIndices);
    
    if (hidden.has(columnIndex)) {
        showColumn(columnIndex);
    } else if (schema.length > 1) {
        hideColumn(columnIndex);
    }
}

/**
 * Set column width.
 */
export function setColumnWidth(columnIndex: number, width: number): void {
    columnWidths.update((widths) => {
        const next = new Map(widths);
        next.set(columnIndex, Math.max(80, Math.round(width)));
        return next;
    });
}
