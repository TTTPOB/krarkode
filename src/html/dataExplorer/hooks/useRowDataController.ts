import { get, type Readable, type Writable } from 'svelte/store';
import type { BackendState, ColumnSchema, ColumnValue, RowsMessage } from '../types';
import { buildRowBlockRanges, formatSpecialValue } from '../utils';

type RowDataControllerOptions = {
    log: (message: string, payload?: unknown) => void;
    postMessage: (message: unknown) => void;
    getBackendState: () => BackendState | null;
    visibleSchema: Readable<ColumnSchema[]>;
    rowCache: Writable<Map<number, string[]>>;
    rowLabelCache: Writable<Map<number, string>>;
    rowCacheVersion: Writable<number>;
    loadedBlocks: Writable<Set<number>>;
    loadingBlocks: Writable<Set<number>>;
    rowBlockSize: number;
    prefetchBlocks: number;
    requestDebounceMs: number;
    getVirtualItems: () => Array<{ index: number }>;
    measureVirtualizer: () => void;
};

export function useRowDataController(options: RowDataControllerOptions) {
    const {
        log,
        postMessage,
        getBackendState,
        visibleSchema,
        rowCache,
        rowLabelCache,
        rowCacheVersion,
        loadedBlocks,
        loadingBlocks,
        rowBlockSize,
        prefetchBlocks,
        requestDebounceMs,
        getVirtualItems,
        measureVirtualizer,
    } = options;

    let pendingRows: RowsMessage[] = [];
    let rowRequestDebounceId: number | undefined;

    const requestInitialBlock = (): void => {
        const backendState = getBackendState();
        if (!backendState) {
            return;
        }
        if (backendState.table_shape.num_rows === 0) {
            return;
        }
        const endIndex = Math.min(backendState.table_shape.num_rows - 1, rowBlockSize - 1);
        const loaded = get(loadedBlocks);
        const loading = get(loadingBlocks);
        if (loaded.has(0) || loading.has(0)) {
            return;
        }
        loadingBlocks.update((blocks) => {
            const next = new Set(blocks);
            next.add(0);
            return next;
        });
        postMessage({
            type: 'requestRows',
            startIndex: 0,
            endIndex,
        });
    };

    const scheduleVisibleBlocksRequest = (reason: string): void => {
        if (rowRequestDebounceId !== undefined) {
            window.clearTimeout(rowRequestDebounceId);
        }
        rowRequestDebounceId = window.setTimeout(() => {
            rowRequestDebounceId = undefined;
            requestVisibleBlocks(reason);
        }, requestDebounceMs);
    };

    const requestVisibleBlocks = (reason: string): void => {
        const backendState = getBackendState();
        if (!backendState) {
            return;
        }

        const virtualItems = getVirtualItems();
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
            blockSize: rowBlockSize,
            prefetchBlocks,
            loadedBlocks: get(loadedBlocks),
            loadingBlocks: get(loadingBlocks),
        });

        if (!rangeResult || rangeResult.ranges.length === 0) {
            return;
        }

        log('Requesting row blocks', {
            reason,
            visibleRange: rangeResult.visibleRange,
            prefetchRange: rangeResult.prefetchRange,
            ranges: rangeResult.ranges.map((range) => ({ startBlock: range.startBlock, endBlock: range.endBlock })),
        });

        for (const range of rangeResult.ranges) {
            loadingBlocks.update((blocks) => {
                const next = new Set(blocks);
                for (let block = range.startBlock; block <= range.endBlock; block += 1) {
                    next.add(block);
                }
                return next;
            });

            const blockStart = range.startBlock * rowBlockSize;
            const blockEnd = Math.min(rowCount - 1, (range.endBlock + 1) * rowBlockSize - 1);
            postMessage({
                type: 'requestRows',
                startIndex: blockStart,
                endIndex: blockEnd,
            });
        }
    };

    const formatColumnValue = (value: ColumnValue): string => {
        if (typeof value === 'number') {
            return formatSpecialValue(value);
        }
        return value ?? '';
    };

    const handleRows = (message: RowsMessage): void => {
        const backendState = getBackendState();
        const schema = get(visibleSchema);
        if (!backendState || schema.length === 0) {
            pendingRows.push(message);
            log('Queued rows before init', { startIndex: message.startIndex, endIndex: message.endIndex });
            return;
        }
        const { startIndex, endIndex, columns, rowLabels } = message;
        const rowCount = endIndex - startIndex + 1;
        const columnCount = schema.length;
        const nextRowCache = new Map(get(rowCache));
        const nextRowLabelCache = new Map(get(rowLabelCache));

        for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
            const rowIndex = startIndex + rowOffset;
            const values: string[] = new Array(columnCount).fill('');

            for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
                const columnValues = columns[columnIndex];
                const value = columnValues ? columnValues[rowOffset] : '';
                values[columnIndex] = formatColumnValue(value);
            }

            nextRowCache.set(rowIndex, values);
            if (rowLabels && rowLabels[rowOffset] !== undefined) {
                nextRowLabelCache.set(rowIndex, rowLabels[rowOffset]);
            }
        }

        const startBlock = Math.floor(startIndex / rowBlockSize);
        const endBlock = Math.floor(endIndex / rowBlockSize);
        const nextLoadedBlocks = new Set(get(loadedBlocks));
        const nextLoadingBlocks = new Set(get(loadingBlocks));

        for (let block = startBlock; block <= endBlock; block += 1) {
            nextLoadingBlocks.delete(block);
            nextLoadedBlocks.add(block);
        }

        rowCache.set(nextRowCache);
        rowLabelCache.set(nextRowLabelCache);
        loadedBlocks.set(nextLoadedBlocks);
        loadingBlocks.set(nextLoadingBlocks);
        rowCacheVersion.update((version) => version + 1);
        measureVirtualizer();
        log('Rows rendered', { startIndex, endIndex, rows: rowCount, columns: columnCount });
    };

    const applyPendingRows = (): void => {
        if (pendingRows.length === 0) {
            return;
        }
        const queued = [...pendingRows];
        pendingRows = [];
        queued.forEach((rowsMessage) => handleRows(rowsMessage));
        log('Applied pending rows', { count: queued.length });
    };

    const getCellValue = (rowIndex: number, columnIndex: number): string => {
        const values = get(rowCache).get(rowIndex);
        if (!values) {
            return '';
        }
        return values[columnIndex] ?? '';
    };

    const getRowLabel = (rowIndex: number): string => {
        const backendState = getBackendState();
        if (backendState?.has_row_labels) {
            return get(rowLabelCache).get(rowIndex) ?? '';
        }
        return String(rowIndex + 1);
    };

    const dispose = (): void => {
        if (rowRequestDebounceId !== undefined) {
            window.clearTimeout(rowRequestDebounceId);
        }
    };

    return {
        requestInitialBlock,
        scheduleVisibleBlocksRequest,
        requestVisibleBlocks,
        handleRows,
        applyPendingRows,
        getCellValue,
        getRowLabel,
        dispose,
    };
}
