import { tick } from 'svelte';
import { get, type Writable } from 'svelte/store';
import type { RowFilter, SortState } from '../types';

type TableInteractionOptions = {
    postMessage: (message: unknown) => void;
    activeSort: Writable<SortState | null>;
    columnMenuOpen: Writable<boolean>;
    columnMenuPosition: Writable<{ x: number; y: number }>;
    columnMenuColumnIndex: Writable<number | null>;
    getColumnMenuEl: () => HTMLDivElement | undefined;
    getTableBodyEl: () => HTMLDivElement | undefined;
    setHeaderScrollLeft: (value: number) => void;
    openRowFilterEditor: (filter?: RowFilter, index?: number, columnIndex?: number) => void;
    hideColumn: (columnIndex: number) => void;
};

export function useTableInteractionController(options: TableInteractionOptions) {
    const {
        postMessage,
        activeSort,
        columnMenuOpen,
        columnMenuPosition,
        columnMenuColumnIndex,
        getColumnMenuEl,
        getTableBodyEl,
        setHeaderScrollLeft,
        openRowFilterEditor,
        hideColumn,
    } = options;

    let lastScrollLeft = 0;

    const getNextSort = (columnIndex: number): SortState | null => {
        const current = get(activeSort);
        if (!current || current.columnIndex !== columnIndex) {
            return { columnIndex, direction: 'asc' };
        }
        if (current.direction === 'asc') {
            return { columnIndex, direction: 'desc' };
        }
        return null;
    };

    const closeColumnMenu = (): void => {
        columnMenuOpen.set(false);
        columnMenuColumnIndex.set(null);
    };

    const openColumnMenu = (event: MouseEvent, columnIndex: number): void => {
        columnMenuColumnIndex.set(columnIndex);
        columnMenuOpen.set(true);
        void tick().then(() => {
            const padding = 8;
            const { innerWidth, innerHeight } = window;
            const menuRect = getColumnMenuEl()?.getBoundingClientRect();
            const menuWidth = menuRect?.width ?? 160;
            const menuHeight = menuRect?.height ?? 80;
            const nextLeft = Math.min(event.clientX, innerWidth - menuWidth - padding);
            const nextTop = Math.min(event.clientY, innerHeight - menuHeight - padding);
            columnMenuPosition.set({
                x: Math.max(nextLeft, padding),
                y: Math.max(nextTop, padding),
            });
        });
    };

    const handleColumnMenuAddFilter = (): void => {
        const columnIndex = get(columnMenuColumnIndex);
        if (columnIndex === null) {
            return;
        }
        closeColumnMenu();
        openRowFilterEditor(undefined, undefined, columnIndex);
    };

    const handleColumnMenuHideColumn = (): void => {
        const columnIndex = get(columnMenuColumnIndex);
        if (columnIndex === null) {
            return;
        }
        closeColumnMenu();
        hideColumn(columnIndex);
    };

    const handleDataTableSort = (columnIndex: number): void => {
        const nextSort = getNextSort(columnIndex);
        activeSort.set(nextSort);
        postMessage({
            type: 'setSort',
            sortKey: nextSort ? { columnIndex: nextSort.columnIndex, direction: nextSort.direction } : null,
        });
    };

    const handleDataTableScroll = (): void => {
        if (get(columnMenuOpen)) {
            closeColumnMenu();
        }
        const tableBodyEl = getTableBodyEl();
        if (tableBodyEl && tableBodyEl.scrollLeft !== lastScrollLeft) {
            lastScrollLeft = tableBodyEl.scrollLeft;
            setHeaderScrollLeft(tableBodyEl.scrollLeft);
        }
    };

    return {
        openColumnMenu,
        closeColumnMenu,
        handleColumnMenuAddFilter,
        handleColumnMenuHideColumn,
        handleDataTableSort,
        handleDataTableScroll,
    };
}
