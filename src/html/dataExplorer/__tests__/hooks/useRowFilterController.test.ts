import { describe, test, expect, vi, beforeEach } from 'vitest';
import { RowFilterController } from '../../hooks/useRowFilterController';
import { dataStore, uiStore } from '../../stores';
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
    // Reset stores
    dataStore.fullSchema = schemaColumns;
    dataStore.hiddenColumnIndices = new Set();
    dataStore.columnFilterMatches = null;
    dataStore.setColumnFilterSupport = undefined;
    dataStore.rowFilters = [];
    dataStore.rowFilterSupport = undefined;
    uiStore.rowFilterPanelOpen = false;
    uiStore.columnVisibilityOpen = false;
    uiStore.statsPanelOpen = false;
    uiStore.codeModalOpen = false;

    let editingRowFilterIndex: number | null = null;
    let rowFilterDraft: RowFilterDraft = createRowFilterDraft(schemaColumns);
    let rowFilterError = '';

    const postMessage = vi.fn();
    const log = vi.fn();

    const ctrl = new RowFilterController({
        log,
        postMessage,
        getEditingRowFilterIndex: () => editingRowFilterIndex,
        setEditingRowFilterIndex: (v) => { editingRowFilterIndex = v; },
        getRowFilterDraft: () => rowFilterDraft,
        setRowFilterDraft: (d) => { rowFilterDraft = d; },
        setRowFilterError: (msg) => { rowFilterError = msg; },
    });

    const getState = () => ({
        rowFilterDraft,
        rowFilterError,
        rowFilterPanelOpen: uiStore.rowFilterPanelOpen,
        columnVisibilityOpen: uiStore.columnVisibilityOpen,
        statsPanelOpen: uiStore.statsPanelOpen,
        codeModalOpen: uiStore.codeModalOpen,
        editingRowFilterIndex,
    });

    return { ctrl, postMessage, log, getState, set: {
        rowFilterDraft: (d: RowFilterDraft) => { rowFilterDraft = d; },
        editingRowFilterIndex: (v: number | null) => { editingRowFilterIndex = v; },
    }};
}

beforeEach(() => {
    uiStore.pinnedPanels = new Set();
    uiStore.columnMenuOpen = false;
    uiStore.columnMenuColumnIndex = null;
    uiStore.rowFilterPanelOpen = false;
    uiStore.columnVisibilityOpen = false;
    uiStore.statsPanelOpen = false;
    uiStore.codeModalOpen = false;
    dataStore.rowFilterSupport = undefined;
    dataStore.rowFilters = [];
    dataStore.fullSchema = [];
    dataStore.hiddenColumnIndices = new Set();
    dataStore.columnFilterMatches = null;
    dataStore.setColumnFilterSupport = undefined;
});

describe('useRowFilterController', () => {
    describe('openRowFilterEditor', () => {
        test('opens filter panel and closes other panels', () => {
            const { ctrl: c, getState: gs } = setup();
            uiStore.columnVisibilityOpen = true;
            uiStore.statsPanelOpen = true;

            c.openRowFilterEditor();

            const state = gs();
            expect(state.rowFilterPanelOpen).toBe(true);
            expect(state.columnVisibilityOpen).toBe(false);
            expect(state.statsPanelOpen).toBe(false);
            expect(state.codeModalOpen).toBe(false);
        });

        test('is a no-op when row filter is not supported', () => {
            const schema = [makeSchema()];
            dataStore.fullSchema = schema;
            dataStore.rowFilterSupport = { support_status: 'unsupported' } as any;

            const postMessage = vi.fn();
            const ctrl = new RowFilterController({
                log: vi.fn(),
                postMessage,
                getEditingRowFilterIndex: () => null,
                setEditingRowFilterIndex: vi.fn(),
                getRowFilterDraft: () => createRowFilterDraft(schema),
                setRowFilterDraft: vi.fn(),
                setRowFilterError: vi.fn(),
            });

            ctrl.openRowFilterEditor();

            expect(uiStore.rowFilterPanelOpen).toBe(false);
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
            const { ctrl, postMessage, getState, set } = setup();
            set.rowFilterDraft({
                ...createRowFilterDraft([makeSchema()]),
                filterType: 'compare',
                compareOp: '>=',
                compareValue: '18',
            });

            ctrl.saveRowFilter();

            const filters = dataStore.rowFilters;
            expect(filters).toHaveLength(1);
            expect(filters[0].params).toEqual({ op: '>=', value: '18' });
            const posted = postMessage.mock.calls[0][0];
            expect(posted).toEqual({
                type: 'setRowFilters',
                filters,
            });
            expect(() => structuredClone(posted.filters)).not.toThrow();
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
            const { ctrl, postMessage, set } = setup(schema);

            // Pre-populate one filter
            dataStore.rowFilters = [makeFilter({ filter_id: 'existing', params: { op: '=', value: 'old' } })];
            set.editingRowFilterIndex(0);
            set.rowFilterDraft({
                ...createRowFilterDraft(schema),
                filterType: 'compare',
                compareOp: '>',
                compareValue: 'new',
            });

            ctrl.saveRowFilter();

            const filters = dataStore.rowFilters;
            expect(filters).toHaveLength(1);
            expect(filters[0].filter_id).toBe('existing');
            expect(filters[0].params).toEqual({ op: '>', value: 'new' });
        });
    });

    describe('removeRowFilter', () => {
        test('removes filter at given index and posts setRowFilters', () => {
            const { ctrl, postMessage } = setup();
            dataStore.rowFilters = [
                makeFilter({ filter_id: 'a' }),
                makeFilter({ filter_id: 'b' }),
                makeFilter({ filter_id: 'c' }),
            ];

            ctrl.removeRowFilter(1);

            const filters = dataStore.rowFilters;
            expect(filters).toHaveLength(2);
            expect(filters.map((f) => f.filter_id)).toEqual(['a', 'c']);
            const posted = postMessage.mock.calls[0][0];
            expect(posted).toEqual({
                type: 'setRowFilters',
                filters,
            });
            expect(() => structuredClone(posted.filters)).not.toThrow();
        });

        test('removing the only filter results in empty list', () => {
            const { ctrl, postMessage } = setup();
            dataStore.rowFilters = [makeFilter()];

            ctrl.removeRowFilter(0);

            expect(dataStore.rowFilters).toHaveLength(0);
            const posted = postMessage.mock.calls[0][0];
            expect(posted).toEqual({ type: 'setRowFilters', filters: [] });
            expect(() => structuredClone(posted.filters)).not.toThrow();
        });
    });
});
