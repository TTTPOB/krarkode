<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { VirtualizerManager, type VirtualRow } from './hooks/useVirtualizer';
    import { StatsCharts } from './hooks/useStatsCharts';
    import { createMessageHandler } from './hooks/useVscodeMessages';
    import { StatsController } from './hooks/useStatsController';
    import { SchemaController } from './hooks/useSchemaController';
    import { RowFilterController } from './hooks/useRowFilterController';
    import { TableLayoutController } from './hooks/useTableLayoutController';
    import { RowDataController } from './hooks/useRowDataController';
    import { TableInteractionController } from './hooks/useTableInteractionController';
    import { WindowEventsController } from './hooks/useWindowEventsController';
    import { TableSetupController } from './hooks/useTableSetupController';
    import { InitController } from './hooks/useInitController';
    import { PanelToggleController } from './hooks/usePanelToggleController';
    import { ExportController } from './hooks/useExportController';
    import Toolbar from './Toolbar.svelte';
    import RowFilterBar from './RowFilterBar.svelte';
    import CodeModal from './CodeModal.svelte';
    import ColumnVisibilityPanel from './ColumnVisibilityPanel.svelte';
    import RowFilterPanel from './RowFilterPanel.svelte';
    import StatsPanel from './StatsPanel.svelte';
    import DataTable from './DataTable.svelte';
    import { dataStore, uiStore, statsStore } from './stores';
    import {
        type ColumnSchema,
        type RowFilterDraft,
        ROW_HEIGHT,
        ROW_BLOCK_SIZE,
        ROW_PREFETCH_BLOCKS,
        ROW_REQUEST_DEBOUNCE_MS,
        COLUMN_WIDTH,
        MIN_COLUMN_WIDTH,
        ROW_LABEL_WIDTH,
        SIDE_PANEL_MIN_WIDTH,
        SIDE_PANEL_MAX_WIDTH,
        ROW_FILTER_SECTION_MAP,
        getVsCodeApi,
    } from './types';
    import {
        getColumnLabel,
        createRowFilterDraft,
        computeDisplayedColumns,
        resolveColumnWidth,
    } from './utils';

    const vscode = getVsCodeApi();
    const debugEnabled = typeof window !== 'undefined'
        && (window as { __krarkodeDebug?: boolean }).__krarkodeDebug === true;

    const COLUMN_VIRTUALIZATION_THRESHOLD = 80;

    let editingRowFilterIndex: number | null = $state(null);
    let rowFilterError = $state('');
    let rowFilterDraft: RowFilterDraft = $state(createRowFilterDraft());

    // DOM element refs
    let tableBodyEl: HTMLDivElement = $state(undefined!);
    let tableHeaderEl: HTMLDivElement = $state(undefined!);
    let bodyInnerEl: HTMLDivElement = $state(undefined!);
    let dataTableComponent: DataTable = $state(undefined!);
    let columnVisibilityPanelEl: HTMLDivElement = $state(undefined!);
    let rowFilterPanelEl: HTMLDivElement = $state(undefined!);
    let statsPanelEl: HTMLDivElement = $state(undefined!);
    let codeModalEl: HTMLDivElement = $state(undefined!);
    let columnMenuEl: HTMLDivElement = $state(undefined!);
    let statsResultsEl: HTMLDivElement = $state(undefined!);
    let columnsButtonEl: HTMLButtonElement = $state(undefined!);
    let statsButtonEl: HTMLButtonElement = $state(undefined!);
    let codeButtonEl: HTMLButtonElement = $state(undefined!);
    let addRowFilterButtonEl: HTMLButtonElement = $state(undefined!);
    let histogramContainer: HTMLDivElement = $state(undefined!);
    let frequencyContainer: HTMLDivElement = $state(undefined!);
    let tableAreaEl: HTMLDivElement = $state(undefined!);

    // Local UI state
    let virtualRows: VirtualRow[] = $state([]);
    let tableAreaTop = $state(0);
    let virtualizerTotalHeight = $state(0);
    let headerScrollLeft = $state(0);
    let tableViewportWidth = $state(0);
    let renderColumns: Array<{ column: ColumnSchema; schemaIndex: number }> = $state([]);
    let leftSpacerWidth = $state(0);
    let rightSpacerWidth = $state(0);
    let tableMetaError = $state('');
    const tableMetaText = $derived(tableMetaError || tableSetupController.buildTableMetaText());

    // Derived values
    const resolvedColumnWidths = $derived(dataStore.visibleSchema.map((column) => resolveColumnWidth(dataStore.columnWidths.get(column.column_index))));
    const columnTemplate = $derived(resolvedColumnWidths.length > 0
        ? `${ROW_LABEL_WIDTH}px ${resolvedColumnWidths.map((width) => `${width}px`).join(' ')}`
        : `${ROW_LABEL_WIDTH}px`);
    const totalWidth = $derived(ROW_LABEL_WIDTH + resolvedColumnWidths.reduce((sum, width) => sum + width, 0));
    const rowFilterSection = $derived(ROW_FILTER_SECTION_MAP[rowFilterDraft.filterType] ?? 'none');
    const tableTitleText = $derived(dataStore.backendState?.display_name || 'Data Explorer');
    const columnVisibilityDisplayedColumns = $derived(computeDisplayedColumns(dataStore.fullSchema, dataStore.columnFilterMatches, uiStore.columnVisibilitySearchTerm));

    function log(message: string, payload?: unknown): void {
        if (!debugEnabled) {
            return;
        }
        if (payload !== undefined) {
            vscode.postMessage({ type: 'log', message, payload });
        } else {
            vscode.postMessage({ type: 'log', message });
        }
    }

    const virtualizer = new VirtualizerManager({
        getScrollElement: () => tableBodyEl ?? null,
        rowHeight: ROW_HEIGHT,
        rowCount: () => dataStore.backendState?.table_shape.num_rows ?? 0,
        onVirtualRowsChange: (rows, totalHeight) => {
            virtualRows = rows;
            virtualizerTotalHeight = totalHeight;
            rowDataController.scheduleVisibleBlocksRequest('scroll');
        },
        log,
    });

    const statsCharts = new StatsCharts({
        getHistogramContainer: () => histogramContainer,
        getFrequencyContainer: () => frequencyContainer,
        log,
    });

    const tableLayoutController = new TableLayoutController({
        log,
        minColumnWidth: MIN_COLUMN_WIDTH,
        columnWidthFallback: COLUMN_WIDTH,
        sidePanelMinWidth: SIDE_PANEL_MIN_WIDTH,
        sidePanelMaxWidth: SIDE_PANEL_MAX_WIDTH,
        virtualizationThreshold: COLUMN_VIRTUALIZATION_THRESHOLD,
        getTableHeaderEl: () => tableHeaderEl,
        getTableBodyEl: () => tableBodyEl,
        getBodyInnerEl: () => bodyInnerEl,
        getStatsPanelEl: () => statsPanelEl,
        getDataTableComponent: () => dataTableComponent ?? null,
        setTableViewportWidth: (value) => {
            tableViewportWidth = value;
        },
        setHeaderScrollLeft: (value) => {
            headerScrollLeft = value;
        },
        setRenderColumns: (columns) => {
            renderColumns = columns;
        },
        setLeftSpacerWidth: (value) => {
            leftSpacerWidth = value;
        },
        setRightSpacerWidth: (value) => {
            rightSpacerWidth = value;
        },
        onSidePanelResize: () => statsCharts.resize(),
    });

    const statsController = new StatsController({
        log,
        postMessage: (message) => vscode.postMessage(message),
        statsCharts,
        getVisibleSchema: () => dataStore.visibleSchema,
        getStatsResultsEl: () => statsResultsEl,
    });

    const rowDataController = new RowDataController({
        log,
        postMessage: (message) => vscode.postMessage(message),
        rowBlockSize: ROW_BLOCK_SIZE,
        prefetchBlocks: ROW_PREFETCH_BLOCKS,
        requestDebounceMs: ROW_REQUEST_DEBOUNCE_MS,
        getVirtualItems: () => virtualizer.getVirtualItems(),
        measureVirtualizer: () => virtualizer.measure(),
    });

    const tableSetupController = new TableSetupController({
        log,
        getRowLabel: (rowIndex, version) => rowDataController.getRowLabel(rowIndex, version),
        getCellValue: (rowIndex, columnIndex, version) => rowDataController.getCellValue(rowIndex, columnIndex, version),
        getColumnLabel,
    });

    const schemaController = new SchemaController({
        log,
        postMessage: (message) => vscode.postMessage(message),
        setupTable: () => tableSetupController.setupTable(),
        updateVirtualizer: () => virtualizer.update(),
        requestInitialBlock: () => rowDataController.requestInitialBlock(),
        scheduleTableLayoutDiagnostics: (stage) => tableLayoutController.scheduleTableLayoutDiagnostics(stage),
        setStatsMessage: (message, state) => statsController.setStatsMessage(message, state),
        clearStatsContent: () => statsController.clearStatsContent(),
    });

    const rowFilterController = new RowFilterController({
        log,
        postMessage: (message) => vscode.postMessage(message),
        getEditingRowFilterIndex: () => editingRowFilterIndex,
        setEditingRowFilterIndex: (value) => {
            editingRowFilterIndex = value;
        },
        getRowFilterDraft: () => rowFilterDraft,
        setRowFilterDraft: (draft) => {
            rowFilterDraft = draft;
        },
        setRowFilterError: (message) => {
            rowFilterError = message;
        },
    });

    const tableInteractionController = new TableInteractionController({
        postMessage: (message) => vscode.postMessage(message),
        getColumnMenuEl: () => columnMenuEl,
        getTableBodyEl: () => tableBodyEl,
        setHeaderScrollLeft: (value) => tableLayoutController.updateHeaderScroll(value),
        openRowFilterEditor: (filter, index, columnIndex) => rowFilterController.openRowFilterEditor(filter, index, columnIndex),
    });

    const windowEventsController = new WindowEventsController({
        getColumnMenuEl: () => columnMenuEl,
        getStatsPanelEl: () => statsPanelEl,
        getStatsButtonEl: () => statsButtonEl,
        getColumnVisibilityPanelEl: () => columnVisibilityPanelEl,
        getColumnsButtonEl: () => columnsButtonEl,
        getCodeModalEl: () => codeModalEl,
        getCodeButtonEl: () => codeButtonEl,
        getRowFilterPanelEl: () => rowFilterPanelEl,
        getAddRowFilterButtonEl: () => addRowFilterButtonEl,
        handleSidePanelResize: (event) => tableLayoutController.handleSidePanelResize(event),
        handleColumnResizeMove: (event) => tableLayoutController.handleColumnResizeMove(event),
        finishSidePanelResize: () => tableLayoutController.finishSidePanelResize(),
        handleColumnResizeEnd: () => tableLayoutController.handleColumnResizeEnd(),
        onResize: () => {
            statsCharts.resize();
            updateTableAreaTop();
        },
    });

    const initController = new InitController({
        log,
        initializeDataStore: (state, schema) => dataStore.initialize(state, schema),
        applySchemaUpdate: (schema) => schemaController.applySchemaUpdate(schema),
        getVisibleSchema: () => dataStore.visibleSchema,
        applyPendingRows: () => rowDataController.applyPendingRows(),
        scheduleTableLayoutDiagnostics: (stage) => tableLayoutController.scheduleTableLayoutDiagnostics(stage),
        clearStatsContent: () => statsController.clearStatsContent(),
    });

    const panelToggleController = new PanelToggleController({
        postMessage: (message) => vscode.postMessage(message),
    });

    const exportController = new ExportController({
        postMessage: (message) => vscode.postMessage(message),
    });

    function setPanelPinned(panelId: string, pinned: boolean): void {
        uiStore.setPanelPinned(panelId, pinned);
        log('Panel pin updated', { panelId, pinned });
    }

    function updateTableAreaTop(): void {
        if (tableAreaEl) {
            tableAreaTop = tableAreaEl.offsetTop;
        }
    }

    // Effects
    $effect(() => {
        tableLayoutController.attachTableBodyObserver(tableBodyEl);
    });

    $effect(() => {
        tableLayoutController.updateRenderColumns(dataStore.visibleSchema, resolvedColumnWidths, headerScrollLeft, tableViewportWidth);
    });

    $effect(() => {
        if (typeof document !== 'undefined') {
            document.body.style.setProperty('--table-area-top', `${tableAreaTop}px`);
        }
    });

    const messageHandler = createMessageHandler({
        onInit: (msg) => {
            tableMetaError = '';
            initController.handleInit(msg);
        },
        onRows: (message) => rowDataController.handleRows(message),
        onError: (message) => {
            tableMetaError = message;
        },
        onSearchSchemaResult: (matches) => schemaController.handleSearchSchemaResult(matches),
        onExportResult: (data, format) => exportController.handleExportResult(data, format),
        onColumnProfilesResult: (columnIndex, profiles, errorMessage) =>
            statsController.handleColumnProfilesResult(columnIndex, profiles, errorMessage),
        onConvertToCodeResult: (code) => exportController.handleConvertToCodeResult(code),
        onSuggestCodeSyntaxResult: (syntax) => exportController.handleSuggestCodeSyntaxResult(syntax),
    });

    onMount(() => {
        messageHandler.attach();
        statsController.initializeStatsDefaults();
        statsController.setStatsMessage('Select a column to view statistics.', 'empty');
        statsController.clearStatsContent();
        const handleClick = (e: MouseEvent) => windowEventsController.handleDocumentClick(e);
        document.addEventListener('click', handleClick);
        vscode.postMessage({ type: 'ready' });
        log('Data explorer initialized.');
        updateTableAreaTop();

        return () => {
            messageHandler.detach();
            document.removeEventListener('click', handleClick);
        };
    });

    // Auto-focus the first context menu item when menu opens
    $effect(() => {
        if (uiStore.columnMenuOpen && columnMenuEl) {
            requestAnimationFrame(() => {
                const first = columnMenuEl?.querySelector<HTMLButtonElement>('button:not(:disabled)');
                first?.focus();
            });
        }
    });

    onDestroy(() => {
        statsController.dispose();
        schemaController.dispose();
        rowDataController.dispose();
        tableLayoutController.dispose();
        virtualizer.dispose();
        statsCharts.dispose();
    });

    function handleContextMenuKeydown(event: KeyboardEvent): void {
        const menu = columnMenuEl;
        if (!menu) {
            return;
        }
        const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const idx = items.indexOf(document.activeElement as HTMLButtonElement);

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            items[idx < items.length - 1 ? idx + 1 : 0]?.focus();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            items[idx > 0 ? idx - 1 : items.length - 1]?.focus();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            uiStore.closeColumnMenu();
        }
    }
