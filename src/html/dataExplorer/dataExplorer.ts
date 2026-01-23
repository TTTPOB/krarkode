import {
    ColumnDef,
    RowModel,
    Table,
    createTable,
    getCoreRowModel,
} from '@tanstack/table-core';
import {
    Virtualizer,
    elementScroll,
    observeElementOffset,
    observeElementRect,
} from '@tanstack/virtual-core';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GridComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

interface TableShape {
    num_rows: number;
    num_columns: number;
}

interface BackendState {
    display_name: string;
    table_shape: TableShape;
    table_unfiltered_shape: TableShape;
    has_row_labels: boolean;
    sort_keys?: ColumnSortKey[];
    supported_features?: SupportedFeatures;
    column_filters?: ColumnFilter[];
    row_filters?: RowFilter[];
}

interface ColumnSchema {
    column_name: string;
    column_label?: string;
    column_index: number;
    type_name: string;
    type_display: string;
    description?: string;
}

type SupportStatus = 'supported' | 'unsupported';

interface ColumnSortKey {
    column_index: number;
    ascending: boolean;
}

interface ColumnFilter {
    filter_type: 'text_search' | 'match_data_types';
    params: {
        search_type?: string;
        term?: string;
        case_sensitive?: boolean;
        display_types?: string[];
    };
}

type RowFilterType =
    | 'between'
    | 'compare'
    | 'is_empty'
    | 'is_false'
    | 'is_null'
    | 'is_true'
    | 'not_between'
    | 'not_empty'
    | 'not_null'
    | 'search'
    | 'set_membership';

type RowFilterCondition = 'and' | 'or';

type FilterComparisonOp = '=' | '!=' | '<' | '<=' | '>' | '>=';

type TextSearchType = 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'regex_match';

interface RowFilter {
    filter_id: string;
    filter_type: RowFilterType;
    column_schema: ColumnSchema;
    condition: RowFilterCondition;
    params?: Record<string, unknown>;
}

interface ColumnProfileResult {
    null_count?: number;
    summary_stats?: {
        type_display: string;
        number_stats?: Record<string, string>;
        string_stats?: Record<string, number>;
        boolean_stats?: Record<string, number>;
        date_stats?: Record<string, string>;
        datetime_stats?: Record<string, string>;
        other_stats?: Record<string, number>;
    };
    small_histogram?: {
        bin_edges: string[];
        bin_counts: number[];
    };
    small_frequency_table?: {
        values: ColumnValue[];
        counts: number[];
        other_count?: number;
    };
}

interface SetSortColumnsFeatures {
    support_status?: SupportStatus;
}

interface SearchSchemaFeatures {
    support_status?: SupportStatus;
}

interface SetColumnFiltersFeatures {
    support_status?: SupportStatus;
}

interface RowFilterTypeSupportStatus {
    row_filter_type: RowFilterType;
    support_status: SupportStatus;
}

interface SetRowFiltersFeatures {
    support_status?: SupportStatus;
    supports_conditions?: SupportStatus;
    supported_types?: RowFilterTypeSupportStatus[];
}

interface SupportedFeatures {
    search_schema?: SearchSchemaFeatures;
    set_column_filters?: SetColumnFiltersFeatures;
    set_row_filters?: SetRowFiltersFeatures;
    set_sort_columns?: SetSortColumnsFeatures;
    [key: string]: unknown;
}

type ColumnValue = string | number;

interface RowsMessage {
    startIndex: number;
    endIndex: number;
    columns: ColumnValue[][];
    rowLabels?: string[];
}

interface InitMessage {
    state: BackendState;
    schema: ColumnSchema[];
}

type SortDirection = 'asc' | 'desc';

interface SortState {
    columnIndex: number;
    direction: SortDirection;
}

interface RowData {
    index: number;
}

declare const acquireVsCodeApi: () => {
    postMessage: (message: unknown) => void;
};

const vscode = acquireVsCodeApi();

const tableTitle = document.getElementById('table-title') as HTMLDivElement;
const tableMeta = document.getElementById('table-meta') as HTMLDivElement;
const refreshButton = document.getElementById('refresh-btn') as HTMLButtonElement;
const columnsButton = document.getElementById('columns-btn') as HTMLButtonElement;
const statsButton = document.getElementById('stats-btn') as HTMLButtonElement;
const codeButton = document.getElementById('code-btn') as HTMLButtonElement;
const rowFilterBar = document.getElementById('row-filter-bar') as HTMLDivElement;
const rowFilterChips = document.getElementById('row-filter-chips') as HTMLDivElement;
const addRowFilterButton = document.getElementById('add-row-filter') as HTMLButtonElement;
const columnVisibilityPanel = document.getElementById('column-visibility-panel') as HTMLDivElement;
const statsPanel = document.getElementById('stats-panel') as HTMLDivElement;
const codeModal = document.getElementById('code-modal') as HTMLDivElement;
const columnMenu = document.getElementById('column-menu') as HTMLDivElement;
const columnMenuAddFilter = document.getElementById('column-menu-add-filter') as HTMLButtonElement;
const columnMenuHideColumn = document.getElementById('column-menu-hide-column') as HTMLButtonElement;
const columnVisibilityList = document.getElementById('column-visibility-list') as HTMLDivElement;
const columnVisibilitySearch = document.getElementById('column-visibility-search') as HTMLInputElement;
const columnVisibilityApply = document.getElementById('apply-column-visibility-filter') as HTMLButtonElement;
const columnVisibilityClear = document.getElementById('clear-column-visibility-filter') as HTMLButtonElement;
const columnVisibilityStatus = document.getElementById('column-visibility-status') as HTMLDivElement;
const rowFilterPanel = document.getElementById('row-filter-panel') as HTMLDivElement;
const rowFilterColumn = document.getElementById('row-filter-column') as HTMLSelectElement;
const rowFilterType = document.getElementById('row-filter-type') as HTMLSelectElement;
const rowFilterCompareOp = document.getElementById('row-filter-compare-op') as HTMLSelectElement;
const rowFilterCompareValue = document.getElementById('row-filter-compare-value') as HTMLInputElement;
const rowFilterBetweenLeft = document.getElementById('row-filter-between-left') as HTMLInputElement;
const rowFilterBetweenRight = document.getElementById('row-filter-between-right') as HTMLInputElement;
const rowFilterSearchType = document.getElementById('row-filter-search-type') as HTMLSelectElement;
const rowFilterSearchTerm = document.getElementById('row-filter-search-term') as HTMLInputElement;
const rowFilterSearchCase = document.getElementById('row-filter-search-case') as HTMLInputElement;
const rowFilterSetValues = document.getElementById('row-filter-set-values') as HTMLInputElement;
const rowFilterSetInclusive = document.getElementById('row-filter-set-inclusive') as HTMLInputElement;
const rowFilterCondition = document.getElementById('row-filter-condition') as HTMLSelectElement;
const rowFilterError = document.getElementById('row-filter-error') as HTMLDivElement;
const rowFilterCompareSection = document.getElementById('row-filter-compare-section') as HTMLDivElement;
const rowFilterBetweenSection = document.getElementById('row-filter-between-section') as HTMLDivElement;
const rowFilterSearchSection = document.getElementById('row-filter-search-section') as HTMLDivElement;
const rowFilterSetSection = document.getElementById('row-filter-set-section') as HTMLDivElement;
const rowFilterConditionSection = document.getElementById('row-filter-condition-section') as HTMLDivElement;
const statsResults = document.getElementById('stats-results') as HTMLDivElement;
const statsText = document.getElementById('stats-text') as HTMLPreElement;
const histogramContainer = document.getElementById('histogram-chart') as HTMLDivElement;
const codePreview = document.getElementById('code-preview') as HTMLPreElement;
const tableHeader = document.getElementById('table-header') as HTMLDivElement;
const tableBody = document.getElementById('table-body') as HTMLDivElement;

