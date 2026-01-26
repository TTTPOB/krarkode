import { get, type Readable, type Writable } from 'svelte/store';
import type { ColumnFilter, ColumnSchema, StatsMessageState } from '../types';
import { COLUMN_WIDTH } from '../types';
import { resolveSchemaMatches, resolveVisibleSchema } from '../utils';

type SchemaStores = {
    fullSchema: Readable<ColumnSchema[]>;
    visibleSchema: Readable<ColumnSchema[]>;
    columnFilterMatches: Writable<Array<number | string | Record<string, unknown>> | null>;
    hiddenColumnIndices: Writable<Set<number>>;
    columnWidths: Writable<Map<number, number>>;
    rowCache: Writable<Map<number, string[]>>;
    rowLabelCache: Writable<Map<number, string>>;
    rowCacheVersion: Writable<number>;
    loadedBlocks: Writable<Set<number>>;
    loadingBlocks: Writable<Set<number>>;
};

type SchemaControllerOptions = {
    log: (message: string, payload?: unknown) => void;
    postMessage: (message: unknown) => void;
    stores: SchemaStores;
    getColumnVisibilitySearchTerm: () => string;
    setColumnVisibilityStatus: (value: string) => void;
    isColumnFilterSupported: () => boolean;
    isSetColumnFiltersSupported: () => boolean;
    setupTable: () => void;
    updateVirtualizer: () => void;
    requestInitialBlock: () => void;
    scheduleTableLayoutDiagnostics: (stage: string) => void;
    getStatsPanelOpen: () => boolean;
    getActiveStatsColumnIndex: () => number | null;
    setActiveStatsColumnIndex: (value: number | null) => void;
    setStatsColumnValue: (value: string) => void;
    setStatsMessage: (message: string, stateValue: StatsMessageState) => void;
    clearStatsContent: () => void;
};

