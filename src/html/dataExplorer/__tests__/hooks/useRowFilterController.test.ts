import { describe, test, expect, vi } from 'vitest';
import { writable, readable, get } from 'svelte/store';
import { useRowFilterController } from '../../hooks/useRowFilterController';
import { createRowFilterDraft } from '../../utils/rowFilterHelpers';
import type { ColumnSchema, RowFilter, RowFilterDraft } from '../../types';

function makeSchema(partial: Partial<ColumnSchema> = {}): ColumnSchema {
    return {
        column_name: 'col',
        column_index: 0,
        type_name: 'string',
        type_display: 'string',
        ...partial,
    };
}

function makeFilter(partial: Partial<RowFilter> = {}): RowFilter {
    return {
        filter_id: 'test-id',
        filter_type: 'compare',
        column_schema: makeSchema(),
        condition: 'and',
        params: { op: '=', value: 'foo' },
        ...partial,
    };
}

function setup(schemaColumns: ColumnSchema[] = [makeSchema()]) {
    const visibleSchema = readable(schemaColumns);
    const rowFilters = writable<RowFilter[]>([]);
    const rowFilterSupport = readable(undefined);

    let editingRowFilterIndex: number | null = null;
    let rowFilterDraft: RowFilterDraft = createRowFilterDraft(schemaColumns);
    let rowFilterError = '';
    let rowFilterPanelOpen = false;
    let columnVisibilityOpen = false;
    let statsPanelOpen = false;
    let codeModalOpen = false;

    const postMessage = vi.fn();
    const log = vi.fn();
    const closeColumnMenu = vi.fn();

    const ctrl = useRowFilterController({
        log,
        postMessage,
        visibleSchema,
        rowFilters,
        rowFilterSupport,
        isRowFilterSupported: () => true,
        supportsRowFilterConditions: () => true,
        getEditingRowFilterIndex: () => editingRowFilterIndex,
        setEditingRowFilterIndex: (v) => { editingRowFilterIndex = v; },
        getRowFilterDraft: () => rowFilterDraft,
        setRowFilterDraft: (d) => { rowFilterDraft = d; },
        setRowFilterError: (msg) => { rowFilterError = msg; },
        setRowFilterPanelOpen: (v) => { rowFilterPanelOpen = v; },
        setColumnVisibilityOpen: (v) => { columnVisibilityOpen = v; },
        setStatsPanelOpen: (v) => { statsPanelOpen = v; },
        setCodeModalOpen: (v) => { codeModalOpen = v; },
        closeColumnMenu,
    });

    const getState = () => ({
        rowFilterDraft,
        rowFilterError,
        rowFilterPanelOpen,
        columnVisibilityOpen,
        statsPanelOpen,
        codeModalOpen,
        editingRowFilterIndex,
    });

    return { ctrl, rowFilters, postMessage, log, getState, set: {
        rowFilterDraft: (d: RowFilterDraft) => { rowFilterDraft = d; },
        editingRowFilterIndex: (v: number | null) => { editingRowFilterIndex = v; },
        columnVisibilityOpen: (v: boolean) => { columnVisibilityOpen = v; },
        statsPanelOpen: (v: boolean) => { statsPanelOpen = v; },
    }};
}