const ROW_HEIGHT = 26;
const ROW_BLOCK_SIZE = 200;
const COLUMN_WIDTH = 160;
const ROW_LABEL_WIDTH = 72;
const UNNAMED_COLUMN_PREFIX = 'Unnamed';

const rowCache = new Map<number, string[]>();
const rowLabelCache = new Map<number, string>();
const loadedBlocks = new Set<number>();
const loadingBlocks = new Set<number>();
const hiddenColumnIndices = new Set<number>();

let state: BackendState | undefined;
let schema: ColumnSchema[] = [];
let fullSchema: ColumnSchema[] = [];
let tableInstance: Table<RowData> | undefined;
let rowModel: RowModel<RowData> | undefined;
let rowVirtualizer: Virtualizer<HTMLDivElement, HTMLDivElement> | undefined;
let bodyInner: HTMLDivElement | undefined;
let columnTemplate = '';
let lastScrollLeft = 0;
let headerRowElement: HTMLDivElement | undefined;
let rowVirtualizerCleanup: (() => void) | undefined;
let activeSort: SortState | null = null;
let histogramChart: echarts.ECharts | null = null;
let rowFilters: RowFilter[] = [];
let editingRowFilterIndex: number | null = null;
let rowFilterSupport: SetRowFiltersFeatures | undefined;
let columnFilterSupport: SearchSchemaFeatures | undefined;
let setColumnFilterSupport: SetColumnFiltersFeatures | undefined;
let columnFilterMatches: number[] | null = null;
let columnMenuColumnIndex: number | null = null;
let columnVisibilityDebounceId: number | undefined;

function log(message: string, payload?: unknown): void {
    if (payload !== undefined) {
        console.log(`[dataExplorer] ${message}`, payload);
    } else {
        console.log(`[dataExplorer] ${message}`);
    }
}

function getColumnLabel(column: ColumnSchema): string {
    const rawLabel = column.column_label ?? column.column_name;
    const trimmed = rawLabel?.trim();
    if (trimmed) {
        return trimmed;
    }
    return `${UNNAMED_COLUMN_PREFIX} ${column.column_index + 1}`;
}

function isColumnNamed(column: ColumnSchema): boolean {
    const rawLabel = column.column_label ?? column.column_name;
    return Boolean(rawLabel?.trim());
}

const ROW_FILTER_TYPE_LABELS: Record<RowFilterType, string> = {
    between: 'Between',
    compare: 'Compare',
    is_empty: 'Is empty',
    is_false: 'Is false',
    is_null: 'Is null',
    is_true: 'Is true',
    not_between: 'Not between',
    not_empty: 'Not empty',
    not_null: 'Not null',
    search: 'Search',
    set_membership: 'Set membership',
};

const ROW_FILTER_SECTION_MAP: Record<RowFilterType, 'compare' | 'between' | 'search' | 'set' | 'none'> = {
    between: 'between',
    compare: 'compare',
    is_empty: 'none',
    is_false: 'none',
    is_null: 'none',
    is_true: 'none',
    not_between: 'between',
    not_empty: 'none',
    not_null: 'none',
    search: 'search',
    set_membership: 'set',
};

refreshButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
});

columnsButton.addEventListener('click', () => {
    columnVisibilityPanel.classList.toggle('open');
    statsPanel.classList.remove('open');
    codeModal.classList.remove('open');
    rowFilterPanel.classList.remove('open');
    if (columnVisibilityPanel.classList.contains('open')) {
        renderColumnVisibilityList();
        columnVisibilitySearch.focus();
    }
});

columnVisibilityApply.addEventListener('click', () => {
    applyColumnSearch();
});

columnVisibilityClear.addEventListener('click', () => {
    columnVisibilitySearch.value = '';
    applyColumnSearch();
});

columnVisibilitySearch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        applyColumnSearch();
    }
});

columnVisibilitySearch.addEventListener('input', () => {
    scheduleColumnVisibilitySearch();
});

addRowFilterButton.addEventListener('click', () => {
    openRowFilterEditor();
});

statsButton.addEventListener('click', () => {
    statsPanel.classList.toggle('open');
    columnVisibilityPanel.classList.remove('open');
    codeModal.classList.remove('open');
    rowFilterPanel.classList.remove('open');
    populateStatsColumnSelect();
    if (statsPanel.classList.contains('open')) {
        requestAnimationFrame(() => {
            histogramChart?.resize();
        });
    }
});

codeButton.addEventListener('click', () => {
    const shouldOpen = !codeModal.classList.contains('open');
    if (shouldOpen) {
        vscode.postMessage({ type: 'suggestCodeSyntax' });
    }
    codeModal.classList.toggle('open');
    columnVisibilityPanel.classList.remove('open');
    statsPanel.classList.remove('open');
    rowFilterPanel.classList.remove('open');
});

document.getElementById('close-column-visibility')?.addEventListener('click', () => {
    columnVisibilityPanel.classList.remove('open');
});

document.getElementById('close-row-filter')?.addEventListener('click', () => {
    rowFilterPanel.classList.remove('open');
});

document.getElementById('close-stats')?.addEventListener('click', () => {
    statsPanel.classList.remove('open');
});

document.getElementById('close-code')?.addEventListener('click', () => {
    codeModal.classList.remove('open');
});

document.getElementById('cancel-row-filter')?.addEventListener('click', () => {
    rowFilterPanel.classList.remove('open');
});

document.getElementById('save-row-filter')?.addEventListener('click', () => {
    saveRowFilter();
});

rowFilterType.addEventListener('change', () => {
    updateRowFilterSections(rowFilterType.value as RowFilterType);
});

document.getElementById('get-stats')?.addEventListener('click', () => {
    getColumnStats();
});

document.getElementById('convert-code')?.addEventListener('click', () => {
    const syntax = (document.getElementById('code-syntax') as HTMLSelectElement).value;
    vscode.postMessage({ type: 'convertToCode', syntax });
});