export function useSchemaController(options: SchemaControllerOptions) {
    const {
        log,
        postMessage,
        stores,
        getColumnVisibilitySearchTerm,
        setColumnVisibilityStatus,
        isColumnFilterSupported,
        isSetColumnFiltersSupported,
        setupTable,
        updateVirtualizer,
        requestInitialBlock,
        scheduleTableLayoutDiagnostics,
        getStatsPanelOpen,
        getActiveStatsColumnIndex,
        setActiveStatsColumnIndex,
        setStatsColumnValue,
        setStatsMessage,
        clearStatsContent,
    } = options;

    let columnVisibilityDebounceId: number | undefined;

    const getResolvedVisibleSchema = (): ColumnSchema[] => {
        return resolveVisibleSchema(
            get(stores.fullSchema),
            get(stores.columnFilterMatches),
            get(stores.hiddenColumnIndices),
            isSetColumnFiltersSupported(),
        );
    };

    const applySchemaUpdate = (nextSchema: ColumnSchema[]): void => {
        stores.rowCache.set(new Map());
        stores.rowLabelCache.set(new Map());
        stores.loadedBlocks.set(new Set());
        stores.loadingBlocks.set(new Set());
        stores.rowCacheVersion.set(0);
        const previousWidths = new Map(get(stores.columnWidths));
        const nextWidths = new Map<number, number>();
        get(stores.fullSchema).forEach((column) => {
            const width = previousWidths.get(column.column_index);
            if (width !== undefined) {
                nextWidths.set(column.column_index, width);
            }
        });
        nextSchema.forEach((column) => {
            if (!nextWidths.has(column.column_index)) {
                nextWidths.set(column.column_index, COLUMN_WIDTH);
            }
        });
        stores.columnWidths.set(nextWidths);
        setupTable();
        updateVirtualizer();
        requestInitialBlock();
        if (getStatsPanelOpen()) {
            const activeStatsColumnIndex = getActiveStatsColumnIndex();
            if (activeStatsColumnIndex !== null) {
                const stillExists = nextSchema.some((column) => column.column_index === activeStatsColumnIndex);
                if (!stillExists) {
                    setActiveStatsColumnIndex(null);
                    setStatsColumnValue('');
                    setStatsMessage('Select a column to view statistics.', 'empty');
                    clearStatsContent();
                } else {
                    setStatsColumnValue(String(activeStatsColumnIndex));
                }
            }
        }
        scheduleTableLayoutDiagnostics('schema-update');
    };

    const handleSearchSchemaResult = (matches: Array<number | string | Record<string, unknown>>): void => {
        const searchTerm = getColumnVisibilitySearchTerm().trim();
        if (!searchTerm) {
            stores.columnFilterMatches.set(null);
            setColumnVisibilityStatus('Showing all columns.');
            return;
        }
        stores.columnFilterMatches.set(matches);
        if (!isSetColumnFiltersSupported()) {
            applySchemaUpdate(getResolvedVisibleSchema());
        }
        setColumnVisibilityStatus(`Found ${matches.length} matching columns.`);
    };

    const applyColumnSearch = (): void => {
        if (!isColumnFilterSupported()) {
            setColumnVisibilityStatus('Column filtering is not supported.');
            log('Column filter unavailable; search_schema unsupported.');
            return;
        }
        const searchTerm = getColumnVisibilitySearchTerm().trim();
        const sortOrder = 'original';

        const filters: ColumnFilter[] = [];
        if (!searchTerm) {
            stores.columnFilterMatches.set(null);
            setColumnVisibilityStatus('Showing all columns.');
            if (!isSetColumnFiltersSupported()) {
                applySchemaUpdate(getResolvedVisibleSchema());
            } else {
                postMessage({ type: 'setColumnFilters', filters });
            }
            log('Column search cleared');
            return;
        }
        if (searchTerm) {
            filters.push({
                filter_type: 'text_search',
                params: {
                    search_type: 'contains',
                    term: searchTerm,
                    case_sensitive: false,
                },
            });
        }

        log('Applying column search', { term: searchTerm, filters: filters.length });
        setColumnVisibilityStatus('Searching...');
        postMessage({ type: 'searchSchema', filters, sortOrder });
        if (isSetColumnFiltersSupported()) {
            postMessage({ type: 'setColumnFilters', filters });
        }
    };

    const scheduleColumnVisibilitySearch = (): void => {
        if (columnVisibilityDebounceId !== undefined) {
            window.clearTimeout(columnVisibilityDebounceId);
        }
        columnVisibilityDebounceId = window.setTimeout(() => {
            applyColumnSearch();
        }, 250);
    };

    const hideColumn = (columnIndex: number): void => {
        if (get(stores.hiddenColumnIndices).has(columnIndex)) {
            return;
        }
        stores.hiddenColumnIndices.update((indices) => {
            const nextHidden = new Set(indices);
            nextHidden.add(columnIndex);
            return nextHidden;
        });
        log('Column hidden', { columnIndex });
        applySchemaUpdate(getResolvedVisibleSchema());
    };

    const showColumn = (columnIndex: number): void => {
        if (!get(stores.hiddenColumnIndices).has(columnIndex)) {
            return;
        }
        stores.hiddenColumnIndices.update((indices) => {
            const nextHidden = new Set(indices);
            nextHidden.delete(columnIndex);
            return nextHidden;
        });
        log('Column shown', { columnIndex });
        applySchemaUpdate(getResolvedVisibleSchema());
    };

    const toggleColumnVisibility = (columnIndex: number): void => {
        if (get(stores.hiddenColumnIndices).has(columnIndex)) {
            showColumn(columnIndex);
            return;
        }
        if (getResolvedVisibleSchema().length <= 1) {
            return;
        }
        hideColumn(columnIndex);
    };

    const invertColumnVisibility = (): void => {
        const fullSchema = get(stores.fullSchema);
        if (!fullSchema.length) {
            return;
        }

        const matches = get(stores.columnFilterMatches);
        const baseSchema = matches ? resolveSchemaMatches(fullSchema, matches) : fullSchema;
        if (!baseSchema.length) {
            return;
        }

        log('Inverting column visibility', { matches: baseSchema.length });
        const nextHidden = new Set(get(stores.hiddenColumnIndices));
        for (const column of baseSchema) {
            const index = column.column_index;
            if (nextHidden.has(index)) {
                nextHidden.delete(index);
            } else {
                nextHidden.add(index);
            }
        }

        if (nextHidden.size >= fullSchema.length) {
            nextHidden.delete(fullSchema[0]?.column_index ?? 0);
        }

        stores.hiddenColumnIndices.set(nextHidden);
        applySchemaUpdate(getResolvedVisibleSchema());
    };

    const dispose = (): void => {
        if (columnVisibilityDebounceId !== undefined) {
            window.clearTimeout(columnVisibilityDebounceId);
        }
    };

    return {
        handleSearchSchemaResult,
        getResolvedVisibleSchema,
        applySchemaUpdate,
        applyColumnSearch,
        scheduleColumnVisibilitySearch,
        hideColumn,
        showColumn,
        toggleColumnVisibility,
        invertColumnVisibility,
        dispose,
    };
}
