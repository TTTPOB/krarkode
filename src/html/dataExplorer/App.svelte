<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { useVirtualizer, type VirtualRow } from './hooks/useVirtualizer';
    import { useStatsCharts } from './hooks/useStatsCharts';
    import { useVscodeMessages } from './hooks/useVscodeMessages';
    import { useStatsController } from './hooks/useStatsController';
    import { useSchemaController } from './hooks/useSchemaController';
    import { useRowFilterController } from './hooks/useRowFilterController';
    import { useTableLayoutController } from './hooks/useTableLayoutController';
    import { useRowDataController } from './hooks/useRowDataController';
    import { useTableInteractionController } from './hooks/useTableInteractionController';
    import { useWindowEventsController } from './hooks/useWindowEventsController';
    import { useTableSetupController } from './hooks/useTableSetupController';
    import { useInitController } from './hooks/useInitController';
    import { usePanelToggleController } from './hooks/usePanelToggleController';
    import { useExportController } from './hooks/useExportController';
    import Toolbar from './Toolbar.svelte';
    import RowFilterBar from './RowFilterBar.svelte';
    import CodeModal from './CodeModal.svelte';
    import ColumnVisibilityPanel from './ColumnVisibilityPanel.svelte';
    import RowFilterPanel from './RowFilterPanel.svelte';
    import StatsPanel from './StatsPanel.svelte';
    import DataTable from './DataTable.svelte';
    import {
        backendState,
        fullSchema,
        visibleSchema,
        columnFilterMatches,
        hiddenColumnIndices,
        columnWidths,
        rowCache,
        rowLabelCache,
        rowCacheVersion,
        loadedBlocks,
        loadingBlocks,
        rowFilters,
        activeSort,
        rowFilterSupport,
        columnFilterSupport,
        setColumnFilterSupport,
        initializeDataStore,
        // UI stores - using $ syntax for reactive access
        collapsedSections as collapsedSectionsStore,
        pinnedPanels as pinnedPanelsStore,
        setPanelPinned as storeSetPanelPinned,
        columnMenuOpen as columnMenuOpenStore,
        columnMenuPosition as columnMenuPositionStore,
        columnMenuColumnIndex as columnMenuColumnIndexStore,
        closeColumnMenu as storeCloseColumnMenu,
        // Panel visibility stores
        columnVisibilityOpen as columnVisibilityOpenStore,
        rowFilterPanelOpen as rowFilterPanelOpenStore,
        statsPanelOpen as statsPanelOpenStore,
        codeModalOpen as codeModalOpenStore,
        // Stats stores
        statsMessageText as statsMessageTextStore,
        statsMessageState as statsMessageStateStore,
        statsSectionsVisible as statsSectionsVisibleStore,
        statsControlsEnabled as statsControlsEnabledStore,
        statsOverviewRows as statsOverviewRowsStore,
        statsSummaryRows as statsSummaryRowsStore,
        statsOverviewEmptyMessage as statsOverviewEmptyMessageStore,
        statsSummaryEmptyMessage as statsSummaryEmptyMessageStore,
        frequencyFootnote as frequencyFootnoteStore,
        histogramBins as histogramBinsStore,
        histogramMethod as histogramMethodStore,
        frequencyLimit as frequencyLimitStore,
        histogramVisible as histogramVisibleStore,
        frequencyVisible as frequencyVisibleStore,
    } from './stores';
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
        isRowFilterSupported as checkRowFilterSupported,
        isColumnFilterSupported as checkColumnFilterSupported,
        isSetColumnFiltersSupported as checkSetColumnFiltersSupported,
        supportsRowFilterConditions as checkSupportsRowFilterConditions,
        isSortSupported as checkSortSupported,
    } from './utils';

    const vscode = getVsCodeApi();
    const debugEnabled = typeof window !== 'undefined'
        && (window as { __krarkodeDebug?: boolean }).__krarkodeDebug === true;

    const COLUMN_VIRTUALIZATION_THRESHOLD = 80;

    let editingRowFilterIndex: number | null = null;

    // Panel visibility now comes from stores via $columnVisibilityOpenStore, $rowFilterPanelOpenStore, etc.
    // columnMenuOpen, columnMenuPosition, columnMenuColumnIndex now come from stores
    // pinnedPanels now comes from store via $pinnedPanelsStore

    let columnVisibilitySearchTerm = '';
    let columnVisibilityStatus = '';
    let columnVisibilityDisplayedColumns: ColumnSchema[] = [];

    let rowFilterError = '';
    let rowFilterDraft: RowFilterDraft = createRowFilterDraft();
    let activeStatsColumnIndex: number | null = null;
    let statsColumnValue = '';

    let codePreview = '';
    let codeSyntax = 'pandas';


    let tableBodyEl: HTMLDivElement;
    let tableHeaderEl: HTMLDivElement;
    let bodyInnerEl: HTMLDivElement;
    let dataTableComponent: DataTable;
    let columnVisibilityPanelEl: HTMLDivElement;
    let rowFilterPanelEl: HTMLDivElement;
    let statsPanelEl: HTMLDivElement;
    let codeModalEl: HTMLDivElement;
    let columnMenuEl: HTMLDivElement;
    let statsResultsEl: HTMLDivElement;
    let columnsButtonEl: HTMLButtonElement;
    let statsButtonEl: HTMLButtonElement;
    let codeButtonEl: HTMLButtonElement;
    let addRowFilterButtonEl: HTMLButtonElement;
    let histogramContainer: HTMLDivElement;
    let frequencyContainer: HTMLDivElement;


    let virtualRows: VirtualRow[] = [];
    let virtualizerTotalHeight = 0;
    let headerScrollLeft = 0;
    let tableViewportWidth = 0;
    let renderColumns: Array<{ column: ColumnSchema; schemaIndex: number }> = [];
    let leftSpacerWidth = 0;
    let rightSpacerWidth = 0;


    // collapsedSections now comes from store via $collapsedSectionsStore

    let tableTitleText = 'Data Explorer';
    let tableMetaText = '';

    $: resolvedColumnWidths = $visibleSchema.map((column) => resolveColumnWidth($columnWidths.get(column.column_index)));
    $: columnTemplate = resolvedColumnWidths.length > 0
        ? `${ROW_LABEL_WIDTH}px ${resolvedColumnWidths.map((width) => `${width}px`).join(' ')}`
        : `${ROW_LABEL_WIDTH}px`;
    $: totalWidth = ROW_LABEL_WIDTH + resolvedColumnWidths.reduce((sum, width) => sum + width, 0);
    $: rowFilterSection = ROW_FILTER_SECTION_MAP[rowFilterDraft.filterType] ?? 'none';
    $: rowFilterSupported = isRowFilterSupported();
    $: sortSupported = isSortSupported();
    $: tableTitleText = $backendState?.display_name || 'Data Explorer';
    // Compute displayed columns reactively based on search matches and full schema
    $: columnVisibilityDisplayedColumns = computeDisplayedColumns($fullSchema, $columnFilterMatches, columnVisibilitySearchTerm);
    $: tableMetaText = buildTableMetaText();
    $: attachTableBodyObserver(tableBodyEl);
    $: updateRenderColumnsLayout($visibleSchema, resolvedColumnWidths, headerScrollLeft, tableViewportWidth);

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

    const virtualizer = useVirtualizer({
        getScrollElement: () => tableBodyEl ?? null,
        rowHeight: ROW_HEIGHT,
        rowCount: () => $backendState?.table_shape.num_rows ?? 0,
        onVirtualRowsChange: (rows, totalHeight) => {
            virtualRows = rows;
            virtualizerTotalHeight = totalHeight;
            scheduleVisibleBlocksRequest('scroll');
        },
        log,
    });

    const statsCharts = useStatsCharts({
        getHistogramContainer: () => histogramContainer,
        getFrequencyContainer: () => frequencyContainer,
        log,
    });

    const tableLayoutController = useTableLayoutController({
        log,
        columnWidths,
        minColumnWidth: MIN_COLUMN_WIDTH,
        columnWidthFallback: COLUMN_WIDTH,
        sidePanelMinWidth: SIDE_PANEL_MIN_WIDTH,
        sidePanelMaxWidth: SIDE_PANEL_MAX_WIDTH,
        virtualizationThreshold: COLUMN_VIRTUALIZATION_THRESHOLD,
        getVisibleSchema: () => $visibleSchema,
        getResolvedColumnWidths: () => resolvedColumnWidths,
        getTotalWidth: () => totalWidth,
        getColumnTemplate: () => columnTemplate,
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

    const {
        scheduleTableLayoutDiagnostics,
        updateRenderColumns: updateRenderColumnsLayout,
        attachTableBodyObserver,
        updateHeaderScroll,
        startColumnResize,
        handleColumnResizeMove,
        handleColumnResizeEnd,
        startSidePanelResize,
        handleSidePanelResize,
        finishSidePanelResize,
        dispose: disposeTableLayoutController,
    } = tableLayoutController;

    const statsController = useStatsController({
        log,
        postMessage: (message) => vscode.postMessage(message),
        statsCharts,
        getVisibleSchema: () => $visibleSchema,
        getActiveStatsColumnIndex: () => activeStatsColumnIndex,
        setActiveStatsColumnIndex: (value) => {
            activeStatsColumnIndex = value;
        },
        getStatsColumnValue: () => statsColumnValue,
        setStatsColumnValue: (value) => {
            statsColumnValue = value;
        },
        getStatsResultsEl: () => statsResultsEl,
        getStatsPanelOpen: () => $statsPanelOpenStore,
        setStatsPanelOpen: (value) => {
            $statsPanelOpenStore = value;
        },
        setColumnVisibilityOpen: (value) => {
            $columnVisibilityOpenStore = value;
        },
        setRowFilterPanelOpen: (value) => {
            $rowFilterPanelOpenStore = value;
        },
        setCodeModalOpen: (value) => {
            $codeModalOpenStore = value;
        },
        isPanelPinned,
        stores: {
            statsMessageText: statsMessageTextStore,
            statsMessageState: statsMessageStateStore,
            statsSectionsVisible: statsSectionsVisibleStore,
            statsControlsEnabled: statsControlsEnabledStore,
            statsOverviewRows: statsOverviewRowsStore,
            statsSummaryRows: statsSummaryRowsStore,
            statsOverviewEmptyMessage: statsOverviewEmptyMessageStore,
            statsSummaryEmptyMessage: statsSummaryEmptyMessageStore,
            frequencyFootnote: frequencyFootnoteStore,
            histogramBins: histogramBinsStore,
            histogramMethod: histogramMethodStore,
            frequencyLimit: frequencyLimitStore,
            histogramVisible: histogramVisibleStore,
            frequencyVisible: frequencyVisibleStore,
            collapsedSections: collapsedSectionsStore,
        },
    });

    const {
        initializeStatsDefaults,
        setStatsMessage,
        clearStatsContent,
        openStatsPanel,
        handleStatsColumnChange,
        handleColumnProfilesResult,
        handleStatsMethodChange,
        handleHistogramBinsInput,
        handleFrequencyLimitInput,
        toggleStatsSection,
        dispose: disposeStatsController,
    } = statsController;

    const rowDataController = useRowDataController({
        log,
        postMessage: (message) => vscode.postMessage(message),
        getBackendState: () => $backendState,
        visibleSchema,
        rowCache,
        rowLabelCache,
        rowCacheVersion,
        loadedBlocks,
        loadingBlocks,
        rowBlockSize: ROW_BLOCK_SIZE,
        prefetchBlocks: ROW_PREFETCH_BLOCKS,
        requestDebounceMs: ROW_REQUEST_DEBOUNCE_MS,
        getVirtualItems: () => virtualizer.getVirtualItems(),
        measureVirtualizer: () => virtualizer.measure(),
    });

    const {
        requestInitialBlock,
        scheduleVisibleBlocksRequest,
        handleRows,
        applyPendingRows,
        getCellValue,
        getRowLabel,
        dispose: disposeRowDataController,
    } = rowDataController;

    const tableSetupController = useTableSetupController({
        log,
        getBackendState: () => $backendState,
        getVisibleSchema: () => $visibleSchema,
        getFullSchema: () => $fullSchema,
        getRowLabel,
        getCellValue,
        getColumnLabel,
    });

    const {
        setupTable,
        buildTableMetaText,
    } = tableSetupController;

    const schemaController = useSchemaController({
        log,
        postMessage: (message) => vscode.postMessage(message),
        stores: {
            fullSchema,
            visibleSchema,
            columnFilterMatches,
            hiddenColumnIndices,
            columnWidths,
            rowCache,
            rowLabelCache,
            rowCacheVersion,
            loadedBlocks,
            loadingBlocks,
        },
        getColumnVisibilitySearchTerm: () => columnVisibilitySearchTerm,
        setColumnVisibilityStatus: (value) => {
            columnVisibilityStatus = value;
        },
        isColumnFilterSupported,
        isSetColumnFiltersSupported,
        setupTable,
        updateVirtualizer,
        requestInitialBlock,
        scheduleTableLayoutDiagnostics,
        getStatsPanelOpen: () => $statsPanelOpenStore,
        getActiveStatsColumnIndex: () => activeStatsColumnIndex,
        setActiveStatsColumnIndex: (value) => {
            activeStatsColumnIndex = value;
        },
        setStatsColumnValue: (value) => {
            statsColumnValue = value;
        },
        setStatsMessage,
        clearStatsContent: () => clearStatsContent(),
    });

    const {
        handleSearchSchemaResult,
        applySchemaUpdate,
        applyColumnSearch,
        hideColumn,
        showColumn,
        toggleColumnVisibility,
        invertColumnVisibility,
        dispose: disposeSchemaController,
    } = schemaController;

    const rowFilterController = useRowFilterController({
        log,
        postMessage: (message) => vscode.postMessage(message),
        visibleSchema,
        rowFilters,
        rowFilterSupport,
        isRowFilterSupported,
        supportsRowFilterConditions,
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
        setRowFilterPanelOpen: (open) => {
            $rowFilterPanelOpenStore = open;
        },
        setColumnVisibilityOpen: (open) => {
            $columnVisibilityOpenStore = open;
        },
        setStatsPanelOpen: (open) => {
            $statsPanelOpenStore = open;
        },
        setCodeModalOpen: (open) => {
            $codeModalOpenStore = open;
        },
        closeColumnMenu: storeCloseColumnMenu,
    });

    const {
        openRowFilterEditor,
        saveRowFilter,
        removeRowFilter,
    } = rowFilterController;

    const tableInteractionController = useTableInteractionController({
        postMessage: (message) => vscode.postMessage(message),
        activeSort,
        columnMenuOpen: columnMenuOpenStore,
        columnMenuPosition: columnMenuPositionStore,
        columnMenuColumnIndex: columnMenuColumnIndexStore,
        getColumnMenuEl: () => columnMenuEl,
        getTableBodyEl: () => tableBodyEl,
        setHeaderScrollLeft: updateHeaderScroll,
        openRowFilterEditor,
        hideColumn,
    });

    const {
        openColumnMenu,
        closeColumnMenu,
        handleColumnMenuAddFilter,
        handleColumnMenuHideColumn,
        handleDataTableSort,
        handleDataTableScroll,
    } = tableInteractionController;

    const windowEventsController = useWindowEventsController({
        closeColumnMenu,
        isPanelPinned,
        columnMenuOpen: columnMenuOpenStore,
        statsPanelOpen: statsPanelOpenStore,
        columnVisibilityOpen: columnVisibilityOpenStore,
        codeModalOpen: codeModalOpenStore,
        rowFilterPanelOpen: rowFilterPanelOpenStore,
        getColumnMenuEl: () => columnMenuEl,
        getStatsPanelEl: () => statsPanelEl,
        getStatsButtonEl: () => statsButtonEl,
        getColumnVisibilityPanelEl: () => columnVisibilityPanelEl,
        getColumnsButtonEl: () => columnsButtonEl,
        getCodeModalEl: () => codeModalEl,
        getCodeButtonEl: () => codeButtonEl,
        getRowFilterPanelEl: () => rowFilterPanelEl,
        getAddRowFilterButtonEl: () => addRowFilterButtonEl,
        handleSidePanelResize,
        handleColumnResizeMove,
        finishSidePanelResize,
        handleColumnResizeEnd,
        onResize: () => {
            statsCharts.resize();
        },
    });

    const {
        handleDocumentClick,
        handleWindowResize,
        handleWindowKeydown,
        handleWindowMouseMove,
        handleWindowMouseUp,
    } = windowEventsController;

    const initController = useInitController({
        log,
        initializeDataStore,
        setColumnVisibilityStatus: (value) => {
            columnVisibilityStatus = value;
        },
        setColumnVisibilitySearchTerm: (value) => {
            columnVisibilitySearchTerm = value;
        },
        getActiveStatsColumnIndex: () => activeStatsColumnIndex,
        setStatsMessage,
        clearStatsContent,
        setCodePreview: (value) => {
            codePreview = value;
        },
        applySchemaUpdate,
        getVisibleSchema: () => $visibleSchema,
        applyPendingRows,
        scheduleTableLayoutDiagnostics,
    });

    const { handleInit } = initController;

    const panelToggleController = usePanelToggleController({
        postMessage: (message) => vscode.postMessage(message),
        getCodeModalOpen: () => $codeModalOpenStore,
        getColumnVisibilityOpen: () => $columnVisibilityOpenStore,
        getStatsPanelOpen: () => $statsPanelOpenStore,
        getRowFilterPanelOpen: () => $rowFilterPanelOpenStore,
        isPanelPinned,
        setCodeModalOpen: (value) => {
            $codeModalOpenStore = value;
        },
        setColumnVisibilityOpen: (value) => {
            $columnVisibilityOpenStore = value;
        },
        setStatsPanelOpen: (value) => {
            $statsPanelOpenStore = value;
        },
        setRowFilterPanelOpen: (value) => {
            $rowFilterPanelOpenStore = value;
        },
    });

    const { openColumnVisibilityPanel, openCodeModal, closeOtherNonPinnedPanels } = panelToggleController;

    const exportController = useExportController({
        postMessage: (message) => vscode.postMessage(message),
        getCodeSyntax: () => codeSyntax,
        setCodePreview: (value) => {
            codePreview = value;
        },
        setCodeSyntax: (value) => {
            codeSyntax = value;
        },
    });

    const {
        handleExportResult,
        handleConvertToCodeResult,
        handleSuggestCodeSyntaxResult,
        handleCodeConvert,
        handleExport,
    } = exportController;

    useVscodeMessages({
        onInit: handleInit,
        onRows: handleRows,
        onError: (message) => {
            tableMetaText = message;
        },
        onSearchSchemaResult: handleSearchSchemaResult,
        onExportResult: handleExportResult,
        onColumnProfilesResult: handleColumnProfilesResult,
        onConvertToCodeResult: handleConvertToCodeResult,
        onSuggestCodeSyntaxResult: handleSuggestCodeSyntaxResult,
    });

    function setPanelPinned(panelId: string, pinned: boolean): void {
        storeSetPanelPinned(panelId, pinned);
        log('Panel pin updated', { panelId, pinned });
    }

    function isPanelPinned(panelId: string): boolean {
        return $pinnedPanelsStore.has(panelId);
    }

    // Wrapper functions for feature support checks (use local state)
    function isRowFilterSupported(): boolean {
        return checkRowFilterSupported($rowFilterSupport);
    }

    function isColumnFilterSupported(): boolean {
        return checkColumnFilterSupported($columnFilterSupport);
    }

    function isSetColumnFiltersSupported(): boolean {
        return checkSetColumnFiltersSupported($setColumnFilterSupport);
    }

    function supportsRowFilterConditions(): boolean {
        return checkSupportsRowFilterConditions($rowFilterSupport);
    }

    function isSortSupported(): boolean {
        return checkSortSupported($backendState);
    }

    function updateVirtualizer(): void {
        virtualizer.update();
    }

    onMount(() => {
        initializeStatsDefaults();
        setStatsMessage('Select a column to view statistics.', 'empty');
        clearStatsContent();
        document.addEventListener('click', handleDocumentClick);
        vscode.postMessage({ type: 'ready' });
        log('Data explorer initialized.');
    });

    onDestroy(() => {
        document.removeEventListener('click', handleDocumentClick);
        disposeStatsController();
        disposeSchemaController();
        disposeRowDataController();
        disposeTableLayoutController();
        virtualizer.dispose();
        statsCharts.dispose();
    });
</script>

<svelte:window
    on:resize={handleWindowResize}
    on:keydown={handleWindowKeydown}
    on:mousemove={handleWindowMouseMove}
    on:mouseup={handleWindowMouseUp}
/>

<Toolbar
    title={tableTitleText}
    meta={tableMetaText}
    bind:columnsButtonEl
    bind:statsButtonEl
    bind:codeButtonEl
    on:openColumns={openColumnVisibilityPanel}
    on:openStats={() => openStatsPanel({ toggle: true })}
    on:openCode={openCodeModal}
    on:refresh={() => vscode.postMessage({ type: 'refresh' })}
    on:export={(e) => handleExport(e.detail.format)}
/>

<RowFilterBar
    rowFilters={$rowFilters}
    visible={rowFilterSupported}
    bind:addFilterButtonEl={addRowFilterButtonEl}
    on:addFilter={() => openRowFilterEditor()}
    on:editFilter={(e) => openRowFilterEditor(e.detail.filter, e.detail.index)}
    on:removeFilter={(e) => removeRowFilter(e.detail.index)}
/>

<CodeModal
    open={$codeModalOpenStore}
    bind:codePreview
    bind:codeSyntax
    bind:codeModalEl
    on:close={() => { $codeModalOpenStore = false; }}
    on:convert={(e) => handleCodeConvert()}
    on:copy={() => {}}
/>

<div
    class="context-menu"
    id="column-menu"
    bind:this={columnMenuEl}
    class:open={$columnMenuOpenStore}
    style={`left: ${$columnMenuPositionStore.x}px; top: ${$columnMenuPositionStore.y}px;`}
>
    <button class="context-menu-item" id="column-menu-add-filter" disabled={!rowFilterSupported} on:click={handleColumnMenuAddFilter}>Add Filter</button>
    <button class="context-menu-item" id="column-menu-hide-column" disabled={$visibleSchema.length <= 1} on:click={handleColumnMenuHideColumn}>Hide Column</button>
</div>

<div class="table-area">
    <DataTable
        bind:this={dataTableComponent}
        state={$backendState}
        schema={$visibleSchema}
        {renderColumns}
        columnWidths={$columnWidths}
        activeSort={$activeSort}
        {sortSupported}
        {rowFilterSupported}
        {virtualRows}
        {virtualizerTotalHeight}
        rowCacheVersion={$rowCacheVersion}
        {headerScrollLeft}
        {leftSpacerWidth}
        {rightSpacerWidth}
        {getCellValue}
        {getRowLabel}
        {getColumnLabel}
        bind:tableBodyEl
        bind:tableHeaderEl
        bind:bodyInnerEl
        on:sort={(e) => handleDataTableSort(e.detail.columnIndex)}
        on:columnMenu={(e) => openColumnMenu(e.detail.event, e.detail.columnIndex)}
        on:openRowFilter={(e) => openRowFilterEditor(undefined, undefined, e.detail.columnIndex)}
        on:openStats={(e) => openStatsPanel({ columnIndex: e.detail.columnIndex })}
        on:hideColumn={(e) => hideColumn(e.detail.columnIndex)}
        on:scroll={handleDataTableScroll}
        on:startColumnResize={(e) => startColumnResize(e.detail.event, e.detail.columnIndex)}
    />
    {#if $pinnedPanelsStore.has('column-visibility-panel') && $columnVisibilityOpenStore}
        <ColumnVisibilityPanel
            open={$columnVisibilityOpenStore}
            pinned={true}
            displayedColumns={columnVisibilityDisplayedColumns}
            hiddenColumnIndices={$hiddenColumnIndices}
            bind:searchTerm={columnVisibilitySearchTerm}
            status={columnVisibilityStatus}
            bind:panelEl={columnVisibilityPanelEl}
            on:close={() => {
                setPanelPinned('column-visibility-panel', false);
                $columnVisibilityOpenStore = false;
            }}
            on:togglePin={() => setPanelPinned('column-visibility-panel', !isPanelPinned('column-visibility-panel'))}
            on:search={(e) => {
                columnVisibilitySearchTerm = e.detail.term;
                applyColumnSearch();
            }}
            on:clear={() => {
                columnVisibilitySearchTerm = '';
                applyColumnSearch();
            }}
            on:invert={invertColumnVisibility}
            on:toggleVisibility={(e) => toggleColumnVisibility(e.detail.columnIndex)}
            on:startResize={(e) => startSidePanelResize(e.detail.event, 'column-visibility-panel')}
        />
    {/if}
    {#if $pinnedPanelsStore.has('row-filter-panel') && $rowFilterPanelOpenStore}
        <RowFilterPanel
            open={$rowFilterPanelOpenStore}
            pinned={true}
            schema={$visibleSchema}
            bind:draft={rowFilterDraft}
            error={rowFilterError}
            rowFilterSupport={$rowFilterSupport}
            bind:panelEl={rowFilterPanelEl}
            on:close={() => {
                setPanelPinned('row-filter-panel', false);
                $rowFilterPanelOpenStore = false;
            }}
            on:togglePin={() => setPanelPinned('row-filter-panel', !isPanelPinned('row-filter-panel'))}
            on:save={(e) => saveRowFilter()}
            on:cancel={() => { $rowFilterPanelOpenStore = false; }}
            on:startResize={(e) => startSidePanelResize(e.detail.event, 'row-filter-panel')}
        />
    {/if}
    {#if $pinnedPanelsStore.has('stats-panel') && $statsPanelOpenStore}
        <StatsPanel
            isOpen={$statsPanelOpenStore}
            isPinned={true}
            schema={$visibleSchema}
            getColumnLabel={getColumnLabel}
            bind:statsColumnValue
            collapsedSections={$collapsedSectionsStore}
            bind:statsPanelEl
            bind:statsResultsEl
            bind:histogramContainer
            bind:frequencyContainer
            on:close={() => {
                setPanelPinned('stats-panel', false);
                $statsPanelOpenStore = false;
            }}
            on:togglePin={() => setPanelPinned('stats-panel', !isPanelPinned('stats-panel'))}
            on:columnChange={handleStatsColumnChange}
            on:toggleSection={(e) => toggleStatsSection(e.detail.sectionId)}
            on:binsInput={(e) => {
                histogramBinsStore.set(e.detail.value);
                handleHistogramBinsInput(e.detail.source);
            }}
            on:methodChange={handleStatsMethodChange}
            on:limitInput={(e) => {
                frequencyLimitStore.set(e.detail.value);
                handleFrequencyLimitInput(e.detail.source);
            }}
            on:startResize={(e) => startSidePanelResize(e.detail.event, 'stats-panel')}
        />
    {/if}

    <!-- Non-pinned panels: rendered with position:absolute inside .table-area -->
    {#if !$pinnedPanelsStore.has('column-visibility-panel')}
        <ColumnVisibilityPanel
            open={$columnVisibilityOpenStore}
            pinned={false}
            displayedColumns={columnVisibilityDisplayedColumns}
            hiddenColumnIndices={$hiddenColumnIndices}
            bind:searchTerm={columnVisibilitySearchTerm}
            status={columnVisibilityStatus}
            bind:panelEl={columnVisibilityPanelEl}
            on:close={() => {
                setPanelPinned('column-visibility-panel', false);
                $columnVisibilityOpenStore = false;
            }}
            on:togglePin={() => setPanelPinned('column-visibility-panel', !isPanelPinned('column-visibility-panel'))}
            on:search={(e) => {
                columnVisibilitySearchTerm = e.detail.term;
                applyColumnSearch();
            }}
            on:clear={() => {
                columnVisibilitySearchTerm = '';
                applyColumnSearch();
            }}
            on:invert={invertColumnVisibility}
            on:toggleVisibility={(e) => toggleColumnVisibility(e.detail.columnIndex)}
            on:startResize={(e) => startSidePanelResize(e.detail.event, 'column-visibility-panel')}
        />
    {/if}

    {#if !$pinnedPanelsStore.has('row-filter-panel')}
        <RowFilterPanel
            open={$rowFilterPanelOpenStore}
            pinned={false}
            schema={$visibleSchema}
            bind:draft={rowFilterDraft}
            error={rowFilterError}
            rowFilterSupport={$rowFilterSupport}
            bind:panelEl={rowFilterPanelEl}
            on:close={() => {
                setPanelPinned('row-filter-panel', false);
                $rowFilterPanelOpenStore = false;
            }}
            on:togglePin={() => setPanelPinned('row-filter-panel', !isPanelPinned('row-filter-panel'))}
            on:save={(e) => saveRowFilter()}
            on:cancel={() => { $rowFilterPanelOpenStore = false; }}
            on:startResize={(e) => startSidePanelResize(e.detail.event, 'row-filter-panel')}
        />
    {/if}

    {#if !$pinnedPanelsStore.has('stats-panel')}
        <StatsPanel
            isOpen={$statsPanelOpenStore}
            isPinned={false}
            schema={$visibleSchema}
            getColumnLabel={getColumnLabel}
            bind:statsColumnValue
            collapsedSections={$collapsedSectionsStore}
            bind:statsPanelEl
            bind:statsResultsEl
            bind:histogramContainer
            bind:frequencyContainer
            on:close={() => {
                setPanelPinned('stats-panel', false);
                $statsPanelOpenStore = false;
            }}
            on:togglePin={() => setPanelPinned('stats-panel', !isPanelPinned('stats-panel'))}
            on:columnChange={handleStatsColumnChange}
            on:toggleSection={(e) => toggleStatsSection(e.detail.sectionId)}
            on:binsInput={(e) => {
                histogramBinsStore.set(e.detail.value);
                handleHistogramBinsInput(e.detail.source);
            }}
            on:methodChange={handleStatsMethodChange}
            on:limitInput={(e) => {
                frequencyLimitStore.set(e.detail.value);
                handleFrequencyLimitInput(e.detail.source);
            }}
            on:startResize={(e) => startSidePanelResize(e.detail.event, 'stats-panel')}
        />
    {/if}
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