document.getElementById('copy-code')?.addEventListener('click', () => {
    const code = (document.getElementById('code-preview') as HTMLPreElement).textContent;
    if (code) {
        navigator.clipboard.writeText(code);
    }
});

document.querySelectorAll('#export-dropdown button').forEach((btn) => {
    btn.addEventListener('click', (e) => {
        const format = (e.target as HTMLElement).dataset.format as 'csv' | 'tsv' | 'html';
        vscode.postMessage({ type: 'exportData', format });
    });
});

columnMenuAddFilter.addEventListener('click', () => {
    if (columnMenuColumnIndex === null) {
        return;
    }
    const selectedColumnIndex = columnMenuColumnIndex;
    closeColumnMenu();
    openRowFilterEditor(undefined, undefined, selectedColumnIndex);
});

columnMenuHideColumn.addEventListener('click', () => {
    if (columnMenuColumnIndex === null) {
        return;
    }
    const selectedColumnIndex = columnMenuColumnIndex;
    closeColumnMenu();
    hideColumn(selectedColumnIndex);
});

document.addEventListener('click', (event) => {
    if (!columnMenu.classList.contains('open')) {
        return;
    }
    if (columnMenu.contains(event.target as Node)) {
        return;
    }
    closeColumnMenu();
});

document.addEventListener('click', (event) => {
    const target = event.target as Node;
    if (statsPanel.classList.contains('open')
        && !statsPanel.contains(target)
        && !statsButton.contains(target)) {
        statsPanel.classList.remove('open');
    }
    if (columnVisibilityPanel.classList.contains('open')
        && !columnVisibilityPanel.contains(target)
        && !columnsButton.contains(target)) {
        columnVisibilityPanel.classList.remove('open');
    }
    if (codeModal.classList.contains('open')
        && !codeModal.contains(target)
        && !codeButton.contains(target)) {
        codeModal.classList.remove('open');
    }
    if (rowFilterPanel.classList.contains('open')
        && !rowFilterPanel.contains(target)
        && !addRowFilterButton.contains(target)) {
        rowFilterPanel.classList.remove('open');
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeColumnMenu();
    }
});

window.addEventListener('resize', () => {
    closeColumnMenu();
});

function populateStatsColumnSelect() {
    const select = document.getElementById('stats-column') as HTMLSelectElement;
    select.innerHTML = '<option value="">Choose column...</option>';
    schema.forEach((col) => {
        const option = document.createElement('option');
        option.value = String(col.column_index);
        option.textContent = getColumnLabel(col);
        select.appendChild(option);
    });
}

function applyColumnSearch() {
    if (!isColumnFilterSupported()) {
        columnVisibilityStatus.textContent = 'Column filtering is not supported.';
        log('Column filter unavailable; search_schema unsupported.');
        return;
    }
    const searchTerm = columnVisibilitySearch.value.trim();
    const sortOrder = 'original';

    const filters: ColumnFilter[] = [];
    if (!searchTerm) {
        columnFilterMatches = null;
        columnVisibilityStatus.textContent = 'Showing all columns.';
        renderColumnVisibilityList();
        if (!isSetColumnFiltersSupported()) {
            applySchemaUpdate(resolveVisibleSchema());
        } else {
            vscode.postMessage({ type: 'setColumnFilters', filters });
        }
        log('Column search cleared');
        return;
    }
    if (searchTerm) {
        filters.push({
            filter_type: 'text_search',
            params: {
                search_type: 'contains',
                term: searchTerm,
                case_sensitive: false,
            },
        });
    }

    log('Applying column search', { term: searchTerm, filters: filters.length });
    columnVisibilityStatus.textContent = 'Searching...';
    vscode.postMessage({ type: 'searchSchema', filters, sortOrder });
    if (isSetColumnFiltersSupported()) {
        vscode.postMessage({ type: 'setColumnFilters', filters });
    }
}

function scheduleColumnVisibilitySearch(): void {
    if (columnVisibilityDebounceId !== undefined) {
        window.clearTimeout(columnVisibilityDebounceId);
    }
    columnVisibilityDebounceId = window.setTimeout(() => {
        applyColumnSearch();
    }, 250);
}

function hideColumn(columnIndex: number): void {
    if (hiddenColumnIndices.has(columnIndex)) {
        return;
    }
    hiddenColumnIndices.add(columnIndex);
    log('Column hidden', { columnIndex });
    applySchemaUpdate(resolveVisibleSchema());
}

function showColumn(columnIndex: number): void {
    if (!hiddenColumnIndices.has(columnIndex)) {
        return;
    }
    hiddenColumnIndices.delete(columnIndex);
    log('Column shown', { columnIndex });
    applySchemaUpdate(resolveVisibleSchema());
}

function toggleColumnVisibility(columnIndex: number): void {
    if (hiddenColumnIndices.has(columnIndex)) {
        showColumn(columnIndex);
        return;
    }
    if (resolveVisibleSchema().length <= 1) {
        return;
    }
    hideColumn(columnIndex);
}

function renderColumnVisibilityList(): void {
    columnVisibilityList.innerHTML = '';
    const baseSchema = columnFilterMatches ? resolveSchemaMatches(columnFilterMatches) : fullSchema;
    if (!baseSchema.length) {
        const empty = document.createElement('div');
        empty.className = 'column-visibility-empty';
        empty.textContent = 'No columns available.';
        columnVisibilityList.appendChild(empty);
        return;
    }

    const visibleCount = resolveVisibleSchema().length;
    for (const column of baseSchema) {
        const item = document.createElement('div');
        item.className = 'column-visibility-item';

        const details = document.createElement('div');
        details.className = 'column-visibility-details';

        const name = document.createElement('div');
        name.className = 'column-visibility-name';
        name.textContent = getColumnLabel(column);
        name.title = getColumnLabel(column);
        details.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'column-visibility-meta';
        meta.textContent = column.type_display || column.type_name;
        details.appendChild(meta);

        const toggle = document.createElement('button');
        toggle.className = 'column-visibility-toggle';
        const isHidden = hiddenColumnIndices.has(column.column_index);
        toggle.title = isHidden ? 'Show column' : 'Hide column';
        toggle.setAttribute('aria-pressed', String(!isHidden));
        if (isHidden) {
            toggle.classList.add('is-hidden');
        }
        if (!isHidden && visibleCount <= 1) {
            toggle.disabled = true;
            toggle.title = 'Cannot hide last visible column';
        }
        const icon = document.createElement('span');
        icon.className = `codicon ${isHidden ? 'codicon-eye-closed' : 'codicon-eye'}`;
        toggle.appendChild(icon);
        toggle.addEventListener('click', () => {
            toggleColumnVisibility(column.column_index);
        });

        item.appendChild(details);
        item.appendChild(toggle);
        columnVisibilityList.appendChild(item);
    }
}

function updateRowFilterBarVisibility(): void {
    const supported = isRowFilterSupported();
    rowFilterBar.style.display = supported ? 'flex' : 'none';
    addRowFilterButton.disabled = !supported;
    if (!supported) {
        rowFilterPanel.classList.remove('open');
    }
}

