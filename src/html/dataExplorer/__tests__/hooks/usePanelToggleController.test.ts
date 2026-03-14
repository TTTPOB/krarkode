import { describe, test, expect, vi } from 'vitest';
import { usePanelToggleController } from '../../hooks/usePanelToggleController';

function setup() {
    const state = {
        codeModalOpen: false,
        columnVisibilityOpen: false,
        statsPanelOpen: false,
        rowFilterPanelOpen: false,
    };
    const pinnedPanels = new Set<string>();
    const postMessage = vi.fn();

    const ctrl = usePanelToggleController({
        postMessage,
        getCodeModalOpen: () => state.codeModalOpen,
        getColumnVisibilityOpen: () => state.columnVisibilityOpen,
        getStatsPanelOpen: () => state.statsPanelOpen,
        getRowFilterPanelOpen: () => state.rowFilterPanelOpen,
        isPanelPinned: (id) => pinnedPanels.has(id),
        setCodeModalOpen: (v) => { state.codeModalOpen = v; },
        setColumnVisibilityOpen: (v) => { state.columnVisibilityOpen = v; },
        setStatsPanelOpen: (v) => { state.statsPanelOpen = v; },
        setRowFilterPanelOpen: (v) => { state.rowFilterPanelOpen = v; },
    });

    return { state, pinnedPanels, postMessage, ctrl };
}

describe('usePanelToggleController', () => {
    describe('closeOtherNonPinnedPanels', () => {
        test('closes all panels except the named one', () => {
            const { state, ctrl } = setup();
            state.columnVisibilityOpen = true;
            state.rowFilterPanelOpen = true;
            state.codeModalOpen = true;
            state.statsPanelOpen = true;

            ctrl.closeOtherNonPinnedPanels('stats-panel');

            expect(state.statsPanelOpen).toBe(true);
            expect(state.columnVisibilityOpen).toBe(false);
            expect(state.rowFilterPanelOpen).toBe(false);
            expect(state.codeModalOpen).toBe(false);
        });

        test('does not close pinned panels', () => {
            const { state, pinnedPanels, ctrl } = setup();
            state.statsPanelOpen = true;
            pinnedPanels.add('stats-panel');

            ctrl.closeOtherNonPinnedPanels('column-visibility-panel');

            // stats is pinned, should stay open
            expect(state.statsPanelOpen).toBe(true);
        });

        test('code modal is always closed regardless of pin status', () => {
            const { state, pinnedPanels, ctrl } = setup();
            state.codeModalOpen = true;
            // code modal cannot be pinned, but even if added to set it should close
            pinnedPanels.add('code-modal');

            ctrl.closeOtherNonPinnedPanels('stats-panel');

            expect(state.codeModalOpen).toBe(false);
        });

        test('multiple pinned panels all stay open', () => {
            const { state, pinnedPanels, ctrl } = setup();
            state.statsPanelOpen = true;
            state.rowFilterPanelOpen = true;
            pinnedPanels.add('stats-panel');
            pinnedPanels.add('row-filter-panel');

            ctrl.closeOtherNonPinnedPanels('column-visibility-panel');

            expect(state.statsPanelOpen).toBe(true);
            expect(state.rowFilterPanelOpen).toBe(true);
        });
    });

    describe('openColumnVisibilityPanel', () => {
        test('opens panel when closed and closes other non-pinned panels', () => {
            const { state, ctrl } = setup();
            state.statsPanelOpen = true;

            ctrl.openColumnVisibilityPanel();

            expect(state.columnVisibilityOpen).toBe(true);
            expect(state.statsPanelOpen).toBe(false);
        });

        test('toggles closed when panel is already open (not pinned)', () => {
            const { state, ctrl } = setup();
            state.columnVisibilityOpen = true;

            ctrl.openColumnVisibilityPanel();

            expect(state.columnVisibilityOpen).toBe(false);
        });

        test('toggles without closing others when panel is pinned', () => {
            const { state, pinnedPanels, ctrl } = setup();
            pinnedPanels.add('column-visibility-panel');
            state.statsPanelOpen = true;

            ctrl.openColumnVisibilityPanel();

            // opens column visibility
            expect(state.columnVisibilityOpen).toBe(true);
            // does NOT close stats (pinned path doesn't call closeOtherNonPinnedPanels)
            expect(state.statsPanelOpen).toBe(true);
        });
    });

    describe('openCodeModal', () => {
        test('posts suggestCodeSyntax and opens modal when closed', () => {
            const { state, postMessage, ctrl } = setup();

            ctrl.openCodeModal();

            expect(postMessage).toHaveBeenCalledWith({ type: 'suggestCodeSyntax' });
            expect(state.codeModalOpen).toBe(true);
        });

        test('does NOT post message when modal is already open (closes it)', () => {
            const { state, postMessage, ctrl } = setup();
            state.codeModalOpen = true;

            ctrl.openCodeModal();

            expect(postMessage).not.toHaveBeenCalled();
            expect(state.codeModalOpen).toBe(false);
        });

        test('closes other non-pinned panels when opening', () => {
            const { state, ctrl } = setup();
            state.statsPanelOpen = true;
            state.columnVisibilityOpen = true;

            ctrl.openCodeModal();

            expect(state.statsPanelOpen).toBe(false);
            expect(state.columnVisibilityOpen).toBe(false);
            expect(state.codeModalOpen).toBe(true);
        });
    });
});
