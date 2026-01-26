type PanelToggleOptions = {
    postMessage: (message: unknown) => void;
    getCodeModalOpen: () => boolean;
    getColumnVisibilityOpen: () => boolean;
    getStatsPanelOpen: () => boolean;
    getRowFilterPanelOpen: () => boolean;
    isPanelPinned: (panelId: string) => boolean;
    setCodeModalOpen: (value: boolean) => void;
    setColumnVisibilityOpen: (value: boolean) => void;
    setStatsPanelOpen: (value: boolean) => void;
    setRowFilterPanelOpen: (value: boolean) => void;
};

export function usePanelToggleController(options: PanelToggleOptions) {
    const {
        postMessage,
        getCodeModalOpen,
        getColumnVisibilityOpen,
        getStatsPanelOpen,
        getRowFilterPanelOpen,
        isPanelPinned,
        setCodeModalOpen,
        setColumnVisibilityOpen,
        setStatsPanelOpen,
        setRowFilterPanelOpen,
    } = options;

    /**
     * Close other non-pinned panels when opening a new panel.
     * Pinned panels remain open.
     */
    const closeOtherNonPinnedPanels = (exceptPanel: string): void => {
        // Close stats panel if not pinned and not the current one
        if (exceptPanel !== 'stats-panel' && !isPanelPinned('stats-panel')) {
            setStatsPanelOpen(false);
        }
        // Close column visibility panel if not pinned and not the current one
        if (exceptPanel !== 'column-visibility-panel' && !isPanelPinned('column-visibility-panel')) {
            setColumnVisibilityOpen(false);
        }
        // Close row filter panel if not pinned and not the current one
        if (exceptPanel !== 'row-filter-panel' && !isPanelPinned('row-filter-panel')) {
            setRowFilterPanelOpen(false);
        }
        // Code modal is always closed (it can't be pinned)
        if (exceptPanel !== 'code-modal') {
            setCodeModalOpen(false);
        }
    };

    const openColumnVisibilityPanel = (): void => {
        const isCurrentlyOpen = getColumnVisibilityOpen();
        const isPinned = isPanelPinned('column-visibility-panel');

        if (isPinned) {
            // If pinned, toggle closes the panel
            setColumnVisibilityOpen(!isCurrentlyOpen);
        } else {
            // If not pinned, toggle and close other non-pinned panels
            closeOtherNonPinnedPanels('column-visibility-panel');
            setColumnVisibilityOpen(!isCurrentlyOpen);
        }
    };

    const openCodeModal = (): void => {
        const shouldOpen = !getCodeModalOpen();
        if (shouldOpen) {
            postMessage({ type: 'suggestCodeSyntax' });
        }
        closeOtherNonPinnedPanels('code-modal');
        setCodeModalOpen(shouldOpen);
    };

    return {
        openColumnVisibilityPanel,
        openCodeModal,
        closeOtherNonPinnedPanels,
    };
}