function isRowFilterSupported(): boolean {
    const supportStatus = rowFilterSupport?.support_status;
    if (!supportStatus) {
        return true;
    }
    return supportStatus === 'supported';
}

function isColumnFilterSupported(): boolean {
    const supportStatus = columnFilterSupport?.support_status;
    if (!supportStatus) {
        return true;
    }
    return supportStatus === 'supported';
}

function isSetColumnFiltersSupported(): boolean {
    const supportStatus = setColumnFilterSupport?.support_status;
    if (!supportStatus) {
        return true;
    }
    return supportStatus === 'supported';
}

function openColumnMenu(x: number, y: number, columnIndex: number): void {
    columnMenuColumnIndex = columnIndex;
    columnMenuAddFilter.disabled = !isRowFilterSupported();
    columnMenuHideColumn.disabled = schema.length <= 1;
    columnMenu.classList.add('open');
    const padding = 8;
    const { innerWidth, innerHeight } = window;
    const menuRect = columnMenu.getBoundingClientRect();
    const nextLeft = Math.min(x, innerWidth - menuRect.width - padding);
    const nextTop = Math.min(y, innerHeight - menuRect.height - padding);
    columnMenu.style.left = `${Math.max(nextLeft, padding)}px`;
    columnMenu.style.top = `${Math.max(nextTop, padding)}px`;
}

function closeColumnMenu(): void {
    columnMenu.classList.remove('open');
    columnMenuColumnIndex = null;
}

function supportsRowFilterConditions(): boolean {
    const supportStatus = rowFilterSupport?.supports_conditions;
    if (!supportStatus) {
        return true;
    }
    return supportStatus === 'supported';
}

function getSupportedRowFilterTypes(): RowFilterType[] {
    const supported = rowFilterSupport?.supported_types
        ?.filter((entry) => entry.support_status === 'supported')
        .map((entry) => entry.row_filter_type);

    if (supported && supported.length > 0) {
        return supported;
    }

    return Object.keys(ROW_FILTER_TYPE_LABELS) as RowFilterType[];
}

function renderRowFilterChips(): void {
    rowFilterChips.innerHTML = '';
    if (!rowFilters.length) {
        const empty = document.createElement('span');
        empty.textContent = 'No filters';
        empty.className = 'row-filter-label';
        rowFilterChips.appendChild(empty);
        return;
    }

    rowFilters.forEach((filter, index) => {
        const chip = document.createElement('div');
        chip.className = 'row-filter-chip';
        const label = document.createElement('span');
        label.textContent = formatRowFilterChip(filter, index);
        chip.appendChild(label);

        const removeButton = document.createElement('button');
        removeButton.textContent = '×';
        removeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            removeRowFilter(index);
        });
        chip.appendChild(removeButton);

        chip.addEventListener('click', () => {
            openRowFilterEditor(filter, index);
        });
        rowFilterChips.appendChild(chip);
    });
}

function formatRowFilterChip(filter: RowFilter, index: number): string {
    const columnLabel = getColumnLabel(filter.column_schema);
    const prefix = index > 0 ? `${filter.condition.toUpperCase()} ` : '';
    const params = filter.params || {};

    switch (filter.filter_type) {
        case 'compare':
            return `${prefix}${columnLabel} ${(params as { op?: string }).op ?? '='} ${(params as { value?: string }).value ?? ''}`.trim();
        case 'between':
            return `${prefix}${columnLabel} between ${(params as { left_value?: string }).left_value ?? ''} and ${(params as { right_value?: string }).right_value ?? ''}`.trim();
        case 'not_between':
            return `${prefix}${columnLabel} not between ${(params as { left_value?: string }).left_value ?? ''} and ${(params as { right_value?: string }).right_value ?? ''}`.trim();
        case 'search':
            return `${prefix}${columnLabel} ${(params as { search_type?: string }).search_type ?? 'contains'} "${(params as { term?: string }).term ?? ''}"`.trim();
        case 'set_membership': {
            const inclusive = (params as { inclusive?: boolean }).inclusive !== false;
            const values = (params as { values?: string[] }).values ?? [];
            const label = inclusive ? 'in' : 'not in';
            return `${prefix}${columnLabel} ${label} [${values.join(', ')}]`;
        }
        case 'is_null':
            return `${prefix}${columnLabel} is null`;
        case 'not_null':
            return `${prefix}${columnLabel} is not null`;
        case 'is_empty':
            return `${prefix}${columnLabel} is empty`;
        case 'not_empty':
            return `${prefix}${columnLabel} is not empty`;
        case 'is_true':
            return `${prefix}${columnLabel} is true`;
        case 'is_false':
            return `${prefix}${columnLabel} is false`;
        default:
            return `${prefix}${columnLabel}`;
    }
}

function openRowFilterEditor(filter?: RowFilter, index?: number, columnIndex?: number): void {
    if (!isRowFilterSupported()) {
        return;
    }

    if (!schema.length) {
        log('Row filter editor skipped; schema not loaded.');
        return;
    }

    editingRowFilterIndex = index ?? null;
    rowFilterPanel.classList.add('open');
    filterPanel.classList.remove('open');
    statsPanel.classList.remove('open');
    codeModal.classList.remove('open');
    closeColumnMenu();
    rowFilterError.textContent = '';

    populateRowFilterColumns();
    populateRowFilterTypes();

    const selectedColumnIndex = filter?.column_schema.column_index
        ?? columnIndex
        ?? schema[0]?.column_index
        ?? 0;
    rowFilterColumn.value = String(selectedColumnIndex);

    const selectedType = filter?.filter_type ?? getSupportedRowFilterTypes()[0] ?? 'compare';
    rowFilterType.value = selectedType;
    updateRowFilterSections(selectedType);

    const conditionValue = filter?.condition ?? 'and';
    rowFilterCondition.value = conditionValue;
    rowFilterConditionSection.style.display = supportsRowFilterConditions() ? 'block' : 'none';

    rowFilterCompareOp.value = (filter?.params as { op?: string })?.op ?? '=';
    rowFilterCompareValue.value = (filter?.params as { value?: string })?.value ?? '';
    rowFilterBetweenLeft.value = (filter?.params as { left_value?: string })?.left_value ?? '';
    rowFilterBetweenRight.value = (filter?.params as { right_value?: string })?.right_value ?? '';
    rowFilterSearchType.value = (filter?.params as { search_type?: string })?.search_type ?? 'contains';
    rowFilterSearchTerm.value = (filter?.params as { term?: string })?.term ?? '';
    rowFilterSearchCase.checked = (filter?.params as { case_sensitive?: boolean })?.case_sensitive ?? false;
    rowFilterSetValues.value = ((filter?.params as { values?: string[] })?.values ?? []).join(', ');
    rowFilterSetInclusive.checked = (filter?.params as { inclusive?: boolean })?.inclusive !== false;

    log('Row filter editor opened', { filter, index });
}

