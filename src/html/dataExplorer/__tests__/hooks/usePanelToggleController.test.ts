import { describe, test, expect, vi, beforeEach } from 'vitest';
import { PanelToggleController } from '../../hooks/usePanelToggleController';
import { uiStore } from '../../stores';

beforeEach(() => {
    uiStore.codeModalOpen = false;
    uiStore.columnVisibilityOpen = false;
    uiStore.statsPanelOpen = false;
    uiStore.rowFilterPanelOpen = false;
    uiStore.pinnedPanels = new Set();
});

function setup() {
    const postMessage = vi.fn();
    const ctrl = new PanelToggleController({ postMessage });
    return { postMessage, ctrl };
}

describe('usePanelToggleController', () => {
    describe('closeOtherNonPinnedPanels', () => {
        test('closes all panels except the named one', () => {
            const { ctrl } = setup();
            uiStore.columnVisibilityOpen = true;
            uiStore.rowFilterPanelOpen = true;
            uiStore.codeModalOpen = true;
            uiStore.statsPanelOpen = true;

            ctrl.closeOtherNonPinnedPanels('stats-panel');

            expect(uiStore.statsPanelOpen).toBe(true);
            expect(uiStore.columnVisibilityOpen).toBe(false);
            expect(uiStore.rowFilterPanelOpen).toBe(false);
            expect(uiStore.codeModalOpen).toBe(false);
        });

        test('does not close pinned panels', () => {
            const { ctrl } = setup();
            uiStore.statsPanelOpen = true;
            uiStore.pinnedPanels = new Set(['stats-panel']);

            ctrl.closeOtherNonPinnedPanels('column-visibility-panel');

            // stats is pinned, should stay open
            expect(uiStore.statsPanelOpen).toBe(true);
        });

        test('code modal is always closed regardless of pin status', () => {
            const { ctrl } = setup();
            uiStore.codeModalOpen = true;
            // code modal cannot be pinned, but even if added to set it should close
            uiStore.pinnedPanels = new Set(['code-modal']);

            ctrl.closeOtherNonPinnedPanels('stats-panel');

            expect(uiStore.codeModalOpen).toBe(false);
        });

        test('multiple pinned panels all stay open', () => {
            const { ctrl } = setup();
            uiStore.statsPanelOpen = true;
            uiStore.rowFilterPanelOpen = true;
            uiStore.pinnedPanels = new Set(['stats-panel', 'row-filter-panel']);

            ctrl.closeOtherNonPinnedPanels('column-visibility-panel');

            expect(uiStore.statsPanelOpen).toBe(true);
            expect(uiStore.rowFilterPanelOpen).toBe(true);
        });
    });

    describe('openColumnVisibilityPanel', () => {
        test('opens panel when closed and closes other non-pinned panels', () => {
            const { ctrl } = setup();
            uiStore.statsPanelOpen = true;

            ctrl.openColumnVisibilityPanel();

            expect(uiStore.columnVisibilityOpen).toBe(true);
            expect(uiStore.statsPanelOpen).toBe(false);
        });

        test('toggles closed when panel is already open (not pinned)', () => {
            const { ctrl } = setup();
            uiStore.columnVisibilityOpen = true;

            ctrl.openColumnVisibilityPanel();

            expect(uiStore.columnVisibilityOpen).toBe(false);
        });

        test('toggles without closing others when panel is pinned', () => {
            const { ctrl } = setup();
            uiStore.pinnedPanels = new Set(['column-visibility-panel']);
            uiStore.statsPanelOpen = true;

            ctrl.openColumnVisibilityPanel();

            // opens column visibility
            expect(uiStore.columnVisibilityOpen).toBe(true);
            // does NOT close stats (pinned path doesn't call closeOtherNonPinnedPanels)
            expect(uiStore.statsPanelOpen).toBe(true);
        });
    });

    describe('openCodeModal', () => {
        test('posts suggestCodeSyntax and opens modal when closed', () => {
            const { postMessage, ctrl } = setup();

            ctrl.openCodeModal();

            expect(postMessage).toHaveBeenCalledWith({ type: 'suggestCodeSyntax' });
            expect(uiStore.codeModalOpen).toBe(true);
        });

        test('does NOT post message when modal is already open (closes it)', () => {
            const { postMessage, ctrl } = setup();
            uiStore.codeModalOpen = true;

            ctrl.openCodeModal();

            expect(postMessage).not.toHaveBeenCalled();
            expect(uiStore.codeModalOpen).toBe(false);
        });

        test('closes other non-pinned panels when opening', () => {
            const { ctrl } = setup();
            uiStore.statsPanelOpen = true;
            uiStore.columnVisibilityOpen = true;

            ctrl.openCodeModal();

            expect(uiStore.statsPanelOpen).toBe(false);
            expect(uiStore.columnVisibilityOpen).toBe(false);
            expect(uiStore.codeModalOpen).toBe(true);
        });
    });
});
