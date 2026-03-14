import { dataStore, uiStore } from '../stores';
import type { RowFilter, RowFilterCondition, RowFilterDraft } from '../types';
import { buildRowFilterParams, createRowFilterDraft, createRowFilterId, getSupportedRowFilterTypes, supportsRowFilterConditions } from '../utils';

type RowFilterControllerOptions = {
    log: (message: string, payload?: unknown) => void;
    postMessage: (message: unknown) => void;
    getEditingRowFilterIndex: () => number | null;
    setEditingRowFilterIndex: (value: number | null) => void;
    getRowFilterDraft: () => RowFilterDraft;
    setRowFilterDraft: (draft: RowFilterDraft) => void;
    setRowFilterError: (message: string) => void;
};

export class RowFilterController {
    private readonly log: (message: string, payload?: unknown) => void;
    private readonly postMessage: (message: unknown) => void;
    private readonly getEditingRowFilterIndex: () => number | null;
    private readonly setEditingRowFilterIndex: (value: number | null) => void;
    private readonly getRowFilterDraft: () => RowFilterDraft;
    private readonly setRowFilterDraft: (draft: RowFilterDraft) => void;
    private readonly setRowFilterError: (message: string) => void;

    constructor(options: RowFilterControllerOptions) {
        this.log = options.log;
        this.postMessage = options.postMessage;
        this.getEditingRowFilterIndex = options.getEditingRowFilterIndex;
        this.setEditingRowFilterIndex = options.setEditingRowFilterIndex;
        this.getRowFilterDraft = options.getRowFilterDraft;
        this.setRowFilterDraft = options.setRowFilterDraft;
        this.setRowFilterError = options.setRowFilterError;
    }

    openRowFilterEditor(filter?: RowFilter, index?: number, columnIndex?: number): void {
        if (!dataStore.isRowFilterSupported) {
            return;
        }

        const schema = dataStore.visibleSchema;
        if (!schema.length) {
            this.log('Row filter editor skipped; schema not loaded.');
            return;
        }

        this.setEditingRowFilterIndex(index ?? null);
        this.setRowFilterDraft(
            createRowFilterDraft(schema, filter, columnIndex, getSupportedRowFilterTypes(dataStore.rowFilterSupport)),
        );
        this.setRowFilterError('');
        uiStore.rowFilterPanelOpen = true;
        uiStore.columnVisibilityOpen = false;
        uiStore.statsPanelOpen = false;
        uiStore.codeModalOpen = false;
        uiStore.closeColumnMenu();
        this.log('Row filter editor opened', { filter, index });
    }

    handleRowFilterColumnChange(event: Event): void {
        const target = event.target as HTMLSelectElement | null;
        if (!target) {
            return;
        }
        this.setRowFilterDraft({
            ...this.getRowFilterDraft(),
            columnIndex: parseInt(target.value, 10),
        });
    }

    saveRowFilter(): void {
        const schema = dataStore.visibleSchema;
        const draft = this.getRowFilterDraft();
        const column = schema.find((item) => item.column_index === draft.columnIndex);
        if (!column) {
            this.setRowFilterError('Select a column.');
            return;
        }

        const params = buildRowFilterParams(draft.filterType, draft);
        if (!params.valid) {
            this.setRowFilterError(params.errorMessage ?? '');
            return;
        }

        const condition: RowFilterCondition = supportsRowFilterConditions(dataStore.rowFilterSupport) ? draft.condition : 'and';

        const currentFilters = dataStore.rowFilters;
        const editingIndex = this.getEditingRowFilterIndex();
        const filterId = editingIndex !== null ? currentFilters[editingIndex]?.filter_id : createRowFilterId();

        if (!filterId) {
            this.setRowFilterError('Unable to create filter ID.');
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
        dataStore.rowFilters = nextFilters;
        uiStore.rowFilterPanelOpen = false;
        this.setRowFilterError('');
        this.postMessage({ type: 'setRowFilters', filters: nextFilters });
        this.log('Row filters saved', { count: nextFilters.length, filter });
    }

    removeRowFilter(index: number): void {
        const nextFilters = [...dataStore.rowFilters];
        nextFilters.splice(index, 1);
        dataStore.rowFilters = nextFilters;
        this.postMessage({ type: 'setRowFilters', filters: nextFilters });
        this.log('Row filter removed', { index, count: nextFilters.length });
    }
}
