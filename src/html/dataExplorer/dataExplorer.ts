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

interface ColumnSummaryStats {
    type_display: string;
    number_stats?: {
        min_value?: string;
        max_value?: string;
        mean?: string;
        median?: string;
        stdev?: string;
    };
    string_stats?: {
        num_empty?: number;
        num_unique?: number;
    };
    boolean_stats?: {
        true_count?: number;
        false_count?: number;
    };
    date_stats?: {
        num_unique?: number;
        min_date?: string;
        mean_date?: string;
        median_date?: string;
        max_date?: string;
    };
    datetime_stats?: {
        num_unique?: number;
        min_date?: string;
        mean_date?: string;
        median_date?: string;
        max_date?: string;
        timezone?: string;
    };
    other_stats?: {
        num_unique?: number;
    };
}

interface ColumnQuantileValue {
    q: number;
    value: string;
    exact: boolean;
}

interface ColumnHistogram {
    bin_edges: string[];
    bin_counts: number[];
    quantiles?: ColumnQuantileValue[];
}

interface ColumnFrequencyTable {
    values: ColumnValue[];
    counts: number[];
    other_count?: number;
}

interface ColumnProfileResult {
    null_count?: number;
    summary_stats?: ColumnSummaryStats;
    small_histogram?: ColumnHistogram;
    large_histogram?: ColumnHistogram;
    small_frequency_table?: ColumnFrequencyTable;
    large_frequency_table?: ColumnFrequencyTable;
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
const columnVisibilityInvert = document.getElementById('invert-column-visibility') as HTMLButtonElement;
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
const statsPanelResizer = document.getElementById('stats-panel-resizer') as HTMLDivElement;
const statsColumnSelect = document.getElementById('stats-column') as HTMLSelectElement;
const statsResults = document.getElementById('stats-results') as HTMLDivElement;
const statsMessage = document.getElementById('stats-message') as HTMLDivElement;
const statsSections = document.getElementById('stats-sections') as HTMLDivElement;
const statsOverviewTable = document.getElementById('stats-overview-table') as HTMLTableElement;
const statsSummaryTable = document.getElementById('stats-summary-table') as HTMLTableElement;
const statsQuantilesTable = document.getElementById('stats-quantiles-table') as HTMLTableElement;
const histogramContainer = document.getElementById('histogram-chart') as HTMLDivElement;
const histogramBinsSlider = document.getElementById('histogram-bins') as HTMLInputElement;
const histogramBinsInput = document.getElementById('histogram-bins-input') as HTMLInputElement;
const histogramMethodSelect = document.getElementById('histogram-method') as HTMLSelectElement;
const frequencyContainer = document.getElementById('frequency-chart') as HTMLDivElement;
const frequencyLimitSlider = document.getElementById('frequency-limit') as HTMLInputElement;
const frequencyLimitInput = document.getElementById('frequency-limit-input') as HTMLInputElement;
const frequencyFootnote = document.getElementById('frequency-footnote') as HTMLDivElement;
const codePreview = document.getElementById('code-preview') as HTMLPreElement;
const tableHeader = document.getElementById('table-header') as HTMLDivElement;
const tableBody = document.getElementById('table-body') as HTMLDivElement;

const ROW_HEIGHT = 26;
const ROW_BLOCK_SIZE = 200;
const COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 80;
const ROW_LABEL_WIDTH = 72;
const UNNAMED_COLUMN_PREFIX = 'Unnamed';
const DEFAULT_HISTOGRAM_BINS = 20;
const DEFAULT_FREQUENCY_LIMIT = 10;
const HISTOGRAM_BINS_MIN = 5;
const HISTOGRAM_BINS_MAX = 200;
const FREQUENCY_LIMIT_MIN = 5;
const FREQUENCY_LIMIT_MAX = 50;
const SMALL_HISTOGRAM_MAX_BINS = 80;
const SMALL_FREQUENCY_MAX_LIMIT = 12;
const STATS_REFRESH_DEBOUNCE_MS = 300;
const STATS_PANEL_MIN_WIDTH = 280;
const STATS_PANEL_MAX_WIDTH = 600;

const rowCache = new Map<number, string[]>();
const rowLabelCache = new Map<number, string>();
const loadedBlocks = new Set<number>();
const loadingBlocks = new Set<number>();
const hiddenColumnIndices = new Set<number>();
const columnWidths = new Map<number, number>();

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
let frequencyChart: echarts.ECharts | null = null;
let rowFilters: RowFilter[] = [];
let editingRowFilterIndex: number | null = null;
let rowFilterSupport: SetRowFiltersFeatures | undefined;
let columnFilterSupport: SearchSchemaFeatures | undefined;
let setColumnFilterSupport: SetColumnFiltersFeatures | undefined;
let columnFilterMatches: number[] | null = null;
let columnMenuColumnIndex: number | null = null;
let columnVisibilityDebounceId: number | undefined;
let statsRefreshDebounceId: number | undefined;
let activeStatsColumnIndex: number | null = null;
let statsPanelResizeState: { startX: number; startWidth: number } | null = null;
let pendingRows: RowsMessage[] = [];
let activeColumnResize: { columnIndex: number; startX: number; startWidth: number } | null = null;
let ignoreHeaderSortClick = false;

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

columnVisibilityInvert.addEventListener('click', () => {
    invertColumnVisibility();
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
    openStatsPanel({ toggle: true });
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

statsColumnSelect.addEventListener('change', () => {
    const columnIndex = parseInt(statsColumnSelect.value, 10);
    if (Number.isNaN(columnIndex)) {
        activeStatsColumnIndex = null;
        setStatsMessage('Select a column to view statistics.', 'empty');
        clearStatsContent();
        return;
    }
    activeStatsColumnIndex = columnIndex;
    requestColumnProfiles('column-change');
});

histogramBinsSlider.addEventListener('input', () => {
    syncHistogramBins('slider');
});

histogramBinsInput.addEventListener('input', () => {
    syncHistogramBins('input');
});

histogramMethodSelect.addEventListener('change', () => {
    scheduleStatsRefresh('histogram-method');
});

frequencyLimitSlider.addEventListener('input', () => {
    syncFrequencyLimit('slider');
});

frequencyLimitInput.addEventListener('input', () => {
    syncFrequencyLimit('input');
});

statsPanelResizer.addEventListener('mousedown', (event) => {
    statsPanelResizeState = {
        startX: event.clientX,
        startWidth: statsPanel.getBoundingClientRect().width,
    };
    document.body.classList.add('panel-resizing');
    event.preventDefault();
});

document.querySelectorAll('.stats-section.collapsible .section-header').forEach((element) => {
    element.addEventListener('click', () => {
        const header = element as HTMLElement;
        const parent = header.closest('.stats-section.collapsible');
        if (!parent) {
            return;
        }
        parent.classList.toggle('is-collapsed');
        requestAnimationFrame(() => {
            histogramChart?.resize();
            frequencyChart?.resize();
        });
    });
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
    histogramChart?.resize();
    frequencyChart?.resize();
});

document.addEventListener('mousemove', (event) => {
    handleStatsPanelResize(event);
});

document.addEventListener('mouseup', () => {
    finishStatsPanelResize();
});

function openStatsPanel(options: { columnIndex?: number; toggle?: boolean } = {}): void {
    const { columnIndex, toggle = false } = options;
    const shouldOpen = toggle ? !statsPanel.classList.contains('open') : true;
    columnVisibilityPanel.classList.remove('open');
    codeModal.classList.remove('open');
    rowFilterPanel.classList.remove('open');
    if (!shouldOpen) {
        statsPanel.classList.remove('open');
        return;
    }

    statsPanel.classList.add('open');
    populateStatsColumnSelect();
    if (columnIndex !== undefined) {
        statsColumnSelect.value = String(columnIndex);
    }
    const resolvedIndex = parseInt(statsColumnSelect.value, 10);
    if (!Number.isNaN(resolvedIndex)) {
        activeStatsColumnIndex = resolvedIndex;
        requestColumnProfiles('panel-open');
    } else {
        activeStatsColumnIndex = null;
        setStatsMessage('Select a column to view statistics.', 'empty');
        clearStatsContent();
    }
    requestAnimationFrame(() => {
        histogramChart?.resize();
        frequencyChart?.resize();
    });
}

function populateStatsColumnSelect() {
    const previousValue = statsColumnSelect.value;
    statsColumnSelect.innerHTML = '<option value="">Choose column...</option>';
    schema.forEach((col) => {
        const option = document.createElement('option');
        option.value = String(col.column_index);
        option.textContent = getColumnLabel(col);
        statsColumnSelect.appendChild(option);
    });
    if (previousValue) {
        statsColumnSelect.value = previousValue;
    }
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

function invertColumnVisibility(): void {
    if (!fullSchema.length) {
        return;
    }

    const baseSchema = columnFilterMatches ? resolveSchemaMatches(columnFilterMatches) : fullSchema;
    if (!baseSchema.length) {
        return;
    }

    log('Inverting column visibility', { matches: baseSchema.length });
    const nextHidden = new Set(hiddenColumnIndices);
    for (const column of baseSchema) {
        const index = column.column_index;
        if (nextHidden.has(index)) {
            nextHidden.delete(index);
        } else {
            nextHidden.add(index);
        }
    }

    if (nextHidden.size >= fullSchema.length) {
        nextHidden.delete(fullSchema[0].column_index);
    }

    hiddenColumnIndices.clear();
    for (const index of nextHidden) {
        hiddenColumnIndices.add(index);
    }
    applySchemaUpdate(resolveVisibleSchema());
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
        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
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
    columnVisibilityPanel.classList.remove('open');
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

type StatsMessageState = 'loading' | 'empty' | 'error';

type StatsRow = {
    label: string;
    value: string;
};

function setStatsMessage(message: string, state: StatsMessageState): void {
    statsMessage.textContent = message;
    statsMessage.classList.remove('is-hidden', 'is-loading', 'is-error');
    statsMessage.classList.toggle('is-loading', state === 'loading');
    statsMessage.classList.toggle('is-error', state === 'error');
    statsSections.classList.add('is-hidden');
    setStatsControlsEnabled(state !== 'empty');
}

function showStatsSections(): void {
    statsMessage.classList.add('is-hidden');
    statsSections.classList.remove('is-hidden');
    setStatsControlsEnabled(true);
}

function clearStatsContent(): void {
    statsOverviewTable.innerHTML = '';
    statsSummaryTable.innerHTML = '';
    statsQuantilesTable.innerHTML = '';
    frequencyFootnote.textContent = '';
    clearHistogram();
    clearFrequency();
    statsResults.scrollTop = 0;
}

function setStatsControlsEnabled(enabled: boolean): void {
    histogramBinsSlider.disabled = !enabled;
    histogramBinsInput.disabled = !enabled;
    histogramMethodSelect.disabled = !enabled;
    frequencyLimitSlider.disabled = !enabled;
    frequencyLimitInput.disabled = !enabled;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(Math.max(Math.round(value), min), max);
}

function syncHistogramBins(source: 'slider' | 'input'): void {
    const rawValue = source === 'slider' ? parseInt(histogramBinsSlider.value, 10) : parseInt(histogramBinsInput.value, 10);
    const nextValue = clampNumber(rawValue, HISTOGRAM_BINS_MIN, HISTOGRAM_BINS_MAX, DEFAULT_HISTOGRAM_BINS);
    histogramBinsSlider.value = String(nextValue);
    histogramBinsInput.value = String(nextValue);
    if (histogramMethodSelect.value !== 'fixed') {
        const previousMethod = histogramMethodSelect.value;
        histogramMethodSelect.value = 'fixed';
        log('Histogram method forced to fixed for bins update', { previousMethod });
    }
    log('Histogram bins updated', { value: nextValue, source });
    scheduleStatsRefresh('histogram-bins');
}

function syncFrequencyLimit(source: 'slider' | 'input'): void {
    const rawValue = source === 'slider' ? parseInt(frequencyLimitSlider.value, 10) : parseInt(frequencyLimitInput.value, 10);
    const nextValue = clampNumber(rawValue, FREQUENCY_LIMIT_MIN, FREQUENCY_LIMIT_MAX, DEFAULT_FREQUENCY_LIMIT);
    frequencyLimitSlider.value = String(nextValue);
    frequencyLimitInput.value = String(nextValue);
    log('Frequency limit updated', { value: nextValue, source });
    scheduleStatsRefresh('frequency-limit');
}

function scheduleStatsRefresh(reason: string): void {
    if (activeStatsColumnIndex === null) {
        return;
    }
    if (statsRefreshDebounceId !== undefined) {
        window.clearTimeout(statsRefreshDebounceId);
    }
    statsRefreshDebounceId = window.setTimeout(() => {
        requestColumnProfiles(reason);
    }, STATS_REFRESH_DEBOUNCE_MS);
}

function requestColumnProfiles(reason: string): void {
    if (activeStatsColumnIndex === null) {
        return;
    }
    const histogramBins = clampNumber(parseInt(histogramBinsInput.value, 10), HISTOGRAM_BINS_MIN, HISTOGRAM_BINS_MAX, DEFAULT_HISTOGRAM_BINS);
    const frequencyLimit = clampNumber(
        parseInt(frequencyLimitInput.value, 10),
        FREQUENCY_LIMIT_MIN,
        FREQUENCY_LIMIT_MAX,
        DEFAULT_FREQUENCY_LIMIT
    );
    const histogramMethod = histogramMethodSelect.value;
    const histogramProfile = histogramBins > SMALL_HISTOGRAM_MAX_BINS ? 'large_histogram' : 'small_histogram';
    const frequencyProfile = frequencyLimit > SMALL_FREQUENCY_MAX_LIMIT ? 'large_frequency_table' : 'small_frequency_table';
    const profileTypes = ['null_count', 'summary_stats', histogramProfile, frequencyProfile];
    const histogramParams = {
        method: histogramMethod,
        num_bins: histogramBins,
        quantiles: [0.25, 0.5, 0.75],
    };
    const frequencyParams = {
        limit: frequencyLimit,
    };

    log('Requesting column profiles', {
        columnIndex: activeStatsColumnIndex,
        profileTypes,
        histogramParams,
        frequencyParams,
        reason,
    });

    setStatsMessage('Loading statistics...', 'loading');
    clearStatsContent();
    vscode.postMessage({
        type: 'getColumnProfiles',
        columnIndex: activeStatsColumnIndex,
        profileTypes,
        histogramParams,
        frequencyParams,
    });
}

function setStatsPanelWidth(width: number): void {
    statsPanel.style.setProperty('--stats-panel-width', `${width}px`);
    requestAnimationFrame(() => {
        histogramChart?.resize();
        frequencyChart?.resize();
    });
}

function handleStatsPanelResize(event: MouseEvent): void {
    if (!statsPanelResizeState) {
        return;
    }
    const delta = statsPanelResizeState.startX - event.clientX;
    const nextWidth = clampNumber(
        statsPanelResizeState.startWidth + delta,
        STATS_PANEL_MIN_WIDTH,
        STATS_PANEL_MAX_WIDTH,
        statsPanelResizeState.startWidth
    );
    setStatsPanelWidth(nextWidth);
}

function finishStatsPanelResize(): void {
    if (!statsPanelResizeState) {
        return;
    }
    statsPanelResizeState = null;
    document.body.classList.remove('panel-resizing');
}

function setStatsTableRows(table: HTMLTableElement, rows: StatsRow[], emptyMessage: string): void {
    table.innerHTML = '';
    if (rows.length === 0) {
        const emptyRow = table.insertRow();
        const cell = emptyRow.insertCell();
        cell.colSpan = 2;
        cell.textContent = emptyMessage;
        cell.classList.add('stats-empty');
        return;
    }
    rows.forEach((row) => {
        const tableRow = table.insertRow();
        const labelCell = tableRow.insertCell();
        const valueCell = tableRow.insertCell();
        labelCell.textContent = row.label;
        valueCell.textContent = row.value;
    });
}

function formatStatValue(value: string | number | undefined | null): string {
    if (value === undefined || value === null || value === '') {
        return '-';
    }
    return String(value);
}

function formatQuantileValue(quantile: ColumnQuantileValue): string {
    const prefix = quantile.exact ? '' : '~';
    return `${prefix}${quantile.value}`;
}

function formatQuantileLabel(q: number): string {
    if (q === 0.25) {
        return 'Q1 (25%)';
    }
    if (q === 0.5) {
        return 'Median (50%)';
    }
    if (q === 0.75) {
        return 'Q3 (75%)';
    }
    const percentage = Math.round(q * 100);
    return `${percentage}%`;
}

function buildSummaryRows(summaryStats: ColumnSummaryStats | undefined): StatsRow[] {
    if (!summaryStats) {
        return [];
    }
    if (summaryStats.number_stats) {
        return [
            { label: 'Minimum', value: formatStatValue(summaryStats.number_stats.min_value) },
            { label: 'Maximum', value: formatStatValue(summaryStats.number_stats.max_value) },
            { label: 'Mean', value: formatStatValue(summaryStats.number_stats.mean) },
            { label: 'Median', value: formatStatValue(summaryStats.number_stats.median) },
            { label: 'Std Dev', value: formatStatValue(summaryStats.number_stats.stdev) },
        ];
    }
    if (summaryStats.string_stats) {
        return [
            { label: 'Empty Count', value: formatStatValue(summaryStats.string_stats.num_empty) },
            { label: 'Unique Count', value: formatStatValue(summaryStats.string_stats.num_unique) },
        ];
    }
    if (summaryStats.boolean_stats) {
        return [
            { label: 'True Count', value: formatStatValue(summaryStats.boolean_stats.true_count) },
            { label: 'False Count', value: formatStatValue(summaryStats.boolean_stats.false_count) },
        ];
    }
    if (summaryStats.date_stats) {
        return [
            { label: 'Minimum', value: formatStatValue(summaryStats.date_stats.min_date) },
            { label: 'Mean', value: formatStatValue(summaryStats.date_stats.mean_date) },
            { label: 'Median', value: formatStatValue(summaryStats.date_stats.median_date) },
            { label: 'Maximum', value: formatStatValue(summaryStats.date_stats.max_date) },
            { label: 'Unique Count', value: formatStatValue(summaryStats.date_stats.num_unique) },
        ];
    }
    if (summaryStats.datetime_stats) {
        return [
            { label: 'Minimum', value: formatStatValue(summaryStats.datetime_stats.min_date) },
            { label: 'Mean', value: formatStatValue(summaryStats.datetime_stats.mean_date) },
            { label: 'Median', value: formatStatValue(summaryStats.datetime_stats.median_date) },
            { label: 'Maximum', value: formatStatValue(summaryStats.datetime_stats.max_date) },
            { label: 'Unique Count', value: formatStatValue(summaryStats.datetime_stats.num_unique) },
            { label: 'Timezone', value: formatStatValue(summaryStats.datetime_stats.timezone) },
        ];
    }
    if (summaryStats.other_stats) {
        return [{ label: 'Unique Count', value: formatStatValue(summaryStats.other_stats.num_unique) }];
    }
    return [];
}

function initializeStatsDefaults(): void {
    histogramBinsSlider.value = String(DEFAULT_HISTOGRAM_BINS);
    histogramBinsInput.value = String(DEFAULT_HISTOGRAM_BINS);
    histogramMethodSelect.value = 'freedman_diaconis';
    frequencyLimitSlider.value = String(DEFAULT_FREQUENCY_LIMIT);
    frequencyLimitInput.value = String(DEFAULT_FREQUENCY_LIMIT);
    setStatsControlsEnabled(false);
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

initializeStatsDefaults();
setStatsMessage('Select a column to view statistics.', 'empty');
clearStatsContent();

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
        if (activeStatsColumnIndex !== null) {
            const stillExists = schema.some((column) => column.column_index === activeStatsColumnIndex);
            if (stillExists) {
                statsColumnSelect.value = String(activeStatsColumnIndex);
                requestColumnProfiles('schema-update');
            } else {
                activeStatsColumnIndex = null;
                statsColumnSelect.value = '';
                setStatsMessage('Select a column to view statistics.', 'empty');
                clearStatsContent();
            }
        }
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

function ensureFrequencyChart(): echarts.ECharts {
    if (!frequencyChart) {
        frequencyChart = echarts.init(frequencyContainer);
    }
    return frequencyChart;
}

function clearFrequency(): void {
    frequencyContainer.style.display = 'none';
    frequencyFootnote.textContent = '';
    frequencyFootnote.style.display = 'none';
    frequencyChart?.clear();
}

function renderHistogram(histogram: ColumnHistogram | undefined, columnLabel: string): void {
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
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
        },
        grid: { left: 44, right: 18, top: 10, bottom: 46 },
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

function renderFrequencyChart(frequency: ColumnFrequencyTable | undefined): void {
    if (!frequency) {
        clearFrequency();
        return;
    }
    const values = frequency.values ?? [];
    const counts = frequency.counts ?? [];
    if (values.length === 0 || counts.length === 0) {
        clearFrequency();
        return;
    }

    log('Rendering frequency chart', { values: values.length });

    const displayValues = values.map((value) => String(value));
    const reversedValues = [...displayValues].reverse();
    const reversedCounts = [...counts].reverse();
    const chartHeight = Math.max(160, reversedValues.length * 18 + 40);
    frequencyContainer.style.display = 'block';
    frequencyContainer.style.height = `${chartHeight}px`;
    const chart = ensureFrequencyChart();
    const chartColor = getComputedStyle(document.body).getPropertyValue('--vscode-charts-blue').trim() || '#4e79a7';

    chart.setOption({
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
        },
        grid: { left: 100, right: 30, top: 10, bottom: 20 },
        xAxis: {
            type: 'value',
            axisLabel: {
                color: getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground').trim() || '#888888',
            },
            splitLine: {
                lineStyle: { color: getComputedStyle(document.body).getPropertyValue('--vscode-editorWidget-border').trim() || '#3c3c3c' },
            },
        },
        yAxis: {
            type: 'category',
            data: reversedValues,
            axisLabel: {
                color: getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground').trim() || '#888888',
                width: 84,
                overflow: 'truncate',
                formatter: (value: string) => (value.length > 18 ? `${value.slice(0, 15)}...` : value),
            },
            axisLine: {
                lineStyle: { color: getComputedStyle(document.body).getPropertyValue('--vscode-editorWidget-border').trim() || '#3c3c3c' },
            },
        },
        series: [
            {
                type: 'bar',
                data: reversedCounts,
                itemStyle: {
                    color: chartColor,
                },
                label: {
                    show: true,
                    position: 'right',
                    fontSize: 10,
                    color: getComputedStyle(document.body).getPropertyValue('--vscode-foreground').trim() || '#cccccc',
                },
            },
        ],
    });
    chart.resize();
}

function handleColumnProfilesResult(columnIndex: number, profiles: ColumnProfileResult[], errorMessage?: string): void {
    if (activeStatsColumnIndex !== null && columnIndex !== activeStatsColumnIndex) {
        log('Ignoring stale column profiles', { columnIndex, activeStatsColumnIndex });
        return;
    }
    if (errorMessage) {
        setStatsMessage(`Error: ${errorMessage}`, 'error');
        clearStatsContent();
        return;
    }

    log('Column profiles received', { columnIndex, profiles });
    if (!profiles || profiles.length === 0) {
        setStatsMessage('No statistics available for this column.', 'empty');
        clearStatsContent();
        return;
    }

    const combined: ColumnProfileResult = {};
    profiles.forEach((profile) => {
        if (profile.null_count !== undefined) {
            combined.null_count = profile.null_count;
        }
        if (profile.summary_stats) {
            combined.summary_stats = profile.summary_stats;
        }
        if (profile.small_histogram) {
            combined.small_histogram = profile.small_histogram;
        }
        if (profile.large_histogram) {
            combined.large_histogram = profile.large_histogram;
        }
        if (profile.small_frequency_table) {
            combined.small_frequency_table = profile.small_frequency_table;
        }
        if (profile.large_frequency_table) {
            combined.large_frequency_table = profile.large_frequency_table;
        }
    });

    const column = schema.find((col) => col.column_index === columnIndex);
    const columnLabel = column ? getColumnLabel(column) : `Column ${columnIndex + 1}`;
    const summaryStats = combined.summary_stats;
    const histogram = combined.large_histogram ?? combined.small_histogram;
    const frequency = combined.large_frequency_table ?? combined.small_frequency_table;

    setStatsTableRows(
        statsOverviewTable,
        [
            { label: 'Column', value: columnLabel },
            { label: 'Type', value: formatStatValue(summaryStats?.type_display) },
            { label: 'Null Count', value: formatStatValue(combined.null_count) },
        ],
        'No overview data.'
    );
    setStatsTableRows(statsSummaryTable, buildSummaryRows(summaryStats), 'No summary statistics.');
    const quantileRows = (histogram?.quantiles ?? []).map((quantile) => ({
        label: formatQuantileLabel(quantile.q),
        value: formatQuantileValue(quantile),
    }));
    setStatsTableRows(statsQuantilesTable, quantileRows, 'No quantile data.');

    renderHistogram(histogram, columnLabel);
    renderFrequencyChart(frequency);
    if (!frequency) {
        frequencyFootnote.textContent = 'No frequency data.';
        frequencyFootnote.style.display = 'block';
    } else if (frequency.other_count !== undefined) {
        frequencyFootnote.textContent = `Other values: ${frequency.other_count}`;
        frequencyFootnote.style.display = 'block';
        log('Frequency table contains other values', { otherCount: frequency.other_count });
    } else {
        frequencyFootnote.textContent = '';
        frequencyFootnote.style.display = 'none';
    }

    showStatsSections();
    statsResults.scrollTop = 0;
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
    const previousWidths = new Map(columnWidths);
    columnWidths.clear();
    fullSchema.forEach((column) => {
        const width = previousWidths.get(column.column_index);
        if (width !== undefined) {
            columnWidths.set(column.column_index, width);
        }
    });
    activeSort = resolveSortState(state.sort_keys);
    rowFilters = state.row_filters ?? [];
    rowFilterSupport = state.supported_features?.set_row_filters;
    columnFilterSupport = state.supported_features?.search_schema;
    setColumnFilterSupport = state.supported_features?.set_column_filters;
    columnVisibilityStatus.textContent = '';
    columnVisibilitySearch.value = '';
    if (activeStatsColumnIndex === null) {
        setStatsMessage('Select a column to view statistics.', 'empty');
    } else {
        setStatsMessage('Loading statistics...', 'loading');
    }
    clearStatsContent();
    codePreview.textContent = '';
    renderRowFilterChips();
    updateRowFilterBarVisibility();
    if (columnFilterMatches && !isSetColumnFiltersSupported()) {
        schema = resolveVisibleSchema();
    }
    renderColumnVisibilityList();
    applySchemaUpdate(schema);
    if (pendingRows.length > 0) {
        const queued = [...pendingRows];
        pendingRows = [];
        queued.forEach((rowsMessage) => handleRows(rowsMessage));
        log('Applied pending rows', { count: queued.length });
    }
    log('Data explorer initialized', {
        rows: state.table_shape.num_rows,
        columns: schema.length,
    });
}

function handleRows(message: RowsMessage) {
    if (!state || schema.length === 0) {
        pendingRows.push(message);
        log('Queued rows before init', { startIndex: message.startIndex, endIndex: message.endIndex });
        return;
    }
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
    const totalWidth = updateColumnTemplate();

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

    for (let columnIndex = 0; columnIndex < schema.length; columnIndex += 1) {
        const column = schema[columnIndex];
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
        filterAction.title = 'Filter rows by this column';
        filterAction.setAttribute('aria-label', 'Filter rows by this column');
        const filterIcon = document.createElement('span');
        filterIcon.className = 'codicon codicon-filter';
        filterAction.appendChild(filterIcon);
        filterAction.disabled = !isRowFilterSupported();
        filterAction.addEventListener('click', (event) => {
            event.stopPropagation();
            if (!isRowFilterSupported()) {
                return;
            }
            log('Header filter action', { columnIndex: column.column_index });
            openRowFilterEditor(undefined, undefined, column.column_index);
        });
        const statsAction = document.createElement('button');
        statsAction.className = 'header-action';
        statsAction.title = 'Show statistics for this column';
        statsAction.setAttribute('aria-label', 'Show statistics for this column');
        const statsIcon = document.createElement('span');
        statsIcon.className = 'codicon codicon-graph';
        statsAction.appendChild(statsIcon);
        statsAction.addEventListener('click', (event) => {
            event.stopPropagation();
            log('Header stats action', { columnIndex: column.column_index });
            openStatsPanel({ columnIndex: column.column_index });
        });
        const hideAction = document.createElement('button');
        hideAction.className = 'header-action';
        hideAction.title = 'Hide this column';
        hideAction.setAttribute('aria-label', 'Hide this column');
        const hideIcon = document.createElement('span');
        hideIcon.className = 'codicon codicon-eye-closed';
        hideAction.appendChild(hideIcon);
        hideAction.disabled = schema.length <= 1;
        hideAction.addEventListener('click', (event) => {
            event.stopPropagation();
            if (schema.length <= 1) {
                return;
            }
            hideColumn(column.column_index);
        });
        const actionSeparator = document.createElement('span');
        actionSeparator.className = 'header-action-separator';
        actionSeparator.textContent = '|';
        const actionSeparator2 = document.createElement('span');
        actionSeparator2.className = 'header-action-separator';
        actionSeparator2.textContent = '|';
        actions.appendChild(filterAction);
        actions.appendChild(actionSeparator);
        actions.appendChild(statsAction);
        actions.appendChild(actionSeparator2);
        actions.appendChild(hideAction);
        content.appendChild(actions);
        cell.appendChild(content);
        if (columnIndex < columnCount - 1) {
            const resizer = document.createElement('div');
            resizer.className = 'column-resizer';
            resizer.addEventListener('mousedown', (event) => startColumnResize(event, column.column_index));
            resizer.addEventListener('click', (event) => event.stopPropagation());
            cell.appendChild(resizer);
        }
        cell.dataset.columnIndex = String(column.column_index);
        if (sortSupported) {
            cell.classList.add('sortable');
            cell.addEventListener('click', (event) => {
                if (ignoreHeaderSortClick) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                handleHeaderSort(column.column_index);
            });
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

function resolveColumnWidths(): number[] {
    return schema.map((column) => {
        const existing = columnWidths.get(column.column_index);
        if (existing !== undefined) {
            return existing;
        }
        columnWidths.set(column.column_index, COLUMN_WIDTH);
        return COLUMN_WIDTH;
    });
}

function updateColumnTemplate(): number {
    const widths = resolveColumnWidths();
    const columnWidthsText = widths.map((width) => `${width}px`).join(' ');
    columnTemplate = columnWidthsText
        ? `${ROW_LABEL_WIDTH}px ${columnWidthsText}`
        : `${ROW_LABEL_WIDTH}px`;
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);
    return ROW_LABEL_WIDTH + totalWidth;
}

function applyColumnLayout(): void {
    const totalWidth = updateColumnTemplate();
    if (headerRowElement) {
        headerRowElement.style.gridTemplateColumns = columnTemplate;
        headerRowElement.style.width = `${totalWidth}px`;
    }
    if (bodyInner) {
        bodyInner.style.width = `${totalWidth}px`;
        bodyInner.querySelectorAll<HTMLDivElement>('.table-row').forEach((row) => {
            row.style.gridTemplateColumns = columnTemplate;
        });
    }
}

function startColumnResize(event: MouseEvent, columnIndex: number): void {
    event.preventDefault();
    event.stopPropagation();
    const startWidth = columnWidths.get(columnIndex) ?? COLUMN_WIDTH;
    activeColumnResize = {
        columnIndex,
        startX: event.clientX,
        startWidth,
    };
    document.body.classList.add('column-resizing');
    log('Column resize started', { columnIndex, startWidth });
    window.addEventListener('mousemove', handleColumnResizeMove);
    window.addEventListener('mouseup', handleColumnResizeEnd);
}

function handleColumnResizeMove(event: MouseEvent): void {
    if (!activeColumnResize) {
        return;
    }
    const delta = event.clientX - activeColumnResize.startX;
    const nextWidth = Math.max(MIN_COLUMN_WIDTH, activeColumnResize.startWidth + delta);
    const currentWidth = columnWidths.get(activeColumnResize.columnIndex) ?? COLUMN_WIDTH;
    if (currentWidth === nextWidth) {
        return;
    }
    columnWidths.set(activeColumnResize.columnIndex, nextWidth);
    log('Column resize update', { columnIndex: activeColumnResize.columnIndex, width: nextWidth });
    applyColumnLayout();
}

function handleColumnResizeEnd(): void {
    if (!activeColumnResize) {
        return;
    }
    const columnIndex = activeColumnResize.columnIndex;
    const width = columnWidths.get(columnIndex) ?? COLUMN_WIDTH;
    log('Column resize ended', { columnIndex, width });
    activeColumnResize = null;
    document.body.classList.remove('column-resizing');
    window.removeEventListener('mousemove', handleColumnResizeMove);
    window.removeEventListener('mouseup', handleColumnResizeEnd);
    ignoreHeaderSortClick = true;
    window.setTimeout(() => {
        ignoreHeaderSortClick = false;
    }, 0);
}

function renderRows() {
    if (!state || !rowModel || !rowVirtualizer || !bodyInner) {
        return;
    }

    const virtualItems = rowVirtualizer.getVirtualItems();
    const totalHeight = rowVirtualizer.getTotalSize();
    const columnCount = schema.length;
    const totalWidth = updateColumnTemplate();
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
