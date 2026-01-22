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
import * as echarts from 'echarts';

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

interface RowFilter {
    filter_id: string;
    filter_type: string;
    column_schema: ColumnSchema;
    condition: 'and' | 'or';
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

interface SupportedFeatures {
    search_schema?: SearchSchemaFeatures;
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
const filterButton = document.getElementById('filter-btn') as HTMLButtonElement;
const statsButton = document.getElementById('stats-btn') as HTMLButtonElement;
const codeButton = document.getElementById('code-btn') as HTMLButtonElement;
const filterPanel = document.getElementById('filter-panel') as HTMLDivElement;
const statsPanel = document.getElementById('stats-panel') as HTMLDivElement;
const codeModal = document.getElementById('code-modal') as HTMLDivElement;
const filterStatus = document.getElementById('filter-status') as HTMLDivElement;
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

const rowCache = new Map<number, string[]>();
const rowLabelCache = new Map<number, string>();
const loadedBlocks = new Set<number>();
const loadingBlocks = new Set<number>();

let state: BackendState | undefined;
let schema: ColumnSchema[] = [];
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

function log(message: string, payload?: unknown): void {
    if (payload !== undefined) {
        console.log(`[dataExplorer] ${message}`, payload);
    } else {
        console.log(`[dataExplorer] ${message}`);
    }
}

refreshButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
});

filterButton.addEventListener('click', () => {
    filterPanel.classList.toggle('open');
    statsPanel.classList.remove('open');
    codeModal.classList.remove('open');
});

statsButton.addEventListener('click', () => {
    statsPanel.classList.toggle('open');
    filterPanel.classList.remove('open');
    codeModal.classList.remove('open');
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
    filterPanel.classList.remove('open');
    statsPanel.classList.remove('open');
});

document.getElementById('close-filter')?.addEventListener('click', () => {
    filterPanel.classList.remove('open');
});

document.getElementById('close-stats')?.addEventListener('click', () => {
    statsPanel.classList.remove('open');
});

document.getElementById('close-code')?.addEventListener('click', () => {
    codeModal.classList.remove('open');
});

document.getElementById('apply-filter')?.addEventListener('click', () => {
    applyColumnFilter();
});

document.getElementById('clear-filter')?.addEventListener('click', () => {
    (document.getElementById('column-search') as HTMLInputElement).value = '';
    (document.getElementById('sort-order') as HTMLSelectElement).value = 'original';
    applyColumnFilter();
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

function populateStatsColumnSelect() {
    const select = document.getElementById('stats-column') as HTMLSelectElement;
    select.innerHTML = '<option value="">Choose column...</option>';
    schema.forEach((col) => {
        const option = document.createElement('option');
        option.value = String(col.column_index);
        option.textContent = col.column_name || `Col${col.column_index + 1}`;
        select.appendChild(option);
    });
}

function applyColumnFilter() {
    const searchTerm = (document.getElementById('column-search') as HTMLInputElement).value;
    const sortOrder = (document.getElementById('sort-order') as HTMLSelectElement).value;

    const filters: ColumnFilter[] = [];
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

    filterStatus.textContent = 'Searching...';
    vscode.postMessage({ type: 'searchSchema', filters, sortOrder });
    vscode.postMessage({ type: 'setColumnFilters', filters });
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
    filterPanel.classList.remove('open');
    filterStatus.textContent = `Found ${matches.length} matching columns.`;
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
    const columnLabel = schema.find((col) => col.column_index === columnIndex)?.column_name || `Column ${columnIndex + 1}`;
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
    schema = message.schema ?? [];
    rowCache.clear();
    rowLabelCache.clear();
    loadedBlocks.clear();
    loadingBlocks.clear();
    activeSort = resolveSortState(state.sort_keys);
    filterStatus.textContent = '';
    statsText.textContent = '';
    clearHistogram();
    codePreview.textContent = '';
    (document.getElementById('column-search') as HTMLInputElement).value = '';
    (document.getElementById('sort-order') as HTMLSelectElement).value = 'original';
    renderHeader();
    setupTable();
    setupVirtualizer();
    renderRows();
    requestInitialBlock();
    requestVisibleBlocks();
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

    renderRows();
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
            header: column.column_label ?? column.column_name,
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
        const headerLabel = column.column_label || column.column_name || `Col${column.column_index + 1}`;
        cell.title = headerLabel;
        const label = document.createElement('span');
        label.className = 'header-label';
        label.textContent = headerLabel;
        cell.appendChild(label);
        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        cell.appendChild(indicator);
        cell.dataset.columnIndex = String(column.column_index);
        if (sortSupported) {
            cell.classList.add('sortable');
            cell.addEventListener('click', () => handleHeaderSort(column.column_index));
        }
        headerRow.appendChild(cell);
    }

    tableHeader.appendChild(headerRow);
    updateHeaderScroll(tableBody.scrollLeft);
    updateHeaderSortIndicators();
    tableTitle.textContent = state.display_name || 'Data Explorer';
    const { num_rows, num_columns } = state.table_shape;
    const { num_rows: rawRows, num_columns: rawColumns } = state.table_unfiltered_shape;
    const filteredText = num_rows !== rawRows || num_columns !== rawColumns
        ? ` (${rawRows}x${rawColumns} raw)`
        : '';
    tableMeta.textContent = `${num_rows}x${num_columns}${filteredText}`;
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