describe('useRowFilterController', () => {
    describe('openRowFilterEditor', () => {
        test('opens filter panel and closes other panels', () => {
            const { ctrl, getState } = setup();
            const { set } = setup();
            const s2 = setup();
            s2.set.columnVisibilityOpen(true);
            s2.set.statsPanelOpen(true);

            // Re-setup to get clean state we can control
            const { ctrl: c, getState: gs, set: st } = setup();
            st.columnVisibilityOpen(true);
            st.statsPanelOpen(true);

            c.openRowFilterEditor();

            const state = gs();
            expect(state.rowFilterPanelOpen).toBe(true);
            expect(state.columnVisibilityOpen).toBe(false);
            expect(state.statsPanelOpen).toBe(false);
            expect(state.codeModalOpen).toBe(false);
        });

        test('is a no-op when row filter is not supported', () => {
            const schema = [makeSchema()];
            const visibleSchema = readable(schema);
            const rowFilters = writable<RowFilter[]>([]);
            const rowFilterSupport = readable(undefined);
            let rowFilterPanelOpen = false;
            const postMessage = vi.fn();

            const ctrl = useRowFilterController({
                log: vi.fn(),
                postMessage,
                visibleSchema,
                rowFilters,
                rowFilterSupport,
                isRowFilterSupported: () => false,
                supportsRowFilterConditions: () => false,
                getEditingRowFilterIndex: () => null,
                setEditingRowFilterIndex: vi.fn(),
                getRowFilterDraft: () => createRowFilterDraft(schema),
                setRowFilterDraft: vi.fn(),
                setRowFilterError: vi.fn(),
                setRowFilterPanelOpen: (v) => { rowFilterPanelOpen = v; },
                setColumnVisibilityOpen: vi.fn(),
                setStatsPanelOpen: vi.fn(),
                setCodeModalOpen: vi.fn(),
                closeColumnMenu: vi.fn(),
            });

            ctrl.openRowFilterEditor();

            expect(rowFilterPanelOpen).toBe(false);
        });

        test('initializes draft with given column index', () => {
            const schema = [
                makeSchema({ column_index: 0, column_name: 'a' }),
                makeSchema({ column_index: 1, column_name: 'b' }),
            ];
            const { ctrl, getState } = setup(schema);

            ctrl.openRowFilterEditor(undefined, undefined, 1);

            expect(getState().rowFilterDraft.columnIndex).toBe(1);
        });

        test('initializes draft from existing filter for editing', () => {
            const schema = [makeSchema()];
            const existingFilter = makeFilter({ params: { op: '>=', value: '42' } });
            const { ctrl, getState } = setup(schema);

            ctrl.openRowFilterEditor(existingFilter, 0);

            expect(getState().editingRowFilterIndex).toBe(0);
            expect(getState().rowFilterDraft.compareValue).toBe('42');
            expect(getState().rowFilterDraft.compareOp).toBe('>=');
        });
    });

    describe('saveRowFilter', () => {
        test('appends a valid compare filter and posts setRowFilters', () => {
            const { ctrl, rowFilters, postMessage, getState, set } = setup();
            set.rowFilterDraft({
                ...createRowFilterDraft([makeSchema()]),
                filterType: 'compare',
                compareOp: '>=',
                compareValue: '18',
            });

            ctrl.saveRowFilter();

            const filters = get(rowFilters);
            expect(filters).toHaveLength(1);
            expect(filters[0].params).toEqual({ op: '>=', value: '18' });
            expect(postMessage).toHaveBeenCalledWith({
                type: 'setRowFilters',
                filters,
            });
            expect(getState().rowFilterPanelOpen).toBe(false);
            expect(getState().rowFilterError).toBe('');
        });

        test('sets error and does NOT post when compare value is blank', () => {
            const { ctrl, postMessage, getState, set } = setup();
            set.rowFilterDraft({
                ...createRowFilterDraft([makeSchema()]),
                filterType: 'compare',
                compareValue: '   ',
            });

            ctrl.saveRowFilter();

            expect(postMessage).not.toHaveBeenCalled();
            expect(getState().rowFilterError).not.toBe('');
        });

        test('sets error when no matching column in schema', () => {
            const { ctrl, postMessage, getState, set } = setup();
            set.rowFilterDraft({
                ...createRowFilterDraft([makeSchema()]),
                columnIndex: 999,
            });

            ctrl.saveRowFilter();

            expect(postMessage).not.toHaveBeenCalled();
            expect(getState().rowFilterError).toBe('Select a column.');
        });

        test('updates existing filter when editing by index', () => {
            const schema = [makeSchema()];
            const { ctrl, rowFilters, postMessage, set } = setup(schema);

            // Pre-populate one filter
            rowFilters.set([makeFilter({ filter_id: 'existing', params: { op: '=', value: 'old' } })]);
            set.editingRowFilterIndex(0);
            set.rowFilterDraft({
                ...createRowFilterDraft(schema),
                filterType: 'compare',
                compareOp: '>',
                compareValue: 'new',
            });

            ctrl.saveRowFilter();

            const filters = get(rowFilters);
            expect(filters).toHaveLength(1);
            expect(filters[0].filter_id).toBe('existing');
            expect(filters[0].params).toEqual({ op: '>', value: 'new' });
        });
    });

    describe('removeRowFilter', () => {
        test('removes filter at given index and posts setRowFilters', () => {
            const { ctrl, rowFilters, postMessage } = setup();
            rowFilters.set([
                makeFilter({ filter_id: 'a' }),
                makeFilter({ filter_id: 'b' }),
                makeFilter({ filter_id: 'c' }),
            ]);

            ctrl.removeRowFilter(1);

            const filters = get(rowFilters);
            expect(filters).toHaveLength(2);
            expect(filters.map((f) => f.filter_id)).toEqual(['a', 'c']);
            expect(postMessage).toHaveBeenCalledWith({
                type: 'setRowFilters',
                filters,
            });
        });

        test('removing the only filter results in empty list', () => {
            const { ctrl, rowFilters, postMessage } = setup();
            rowFilters.set([makeFilter()]);

            ctrl.removeRowFilter(0);

            expect(get(rowFilters)).toHaveLength(0);
            expect(postMessage).toHaveBeenCalledWith({ type: 'setRowFilters', filters: [] });
        });
    });
});
