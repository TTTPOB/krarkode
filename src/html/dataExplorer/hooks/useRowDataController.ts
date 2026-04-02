import { dataStore } from '../stores';
import type { BackendState, ColumnValue, RowsMessage } from '../types';
import { buildRowBlockRanges, formatSpecialValue, Debouncer } from '../utils';

// Maximum number of cached rows before eviction kicks in.
// With typical column counts this keeps memory usage reasonable
// while allowing enough buffer for smooth scrolling.
const MAX_CACHED_ROWS = 10_000;

type RowDataControllerOptions = {
    log: (message: string, payload?: unknown) => void;
    postMessage: (message: unknown) => void;
    rowBlockSize: number;
    prefetchBlocks: number;
    requestDebounceMs: number;
    getVirtualItems: () => Array<{ index: number }>;
    measureVirtualizer: () => void;
};

export class RowDataController {
    private readonly log: (message: string, payload?: unknown) => void;
    private readonly postMessage: (message: unknown) => void;
    private readonly rowBlockSize: number;
    private readonly prefetchBlocks: number;
    private readonly requestDebounceMs: number;
    private readonly getVirtualItems: () => Array<{ index: number }>;
    private readonly measureVirtualizer: () => void;
    private pendingRows: RowsMessage[] = [];
    private readonly debouncer: Debouncer;

    constructor(options: RowDataControllerOptions) {
        this.log = options.log;
        this.postMessage = options.postMessage;
        this.rowBlockSize = options.rowBlockSize;
        this.prefetchBlocks = options.prefetchBlocks;
        this.requestDebounceMs = options.requestDebounceMs;
        this.getVirtualItems = options.getVirtualItems;
        this.measureVirtualizer = options.measureVirtualizer;
        this.debouncer = new Debouncer(options.requestDebounceMs);
    }

    private getBackendState(): BackendState | null {
        return dataStore.backendState;
    }

    requestInitialBlock(): void {
        const backendState = this.getBackendState();
        if (!backendState) {
            return;
        }
        if (backendState.table_shape.num_rows === 0) {
            return;
        }
        const endIndex = Math.min(backendState.table_shape.num_rows - 1, this.rowBlockSize - 1);
        const loaded = dataStore.loadedBlocks;
        const loading = dataStore.loadingBlocks;
        if (loaded.has(0) || loading.has(0)) {
            return;
        }
        const nextLoading = new Set(loading);
        nextLoading.add(0);
        dataStore.loadingBlocks = nextLoading;
        this.postMessage({
            type: 'requestRows',
            startIndex: 0,
            endIndex,
        });
    }

    scheduleVisibleBlocksRequest(reason: string): void {
        this.debouncer.schedule(() => this.requestVisibleBlocks(reason));
    }

    requestVisibleBlocks(reason: string): void {
        const backendState = this.getBackendState();
        if (!backendState) {
            return;
        }

        const virtualItems = this.getVirtualItems();
        if (!virtualItems.length) {
            return;
        }

        const startIndex = virtualItems[0].index;
        const endIndex = virtualItems[virtualItems.length - 1].index;
        const rowCount = backendState.table_shape.num_rows;
        const rangeResult = buildRowBlockRanges({
            startIndex,
            endIndex,
            rowCount,
            blockSize: this.rowBlockSize,
            prefetchBlocks: this.prefetchBlocks,
            loadedBlocks: dataStore.loadedBlocks,
            loadingBlocks: dataStore.loadingBlocks,
        });

        if (!rangeResult || rangeResult.ranges.length === 0) {
            return;
        }

        this.log('Requesting row blocks', {
            reason,
            visibleRange: rangeResult.visibleRange,
            prefetchRange: rangeResult.prefetchRange,
            ranges: rangeResult.ranges.map((range) => ({ startBlock: range.startBlock, endBlock: range.endBlock })),
        });

        for (const range of rangeResult.ranges) {
            const nextLoading = new Set(dataStore.loadingBlocks);
            for (let block = range.startBlock; block <= range.endBlock; block += 1) {
                nextLoading.add(block);
            }
            dataStore.loadingBlocks = nextLoading;

            const blockStart = range.startBlock * this.rowBlockSize;
            const blockEnd = Math.min(rowCount - 1, (range.endBlock + 1) * this.rowBlockSize - 1);
            this.postMessage({
                type: 'requestRows',
                startIndex: blockStart,
                endIndex: blockEnd,
            });
        }
    }

