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

interface SetSortColumnsFeatures {
    support_status?: SupportStatus;
}

interface SupportedFeatures {
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

refreshButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
});

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
    }
});

vscode.postMessage({ type: 'ready' });

function handleInit(message: InitMessage) {
    state = message.state;
    schema = message.schema ?? [];
    rowCache.clear();
    rowLabelCache.clear();
    loadedBlocks.clear();
    loadingBlocks.clear();
    activeSort = resolveSortState(state.sort_keys);
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
