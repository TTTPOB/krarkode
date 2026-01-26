import { get, type Writable } from 'svelte/store';

type WindowEventsOptions = {
    closeColumnMenu: () => void;
    isPanelPinned: (panelId: string) => boolean;
    columnMenuOpen: Writable<boolean>;
    statsPanelOpen: Writable<boolean>;
    columnVisibilityOpen: Writable<boolean>;
    codeModalOpen: Writable<boolean>;
    rowFilterPanelOpen: Writable<boolean>;
    getColumnMenuEl: () => HTMLDivElement | undefined;
    getStatsPanelEl: () => HTMLDivElement | undefined;
    getStatsButtonEl: () => HTMLButtonElement | undefined;
    getColumnVisibilityPanelEl: () => HTMLDivElement | undefined;
    getColumnsButtonEl: () => HTMLButtonElement | undefined;
    getCodeModalEl: () => HTMLDivElement | undefined;
    getCodeButtonEl: () => HTMLButtonElement | undefined;
    getRowFilterPanelEl: () => HTMLDivElement | undefined;
    getAddRowFilterButtonEl: () => HTMLButtonElement | undefined;
    handleSidePanelResize: (event: MouseEvent) => void;
    handleColumnResizeMove: (event: MouseEvent) => void;
    finishSidePanelResize: () => void;
    handleColumnResizeEnd: () => void;
    onResize: () => void;
};

export function useWindowEventsController(options: WindowEventsOptions) {
    const {
        closeColumnMenu,
        isPanelPinned,
        columnMenuOpen,
        statsPanelOpen,
        columnVisibilityOpen,
        codeModalOpen,
        rowFilterPanelOpen,
        getColumnMenuEl,
        getStatsPanelEl,
        getStatsButtonEl,
        getColumnVisibilityPanelEl,
        getColumnsButtonEl,
        getCodeModalEl,
        getCodeButtonEl,
        getRowFilterPanelEl,
        getAddRowFilterButtonEl,
        handleSidePanelResize,
        handleColumnResizeMove,
        finishSidePanelResize,
        handleColumnResizeEnd,
        onResize,
    } = options;

    const handleDocumentClick = (event: MouseEvent): void => {
        const target = event.target as Node;
        const columnMenuEl = getColumnMenuEl();
        if (get(columnMenuOpen) && columnMenuEl && !columnMenuEl.contains(target)) {
            closeColumnMenu();
        }
        const statsPanelEl = getStatsPanelEl();
        const statsButtonEl = getStatsButtonEl();
        if (
            get(statsPanelOpen) &&
            statsPanelEl &&
            !statsPanelEl.contains(target) &&
            statsButtonEl &&
            !statsButtonEl.contains(target) &&
            !isPanelPinned('stats-panel')
        ) {
            statsPanelOpen.set(false);
        }
        const columnVisibilityPanelEl = getColumnVisibilityPanelEl();
        const columnsButtonEl = getColumnsButtonEl();
        if (
            get(columnVisibilityOpen) &&
            columnVisibilityPanelEl &&
            !columnVisibilityPanelEl.contains(target) &&
            columnsButtonEl &&
            !columnsButtonEl.contains(target) &&
            !isPanelPinned('column-visibility-panel')
        ) {
            columnVisibilityOpen.set(false);
        }
        const codeModalEl = getCodeModalEl();
        const codeButtonEl = getCodeButtonEl();
        if (
            get(codeModalOpen) &&
            codeModalEl &&
            !codeModalEl.contains(target) &&
            codeButtonEl &&
            !codeButtonEl.contains(target)
        ) {
            codeModalOpen.set(false);
        }
        const rowFilterPanelEl = getRowFilterPanelEl();
        const addRowFilterButtonEl = getAddRowFilterButtonEl();
        if (
            get(rowFilterPanelOpen) &&
            rowFilterPanelEl &&
            !rowFilterPanelEl.contains(target) &&
            addRowFilterButtonEl &&
            !addRowFilterButtonEl.contains(target) &&
            !isPanelPinned('row-filter-panel')
        ) {
            rowFilterPanelOpen.set(false);
        }
    };

    const handleWindowResize = (): void => {
        closeColumnMenu();
        onResize();
    };

    const handleWindowKeydown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            closeColumnMenu();
        }
    };

    const handleWindowMouseMove = (event: MouseEvent): void => {
        handleSidePanelResize(event);
        handleColumnResizeMove(event);
    };

    const handleWindowMouseUp = (): void => {
        finishSidePanelResize();
        handleColumnResizeEnd();
    };

    return {
        handleDocumentClick,
        handleWindowResize,
        handleWindowKeydown,
        handleWindowMouseMove,
        handleWindowMouseUp,
    };
}
