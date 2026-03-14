/**
 * Core data store for the Data Explorer.
 * Manages schema, row data, and data-related state.
 * Svelte 5 runes class singleton.
 */

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

class DataStore {
    backendState = $state<BackendState | null>(null);
    fullSchema = $state<ColumnSchema[]>([]);
    hiddenColumnIndices = $state<Set<number>>(new Set());
    columnFilterMatches = $state<Array<number | string | Record<string, unknown>> | null>(null);
    columnWidths = $state<Map<number, number>>(new Map());
    rowFilters = $state<RowFilter[]>([]);
    rowCache = $state<Map<number, string[]>>(new Map());
    rowLabelCache = $state<Map<number, string>>(new Map());
    rowCacheVersion = $state(0);
    loadedBlocks = $state<Set<number>>(new Set());
    loadingBlocks = $state<Set<number>>(new Set());
    activeSort = $state<SortState | null>(null);
    rowFilterSupport = $state<SetRowFiltersFeatures | undefined>(undefined);
    columnFilterSupport = $state<SearchSchemaFeatures | undefined>(undefined);
    setColumnFilterSupport = $state<SetColumnFiltersFeatures | undefined>(undefined);

    visibleSchema = $derived.by(() => {
        const isSetColumnFiltersSupported = this.setColumnFilterSupport?.support_status !== 'unsupported';

        let baseSchema = this.fullSchema;
        if (this.columnFilterMatches && !isSetColumnFiltersSupported) {
            const lookup = new Map(this.fullSchema.map((col) => [col.column_index, col]));
            const resolved: ColumnSchema[] = [];
            const seen = new Set<number>();

            for (const match of this.columnFilterMatches) {
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

        return baseSchema.filter((col) => !this.hiddenColumnIndices.has(col.column_index));
    });

    resolvedColumnWidths = $derived.by(() => {
        return this.visibleSchema.map((column) => {
            const width = this.columnWidths.get(column.column_index);
            if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
                return COLUMN_WIDTH;
            }
            return Math.max(80, Math.round(width));
        });
    });

    isRowFilterSupported = $derived.by(() => {
        const status = this.rowFilterSupport?.support_status;
        return !status || status === 'supported';
    });

    isSortSupported = $derived.by(() => {
        const status = this.backendState?.supported_features?.set_sort_columns?.support_status;
        return !status || status === 'supported';
    });

    resolveSortState(sortKeys?: ColumnSortKey[]): SortState | null {
        if (!sortKeys || sortKeys.length === 0) {
            return null;
        }
        const primary = sortKeys[0];
        return {
            columnIndex: primary.column_index,
            direction: primary.ascending ? 'asc' : 'desc',
        };
    }

    initialize(state: BackendState, schema: ColumnSchema[]): void {
        this.backendState = state;
        this.fullSchema = schema;
        this.columnFilterMatches = null;
        this.hiddenColumnIndices = new Set();
        this.rowCache = new Map();
        this.rowLabelCache = new Map();
        this.rowCacheVersion = 0;
        this.loadedBlocks = new Set();
        this.loadingBlocks = new Set();

        // Preserve existing column widths
        const currentWidths = this.columnWidths;
        const nextWidths = new Map<number, number>();
        schema.forEach((column) => {
            const width = currentWidths.get(column.column_index);
            if (width !== undefined) {
                nextWidths.set(column.column_index, width);
            }
        });
        this.columnWidths = nextWidths;

        this.activeSort = this.resolveSortState(state.sort_keys);
        this.rowFilters = state.row_filters ?? [];
        this.rowFilterSupport = state.supported_features?.set_row_filters;
        this.columnFilterSupport = state.supported_features?.search_schema;
        this.setColumnFilterSupport = state.supported_features?.set_column_filters;
    }

    hideColumn(columnIndex: number): void {
        const next = new Set(this.hiddenColumnIndices);
        next.add(columnIndex);
        this.hiddenColumnIndices = next;
    }

    showColumn(columnIndex: number): void {
        const next = new Set(this.hiddenColumnIndices);
        next.delete(columnIndex);
        this.hiddenColumnIndices = next;
    }

    toggleColumnVisibility(columnIndex: number): void {
        if (this.hiddenColumnIndices.has(columnIndex)) {
            this.showColumn(columnIndex);
        } else if (this.visibleSchema.length > 1) {
            this.hideColumn(columnIndex);
        }
    }

    setColumnWidth(columnIndex: number, width: number): void {
        const next = new Map(this.columnWidths);
        next.set(columnIndex, Math.max(80, Math.round(width)));
        this.columnWidths = next;
    }
}

export const dataStore = new DataStore();
