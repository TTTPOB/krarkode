import { get, type Readable, type Writable } from 'svelte/store';
import type { ColumnSchema, RowFilter, RowFilterCondition, RowFilterDraft, SetRowFiltersFeatures } from '../types';
import { buildRowFilterParams, createRowFilterDraft, createRowFilterId, getSupportedRowFilterTypes } from '../utils';

type RowFilterControllerOptions = {
    log: (message: string, payload?: unknown) => void;
    postMessage: (message: unknown) => void;
    visibleSchema: Readable<ColumnSchema[]>;
    rowFilters: Writable<RowFilter[]>;
    rowFilterSupport: Readable<SetRowFiltersFeatures | undefined>;
    isRowFilterSupported: () => boolean;
    supportsRowFilterConditions: () => boolean;
    getEditingRowFilterIndex: () => number | null;
    setEditingRowFilterIndex: (value: number | null) => void;
    getRowFilterDraft: () => RowFilterDraft;
    setRowFilterDraft: (draft: RowFilterDraft) => void;
    setRowFilterError: (message: string) => void;
    setRowFilterPanelOpen: (open: boolean) => void;
    setColumnVisibilityOpen: (open: boolean) => void;
    setStatsPanelOpen: (open: boolean) => void;
    setCodeModalOpen: (open: boolean) => void;
    closeColumnMenu: () => void;
};

export function useRowFilterController(options: RowFilterControllerOptions) {
    const {
        log,
        postMessage,
        visibleSchema,
        rowFilters,
        rowFilterSupport,
        isRowFilterSupported,
        supportsRowFilterConditions,
        getEditingRowFilterIndex,
        setEditingRowFilterIndex,
        getRowFilterDraft,
        setRowFilterDraft,
        setRowFilterError,
        setRowFilterPanelOpen,
        setColumnVisibilityOpen,
        setStatsPanelOpen,
        setCodeModalOpen,
        closeColumnMenu,
    } = options;

    const openRowFilterEditor = (filter?: RowFilter, index?: number, columnIndex?: number): void => {
        if (!isRowFilterSupported()) {
            return;
        }

        const schema = get(visibleSchema);
        if (!schema.length) {
            log('Row filter editor skipped; schema not loaded.');
            return;
        }

        setEditingRowFilterIndex(index ?? null);
        setRowFilterDraft(
            createRowFilterDraft(schema, filter, columnIndex, getSupportedRowFilterTypes(get(rowFilterSupport))),
        );
        setRowFilterError('');
        setRowFilterPanelOpen(true);
        setColumnVisibilityOpen(false);
        setStatsPanelOpen(false);
        setCodeModalOpen(false);
        closeColumnMenu();
        log('Row filter editor opened', { filter, index });
    };

    const handleRowFilterColumnChange = (event: Event): void => {
        const target = event.target as HTMLSelectElement | null;
        if (!target) {
            return;
        }
        setRowFilterDraft({
            ...getRowFilterDraft(),
            columnIndex: parseInt(target.value, 10),
        });
    };

    const saveRowFilter = (): void => {
        const schema = get(visibleSchema);
        const draft = getRowFilterDraft();
        const column = schema.find((item) => item.column_index === draft.columnIndex);
        if (!column) {
            setRowFilterError('Select a column.');
            return;
        }

        const params = buildRowFilterParams(draft.filterType, draft);
        if (!params.valid) {
            setRowFilterError(params.errorMessage ?? '');
            return;
        }

        const condition: RowFilterCondition = supportsRowFilterConditions() ? draft.condition : 'and';

        const currentFilters = get(rowFilters);
        const editingIndex = getEditingRowFilterIndex();
        const filterId = editingIndex !== null ? currentFilters[editingIndex]?.filter_id : createRowFilterId();

        if (!filterId) {
            setRowFilterError('Unable to create filter ID.');
            return;
        }

        const filter: RowFilter = {
            filter_id: filterId,
            filter_type: draft.filterType,
            column_schema: column,
            condition,
            params: params.value,
        };

        const nextFilters = [...currentFilters];
        if (editingIndex !== null) {
            nextFilters[editingIndex] = filter;
        } else {
            nextFilters.push(filter);
        }
        rowFilters.set(nextFilters);
        setRowFilterPanelOpen(false);
        setRowFilterError('');
        postMessage({ type: 'setRowFilters', filters: nextFilters });
        log('Row filters saved', { count: nextFilters.length, filter });
    };

    const removeRowFilter = (index: number): void => {
        const nextFilters = [...get(rowFilters)];
        nextFilters.splice(index, 1);
        rowFilters.set(nextFilters);
        postMessage({ type: 'setRowFilters', filters: nextFilters });
        log('Row filter removed', { index, count: nextFilters.length });
    };

    return {
        openRowFilterEditor,
        handleRowFilterColumnChange,
        saveRowFilter,
        removeRowFilter,
    };
}
