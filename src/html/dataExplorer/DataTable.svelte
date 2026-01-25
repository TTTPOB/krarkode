<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import type {
        ColumnSchema,
        SortState,
        BackendState,
    } from './types';
    import type { VirtualRow } from './hooks/useVirtualizer';
    import {
        ROW_HEIGHT,
        ROW_LABEL_WIDTH,
        COLUMN_WIDTH,
        MIN_COLUMN_WIDTH,
    } from './types';

    // Props
    export let state: BackendState | null = null;
    export let schema: ColumnSchema[] = [];
    export let columnWidths: Map<number, number> = new Map();
    export let activeSort: SortState | null = null;
    export let sortSupported: boolean = true;
    export let rowFilterSupported: boolean = true;
    export let virtualRows: VirtualRow[] = [];
    export let virtualizerTotalHeight: number = 0;
    export let rowCacheVersion: number = 0;
    export let headerScrollLeft: number = 0;
    export let getCellValue: (rowIndex: number, columnIndex: number, version?: number) => string;
    export let getRowLabel: (rowIndex: number, version?: number) => string;
    export let getColumnLabel: (column: ColumnSchema) => string;

    // Bound elements for parent access
    export let tableBodyEl: HTMLDivElement | undefined = undefined;
    export let tableHeaderEl: HTMLDivElement | undefined = undefined;
    export let bodyInnerEl: HTMLDivElement | undefined = undefined;

    const dispatch = createEventDispatcher<{
        sort: { columnIndex: number };
        columnMenu: { event: MouseEvent; columnIndex: number };
        openRowFilter: { columnIndex: number };
        openStats: { columnIndex: number };
        hideColumn: { columnIndex: number };
        scroll: void;
        startColumnResize: { event: MouseEvent; columnIndex: number };
    }>();

    // Local state
    let ignoreHeaderSortClick = false;

    // Computed
    $: resolvedColumnWidths = schema.map((column) => resolveColumnWidth(columnWidths.get(column.column_index)));
    $: columnTemplate = resolvedColumnWidths.length > 0
        ? `${ROW_LABEL_WIDTH}px ${resolvedColumnWidths.map((width) => `${width}px`).join(' ')}`
        : `${ROW_LABEL_WIDTH}px`;
    $: totalWidth = ROW_LABEL_WIDTH + resolvedColumnWidths.reduce((sum, width) => sum + width, 0);

    function resolveColumnWidth(width: number | undefined): number {
        if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
            return COLUMN_WIDTH;
        }
        return Math.max(MIN_COLUMN_WIDTH, Math.round(width));
    }

    function getSortIndicator(columnIndex: number): string {
        if (!activeSort || activeSort.columnIndex !== columnIndex) {
            return '';
        }
        return activeSort.direction === 'asc' ? '^' : 'v';
    }

    function isSpecialValue(value: string): boolean {
        return ['NULL', 'NA', 'NaN', 'NaT', 'None', 'Inf', '-Inf', 'UNKNOWN'].includes(value);
    }

    function handleHeaderSort(event: Event, columnIndex: number): void {
        if (ignoreHeaderSortClick) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (!sortSupported) {
            return;
        }
        dispatch('sort', { columnIndex });
    }

    function handleTableScroll(): void {
        dispatch('scroll');
    }

    function handleColumnResizeStart(event: MouseEvent, columnIndex: number): void {
        event.preventDefault();
        event.stopPropagation();
        dispatch('startColumnResize', { event, columnIndex });
    }

    // Called by parent when column resize ends to prevent accidental sort clicks
    export function setIgnoreHeaderSortClick(ignore: boolean): void {
        ignoreHeaderSortClick = ignore;
    }

    // Update body inner width when total width changes
    $: if (bodyInnerEl) {
        bodyInnerEl.style.width = `${totalWidth}px`;
    }
</script>

