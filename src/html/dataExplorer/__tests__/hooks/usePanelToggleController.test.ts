import { describe, test, expect, beforeEach } from 'vitest';
import { uiStore } from '../../stores';

beforeEach(() => {
    uiStore.codeModalOpen = false;
    uiStore.columnVisibilityOpen = false;
    uiStore.statsPanelOpen = false;
    uiStore.rowFilterPanelOpen = false;
    uiStore.pinnedPanels = new Set();
});

describe('uiStore panel toggle methods', () => {
    describe('closeOtherNonPinnedPanels', () => {
        test('closes all panels except the named one', () => {
            uiStore.columnVisibilityOpen = true;
            uiStore.rowFilterPanelOpen = true;
            uiStore.codeModalOpen = true;
            uiStore.statsPanelOpen = true;

            uiStore.closeOtherNonPinnedPanels('stats-panel');

            expect(uiStore.statsPanelOpen).toBe(true);
            expect(uiStore.columnVisibilityOpen).toBe(false);
            expect(uiStore.rowFilterPanelOpen).toBe(false);
            expect(uiStore.codeModalOpen).toBe(false);
        });

        test('does not close pinned panels', () => {
            uiStore.statsPanelOpen = true;
            uiStore.pinnedPanels = new Set(['stats-panel']);

            uiStore.closeOtherNonPinnedPanels('column-visibility-panel');

            // stats is pinned, should stay open
            expect(uiStore.statsPanelOpen).toBe(true);
        });

        test('code modal is always closed regardless of pin status', () => {
            uiStore.codeModalOpen = true;
            // code modal cannot be pinned, but even if added to set it should close
            uiStore.pinnedPanels = new Set(['code-modal']);

            uiStore.closeOtherNonPinnedPanels('stats-panel');

            expect(uiStore.codeModalOpen).toBe(false);
        });

        test('multiple pinned panels all stay open', () => {
            uiStore.statsPanelOpen = true;
            uiStore.rowFilterPanelOpen = true;
            uiStore.pinnedPanels = new Set(['stats-panel', 'row-filter-panel']);

            uiStore.closeOtherNonPinnedPanels('column-visibility-panel');

            expect(uiStore.statsPanelOpen).toBe(true);
            expect(uiStore.rowFilterPanelOpen).toBe(true);
        });
    });

    describe('toggleColumnVisibilityPanel', () => {
        test('opens panel when closed and closes other non-pinned panels', () => {
            uiStore.statsPanelOpen = true;

            uiStore.toggleColumnVisibilityPanel();

            expect(uiStore.columnVisibilityOpen).toBe(true);
            expect(uiStore.statsPanelOpen).toBe(false);
        });

        test('toggles closed when panel is already open (not pinned)', () => {
            uiStore.columnVisibilityOpen = true;

            uiStore.toggleColumnVisibilityPanel();

            expect(uiStore.columnVisibilityOpen).toBe(false);
        });

        test('toggles without closing others when panel is pinned', () => {
            uiStore.pinnedPanels = new Set(['column-visibility-panel']);
            uiStore.statsPanelOpen = true;

            uiStore.toggleColumnVisibilityPanel();

            // opens column visibility
            expect(uiStore.columnVisibilityOpen).toBe(true);
            // does NOT close stats (pinned path doesn't call closeOtherNonPinnedPanels)
            expect(uiStore.statsPanelOpen).toBe(true);
        });
    });

    describe('toggleCodeModal', () => {
        test('returns true and opens modal when closed', () => {
            const opened = uiStore.toggleCodeModal();

            expect(opened).toBe(true);
            expect(uiStore.codeModalOpen).toBe(true);
        });

        test('returns false when modal is already open (closes it)', () => {
            uiStore.codeModalOpen = true;

            const opened = uiStore.toggleCodeModal();

            expect(opened).toBe(false);
            expect(uiStore.codeModalOpen).toBe(false);
        });

        test('closes other non-pinned panels when opening', () => {
            uiStore.statsPanelOpen = true;
            uiStore.columnVisibilityOpen = true;

            uiStore.toggleCodeModal();

            expect(uiStore.statsPanelOpen).toBe(false);
            expect(uiStore.columnVisibilityOpen).toBe(false);
            expect(uiStore.codeModalOpen).toBe(true);
        });
    });
});