function populateRowFilterColumns(): void {
    rowFilterColumn.innerHTML = '';
    schema.forEach((column) => {
        const option = document.createElement('option');
        option.value = String(column.column_index);
        option.textContent = getColumnLabel(column);
        rowFilterColumn.appendChild(option);
    });
}

function populateRowFilterTypes(): void {
    const supportedTypes = getSupportedRowFilterTypes();
    rowFilterType.innerHTML = '';
    supportedTypes.forEach((filterType) => {
        const option = document.createElement('option');
        option.value = filterType;
        option.textContent = ROW_FILTER_TYPE_LABELS[filterType] ?? filterType;
        rowFilterType.appendChild(option);
    });
}

function updateRowFilterSections(filterType: RowFilterType): void {
    const section = ROW_FILTER_SECTION_MAP[filterType] ?? 'none';
    rowFilterCompareSection.style.display = section === 'compare' ? 'block' : 'none';
    rowFilterBetweenSection.style.display = section === 'between' ? 'block' : 'none';
    rowFilterSearchSection.style.display = section === 'search' ? 'block' : 'none';
    rowFilterSetSection.style.display = section === 'set' ? 'block' : 'none';
}

function saveRowFilter(): void {
    const columnIndex = Number(rowFilterColumn.value);
    const column = schema.find((item) => item.column_index === columnIndex);
    if (!column) {
        rowFilterError.textContent = 'Select a column.';
        return;
    }

    const filterType = rowFilterType.value as RowFilterType;
    const params = buildRowFilterParams(filterType);
    if (!params.valid) {
        rowFilterError.textContent = params.errorMessage;
        return;
    }

    const condition: RowFilterCondition = supportsRowFilterConditions()
        ? (rowFilterCondition.value as RowFilterCondition)
        : 'and';

    const filterId = editingRowFilterIndex !== null
        ? rowFilters[editingRowFilterIndex]?.filter_id
        : createRowFilterId();

    if (!filterId) {
        rowFilterError.textContent = 'Unable to create filter ID.';
        return;
    }

    const filter: RowFilter = {
        filter_id: filterId,
        filter_type: filterType,
        column_schema: column,
        condition,
        params: params.value,
    };

    if (editingRowFilterIndex !== null) {
        rowFilters[editingRowFilterIndex] = filter;
    } else {
        rowFilters.push(filter);
    }

    rowFilterPanel.classList.remove('open');
    rowFilterError.textContent = '';
    renderRowFilterChips();
    vscode.postMessage({ type: 'setRowFilters', filters: rowFilters });
    log('Row filters saved', { count: rowFilters.length, filter });
}

function buildRowFilterParams(filterType: RowFilterType): { valid: boolean; value?: Record<string, unknown>; errorMessage?: string } {
    switch (filterType) {
        case 'compare':
            if (!rowFilterCompareValue.value.trim()) {
                return { valid: false, errorMessage: 'Enter a comparison value.' };
            }
            return {
                valid: true,
                value: {
                    op: rowFilterCompareOp.value as FilterComparisonOp,
                    value: rowFilterCompareValue.value.trim(),
                },
            };
        case 'between':
        case 'not_between':
            if (!rowFilterBetweenLeft.value.trim() || !rowFilterBetweenRight.value.trim()) {
                return { valid: false, errorMessage: 'Enter both range values.' };
            }
            return {
                valid: true,
                value: {
                    left_value: rowFilterBetweenLeft.value.trim(),
                    right_value: rowFilterBetweenRight.value.trim(),
                },
            };
        case 'search':
            if (!rowFilterSearchTerm.value.trim()) {
                return { valid: false, errorMessage: 'Enter a search term.' };
            }
            return {
                valid: true,
                value: {
                    search_type: rowFilterSearchType.value as TextSearchType,
                    term: rowFilterSearchTerm.value.trim(),
                    case_sensitive: rowFilterSearchCase.checked,
                },
            };
        case 'set_membership': {
            const values = rowFilterSetValues.value
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean);
            if (!values.length) {
                return { valid: false, errorMessage: 'Enter one or more values.' };
            }
            return {
                valid: true,
                value: {
                    values,
                    inclusive: rowFilterSetInclusive.checked,
                },
            };
        }
        default:
            return { valid: true };
    }
}

function createRowFilterId(): string {
    if ('randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `row-filter-${Date.now()}`;
}

function removeRowFilter(index: number): void {
    rowFilters.splice(index, 1);
    renderRowFilterChips();
    vscode.postMessage({ type: 'setRowFilters', filters: rowFilters });
    log('Row filter removed', { index, count: rowFilters.length });
}

function getColumnStats() {
    const columnIndex = parseInt((document.getElementById('stats-column') as HTMLSelectElement).value, 10);
    if (isNaN(columnIndex)) {
        return;
    }

    const profileTypes: string[] = [];
    if ((document.getElementById('stat-null-count') as HTMLInputElement).checked) {
        profileTypes.push('null_count');
    }
    if ((document.getElementById('stat-summary') as HTMLInputElement).checked) {
        profileTypes.push('summary_stats');
    }
    if ((document.getElementById('stat-histogram') as HTMLInputElement).checked) {
        profileTypes.push('small_histogram');
    }
    if ((document.getElementById('stat-frequency') as HTMLInputElement).checked) {
        profileTypes.push('small_frequency_table');
    }

    statsText.textContent = 'Loading statistics...';
    clearHistogram();
    vscode.postMessage({ type: 'getColumnProfiles', columnIndex, profileTypes });
}

tableBody.addEventListener('scroll', () => {
    if (columnMenu.classList.contains('open')) {
        closeColumnMenu();
    }
    if (tableBody.scrollLeft !== lastScrollLeft) {
        updateHeaderScroll(tableBody.scrollLeft);
        lastScrollLeft = tableBody.scrollLeft;
    }
});

window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
        case 'init':
            handleInit(message as InitMessage);
            break;
        case 'rows':
            handleRows(message as RowsMessage);
            break;
        case 'error':
            showError(message.message as string);
            break;
        case 'searchSchemaResult':
            handleSearchSchemaResult(message.matches);
            break;
        case 'exportResult':
            handleExportResult(message.data, message.format);
            break;
        case 'columnProfilesResult':
            handleColumnProfilesResult(message.columnIndex, message.profiles, message.errorMessage);
            break;
        case 'convertToCodeResult':
            handleConvertToCodeResult(message.code, message.syntax);
            break;
        case 'suggestCodeSyntaxResult':
            handleSuggestCodeSyntaxResult(message.syntax);
            break;
    }
});

vscode.postMessage({ type: 'ready' });

function handleSearchSchemaResult(matches: number[]): void {
    columnFilterMatches = matches;
    if (!isSetColumnFiltersSupported()) {
        applySchemaUpdate(resolveVisibleSchema());
    }
    columnVisibilityStatus.textContent = `Found ${matches.length} matching columns.`;
    log('Column search results', { matches: matches.length });
    renderColumnVisibilityList();
}