</script>

<svelte:window
    onresize={() => windowEventsController.handleWindowResize()}
    onkeydown={(e) => windowEventsController.handleWindowKeydown(e)}
    onmousemove={(e) => windowEventsController.handleWindowMouseMove(e)}
    onmouseup={(e) => windowEventsController.handleWindowMouseUp(e)}
/>

<Toolbar
    title={tableTitleText}
    meta={tableMetaText}
    bind:columnsButtonEl
    bind:statsButtonEl
    bind:codeButtonEl
    onOpenColumns={() => panelToggleController.openColumnVisibilityPanel()}
    onOpenStats={() => statsController.openStatsPanel({ toggle: true })}
    onOpenCode={() => panelToggleController.openCodeModal()}
    onRefresh={() => vscode.postMessage({ type: 'refresh' })}
    onExport={(e) => exportController.handleExport(e.format)}
/>

<RowFilterBar
    rowFilters={dataStore.rowFilters}
    visible={dataStore.isRowFilterSupported}
    bind:addFilterButtonEl={addRowFilterButtonEl}
    onAddFilter={() => rowFilterController.openRowFilterEditor()}
    onEditFilter={(e) => rowFilterController.openRowFilterEditor(e.filter, e.index)}
    onRemoveFilter={(e) => rowFilterController.removeRowFilter(e.index)}