<div class="table-container" role="table" aria-label="Data explorer table">
    <div class="table-header" id="table-header" role="rowgroup" bind:this={tableHeaderEl}>
        <div class="table-header-bar" role="heading" aria-level="2">Columns</div>
        <div
            class="table-row header-row"
            role="row"
            style:grid-template-columns={columnTemplate}
            style:width={`${totalWidth}px`}
            style:transform={`translateX(${-headerScrollLeft}px)`}
        >
            <div class="table-cell row-label" role="columnheader" aria-label="Row label">
                {state?.has_row_labels ? '#' : 'Row'}
            </div>
            {#each schema as column, columnIndex}
                <div
                    class="table-cell header-cell"
                    class:sortable={sortSupported}
                    class:sorted-asc={activeSort?.columnIndex === column.column_index && activeSort.direction === 'asc'}
                    class:sorted-desc={activeSort?.columnIndex === column.column_index && activeSort.direction === 'desc'}
                    data-column-index={column.column_index}
                    role="columnheader"
                    aria-sort={activeSort?.columnIndex === column.column_index
                        ? activeSort.direction === 'asc' ? 'ascending' : 'descending'
                        : 'none'}
                    aria-label={getColumnLabel(column)}
                    tabindex={sortSupported ? 0 : -1}
                    on:click={(event) => sortSupported && handleHeaderSort(event, column.column_index)}
                    on:keydown={(event) => {
                        if (!sortSupported) {
                            return;
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleHeaderSort(event, column.column_index);
                        }
                    }}
                    on:contextmenu|preventDefault={(event) => dispatch('columnMenu', { event, columnIndex: column.column_index })}
                >
                    <div class="header-content">
                        <div class="header-label-row">
                            <span class="header-label" title={getColumnLabel(column)}>{getColumnLabel(column)}</span>
                            <span class="sort-indicator">{getSortIndicator(column.column_index)}</span>
                        </div>
                        <div class="header-actions">
                            <button
                                class="header-action"
                                title="Filter rows by this column"
                                aria-label="Filter rows by this column"
                                disabled={!rowFilterSupported}
                                on:click|stopPropagation={() => dispatch('openRowFilter', { columnIndex: column.column_index })}
                            >
                                <span class="codicon codicon-filter"></span>
                            </button>
                            <span class="header-action-separator">|</span>
                            <button
                                class="header-action"
                                title="Show statistics for this column"
                                aria-label="Show statistics for this column"
                                on:click|stopPropagation={() => dispatch('openStats', { columnIndex: column.column_index })}
                            >
                                <span class="codicon codicon-graph"></span>
                            </button>
                            <span class="header-action-separator">|</span>
                            <button
                                class="header-action"
                                title="Hide this column"
                                aria-label="Hide this column"
                                disabled={schema.length <= 1}
                                on:click|stopPropagation={() => dispatch('hideColumn', { columnIndex: column.column_index })}
                            >
                                <span class="codicon codicon-eye-closed"></span>
                            </button>
                        </div>
                    </div>
                    {#if columnIndex < schema.length - 1}
                        <button
                            type="button"
                            class="column-resizer"
                            aria-label="Resize column"
                            on:mousedown={(event) => handleColumnResizeStart(event, column.column_index)}
                            on:click|stopPropagation
                        ></button>
                    {/if}
                </div>
            {/each}
        </div>
    </div>
    <div class="table-body" id="table-body" role="rowgroup" bind:this={tableBodyEl} on:scroll={handleTableScroll}>
        <div
            class="table-body-inner"
            bind:this={bodyInnerEl}
            style:height={`${virtualizerTotalHeight}px`}
            style:width={`${totalWidth}px`}
        >
            {#each virtualRows as virtualRow (virtualRow.key)}
                <div
                    class="table-row"
                    role="row"
                    style:grid-template-columns={columnTemplate}
                    style:width={`${totalWidth}px`}
                    style:transform={`translateY(${virtualRow.start}px)`}
                >
                    <div class="table-cell row-label" role="rowheader">
                        {getRowLabel(virtualRow.index, rowCacheVersion)}
                    </div>
                    {#each schema as column, columnIndex}
                        {@const value = getCellValue(virtualRow.index, columnIndex, rowCacheVersion)}
                        <div class="table-cell" role="cell" class:cell-special={isSpecialValue(value)}>{value}</div>
                    {/each}
                </div>
            {/each}
        </div>
    </div>
</div>

<style>
    .table-container {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .table-header {
        overflow: hidden;
        border-bottom: 1px solid var(--vscode-editorWidget-border);
        background: var(--vscode-sideBarSectionHeader-background);
    }

    .table-header-bar {
        padding: 4px 8px;
        font-size: 0.75em;
        font-weight: 600;
        color: var(--vscode-descriptionForeground);
        border-bottom: 1px solid var(--vscode-editorWidget-border);
    }

    .table-body {
        flex: 1;
        overflow: auto;
        background: var(--vscode-editor-background);
    }

    .table-body-inner {
        position: relative;
    }

    .table-row {
        position: absolute;
        display: grid;
        align-items: center;
        min-height: 24px;
        border-bottom: 1px solid var(--vscode-editorWidget-border);
        background: var(--vscode-editor-background);
    }

    .table-row.header-row {
        position: relative;
        border-bottom: none;
        font-weight: 600;
        background: var(--vscode-sideBarSectionHeader-background);
    }

    .table-cell {
        padding: 2px 8px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border-right: 1px solid var(--vscode-editorWidget-border);
    }

    .table-cell.header-cell {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 2px;
        position: relative;
        overflow: visible;
    }

    .header-content {
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 100%;
        overflow: hidden;
    }

    .header-label-row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
    }

    .header-label {
        flex: 1;
        min-width: 0;
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        margin-top: 2px;
        padding-top: 2px;
        border-top: 1px solid var(--vscode-editorWidget-border);
    }

    .header-action {
        background: transparent;
        color: var(--vscode-descriptionForeground);
        border: none;
        padding: 1px 4px;
        border-radius: 2px;
        cursor: pointer;
        font-size: 0.7em;
        display: inline-flex;
        align-items: center;
        gap: 0;
    }

    .header-action:hover {
        background: var(--vscode-list-hoverBackground);
        color: var(--vscode-editor-foreground);
    }

    .header-action:disabled {
        cursor: default;
        color: var(--vscode-disabledForeground);
        background: transparent;
    }

    .header-action .codicon {
        font-size: 0.65em;
    }

    .header-action-separator {
        color: var(--vscode-descriptionForeground);
        opacity: 0.6;
        padding: 0 1px;
        font-size: 0.7em;
    }

    .column-resizer {
        position: absolute;
        top: 0;
        right: -4px;
        width: 8px;
        height: 100%;
        cursor: col-resize;
        z-index: 2;
        background: none;
        border: none;
        padding: 0;
        appearance: none;
    }

    .column-resizer::after {
        content: '';
        position: absolute;
        top: 4px;
        bottom: 4px;
        left: 3px;
        width: 2px;
        background: var(--vscode-editorWidget-border);
        opacity: 0.6;
    }

    :global(body.column-resizing) {
        cursor: col-resize;
        user-select: none;
    }

    .table-cell.header-cell.sortable {
        cursor: pointer;
    }

    .table-cell.header-cell.sortable:hover {
        background: var(--vscode-list-hoverBackground);
    }

    .table-cell.header-cell.sorted-asc,
    .table-cell.header-cell.sorted-desc {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
    }

    .sort-indicator {
        font-size: 0.85em;
        opacity: 0.85;
    }

    .table-cell:last-child {
        border-right: none;
    }

    .table-cell.row-label {
        text-align: right;
        color: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family);
    }

    .cell-special {
        color: var(--vscode-debugConsole-warningForeground);
    }
</style>
