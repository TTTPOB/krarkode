import {
    Virtualizer,
    elementScroll,
    observeElementOffset,
    observeElementRect,
} from '@tanstack/virtual-core';

export type VirtualRow = {
    index: number;
    start: number;
    size: number;
    key: number | string;
};

type VirtualizerOptions = {
    getScrollElement: () => HTMLDivElement | null;
    rowHeight: number;
    rowCount: () => number;
    overscan?: number;
    onVirtualRowsChange: (rows: VirtualRow[], totalHeight: number) => void;
    log?: (message: string, payload?: unknown) => void;
};

export type VirtualizerController = {
    update: () => void;
    measure: () => void;
    getVirtualItems: () => ReturnType<Virtualizer<HTMLDivElement, HTMLDivElement>['getVirtualItems']>;
    dispose: () => void;
};

export function useVirtualizer(options: VirtualizerOptions): VirtualizerController {
    const log = options.log ?? (() => undefined);
    let rowVirtualizer: Virtualizer<HTMLDivElement, HTMLDivElement> | null = null;
    let cleanup: (() => void) | null = null;

    const refreshVirtualRows = (): void => {
        if (!rowVirtualizer) {
            return;
        }
        const rows: VirtualRow[] = rowVirtualizer.getVirtualItems().map((item) => ({
            index: item.index,
            start: item.start,
            size: item.size,
            key: item.key,
        }));
        options.onVirtualRowsChange(rows, rowVirtualizer.getTotalSize());
    };

    const update = (): void => {
        const scrollElement = options.getScrollElement();
        const rowCount = options.rowCount();
        if (!scrollElement || rowCount < 0) {
            return;
        }

        if (!rowVirtualizer) {
            rowVirtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
                count: rowCount,
                getScrollElement: () => scrollElement,
                estimateSize: () => options.rowHeight,
                overscan: options.overscan ?? 8,
                scrollToFn: elementScroll,
                observeElementRect,
                observeElementOffset,
                onChange: () => {
                    refreshVirtualRows();
                },
            });
            cleanup = rowVirtualizer._didMount();
            log('Row virtualizer created', {
                count: rowCount,
                hasScrollElement: Boolean(scrollElement),
            });
        }

        rowVirtualizer.setOptions({
            ...rowVirtualizer.options,
            count: rowCount,
        });
        log('Row virtualizer options updated', {
            count: rowCount,
            hasScrollElement: Boolean(scrollElement),
        });
        rowVirtualizer._willUpdate();
        rowVirtualizer.measure();
        refreshVirtualRows();
    };

    const measure = (): void => {
        if (!rowVirtualizer) {
            return;
        }
        rowVirtualizer.measure();
        refreshVirtualRows();
    };

    const getVirtualItems = (): ReturnType<Virtualizer<HTMLDivElement, HTMLDivElement>['getVirtualItems']> => {
        return rowVirtualizer?.getVirtualItems() ?? [];
    };

    const dispose = (): void => {
        cleanup?.();
        cleanup = null;
        rowVirtualizer = null;
    };

    return {
        update,
        measure,
        getVirtualItems,
        dispose,
    };
}