/>

<!-- Side panels: render a single instance each.
     Pinning only changes layout (fixed overlay vs flex sidebar), avoiding component destroy/recreate. -->

<CodeModal
    open={uiStore.codeModalOpen}
    bind:codePreview={uiStore.codePreview}
    bind:codeSyntax={uiStore.codeSyntax}
    bind:codeModalEl
    onClose={() => { uiStore.codeModalOpen = false; }}
    onConvert={() => exportController.handleCodeConvert()}
    onCopy={() => {}}
/>

<div
    class="context-menu"
    id="column-menu"
    role="menu"
    tabindex="-1"
    bind:this={columnMenuEl}
    class:open={uiStore.columnMenuOpen}
    style={`left: ${uiStore.columnMenuPosition.x}px; top: ${uiStore.columnMenuPosition.y}px;`}
    onkeydown={handleContextMenuKeydown}
>
    <button class="context-menu-item" id="column-menu-add-filter" role="menuitem" disabled={!dataStore.isRowFilterSupported} onclick={() => tableInteractionController.handleColumnMenuAddFilter()}>Add Filter</button>
    <button class="context-menu-item" id="column-menu-hide-column" role="menuitem" disabled={dataStore.visibleSchema.length <= 1} onclick={() => tableInteractionController.handleColumnMenuHideColumn()}>Hide Column</button>
