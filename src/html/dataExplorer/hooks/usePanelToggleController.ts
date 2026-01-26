type PanelToggleOptions = {
    postMessage: (message: unknown) => void;
    getCodeModalOpen: () => boolean;
    getColumnVisibilityOpen: () => boolean;
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
        setCodeModalOpen,
        setColumnVisibilityOpen,
        setStatsPanelOpen,
        setRowFilterPanelOpen,
    } = options;

    const openColumnVisibilityPanel = (): void => {
        setColumnVisibilityOpen(!getColumnVisibilityOpen());
        setStatsPanelOpen(false);
        setCodeModalOpen(false);
        setRowFilterPanelOpen(false);
    };

    const openCodeModal = (): void => {
        const shouldOpen = !getCodeModalOpen();
        if (shouldOpen) {
            postMessage({ type: 'suggestCodeSyntax' });
        }
        setCodeModalOpen(shouldOpen);
        setColumnVisibilityOpen(false);
        setStatsPanelOpen(false);
        setRowFilterPanelOpen(false);
    };

    return {
        openColumnVisibilityPanel,
        openCodeModal,
    };
}