    private formatColumnValue(value: ColumnValue): string {
        if (typeof value === 'number') {
            return formatSpecialValue(value);
        }
        return value ?? '';
    }

    handleRows(message: RowsMessage): void {
        const backendState = this.getBackendState();
        const schema = dataStore.visibleSchema;
        if (!backendState || schema.length === 0) {
            this.pendingRows.push(message);
            this.log('Queued rows before init', { startIndex: message.startIndex, endIndex: message.endIndex });
            return;
        }
        const { startIndex, endIndex, columns, rowLabels } = message;
        const rowCount = endIndex - startIndex + 1;
        const columnCount = schema.length;
        const nextRowCache = new Map(dataStore.rowCache);
        const nextRowLabelCache = new Map(dataStore.rowLabelCache);

        for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
            const rowIndex = startIndex + rowOffset;
            const values: string[] = new Array(columnCount).fill('');

            for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
                const columnValues = columns[columnIndex];
                const value = columnValues ? columnValues[rowOffset] : '';
                values[columnIndex] = this.formatColumnValue(value);
            }

            nextRowCache.set(rowIndex, values);
            if (rowLabels && rowLabels[rowOffset] !== undefined) {
                nextRowLabelCache.set(rowIndex, rowLabels[rowOffset]);
            }
        }

        const startBlock = Math.floor(startIndex / this.rowBlockSize);
        const endBlock = Math.floor(endIndex / this.rowBlockSize);
        const nextLoadedBlocks = new Set(dataStore.loadedBlocks);
        const nextLoadingBlocks = new Set(dataStore.loadingBlocks);

        for (let block = startBlock; block <= endBlock; block += 1) {
            nextLoadingBlocks.delete(block);
            nextLoadedBlocks.add(block);
        }

        // Evict rows furthest from current viewport when cache exceeds limit
        if (nextRowCache.size > MAX_CACHED_ROWS) {
            const viewportCenter = (startIndex + endIndex) / 2;
            const entries = [...nextRowCache.keys()].sort(
                (a, b) => Math.abs(a - viewportCenter) - Math.abs(b - viewportCenter),
            );
            const toRemove = entries.slice(MAX_CACHED_ROWS);
            for (const key of toRemove) {
                nextRowCache.delete(key);
                nextRowLabelCache.delete(key);
            }
            // Recompute loaded blocks to match remaining cache
            nextLoadedBlocks.clear();
            for (const rowIndex of nextRowCache.keys()) {
                nextLoadedBlocks.add(Math.floor(rowIndex / this.rowBlockSize));
            }
            this.log('Row cache evicted', { removed: toRemove.length, remaining: nextRowCache.size });
        }

        dataStore.rowCache = nextRowCache;
        dataStore.rowLabelCache = nextRowLabelCache;
        dataStore.loadedBlocks = nextLoadedBlocks;
        dataStore.loadingBlocks = nextLoadingBlocks;
        dataStore.rowCacheVersion = dataStore.rowCacheVersion + 1;
        this.measureVirtualizer();
        this.log('Rows rendered', { startIndex, endIndex, rows: rowCount, columns: columnCount });
    }

    applyPendingRows(): void {
        if (this.pendingRows.length === 0) {
            return;
        }
        const queued = [...this.pendingRows];
        this.pendingRows = [];
        queued.forEach((rowsMessage) => this.handleRows(rowsMessage));
        this.log('Applied pending rows', { count: queued.length });
    }

    getCellValue(rowIndex: number, columnIndex: number): string {
        const values = dataStore.rowCache.get(rowIndex);
        if (!values) {
            return '';
        }
        return values[columnIndex] ?? '';
    }

    getRowLabel(rowIndex: number): string {
        const backendState = this.getBackendState();
        if (backendState?.has_row_labels) {
            return dataStore.rowLabelCache.get(rowIndex) ?? '';
        }
        return String(rowIndex + 1);
    }

    dispose(): void {
        this.debouncer.cancel();
    }
}