function resolveSchemaMatches(matches: number[]): ColumnSchema[] {
    if (!fullSchema.length || matches.length === 0) {
        return [];
    }
    const lookup = new Map(fullSchema.map((column) => [column.column_index, column]));
    const resolved: ColumnSchema[] = [];
    for (const index of matches) {
        const column = lookup.get(index);
        if (column) {
            resolved.push(column);
        }
    }
    return resolved;
}

function resolveVisibleSchema(): ColumnSchema[] {
    const baseSchema = columnFilterMatches && !isSetColumnFiltersSupported()
        ? resolveSchemaMatches(columnFilterMatches)
        : fullSchema;
    return baseSchema.filter((column) => !hiddenColumnIndices.has(column.column_index));
}

function applySchemaUpdate(nextSchema: ColumnSchema[]): void {
    schema = nextSchema;
    rowCache.clear();
    rowLabelCache.clear();
    loadedBlocks.clear();
    loadingBlocks.clear();
    renderColumnVisibilityList();
    renderHeader();
    setupTable();
    setupVirtualizer();
    renderRows();
    requestInitialBlock();
    requestVisibleBlocks();
    if (statsPanel.classList.contains('open')) {
        populateStatsColumnSelect();
    }
}

function ensureHistogramChart(): echarts.ECharts {
    if (!histogramChart) {
        histogramChart = echarts.init(histogramContainer);
    }
    return histogramChart;
}

function clearHistogram(): void {
    histogramContainer.style.display = 'none';
    histogramChart?.clear();
}

function renderHistogram(histogram: ColumnProfileResult['small_histogram'], columnLabel: string): void {
    if (!histogram) {
        clearHistogram();
        return;
    }

    const edges = histogram.bin_edges ?? [];
    const counts = histogram.bin_counts ?? [];
    if (edges.length < 2 || counts.length === 0) {
        clearHistogram();
        return;
    }

    log('Rendering histogram', { columnLabel, bins: counts.length });

    const labels = counts.map((_, index) => {
        const start = edges[index] ?? '';
        const end = edges[index + 1] ?? '';
        return `${start} - ${end}`;
    });

    histogramContainer.style.display = 'block';
    const chart = ensureHistogramChart();
    const chartColor = getComputedStyle(document.body).getPropertyValue('--vscode-charts-blue').trim() || '#4e79a7';

    chart.setOption({
        title: {
            text: `Histogram: ${columnLabel}`,
            textStyle: {
                fontSize: 12,
                color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground').trim() || '#cccccc',
            },
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
        },
        grid: { left: 40, right: 20, top: 30, bottom: 40 },
        xAxis: {
            type: 'category',
            data: labels,
            axisLabel: {
                rotate: 30,
                color: getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground').trim() || '#888888',
            },
            axisLine: {
                lineStyle: { color: getComputedStyle(document.body).getPropertyValue('--vscode-editorWidget-border').trim() || '#3c3c3c' },
            },
        },
        yAxis: {
            type: 'value',
            axisLabel: {
                color: getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground').trim() || '#888888',
            },
            splitLine: {
                lineStyle: { color: getComputedStyle(document.body).getPropertyValue('--vscode-editorWidget-border').trim() || '#3c3c3c' },
            },
        },
        series: [
            {
                type: 'bar',
                data: counts,
                itemStyle: {
                    color: chartColor,
                },
            },
        ],
    });
    chart.resize();
}

function handleColumnProfilesResult(columnIndex: number, profiles: ColumnProfileResult[], errorMessage?: string): void {
    if (errorMessage) {
        statsText.textContent = `Error: ${errorMessage}`;
        clearHistogram();
        return;
    }

    log('Column profiles received', { columnIndex, profiles });
    const lines: string[] = [`Column ${columnIndex + 1} profiles:`];
    let histogram: ColumnProfileResult['small_histogram'] | undefined;
    profiles.forEach((profile) => {
        if (profile.null_count !== undefined) {
            lines.push(`Null count: ${profile.null_count}`);
        }
        if (profile.summary_stats) {
            const stats = profile.summary_stats;
            lines.push(`Summary (${stats.type_display}):`);
            const details = stats.number_stats || stats.string_stats || stats.boolean_stats || stats.date_stats || stats.datetime_stats || stats.other_stats;
            if (details) {
                Object.entries(details).forEach(([key, value]) => {
                    lines.push(`  ${key}: ${value}`);
                });
            }
        }
        if (profile.small_histogram) {
            histogram = profile.small_histogram;
            lines.push(`Histogram bins: ${profile.small_histogram.bin_counts.length}`);
        }
        if (profile.small_frequency_table) {
            lines.push('Top values:');
            profile.small_frequency_table.values.forEach((value, idx) => {
                const count = profile.small_frequency_table.counts[idx];
                lines.push(`  ${value}: ${count}`);
            });
            if (profile.small_frequency_table.other_count !== undefined) {
                lines.push(`  Other: ${profile.small_frequency_table.other_count}`);
            }
        }
    });

    statsText.textContent = lines.join('\n');
    statsResults.scrollTop = 0;
    const column = schema.find((col) => col.column_index === columnIndex);
    const columnLabel = column ? getColumnLabel(column) : `Column ${columnIndex + 1}`;
    renderHistogram(histogram, columnLabel);
}

