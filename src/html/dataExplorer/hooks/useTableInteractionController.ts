import { tick } from 'svelte';
import { dataStore, uiStore } from '../stores';
import type { RowFilter } from '../types';

type TableInteractionOptions = {
    postMessage: (message: unknown) => void;
    getColumnMenuEl: () => HTMLDivElement | undefined;
    getTableBodyEl: () => HTMLDivElement | undefined;
    setHeaderScrollLeft: (value: number) => void;
    openRowFilterEditor: (filter?: RowFilter, index?: number, columnIndex?: number) => void;
};

export class TableInteractionController {
    private readonly postMessage: (message: unknown) => void;
    private readonly getColumnMenuEl: () => HTMLDivElement | undefined;
    private readonly getTableBodyEl: () => HTMLDivElement | undefined;
    private readonly setHeaderScrollLeft: (value: number) => void;
    private readonly openRowFilterEditor: (filter?: RowFilter, index?: number, columnIndex?: number) => void;
    private lastScrollLeft = 0;

    constructor(options: TableInteractionOptions) {
        this.postMessage = options.postMessage;
        this.getColumnMenuEl = options.getColumnMenuEl;
        this.getTableBodyEl = options.getTableBodyEl;
        this.setHeaderScrollLeft = options.setHeaderScrollLeft;
        this.openRowFilterEditor = options.openRowFilterEditor;
    }

    private getNextSort(columnIndex: number): { columnIndex: number; direction: 'asc' | 'desc' } | null {
        const current = dataStore.activeSort;
        if (!current || current.columnIndex !== columnIndex) {
            return { columnIndex, direction: 'asc' };
        }
        if (current.direction === 'asc') {
            return { columnIndex, direction: 'desc' };
        }
        return null;
    }

    closeColumnMenu(): void {
        uiStore.closeColumnMenu();
    }

    openColumnMenu(event: MouseEvent, columnIndex: number): void {
        uiStore.columnMenuColumnIndex = columnIndex;
        uiStore.columnMenuOpen = true;
        void tick().then(() => {
            const padding = 8;
            const { innerWidth, innerHeight } = window;
            const menuRect = this.getColumnMenuEl()?.getBoundingClientRect();
            const menuWidth = menuRect?.width ?? 160;
            const menuHeight = menuRect?.height ?? 80;
            const nextLeft = Math.min(event.clientX, innerWidth - menuWidth - padding);
            const nextTop = Math.min(event.clientY, innerHeight - menuHeight - padding);
            uiStore.columnMenuPosition = {
                x: Math.max(nextLeft, padding),
                y: Math.max(nextTop, padding),
            };
        });
    }

    handleColumnMenuAddFilter(): void {
        const columnIndex = uiStore.columnMenuColumnIndex;
        if (columnIndex === null) {
            return;
        }
        uiStore.closeColumnMenu();
        this.openRowFilterEditor(undefined, undefined, columnIndex);
    }

    handleColumnMenuHideColumn(): void {
        const columnIndex = uiStore.columnMenuColumnIndex;
        if (columnIndex === null) {
            return;
        }
        uiStore.closeColumnMenu();
        dataStore.hideColumn(columnIndex);
    }

    handleDataTableSort(columnIndex: number): void {
        const nextSort = this.getNextSort(columnIndex);
        dataStore.activeSort = nextSort;
        this.postMessage({
            type: 'setSort',
            sortKey: nextSort ? { columnIndex: nextSort.columnIndex, direction: nextSort.direction } : null,
        });
    }

    handleDataTableScroll(): void {
        if (uiStore.columnMenuOpen) {
            uiStore.closeColumnMenu();
        }
        const tableBodyEl = this.getTableBodyEl();
        if (tableBodyEl && tableBodyEl.scrollLeft !== this.lastScrollLeft) {
            this.lastScrollLeft = tableBodyEl.scrollLeft;
            this.setHeaderScrollLeft(tableBodyEl.scrollLeft);
        }
    }
}
