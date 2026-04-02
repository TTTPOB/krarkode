/**
 * UI state store for the Data Explorer.
 * Manages panel visibility, modal state, and UI interactions.
 * Svelte 5 runes class singleton.
 */

class UiStore {
    // Panel open states
    columnVisibilityOpen = $state(false);
    rowFilterPanelOpen = $state(false);
    statsPanelOpen = $state(false);
    codeModalOpen = $state(false);
    columnMenuOpen = $state(false);

    // Column menu position and target
    columnMenuPosition = $state({ x: 0, y: 0 });
    columnMenuColumnIndex = $state<number | null>(null);

    // Pinned panels
    pinnedPanels = $state<Set<string>>(new Set());

    // Collapsed sections in stats panel
    collapsedSections = $state<Set<string>>(new Set());

    // Column visibility search state
    columnVisibilitySearchTerm = $state('');
    columnVisibilityStatus = $state('');

    // Stats panel state
    activeStatsColumnIndex = $state<number | null>(null);
    statsColumnValue = $state('');

    // Code modal state
    codePreview = $state('');
    codeSyntax = $state('pandas');

    isPanelPinned(panelId: string): boolean {
        return this.pinnedPanels.has(panelId);
    }

    setPanelPinned(panelId: string, pinned: boolean): void {
        const next = new Set(this.pinnedPanels);
        if (pinned) {
            next.add(panelId);
        } else {
            next.delete(panelId);
        }
        this.pinnedPanels = next;
    }

    togglePanelPinned(panelId: string): void {
        const next = new Set(this.pinnedPanels);
        if (next.has(panelId)) {
            next.delete(panelId);
        } else {
            next.add(panelId);
        }
        this.pinnedPanels = next;
    }

    toggleSectionCollapsed(sectionId: string): void {
        const next = new Set(this.collapsedSections);
        if (next.has(sectionId)) {
            next.delete(sectionId);
        } else {
            next.add(sectionId);
        }
        this.collapsedSections = next;
    }

    closeAllPanelsExcept(exceptPanelId?: string, respectPinned = false): void {
        if (exceptPanelId !== 'column-visibility' && !(respectPinned && this.isPanelPinned('column-visibility-panel'))) {
            this.columnVisibilityOpen = false;
        }
        if (exceptPanelId !== 'row-filter' && !(respectPinned && this.isPanelPinned('row-filter-panel'))) {
            this.rowFilterPanelOpen = false;
        }
        if (exceptPanelId !== 'stats' && !(respectPinned && this.isPanelPinned('stats-panel'))) {
            this.statsPanelOpen = false;
        }
        if (exceptPanelId !== 'code') {
            this.codeModalOpen = false;
        }
    }

    /**
     * Close other non-pinned panels when opening a new panel.
     * Pinned panels remain open.
     */
    closeOtherNonPinnedPanels(exceptPanel: string): void {
        if (exceptPanel !== 'stats-panel' && !this.isPanelPinned('stats-panel')) {
            this.statsPanelOpen = false;
        }
        if (exceptPanel !== 'column-visibility-panel' && !this.isPanelPinned('column-visibility-panel')) {
            this.columnVisibilityOpen = false;
        }
        if (exceptPanel !== 'row-filter-panel' && !this.isPanelPinned('row-filter-panel')) {
            this.rowFilterPanelOpen = false;
        }
        // Code modal is always closed (it can't be pinned)
        if (exceptPanel !== 'code-modal') {
            this.codeModalOpen = false;
        }
    }

    toggleColumnVisibilityPanel(): void {
        const isCurrentlyOpen = this.columnVisibilityOpen;
        const isPinned = this.isPanelPinned('column-visibility-panel');

        if (isPinned) {
            this.columnVisibilityOpen = !isCurrentlyOpen;
        } else {
            this.closeOtherNonPinnedPanels('column-visibility-panel');
            this.columnVisibilityOpen = !isCurrentlyOpen;
        }
    }

    /**
     * Toggle code modal. Returns true if modal was opened (caller should post suggestCodeSyntax).
     */
    toggleCodeModal(): boolean {
        const shouldOpen = !this.codeModalOpen;
        this.closeOtherNonPinnedPanels('code-modal');
        this.codeModalOpen = shouldOpen;
        return shouldOpen;
    }

    closeColumnMenu(): void {
        this.columnMenuOpen = false;
        this.columnMenuColumnIndex = null;
    }

    openColumnMenu(x: number, y: number, columnIndex: number): void {
        this.columnMenuPosition = { x, y };
        this.columnMenuColumnIndex = columnIndex;
        this.columnMenuOpen = true;
    }
}

export const uiStore = new UiStore();
