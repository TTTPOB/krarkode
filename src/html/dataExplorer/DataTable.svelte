<script lang="ts">
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

    const HEADER_ACTION_LABEL_MIN_WIDTH = 180;

    type RenderColumn = {
        column: ColumnSchema;
        schemaIndex: number;
    };

    // Props
    let {
        state = null,
        schema = [],
        renderColumns = [],
        columnWidths = new Map<number, number>(),
        activeSort = null,
        sortSupported = true,
        rowFilterSupported = true,
        virtualRows = [],
        virtualizerTotalHeight = 0,
        rowCacheVersion = 0,
        headerScrollLeft = 0,
        leftSpacerWidth = 0,
        rightSpacerWidth = 0,
        getCellValue,
        getRowLabel,
        getColumnLabel,
        tableBodyEl = $bindable<HTMLDivElement | undefined>(),
        tableHeaderEl = $bindable<HTMLDivElement | undefined>(),
        bodyInnerEl = $bindable<HTMLDivElement | undefined>(),
        onSort,
        onColumnMenu,
        onOpenRowFilter,
        onOpenStats,
        onHideColumn,
        onScroll,
        onStartColumnResize,
    }: {
        state?: BackendState | null;
        schema?: ColumnSchema[];
        renderColumns?: RenderColumn[];
        columnWidths?: Map<number, number>;
        activeSort?: SortState | null;
        sortSupported?: boolean;
        rowFilterSupported?: boolean;
        virtualRows?: VirtualRow[];
        virtualizerTotalHeight?: number;
        rowCacheVersion?: number;
        headerScrollLeft?: number;
        leftSpacerWidth?: number;
        rightSpacerWidth?: number;
        getCellValue: (rowIndex: number, columnIndex: number, version?: number) => string;
        getRowLabel: (rowIndex: number, version?: number) => string;
        getColumnLabel: (column: ColumnSchema) => string;
        tableBodyEl?: HTMLDivElement | undefined;
        tableHeaderEl?: HTMLDivElement | undefined;
        bodyInnerEl?: HTMLDivElement | undefined;
        onSort?: (data: { columnIndex: number }) => void;
        onColumnMenu?: (data: { event: MouseEvent; columnIndex: number }) => void;
        onOpenRowFilter?: (data: { columnIndex: number }) => void;
        onOpenStats?: (data: { columnIndex: number }) => void;
        onHideColumn?: (data: { columnIndex: number }) => void;
        onScroll?: () => void;
        onStartColumnResize?: (data: { event: MouseEvent; columnIndex: number }) => void;
    } = $props();

    // Local state
    let ignoreHeaderSortClick = false;

    // Computed
    const resolvedColumnWidths = $derived(schema.map((column) => resolveColumnWidth(columnWidths.get(column.column_index))));
    const renderColumnWidths = $derived(renderColumns.map((entry) => resolvedColumnWidths[entry.schemaIndex] ?? COLUMN_WIDTH));
    const columnTemplate = $derived(buildColumnTemplate(renderColumnWidths, leftSpacerWidth, rightSpacerWidth));
    const totalWidth = $derived(ROW_LABEL_WIDTH + resolvedColumnWidths.reduce((sum, width) => sum + width, 0));

    function resolveColumnWidth(width: number | undefined): number {
        if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
            return COLUMN_WIDTH;
        }
        return Math.max(MIN_COLUMN_WIDTH, Math.round(width));
    }

    function getSortDirection(columnIndex: number): 'asc' | 'desc' | null {
        if (!activeSort || activeSort.columnIndex !== columnIndex) {
            return null;
        }
        return activeSort.direction;
    }

    function buildColumnTemplate(widths: number[], leftSpacer: number, rightSpacer: number): string {
        const segments = [`${ROW_LABEL_WIDTH}px`];
        if (leftSpacer > 0) {
            segments.push(`${Math.round(leftSpacer)}px`);
        }
        if (widths.length > 0) {
            segments.push(...widths.map((width) => `${width}px`));
        }
        if (rightSpacer > 0) {
            segments.push(`${Math.round(rightSpacer)}px`);
        }
        return segments.join(' ');
    }

    function isSpecialValue(value: string): boolean {
        return ['NULL', 'NA', 'NaN', 'NaT', 'None', 'Inf', '-Inf', 'UNKNOWN'].includes(value);
    }

    function shouldShowHeaderActionLabels(schemaIndex: number): boolean {
        return (resolvedColumnWidths[schemaIndex] ?? COLUMN_WIDTH) >= HEADER_ACTION_LABEL_MIN_WIDTH;
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
        onSort?.({ columnIndex });
    }

    function handleTableScroll(): void {
        onScroll?.();
    }

    function handleColumnResizeStart(event: MouseEvent, columnIndex: number): void {
        event.preventDefault();
        event.stopPropagation();
        onStartColumnResize?.({ event, columnIndex });
    }

    // Called by parent when column resize ends to prevent accidental sort clicks
    export function setIgnoreHeaderSortClick(ignore: boolean): void {
        ignoreHeaderSortClick = ignore;
    }

    // Update body inner width when total width changes
    $effect(() => {
        if (bodyInnerEl) {
            bodyInnerEl.style.width = `${totalWidth}px`;
        }
    });
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
            {#if leftSpacerWidth > 0}
                <div class="table-cell column-spacer" role="presentation" aria-hidden="true"></div>
            {/if}
            {#each renderColumns as entry (entry.column.column_index)}
                {@const column = entry.column}
                {@const showHeaderActionLabels = shouldShowHeaderActionLabels(entry.schemaIndex)}
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
                    onclick={(event) => sortSupported && handleHeaderSort(event, column.column_index)}
                    onkeydown={(event) => {
                        if (!sortSupported) {
                            return;
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleHeaderSort(event, column.column_index);
                        }
                    }}
                    oncontextmenu={(event) => { event.preventDefault(); onColumnMenu?.({ event, columnIndex: column.column_index }); }}
                >
                    <div class="header-content">
                        <div class="header-label-row">
                            <span class="header-label" title={getColumnLabel(column)}>{getColumnLabel(column)}</span>
                            {#if getSortDirection(column.column_index)}
                                <span class="sort-indicator codicon codicon-chevron-{getSortDirection(column.column_index) === 'asc' ? 'up' : 'down'}"></span>
                            {/if}
                        </div>
                        <div
                            class={`header-actions${showHeaderActionLabels ? '' : ' header-actions-compact'}`}
                            aria-label="Column actions"
                        >
                            <button
                                type="button"
                                class={`header-action${showHeaderActionLabels ? '' : ' header-action-icon-only'}`}
                                title="Filter rows by this column"
                                aria-label="Filter rows by this column"
                                disabled={!rowFilterSupported}
                                onclick={(e) => { e.stopPropagation(); onOpenRowFilter?.({ columnIndex: column.column_index }); }}
                            >
                                <span class="codicon codicon-filter"></span>
                                {#if showHeaderActionLabels}
                                    <span class="header-action-label">Filter</span>
                                {/if}
                            </button>
                            <button
                                type="button"
                                class={`header-action${showHeaderActionLabels ? '' : ' header-action-icon-only'}`}
                                title="Show statistics for this column"
                                aria-label="Show statistics for this column"
                                onclick={(e) => { e.stopPropagation(); onOpenStats?.({ columnIndex: column.column_index }); }}
                            >
                                <span class="codicon codicon-graph"></span>
                                {#if showHeaderActionLabels}
                                    <span class="header-action-label">Stats</span>
                                {/if}
                            </button>
                            <button
                                type="button"
                                class={`header-action${showHeaderActionLabels ? '' : ' header-action-icon-only'}`}
                                title="Hide this column"
                                aria-label="Hide this column"
                                disabled={schema.length <= 1}
                                onclick={(e) => { e.stopPropagation(); onHideColumn?.({ columnIndex: column.column_index }); }}
                            >
                                <span class="codicon codicon-eye-closed"></span>
                                {#if showHeaderActionLabels}
                                    <span class="header-action-label">Hide</span>
                                {/if}
                            </button>
                        </div>
                    </div>
                    {#if entry.schemaIndex < schema.length - 1}
                        <button
                            type="button"
                            class="column-resizer"
                            aria-label="Resize column"
                            onmousedown={(event) => handleColumnResizeStart(event, column.column_index)}
                            onclick={(e) => e.stopPropagation()}
                        ></button>
                    {/if}
                </div>
            {/each}
        </div>
    </div>
    <div class="table-body" id="table-body" role="rowgroup" bind:this={tableBodyEl} onscroll={handleTableScroll}>
        {#if state && state.table_shape.num_rows === 0}
            <div class="empty-state">
                <span class="empty-state-text">No rows to display.</span>
            </div>
        {:else}
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
                        {#if leftSpacerWidth > 0}
                            <div class="table-cell column-spacer" role="presentation" aria-hidden="true"></div>
                        {/if}
                        {#each renderColumns as entry (entry.column.column_index)}
                            {@const value = getCellValue(virtualRow.index, entry.schemaIndex, rowCacheVersion)}
                            <div class="table-cell" role="cell" class:cell-special={isSpecialValue(value)}>{value}</div>
                        {/each}
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>

<style>
    .table-container {
        flex: 1;
        min-width: 0;
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

    .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        min-height: 80px;
    }

    .empty-state-text {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        font-size: 0.9em;
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

    .table-cell.column-spacer {
        pointer-events: none;
        background: transparent;
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
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        align-items: stretch;
        gap: 4px;
        margin-top: 2px;
        padding-top: 2px;
        border-top: 1px solid var(--vscode-editorWidget-border);
    }

    .header-actions-compact {
        grid-template-columns: repeat(3, auto);
        justify-content: start;
    }

    .header-action {
        min-width: 0;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: 1px solid transparent;
        padding: 2px 6px;
        border-radius: 999px;
        cursor: pointer;
        font-size: 0.72em;
        font-weight: 600;
        line-height: 1.2;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        white-space: nowrap;
        overflow: hidden;
    }

    .header-action:hover {
        background: var(--vscode-button-secondaryHoverBackground);
        border-color: var(--vscode-focusBorder);
        color: var(--vscode-button-secondaryForeground);
    }

    .header-action:disabled {
        cursor: default;
        color: var(--vscode-disabledForeground);
        background: var(--vscode-button-secondaryBackground);
        border-color: transparent;
        opacity: 0.7;
    }

    .header-action .codicon {
        font-size: 1.1em;
    }

    .header-action-icon-only {
        min-width: 28px;
        padding: 2px 4px;
        gap: 0;
    }

    .header-action-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
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
        font-size: 14px;
        opacity: 0.85;
        display: inline-flex;
        align-items: center;
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