function handleExportResult(data: string, format: string): void {
    const blob = new Blob([data], { type: format === 'html' ? 'text/html' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export.${format === 'csv' ? 'csv' : format === 'tsv' ? 'tsv' : 'html'}`;
    a.click();
    URL.revokeObjectURL(url);
}

function handleConvertToCodeResult(code: string, syntax: string): void {
    codePreview.textContent = code || '(No code generated)';
}

function handleSuggestCodeSyntaxResult(syntax: string): void {
    const select = document.getElementById('code-syntax') as HTMLSelectElement;
    select.value = syntax;
}

function handleInit(message: InitMessage) {
    state = message.state;
    fullSchema = message.schema ?? [];
    columnFilterMatches = null;
    hiddenColumnIndices.clear();
    schema = resolveVisibleSchema();
    rowCache.clear();
    rowLabelCache.clear();
    loadedBlocks.clear();
    loadingBlocks.clear();
    activeSort = resolveSortState(state.sort_keys);
    rowFilters = state.row_filters ?? [];
    rowFilterSupport = state.supported_features?.set_row_filters;
    columnFilterSupport = state.supported_features?.search_schema;
    setColumnFilterSupport = state.supported_features?.set_column_filters;
    columnVisibilityStatus.textContent = '';
    columnVisibilitySearch.value = '';
    statsText.textContent = '';
    clearHistogram();
    codePreview.textContent = '';
    (document.getElementById('column-search') as HTMLInputElement).value = '';
    (document.getElementById('sort-order') as HTMLSelectElement).value = 'original';
    renderRowFilterChips();
    updateRowFilterBarVisibility();
    if (columnFilterMatches && !isSetColumnFiltersSupported()) {
        schema = resolveVisibleSchema();
    }
    renderColumnVisibilityList();
    applySchemaUpdate(schema);
    log('Data explorer initialized', {
        rows: state.table_shape.num_rows,
        columns: schema.length,
    });
}

function handleRows(message: RowsMessage) {
    const { startIndex, endIndex, columns, rowLabels } = message;
    const rowCount = endIndex - startIndex + 1;
    const columnCount = schema.length;

    for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
        const rowIndex = startIndex + rowOffset;
        const values: string[] = new Array(columnCount).fill('');

        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            const columnValues = columns[columnIndex];
            const value = columnValues ? columnValues[rowOffset] : '';
            values[columnIndex] = formatColumnValue(value);
        }

        rowCache.set(rowIndex, values);
        if (rowLabels && rowLabels[rowOffset] !== undefined) {
            rowLabelCache.set(rowIndex, rowLabels[rowOffset]);
        }
    }

    const startBlock = Math.floor(startIndex / ROW_BLOCK_SIZE);
    const endBlock = Math.floor(endIndex / ROW_BLOCK_SIZE);
    for (let block = startBlock; block <= endBlock; block += 1) {
        loadingBlocks.delete(block);
        loadedBlocks.add(block);
    }

    if (rowVirtualizer) {
        rowVirtualizer.measure();
    }
    renderRows();
    requestVisibleBlocks();
    log('Rows rendered', { startIndex, endIndex, rows: rowCount, columns: columnCount });
}

function setupTable() {
    if (!state) {
        return;
    }

    const rowCount = state.table_shape.num_rows;
    const rowData = Array.from({ length: rowCount }, (_, index) => ({ index }));
    const columns = buildColumnDefs();

    if (!tableInstance) {
        tableInstance = createTable<RowData>({
            data: rowData,
            columns,
            getCoreRowModel: getCoreRowModel(),
            state: {},
            onStateChange: () => undefined,
            renderFallbackValue: '',
        });
    } else {
        tableInstance.setOptions((prev) => ({
            ...prev,
            data: rowData,
            columns,
        }));
    }

    rowModel = tableInstance.getRowModel();
}

function setupVirtualizer() {
    if (!state) {
        return;
    }

    if (!bodyInner) {
        bodyInner = document.createElement('div');
        bodyInner.className = 'table-body-inner';
        tableBody.innerHTML = '';
        tableBody.appendChild(bodyInner);
    }

    rowVirtualizerCleanup?.();
    rowVirtualizerCleanup = undefined;

    rowVirtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
        count: state.table_shape.num_rows,
        getScrollElement: () => tableBody,
        estimateSize: () => ROW_HEIGHT,
        overscan: 8,
        scrollToFn: elementScroll,
        observeElementRect,
        observeElementOffset,
        onChange: () => {
            renderRows();
            requestVisibleBlocks();
        },
    });

    rowVirtualizerCleanup = rowVirtualizer._didMount();
    rowVirtualizer._willUpdate();
    rowVirtualizer.measure();
}

function buildColumnDefs(): ColumnDef<RowData>[] {
    const columns: ColumnDef<RowData>[] = [];
    const showRowLabel = state?.has_row_labels ?? false;

    columns.push({
        id: 'row-label',
        header: showRowLabel ? '#' : 'Row',
        accessorFn: (row) => getRowLabel(row.index),
    });

    for (const column of schema) {
        columns.push({
            id: `col-${column.column_index}`,
            header: getColumnLabel(column),
            accessorFn: (row) => getCellValue(row.index, column.column_index),
        });
    }

    return columns;
}

function renderHeader() {
    if (!state) {
        return;
    }

    const sortSupported = isSortSupported();
    const columnCount = schema.length;
    const totalWidth = ROW_LABEL_WIDTH + columnCount * COLUMN_WIDTH;
    columnTemplate = `${ROW_LABEL_WIDTH}px ${Array.from({ length: columnCount })
        .map(() => `${COLUMN_WIDTH}px`)
        .join(' ')}`;

    tableHeader.innerHTML = '';
    const headerBar = document.createElement('div');
    headerBar.className = 'table-header-bar';
    headerBar.textContent = 'Columns';
    tableHeader.appendChild(headerBar);

    const headerRow = document.createElement('div');
    headerRow.className = 'table-row header-row';
    headerRow.style.gridTemplateColumns = columnTemplate;
    headerRow.style.width = `${totalWidth}px`;
    headerRowElement = headerRow;

    const rowLabelHeader = document.createElement('div');
    rowLabelHeader.className = 'table-cell row-label';
    rowLabelHeader.textContent = state.has_row_labels ? '#' : 'Row';
    headerRow.appendChild(rowLabelHeader);

    for (const column of schema) {
        const cell = document.createElement('div');
        cell.className = 'table-cell header-cell';
        const headerLabel = getColumnLabel(column);
        cell.title = headerLabel;
        const content = document.createElement('div');
        content.className = 'header-content';
        const labelRow = document.createElement('div');
        labelRow.className = 'header-label-row';
        const label = document.createElement('span');
        label.className = 'header-label';
        label.textContent = headerLabel;
        labelRow.appendChild(label);
        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        labelRow.appendChild(indicator);
        content.appendChild(labelRow);
        const actions = document.createElement('div');
        actions.className = 'header-actions';
        const filterAction = document.createElement('button');
        filterAction.className = 'header-action';
        filterAction.textContent = 'Filter';
        filterAction.title = 'Add row filter';
        filterAction.disabled = !isRowFilterSupported();
        filterAction.addEventListener('click', (event) => {
            event.stopPropagation();
            if (!isRowFilterSupported()) {
                return;
            }
            log('Header filter action', { columnIndex: column.column_index });
            openRowFilterEditor(undefined, undefined, column.column_index);
        });
        const hideAction = document.createElement('button');
        hideAction.className = 'header-action';
        hideAction.textContent = 'x';
        hideAction.title = 'Hide column';
        hideAction.disabled = schema.length <= 1;
        hideAction.addEventListener('click', (event) => {
            event.stopPropagation();
            if (schema.length <= 1) {
                return;
            }
            hideColumn(column.column_index);
        });
        actions.appendChild(filterAction);
        actions.appendChild(hideAction);
        content.appendChild(actions);
        cell.appendChild(content);
        cell.dataset.columnIndex = String(column.column_index);
        if (sortSupported) {
            cell.classList.add('sortable');
            cell.addEventListener('click', () => handleHeaderSort(column.column_index));
        }
        cell.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            openColumnMenu(event.clientX, event.clientY, column.column_index);
        });
        headerRow.appendChild(cell);
    }

    tableHeader.appendChild(headerRow);
    updateHeaderScroll(tableBody.scrollLeft);
    updateHeaderSortIndicators();
    tableTitle.textContent = state.display_name || 'Data Explorer';
    const { num_rows } = state.table_shape;
    const num_columns = schema.length;
    const { num_rows: rawRows, num_columns: rawColumns } = state.table_unfiltered_shape;
    const filteredText = num_rows !== rawRows || num_columns !== rawColumns
        ? ` (${rawRows}x${rawColumns} raw)`
        : '';
    const unnamedCount = fullSchema.filter((column) => !isColumnNamed(column)).length;
    const unnamedText = unnamedCount
        ? ` - ${unnamedCount === fullSchema.length ? 'No column names' : `${unnamedCount} unnamed columns`}`
        : '';
    tableMeta.textContent = `${num_rows}x${num_columns}${filteredText}${unnamedText}`;
}

function handleHeaderSort(columnIndex: number): void {
    if (!isSortSupported()) {
        return;
    }
    activeSort = getNextSort(columnIndex);
    updateHeaderSortIndicators();
    vscode.postMessage({
        type: 'setSort',
        sortKey: activeSort
            ? { columnIndex: activeSort.columnIndex, direction: activeSort.direction }
            : null,
    });
}

function getNextSort(columnIndex: number): SortState | null {
    if (!activeSort || activeSort.columnIndex !== columnIndex) {
        return { columnIndex, direction: 'asc' };
    }
    if (activeSort.direction === 'asc') {
        return { columnIndex, direction: 'desc' };
    }
    return null;
}

function resolveSortState(sortKeys?: ColumnSortKey[]): SortState | null {
    if (!sortKeys || sortKeys.length === 0) {
        return null;
    }
    const primary = sortKeys[0];
    return {
        columnIndex: primary.column_index,
        direction: primary.ascending ? 'asc' : 'desc',
    };
}

function updateHeaderSortIndicators(): void {
    if (!headerRowElement) {
        return;
    }
    const headerCells = headerRowElement.querySelectorAll<HTMLDivElement>('.header-cell.sortable');
    headerCells.forEach((cell) => {
        const columnIndex = Number(cell.dataset.columnIndex);
        const indicator = cell.querySelector<HTMLSpanElement>('.sort-indicator');
        cell.classList.remove('sorted-asc', 'sorted-desc');
        if (activeSort && columnIndex === activeSort.columnIndex) {
            const directionClass = activeSort.direction === 'asc' ? 'sorted-asc' : 'sorted-desc';
            cell.classList.add(directionClass);
            if (indicator) {
                indicator.textContent = activeSort.direction === 'asc' ? '^' : 'v';
            }
        } else if (indicator) {
            indicator.textContent = '';
        }
    });
}

function requestInitialBlock(): void {
    if (!state) {
        return;
    }
    if (state.table_shape.num_rows === 0) {
        return;
    }
    const endIndex = Math.min(state.table_shape.num_rows - 1, ROW_BLOCK_SIZE - 1);
    if (loadedBlocks.has(0) || loadingBlocks.has(0)) {
        return;
    }
    loadingBlocks.add(0);
    vscode.postMessage({
        type: 'requestRows',
        startIndex: 0,
        endIndex,
    });
}

function updateHeaderScroll(scrollLeft: number): void {
    if (!headerRowElement) {
        return;
    }
    headerRowElement.style.transform = `translateX(${-scrollLeft}px)`;
}

function renderRows() {
    if (!state || !rowModel || !rowVirtualizer || !bodyInner) {
        return;
    }

    const virtualItems = rowVirtualizer.getVirtualItems();
    const totalHeight = rowVirtualizer.getTotalSize();
    const columnCount = schema.length;
    const totalWidth = ROW_LABEL_WIDTH + columnCount * COLUMN_WIDTH;
    bodyInner.style.height = `${totalHeight}px`;
    bodyInner.style.width = `${totalWidth}px`;
    bodyInner.innerHTML = '';

    for (const virtualRow of virtualItems) {
        const row = rowModel.rows[virtualRow.index];
        if (!row) {
            continue;
        }

        const rowEl = document.createElement('div');
        rowEl.className = 'table-row';
        rowEl.style.gridTemplateColumns = columnTemplate;
        rowEl.style.transform = `translateY(${virtualRow.start}px)`;

        const rowLabel = document.createElement('div');
        rowLabel.className = 'table-cell row-label';
        rowLabel.textContent = getRowLabel(row.original.index);
        rowEl.appendChild(rowLabel);

        const values = rowCache.get(row.original.index);
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            const cell = document.createElement('div');
            cell.className = 'table-cell';
            const value = values ? values[columnIndex] : '';
            if (isSpecialValue(value)) {
                cell.classList.add('cell-special');
            }
            cell.textContent = value;
            rowEl.appendChild(cell);
        }

        bodyInner.appendChild(rowEl);
    }
}

function requestVisibleBlocks() {
    if (!state || !rowVirtualizer) {
        return;
    }

    const virtualItems = rowVirtualizer.getVirtualItems();
    if (!virtualItems.length) {
        return;
    }

    const startIndex = virtualItems[0].index;
    const endIndex = virtualItems[virtualItems.length - 1].index;
    const startBlock = Math.floor(startIndex / ROW_BLOCK_SIZE);
    const endBlock = Math.floor(endIndex / ROW_BLOCK_SIZE);

    for (let block = startBlock; block <= endBlock; block += 1) {
        if (loadedBlocks.has(block) || loadingBlocks.has(block)) {
            continue;
        }
        const blockStart = block * ROW_BLOCK_SIZE;
        const blockEnd = Math.min(state.table_shape.num_rows - 1, blockStart + ROW_BLOCK_SIZE - 1);
        loadingBlocks.add(block);
        vscode.postMessage({
            type: 'requestRows',
            startIndex: blockStart,
            endIndex: blockEnd,
        });
    }
}

function getCellValue(rowIndex: number, columnIndex: number): string {
    const values = rowCache.get(rowIndex);
    if (!values) {
        return '';
    }
    return values[columnIndex] ?? '';
}

function getRowLabel(rowIndex: number): string {
    if (state?.has_row_labels) {
        return rowLabelCache.get(rowIndex) ?? '';
    }
    return String(rowIndex + 1);
}

function formatColumnValue(value: ColumnValue): string {
    if (typeof value === 'number') {
        return formatSpecialValue(value);
    }
    return value ?? '';
}

function isSortSupported(): boolean {
    const status = state?.supported_features?.set_sort_columns?.support_status;
    if (!status) {
        return true;
    }
    return status === 'supported';
}

function formatSpecialValue(code: number): string {
    switch (code) {
        case 0:
            return 'NULL';
        case 1:
            return 'NA';
        case 2:
            return 'NaN';
        case 3:
            return 'NaT';
        case 4:
            return 'None';
        case 10:
            return 'Inf';
        case 11:
            return '-Inf';
        default:
            return 'UNKNOWN';
    }
}

function isSpecialValue(value: string): boolean {
    return ['NULL', 'NA', 'NaN', 'NaT', 'None', 'Inf', '-Inf', 'UNKNOWN'].includes(value);
}

function showError(message: string): void {
    tableMeta.textContent = message;
}
