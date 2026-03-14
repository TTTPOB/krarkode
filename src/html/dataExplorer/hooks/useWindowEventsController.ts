import { uiStore } from '../stores';

type WindowEventsOptions = {
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

export class WindowEventsController {
    private readonly getColumnMenuEl: () => HTMLDivElement | undefined;
    private readonly getStatsPanelEl: () => HTMLDivElement | undefined;
    private readonly getStatsButtonEl: () => HTMLButtonElement | undefined;
    private readonly getColumnVisibilityPanelEl: () => HTMLDivElement | undefined;
    private readonly getColumnsButtonEl: () => HTMLButtonElement | undefined;
    private readonly getCodeModalEl: () => HTMLDivElement | undefined;
    private readonly getCodeButtonEl: () => HTMLButtonElement | undefined;
    private readonly getRowFilterPanelEl: () => HTMLDivElement | undefined;
    private readonly getAddRowFilterButtonEl: () => HTMLButtonElement | undefined;
    private readonly handleSidePanelResizeFn: (event: MouseEvent) => void;
    private readonly handleColumnResizeMoveFn: (event: MouseEvent) => void;
    private readonly finishSidePanelResizeFn: () => void;
    private readonly handleColumnResizeEndFn: () => void;
    private readonly onResize: () => void;

    constructor(options: WindowEventsOptions) {
        this.getColumnMenuEl = options.getColumnMenuEl;
        this.getStatsPanelEl = options.getStatsPanelEl;
        this.getStatsButtonEl = options.getStatsButtonEl;
        this.getColumnVisibilityPanelEl = options.getColumnVisibilityPanelEl;
        this.getColumnsButtonEl = options.getColumnsButtonEl;
        this.getCodeModalEl = options.getCodeModalEl;
        this.getCodeButtonEl = options.getCodeButtonEl;
        this.getRowFilterPanelEl = options.getRowFilterPanelEl;
        this.getAddRowFilterButtonEl = options.getAddRowFilterButtonEl;
        this.handleSidePanelResizeFn = options.handleSidePanelResize;
        this.handleColumnResizeMoveFn = options.handleColumnResizeMove;
        this.finishSidePanelResizeFn = options.finishSidePanelResize;
        this.handleColumnResizeEndFn = options.handleColumnResizeEnd;
        this.onResize = options.onResize;
    }

    handleDocumentClick(event: MouseEvent): void {
        const target = event.target as Node;
        const columnMenuEl = this.getColumnMenuEl();
        if (uiStore.columnMenuOpen && columnMenuEl && !columnMenuEl.contains(target)) {
            uiStore.closeColumnMenu();
        }
        const statsPanelEl = this.getStatsPanelEl();
        const statsButtonEl = this.getStatsButtonEl();
        if (
            uiStore.statsPanelOpen &&
            statsPanelEl &&
            !statsPanelEl.contains(target) &&
            statsButtonEl &&
            !statsButtonEl.contains(target) &&
            !uiStore.isPanelPinned('stats-panel')
        ) {
            uiStore.statsPanelOpen = false;
        }
        const columnVisibilityPanelEl = this.getColumnVisibilityPanelEl();
        const columnsButtonEl = this.getColumnsButtonEl();
        if (
            uiStore.columnVisibilityOpen &&
            columnVisibilityPanelEl &&
            !columnVisibilityPanelEl.contains(target) &&
            columnsButtonEl &&
            !columnsButtonEl.contains(target) &&
            !uiStore.isPanelPinned('column-visibility-panel')
        ) {
            uiStore.columnVisibilityOpen = false;
        }
        const codeModalEl = this.getCodeModalEl();
        const codeButtonEl = this.getCodeButtonEl();
        if (
            uiStore.codeModalOpen &&
            codeModalEl &&
            !codeModalEl.contains(target) &&
            codeButtonEl &&
            !codeButtonEl.contains(target)
        ) {
            uiStore.codeModalOpen = false;
        }
        const rowFilterPanelEl = this.getRowFilterPanelEl();
        const addRowFilterButtonEl = this.getAddRowFilterButtonEl();
        if (
            uiStore.rowFilterPanelOpen &&
            rowFilterPanelEl &&
            !rowFilterPanelEl.contains(target) &&
            addRowFilterButtonEl &&
            !addRowFilterButtonEl.contains(target) &&
            !uiStore.isPanelPinned('row-filter-panel')
        ) {
            uiStore.rowFilterPanelOpen = false;
        }
    }

    handleWindowResize(): void {
        uiStore.closeColumnMenu();
        this.onResize();
    }

    handleWindowKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            uiStore.closeColumnMenu();
        }
    }

    handleWindowMouseMove(event: MouseEvent): void {
        this.handleSidePanelResizeFn(event);
        this.handleColumnResizeMoveFn(event);
    }

    handleWindowMouseUp(): void {
        this.finishSidePanelResizeFn();
        this.handleColumnResizeEndFn();
    }
}