</div>

<div class="table-area" bind:this={tableAreaEl}>
    <DataTable
        bind:this={dataTableComponent}
        state={dataStore.backendState}
        schema={dataStore.visibleSchema}
        {renderColumns}
        columnWidths={dataStore.columnWidths}
        activeSort={dataStore.activeSort}
        sortSupported={dataStore.isSortSupported}
        rowFilterSupported={dataStore.isRowFilterSupported}
        {virtualRows}
        {virtualizerTotalHeight}
        rowCacheVersion={dataStore.rowCacheVersion}
        {headerScrollLeft}
        {leftSpacerWidth}
        {rightSpacerWidth}
        getCellValue={(rowIndex, columnIndex, version) => rowDataController.getCellValue(rowIndex, columnIndex, version)}
        getRowLabel={(rowIndex, version) => rowDataController.getRowLabel(rowIndex, version)}
        {getColumnLabel}
        bind:tableBodyEl
        bind:tableHeaderEl
        bind:bodyInnerEl
        onSort={(e) => tableInteractionController.handleDataTableSort(e.columnIndex)}
        onColumnMenu={(e) => tableInteractionController.openColumnMenu(e.event, e.columnIndex)}
        onOpenRowFilter={(e) => rowFilterController.openRowFilterEditor(undefined, undefined, e.columnIndex)}
        onOpenStats={(e) => statsController.openStatsPanel({ columnIndex: e.columnIndex })}
        onHideColumn={(e) => schemaController.hideColumn(e.columnIndex)}
        onScroll={() => tableInteractionController.handleDataTableScroll()}
        onStartColumnResize={(e) => tableLayoutController.startColumnResize(e.event, e.columnIndex)}
    />

    <ColumnVisibilityPanel
        open={uiStore.columnVisibilityOpen}
        pinned={uiStore.pinnedPanels.has('column-visibility-panel') && uiStore.columnVisibilityOpen}
        displayedColumns={columnVisibilityDisplayedColumns}
        hiddenColumnIndices={dataStore.hiddenColumnIndices}
        bind:searchTerm={uiStore.columnVisibilitySearchTerm}
        status={uiStore.columnVisibilityStatus}
        bind:panelEl={columnVisibilityPanelEl}
        onClose={() => {
            setPanelPinned('column-visibility-panel', false);
            uiStore.columnVisibilityOpen = false;
        }}
        onTogglePin={() => setPanelPinned('column-visibility-panel', !uiStore.isPanelPinned('column-visibility-panel'))}
        onSearch={(e) => {
            uiStore.columnVisibilitySearchTerm = e.term;
            schemaController.applyColumnSearch();
        }}
        onClear={() => {
            uiStore.columnVisibilitySearchTerm = '';
            schemaController.applyColumnSearch();
        }}
        onInvert={() => schemaController.invertColumnVisibility()}
        onToggleVisibility={(e) => schemaController.toggleColumnVisibility(e.columnIndex)}
        onStartResize={(e) => tableLayoutController.startSidePanelResize(e.event, 'column-visibility-panel')}
    />

    <RowFilterPanel
        open={uiStore.rowFilterPanelOpen}
        pinned={uiStore.pinnedPanels.has('row-filter-panel') && uiStore.rowFilterPanelOpen}
        schema={dataStore.visibleSchema}
        bind:draft={rowFilterDraft}
        error={rowFilterError}
        rowFilterSupport={dataStore.rowFilterSupport}
        bind:panelEl={rowFilterPanelEl}
        onClose={() => {
            setPanelPinned('row-filter-panel', false);
            uiStore.rowFilterPanelOpen = false;
        }}
        onTogglePin={() => setPanelPinned('row-filter-panel', !uiStore.isPanelPinned('row-filter-panel'))}
        onSave={() => rowFilterController.saveRowFilter()}
        onCancel={() => { uiStore.rowFilterPanelOpen = false; }}
        onStartResize={(e) => tableLayoutController.startSidePanelResize(e.event, 'row-filter-panel')}
    />

    <StatsPanel
        isOpen={uiStore.statsPanelOpen}
        isPinned={uiStore.pinnedPanels.has('stats-panel') && uiStore.statsPanelOpen}
        schema={dataStore.visibleSchema}
        {getColumnLabel}
        bind:statsColumnValue={uiStore.statsColumnValue}
        collapsedSections={uiStore.collapsedSections}
        bind:statsPanelEl
        bind:statsResultsEl
        bind:histogramContainer
        bind:frequencyContainer
        onClose={() => {
            setPanelPinned('stats-panel', false);
            uiStore.statsPanelOpen = false;
        }}
        onTogglePin={() => setPanelPinned('stats-panel', !uiStore.isPanelPinned('stats-panel'))}
        onColumnChange={() => statsController.handleStatsColumnChange()}
        onToggleSection={(e) => statsController.toggleStatsSection(e.sectionId)}
        onBinsInput={(e) => {
            statsStore.histogramBins = e.value;
            statsController.handleHistogramBinsInput(e.source);
        }}
        onLimitInput={(e) => {
            statsStore.frequencyLimit = e.value;
            statsController.handleFrequencyLimitInput(e.source);
        }}
        onStartResize={(e) => tableLayoutController.startSidePanelResize(e.event, 'stats-panel')}
    />
</div>

<style>
    :global(body) {
        margin: 0;
        padding: 0;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-editor-foreground);
        background-color: var(--vscode-editor-background);
        --side-panel-width: 300px;
        height: 100vh;
        display: flex;
        flex-direction: column;
    }

    :global(#svelte-root) {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }

    :global(body.panel-resizing) {
        cursor: ew-resize;
        user-select: none;
    }

    .table-area {
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: stretch;
        position: relative;
        overflow: hidden;
    }

    .context-menu {
        position: fixed;
        min-width: 160px;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        border-radius: 3px;
        display: none;
        z-index: 2000;
    }

    .context-menu.open {
        display: block;
    }

    .context-menu-item {
        width: 100%;
        text-align: left;
        padding: 8px 12px;
        background: none;
        border: none;
        color: var(--vscode-dropdown-foreground);
        cursor: pointer;
    }

    .context-menu-item:hover {
        background: var(--vscode-list-hoverBackground);
    }

    .context-menu-item:disabled {
        color: var(--vscode-disabledForeground);
        cursor: default;
        background: none;
    }
</style>
