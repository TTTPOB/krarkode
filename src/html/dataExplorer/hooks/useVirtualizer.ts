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
    key: number | string | bigint;
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

export class VirtualizerManager implements VirtualizerController {
    private readonly options: VirtualizerOptions;
    private readonly log: (message: string, payload?: unknown) => void;
    private rowVirtualizer: Virtualizer<HTMLDivElement, HTMLDivElement> | null = null;
    private cleanup: (() => void) | null = null;

    constructor(options: VirtualizerOptions) {
        this.options = options;
        this.log = options.log ?? (() => undefined);
    }

    private refreshVirtualRows(): void {
        if (!this.rowVirtualizer) {
            return;
        }
        const rows: VirtualRow[] = this.rowVirtualizer.getVirtualItems().map((item) => ({
            index: item.index,
            start: item.start,
            size: item.size,
            key: item.key,
        }));
        this.options.onVirtualRowsChange(rows, this.rowVirtualizer.getTotalSize());
    }

    update(): void {
        const scrollElement = this.options.getScrollElement();
        const rowCount = this.options.rowCount();
        if (!scrollElement || rowCount < 0) {
            return;
        }

        if (!this.rowVirtualizer) {
            this.rowVirtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
                count: rowCount,
                getScrollElement: () => scrollElement,
                estimateSize: () => this.options.rowHeight,
                overscan: this.options.overscan ?? 8,
                scrollToFn: elementScroll,
                observeElementRect,
                observeElementOffset,
                onChange: () => {
                    this.refreshVirtualRows();
                },
            });
            this.cleanup = this.rowVirtualizer._didMount();
            this.log('Row virtualizer created', {
                count: rowCount,
                hasScrollElement: Boolean(scrollElement),
            });
        }

        this.rowVirtualizer.setOptions({
            ...this.rowVirtualizer.options,
            count: rowCount,
        });
        this.log('Row virtualizer options updated', {
            count: rowCount,
            hasScrollElement: Boolean(scrollElement),
        });
        this.rowVirtualizer._willUpdate();
        this.rowVirtualizer.measure();
        this.refreshVirtualRows();
    }

    measure(): void {
        if (!this.rowVirtualizer) {
            return;
        }
        this.rowVirtualizer.measure();
        this.refreshVirtualRows();
    }

    getVirtualItems(): ReturnType<Virtualizer<HTMLDivElement, HTMLDivElement>['getVirtualItems']> {
        return this.rowVirtualizer?.getVirtualItems() ?? [];
    }

    dispose(): void {
        this.cleanup?.();
        this.cleanup = null;
        this.rowVirtualizer = null;
    }
}
