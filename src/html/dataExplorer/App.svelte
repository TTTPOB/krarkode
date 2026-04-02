<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { VirtualizerManager, type VirtualRow } from './hooks/useVirtualizer';
    import { createMessageHandler } from './hooks/useVscodeMessages';
    import { StatsController } from './hooks/useStatsController';
    import { SchemaController } from './hooks/useSchemaController';
    import { RowFilterController } from './hooks/useRowFilterController';
    import { TableController } from './hooks/useTableLayoutController';
    import { RowDataController } from './hooks/useRowDataController';
    import { WindowEventsController } from './hooks/useWindowEventsController';
    import { TableSetupController } from './hooks/useTableSetupController';
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

    const tableController = new TableController({
        log,
        postMessage: (message) => vscode.postMessage(message),
        minColumnWidth: MIN_COLUMN_WIDTH,
        columnWidthFallback: COLUMN_WIDTH,
        sidePanelMinWidth: SIDE_PANEL_MIN_WIDTH,
        sidePanelMaxWidth: SIDE_PANEL_MAX_WIDTH,
        virtualizationThreshold: COLUMN_VIRTUALIZATION_THRESHOLD,
        getTableHeaderEl: () => tableHeaderEl,
        getTableBodyEl: () => tableBodyEl,
        getBodyInnerEl: () => bodyInnerEl,
        getStatsPanelEl: () => statsPanelEl,
        getColumnMenuEl: () => columnMenuEl,
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
        onSidePanelResize: () => statsController.resizeCharts(),
        openRowFilterEditor: (filter, index, columnIndex) => rowFilterController.openRowFilterEditor(filter, index, columnIndex),
    });

    const statsController = new StatsController({
        log,
        postMessage: (message) => vscode.postMessage(message),
        getVisibleSchema: () => dataStore.visibleSchema,
        getStatsResultsEl: () => statsResultsEl,
        getHistogramContainer: () => histogramContainer,
        getFrequencyContainer: () => frequencyContainer,
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
        scheduleTableLayoutDiagnostics: (stage) => tableController.scheduleTableLayoutDiagnostics(stage),
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
        handleSidePanelResize: (event) => tableController.handleSidePanelResize(event),
        handleColumnResizeMove: (event) => tableController.handleColumnResizeMove(event),
        finishSidePanelResize: () => tableController.finishSidePanelResize(),
        handleColumnResizeEnd: () => tableController.handleColumnResizeEnd(),
        onResize: () => {
            statsController.resizeCharts();
            updateTableAreaTop();
        },
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
        tableController.attachTableBodyObserver(tableBodyEl);
    });

    $effect(() => {
        tableController.updateRenderColumns(dataStore.visibleSchema, resolvedColumnWidths, headerScrollLeft, tableViewportWidth);
    });

    $effect(() => {
        if (typeof document !== 'undefined') {
            document.body.style.setProperty('--table-area-top', `${tableAreaTop}px`);
        }
    });

    const messageHandler = createMessageHandler({
        onInit: (msg) => {
            tableMetaError = '';
            dataStore.initialize(msg.state, msg.schema ?? []);
            uiStore.columnVisibilityStatus = '';
            uiStore.columnVisibilitySearchTerm = '';
            if (uiStore.activeStatsColumnIndex === null) {
                statsStore.messageText = 'Select a column to view statistics.';
                statsStore.messageState = 'empty';
            } else {
                statsStore.messageText = 'Loading statistics...';
                statsStore.messageState = 'loading';
            }
            statsController.clearStatsContent();
            uiStore.codePreview = '';
            schemaController.applySchemaUpdate(dataStore.visibleSchema);
            rowDataController.applyPendingRows();
            log('Data explorer initialized', {
                rows: msg.state.table_shape.num_rows,
                columns: dataStore.visibleSchema.length,
            });
            tableController.scheduleTableLayoutDiagnostics('init');
        },
        onRows: (message) => rowDataController.handleRows(message),
        onError: (message) => {
            tableMetaError = message;
        },
        onSearchSchemaResult: (matches) => schemaController.handleSearchSchemaResult(matches),
        onExportResult: (data, format) => {
            const blob = new Blob([data], { type: format === 'html' ? 'text/html' : 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `export.${format === 'csv' ? 'csv' : format === 'tsv' ? 'tsv' : 'html'}`;
            a.click();
            URL.revokeObjectURL(url);
        },
        onColumnProfilesResult: (columnIndex, profiles, errorMessage) =>
            statsController.handleColumnProfilesResult(columnIndex, profiles, errorMessage),
        onConvertToCodeResult: (code) => { uiStore.codePreview = code || '(No code generated)'; },
        onSuggestCodeSyntaxResult: (syntax) => { uiStore.codeSyntax = syntax; },
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
        tableController.dispose();
        virtualizer.dispose();
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
    onOpenColumns={() => uiStore.toggleColumnVisibilityPanel()}
    onOpenStats={() => statsController.openStatsPanel({ toggle: true })}
    onOpenCode={() => {
        if (uiStore.toggleCodeModal()) {
            vscode.postMessage({ type: 'suggestCodeSyntax' });
        }
    }}
    onRefresh={() => vscode.postMessage({ type: 'refresh' })}
    onExport={(e) => vscode.postMessage({ type: 'exportData', format: e.format })}
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
    onConvert={() => vscode.postMessage({ type: 'convertToCode', syntax: uiStore.codeSyntax })}
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
    <button class="context-menu-item" id="column-menu-add-filter" role="menuitem" disabled={!dataStore.isRowFilterSupported} onclick={() => tableController.handleColumnMenuAddFilter()}>Add Filter</button>
    <button class="context-menu-item" id="column-menu-hide-column" role="menuitem" disabled={dataStore.visibleSchema.length <= 1} onclick={() => tableController.handleColumnMenuHideColumn()}>Hide Column</button>
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
        onSort={(e) => tableController.handleDataTableSort(e.columnIndex)}
        onColumnMenu={(e) => tableController.openColumnMenu(e.event, e.columnIndex)}
        onOpenRowFilter={(e) => rowFilterController.openRowFilterEditor(undefined, undefined, e.columnIndex)}
        onOpenStats={(e) => statsController.openStatsPanel({ columnIndex: e.columnIndex })}
        onHideColumn={(e) => schemaController.hideColumn(e.columnIndex)}
        onScroll={() => tableController.handleDataTableScroll()}
        onStartColumnResize={(e) => tableController.startColumnResize(e.event, e.columnIndex)}
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
        onStartResize={(e) => tableController.startSidePanelResize(e.event, 'column-visibility-panel')}
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
        onStartResize={(e) => tableController.startSidePanelResize(e.event, 'row-filter-panel')}
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
        onStartResize={(e) => tableController.startSidePanelResize(e.event, 'stats-panel')}
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
