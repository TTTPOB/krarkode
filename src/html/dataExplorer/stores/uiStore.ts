/**
 * UI state store for the Data Explorer.
 * Manages panel visibility, modal state, and UI interactions.
 */

import { writable, derived } from 'svelte/store';

/**
 * Panel open states.
 */
export const columnVisibilityOpen = writable(false);
export const rowFilterPanelOpen = writable(false);
export const statsPanelOpen = writable(false);
export const codeModalOpen = writable(false);
export const columnMenuOpen = writable(false);

/**
 * Column menu position and target.
 */
export const columnMenuPosition = writable({ x: 0, y: 0 });
export const columnMenuColumnIndex = writable<number | null>(null);

/**
 * Pinned panels.
 */
export const pinnedPanels = writable<Set<string>>(new Set());

/**
 * Check if a panel is pinned.
 * Note: Use $pinnedPanels.has(panelId) directly in Svelte components for reactivity.
 */
export function isPanelPinned(panelId: string): boolean {
    let pinned = false;
    const unsubscribe = pinnedPanels.subscribe((panels) => {
        pinned = panels.has(panelId);
    });
    unsubscribe();
    return pinned;
}

/**
 * Set panel pinned state.
 */
export function setPanelPinned(panelId: string, pinned: boolean): void {
    pinnedPanels.update((panels) => {
        const next = new Set(panels);
        if (pinned) {
            next.add(panelId);
        } else {
            next.delete(panelId);
        }
        return next;
    });
}

/**
 * Toggle panel pinned state.
 */
export function togglePanelPinned(panelId: string): void {
    pinnedPanels.update((panels) => {
        const next = new Set(panels);
        if (next.has(panelId)) {
            next.delete(panelId);
        } else {
            next.add(panelId);
        }
        return next;
    });
}

/**
 * Collapsed sections in stats panel.
 */
export const collapsedSections = writable<Set<string>>(new Set());

/**
 * Toggle section collapsed state.
 */
export function toggleSectionCollapsed(sectionId: string): void {
    collapsedSections.update((sections) => {
        const next = new Set(sections);
        if (next.has(sectionId)) {
            next.delete(sectionId);
        } else {
            next.add(sectionId);
        }
        return next;
    });
}

/**
 * Column visibility search state.
 */
export const columnVisibilitySearchTerm = writable('');
export const columnVisibilityStatus = writable('');

/**
 * Stats panel state.
 */
export const activeStatsColumnIndex = writable<number | null>(null);
export const statsColumnValue = writable('');

/**
 * Code modal state.
 */
export const codePreview = writable('');
export const codeSyntax = writable('pandas');

/**
 * Close all panels except the specified one.
 */
export function closeAllPanelsExcept(exceptPanelId?: string): void {
    if (exceptPanelId !== 'column-visibility') {
        columnVisibilityOpen.set(false);
    }
    if (exceptPanelId !== 'row-filter') {
        rowFilterPanelOpen.set(false);
    }
    if (exceptPanelId !== 'stats') {
        statsPanelOpen.set(false);
    }
    if (exceptPanelId !== 'code') {
        codeModalOpen.set(false);
    }
}

/**
 * Close column menu.
 */
export function closeColumnMenu(): void {
    columnMenuOpen.set(false);
    columnMenuColumnIndex.set(null);
}

/**
 * Open column menu at position.
 */
export function openColumnMenu(x: number, y: number, columnIndex: number): void {
    columnMenuPosition.set({ x, y });
    columnMenuColumnIndex.set(columnIndex);
    columnMenuOpen.set(true);
}
