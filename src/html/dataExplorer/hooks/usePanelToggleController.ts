import { uiStore } from '../stores';

type PanelToggleOptions = {
    postMessage: (message: unknown) => void;
};

export class PanelToggleController {
    private readonly postMessage: (message: unknown) => void;

    constructor(options: PanelToggleOptions) {
        this.postMessage = options.postMessage;
    }

    /**
     * Close other non-pinned panels when opening a new panel.
     * Pinned panels remain open.
     */
    closeOtherNonPinnedPanels(exceptPanel: string): void {
        // Close stats panel if not pinned and not the current one
        if (exceptPanel !== 'stats-panel' && !uiStore.isPanelPinned('stats-panel')) {
            uiStore.statsPanelOpen = false;
        }
        // Close column visibility panel if not pinned and not the current one
        if (exceptPanel !== 'column-visibility-panel' && !uiStore.isPanelPinned('column-visibility-panel')) {
            uiStore.columnVisibilityOpen = false;
        }
        // Close row filter panel if not pinned and not the current one
        if (exceptPanel !== 'row-filter-panel' && !uiStore.isPanelPinned('row-filter-panel')) {
            uiStore.rowFilterPanelOpen = false;
        }
        // Code modal is always closed (it can't be pinned)
        if (exceptPanel !== 'code-modal') {
            uiStore.codeModalOpen = false;
        }
    }

    openColumnVisibilityPanel(): void {
        const isCurrentlyOpen = uiStore.columnVisibilityOpen;
        const isPinned = uiStore.isPanelPinned('column-visibility-panel');

        if (isPinned) {
            // If pinned, toggle closes the panel
            uiStore.columnVisibilityOpen = !isCurrentlyOpen;
        } else {
            // If not pinned, toggle and close other non-pinned panels
            this.closeOtherNonPinnedPanels('column-visibility-panel');
            uiStore.columnVisibilityOpen = !isCurrentlyOpen;
        }
    }

    openCodeModal(): void {
        const shouldOpen = !uiStore.codeModalOpen;
        if (shouldOpen) {
            this.postMessage({ type: 'suggestCodeSyntax' });
        }
        this.closeOtherNonPinnedPanels('code-modal');
        uiStore.codeModalOpen = shouldOpen;
    }
}
