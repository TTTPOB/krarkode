import { dataStore, uiStore } from '../stores';
import type { ColumnFilter, ColumnSchema, StatsMessageState } from '../types';
import { COLUMN_WIDTH } from '../types';
import { isColumnFilterSupported as checkColumnFilterSupported, resolveSchemaMatches, resolveVisibleSchema, Debouncer } from '../utils';

type SchemaControllerOptions = {
    log: (message: string, payload?: unknown) => void;
    postMessage: (message: unknown) => void;
    setupTable: () => void;
    updateVirtualizer: () => void;
    requestInitialBlock: () => void;
    scheduleTableLayoutDiagnostics: (stage: string) => void;
    setStatsMessage: (message: string, stateValue: StatsMessageState) => void;
    clearStatsContent: () => void;
};

export class SchemaController {
    private readonly log: (message: string, payload?: unknown) => void;
    private readonly postMessage: (message: unknown) => void;
    private readonly setupTable: () => void;
    private readonly updateVirtualizer: () => void;
    private readonly requestInitialBlock: () => void;
    private readonly scheduleTableLayoutDiagnostics: (stage: string) => void;
    private readonly setStatsMessage: (message: string, stateValue: StatsMessageState) => void;
    private readonly clearStatsContent: () => void;
    private readonly columnSearchDebouncer = new Debouncer(250);

    constructor(options: SchemaControllerOptions) {
        this.log = options.log;
        this.postMessage = options.postMessage;
        this.setupTable = options.setupTable;
        this.updateVirtualizer = options.updateVirtualizer;
        this.requestInitialBlock = options.requestInitialBlock;
        this.scheduleTableLayoutDiagnostics = options.scheduleTableLayoutDiagnostics;
        this.setStatsMessage = options.setStatsMessage;
        this.clearStatsContent = options.clearStatsContent;
    }

    private isColumnFilterSupported(): boolean {
        return checkColumnFilterSupported(dataStore.columnFilterSupport);
    }

    private isSetColumnFiltersSupported(): boolean {
        return dataStore.setColumnFilterSupport?.support_status !== 'unsupported';
    }

    getResolvedVisibleSchema(): ColumnSchema[] {
        return resolveVisibleSchema(
            dataStore.fullSchema,
            dataStore.columnFilterMatches,
            dataStore.hiddenColumnIndices,
            this.isSetColumnFiltersSupported(),
        );
    }

    applySchemaUpdate(nextSchema: ColumnSchema[]): void {
        dataStore.rowCache = new Map();
        dataStore.rowLabelCache = new Map();
        dataStore.loadedBlocks = new Set();
        dataStore.loadingBlocks = new Set();
        dataStore.rowCacheVersion = 0;
        const previousWidths = new Map(dataStore.columnWidths);
        const nextWidths = new Map<number, number>();
        dataStore.fullSchema.forEach((column) => {
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
        dataStore.columnWidths = nextWidths;
        this.setupTable();
        this.updateVirtualizer();
        this.requestInitialBlock();
        if (uiStore.statsPanelOpen) {
            const activeStatsColumnIndex = uiStore.activeStatsColumnIndex;
            if (activeStatsColumnIndex !== null) {
                const stillExists = nextSchema.some((column) => column.column_index === activeStatsColumnIndex);
                if (!stillExists) {
                    uiStore.activeStatsColumnIndex = null;
                    uiStore.statsColumnValue = '';
                    this.setStatsMessage('Select a column to view statistics.', 'empty');
                    this.clearStatsContent();
                } else {
                    uiStore.statsColumnValue = String(activeStatsColumnIndex);
                }
            }
        }
        this.scheduleTableLayoutDiagnostics('schema-update');
    }

    handleSearchSchemaResult(matches: Array<number | string | Record<string, unknown>>): void {
        const searchTerm = uiStore.columnVisibilitySearchTerm.trim();
        if (!searchTerm) {
            dataStore.columnFilterMatches = null;
            uiStore.columnVisibilityStatus = 'Showing all columns.';
            return;
        }
        dataStore.columnFilterMatches = matches;
        if (!this.isSetColumnFiltersSupported()) {
            this.applySchemaUpdate(this.getResolvedVisibleSchema());
        }
        uiStore.columnVisibilityStatus = `Found ${matches.length} matching columns.`;
    }

    applyColumnSearch(): void {
        if (!this.isColumnFilterSupported()) {
            uiStore.columnVisibilityStatus = 'Column filtering is not supported.';
            this.log('Column filter unavailable; search_schema unsupported.');
            return;
        }
        const searchTerm = uiStore.columnVisibilitySearchTerm.trim();
        const sortOrder = 'original';

        const filters: ColumnFilter[] = [];
        if (!searchTerm) {
            dataStore.columnFilterMatches = null;
            uiStore.columnVisibilityStatus = 'Showing all columns.';
            if (!this.isSetColumnFiltersSupported()) {
                this.applySchemaUpdate(this.getResolvedVisibleSchema());
            } else {
                this.postMessage({ type: 'setColumnFilters', filters });
            }
            this.log('Column search cleared');
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

        this.log('Applying column search', { term: searchTerm, filters: filters.length });
        uiStore.columnVisibilityStatus = 'Searching...';
        this.postMessage({ type: 'searchSchema', filters, sortOrder });
        if (this.isSetColumnFiltersSupported()) {
            this.postMessage({ type: 'setColumnFilters', filters });
        }
    }

    scheduleColumnVisibilitySearch(): void {
        this.columnSearchDebouncer.schedule(() => this.applyColumnSearch());
    }

    hideColumn(columnIndex: number): void {
        if (dataStore.hiddenColumnIndices.has(columnIndex)) {
            return;
        }
        const nextHidden = new Set(dataStore.hiddenColumnIndices);
        nextHidden.add(columnIndex);
        dataStore.hiddenColumnIndices = nextHidden;
        this.log('Column hidden', { columnIndex });
        this.applySchemaUpdate(this.getResolvedVisibleSchema());
    }

    showColumn(columnIndex: number): void {
        if (!dataStore.hiddenColumnIndices.has(columnIndex)) {
            return;
        }
        const nextHidden = new Set(dataStore.hiddenColumnIndices);
        nextHidden.delete(columnIndex);
        dataStore.hiddenColumnIndices = nextHidden;
        this.log('Column shown', { columnIndex });
        this.applySchemaUpdate(this.getResolvedVisibleSchema());
    }

    toggleColumnVisibility(columnIndex: number): void {
        if (dataStore.hiddenColumnIndices.has(columnIndex)) {
            this.showColumn(columnIndex);
            return;
        }
        if (this.getResolvedVisibleSchema().length <= 1) {
            return;
        }
        this.hideColumn(columnIndex);
    }

    invertColumnVisibility(): void {
        const fullSchema = dataStore.fullSchema;
        if (!fullSchema.length) {
            return;
        }

        const matches = dataStore.columnFilterMatches;
        const baseSchema = matches ? resolveSchemaMatches(fullSchema, matches) : fullSchema;
        if (!baseSchema.length) {
            return;
        }

        this.log('Inverting column visibility', { matches: baseSchema.length });
        const nextHidden = new Set(dataStore.hiddenColumnIndices);
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

        dataStore.hiddenColumnIndices = nextHidden;
        this.applySchemaUpdate(this.getResolvedVisibleSchema());
    }

    dispose(): void {
        this.columnSearchDebouncer.cancel();
    }
}
