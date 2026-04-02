import { uiStore } from '../stores';

type WindowEventsOptions = {
    handleSidePanelResize: (event: MouseEvent) => void;
    handleColumnResizeMove: (event: MouseEvent) => void;
    finishSidePanelResize: () => void;
    handleColumnResizeEnd: () => void;
    onResize: () => void;
};

// DOM element IDs used for click-outside detection
const PANEL_IDS = {
    columnMenu: 'column-menu',
    statsPanel: 'stats-panel',
    statsButton: 'stats-btn',
    columnVisibilityPanel: 'column-visibility-panel',
    columnsButton: 'columns-btn',
    codeModal: 'code-modal',
    codeButton: 'code-btn',
    rowFilterPanel: 'row-filter-panel',
    addRowFilterButton: 'add-row-filter',
} as const;

export class WindowEventsController {
    private readonly handleSidePanelResizeFn: (event: MouseEvent) => void;
    private readonly handleColumnResizeMoveFn: (event: MouseEvent) => void;
    private readonly finishSidePanelResizeFn: () => void;
    private readonly handleColumnResizeEndFn: () => void;
    private readonly onResize: () => void;

    constructor(options: WindowEventsOptions) {
        this.handleSidePanelResizeFn = options.handleSidePanelResize;
        this.handleColumnResizeMoveFn = options.handleColumnResizeMove;
        this.finishSidePanelResizeFn = options.finishSidePanelResize;
        this.handleColumnResizeEndFn = options.handleColumnResizeEnd;
        this.onResize = options.onResize;
    }

    private shouldCloseOnClick(target: Node, panelId: string, buttonId: string): boolean {
        const panelEl = document.getElementById(panelId);
        const buttonEl = document.getElementById(buttonId);
        return (
            !!panelEl &&
            !panelEl.contains(target) &&
            !!buttonEl &&
            !buttonEl.contains(target)
        );
    }

    handleDocumentClick(event: MouseEvent): void {
        const target = event.target as Node;

        const columnMenuEl = document.getElementById(PANEL_IDS.columnMenu);
        if (uiStore.columnMenuOpen && columnMenuEl && !columnMenuEl.contains(target)) {
            uiStore.closeColumnMenu();
        }

        if (
            uiStore.statsPanelOpen &&
            !uiStore.isPanelPinned('stats-panel') &&
            this.shouldCloseOnClick(target, PANEL_IDS.statsPanel, PANEL_IDS.statsButton)
        ) {
            uiStore.statsPanelOpen = false;
        }

        if (
            uiStore.columnVisibilityOpen &&
            !uiStore.isPanelPinned('column-visibility-panel') &&
            this.shouldCloseOnClick(target, PANEL_IDS.columnVisibilityPanel, PANEL_IDS.columnsButton)
        ) {
            uiStore.columnVisibilityOpen = false;
        }

        if (
            uiStore.codeModalOpen &&
            this.shouldCloseOnClick(target, PANEL_IDS.codeModal, PANEL_IDS.codeButton)
        ) {
            uiStore.codeModalOpen = false;
        }

        if (
            uiStore.rowFilterPanelOpen &&
            !uiStore.isPanelPinned('row-filter-panel') &&
            this.shouldCloseOnClick(target, PANEL_IDS.rowFilterPanel, PANEL_IDS.addRowFilterButton)
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
