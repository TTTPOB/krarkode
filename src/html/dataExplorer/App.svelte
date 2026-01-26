<script lang="ts">
    import { onDestroy, onMount, tick } from 'svelte';
    import { useVirtualizer, type VirtualRow } from './hooks/useVirtualizer';
    import { useStatsCharts } from './hooks/useStatsCharts';
    import { useVscodeMessages } from './hooks/useVscodeMessages';
    import { useStatsController } from './hooks/useStatsController';
    import { useSchemaController } from './hooks/useSchemaController';
    import { useRowFilterController } from './hooks/useRowFilterController';
    import {
        ColumnDef,
        Table,
        createTable,
        getCoreRowModel,
    } from '@tanstack/table-core';
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
        openColumnMenu as storeOpenColumnMenu,
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
        type ColumnValue,
        type RowsMessage,
        type InitMessage,
        type SortState,
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
        formatSpecialValue,
        getColumnLabel,
        isColumnNamed,
        clampNumber,
        createRowFilterDraft,
        computeDisplayedColumns,
        resolveColumnWidth,
        computeColumnWindow,
        buildRowBlockRanges,
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

    let pendingRows: RowsMessage[] = [];
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
    let lastScrollLeft = 0;
    let tableLayoutLogSequence = 0;
    let tableViewportWidth = 0;
    let tableBodyResizeObserver: ResizeObserver | null = null;
    let renderColumns: Array<{ column: ColumnSchema; schemaIndex: number }> = [];
    let leftSpacerWidth = 0;
    let rightSpacerWidth = 0;
    let lastColumnWindowKey = '';

    // TanStack Table state
    interface RowData {
        index: number;
    }
    let tableInstance: Table<RowData> | null = null;

    let activeColumnResize: { columnIndex: number; startX: number; startWidth: number } | null = null;
    let sidePanelResizeState: { startX: number; startWidth: number; panelId?: string } | null = null;

    // collapsedSections now comes from store via $collapsedSectionsStore

    let tableTitleText = 'Data Explorer';
    let tableMetaText = '';
    let rowRequestDebounceId: number | undefined = undefined;

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
    $: updateRenderColumns($visibleSchema, resolvedColumnWidths, headerScrollLeft, tableViewportWidth);

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
        getResolvedVisibleSchema,
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
        closeColumnMenu,
    });

    const {
        openRowFilterEditor,
        saveRowFilter,
        removeRowFilter,
    } = rowFilterController;

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

    function logTableLayoutState(stage: string): void {
        const rawWidths = $visibleSchema.map((column) => $columnWidths.get(column.column_index));
        const invalidWidths = rawWidths.filter((value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0);
        log('Table layout state', {
            stage,
            sequence: (tableLayoutLogSequence += 1),
            schemaCount: $visibleSchema.length,
            resolvedWidthCount: resolvedColumnWidths.length,
            widthSample: resolvedColumnWidths.slice(0, 6),
            totalWidth,
            columnTemplate,
            invalidWidthCount: invalidWidths.length,
        });
    }

    function logTableLayoutDom(stage: string): void {
        if (!tableHeaderEl && !tableBodyEl) {
            log('Table layout DOM skipped', { stage, reason: 'missing table elements' });
            return;
        }
        const headerRow = tableHeaderEl?.querySelector<HTMLDivElement>('.header-row');
        const bodyRow = tableBodyEl?.querySelector<HTMLDivElement>('.table-row');
        const headerStyle = headerRow ? getComputedStyle(headerRow) : null;
        const bodyStyle = bodyRow ? getComputedStyle(bodyRow) : null;
        log('Table layout DOM', {
            stage,
            headerDisplay: headerStyle?.display,
            headerGridTemplate: headerStyle?.gridTemplateColumns,
            headerWidth: headerRow?.getBoundingClientRect().width,
            bodyDisplay: bodyStyle?.display,
            bodyGridTemplate: bodyStyle?.gridTemplateColumns,
            bodyWidth: bodyRow?.getBoundingClientRect().width,
            scrollWidth: tableBodyEl?.scrollWidth,
            clientWidth: tableBodyEl?.clientWidth,
        });
    }

    function scheduleTableLayoutDiagnostics(stage: string): void {
        void tick().then(() => {
            logTableLayoutState(stage);
            logTableLayoutDom(stage);
        });
    }


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

    function setSidePanelWidth(width: number): void {
        document.body.style.setProperty('--side-panel-width', `${width}px`);
        requestAnimationFrame(() => {
            statsCharts.resize();
        });
    }

    function startSidePanelResize(event: MouseEvent, panelId?: string): void {
        const panel = panelId ? document.getElementById(panelId) : null;
        const startWidth = panel?.getBoundingClientRect().width ?? statsPanelEl?.getBoundingClientRect().width ?? SIDE_PANEL_MIN_WIDTH;
        sidePanelResizeState = {
            startX: event.clientX,
            startWidth,
            panelId,
        };
        log('Side panel resize started', { panelId, startWidth });
        document.body.classList.add('panel-resizing');
        event.preventDefault();
    }

    function handleSidePanelResize(event: MouseEvent): void {
        if (!sidePanelResizeState) {
            return;
        }
        const delta = sidePanelResizeState.startX - event.clientX;
        const nextWidth = clampNumber(
            sidePanelResizeState.startWidth + delta,
            SIDE_PANEL_MIN_WIDTH,
            SIDE_PANEL_MAX_WIDTH,
            sidePanelResizeState.startWidth
        );
        setSidePanelWidth(nextWidth);
    }

    function finishSidePanelResize(): void {
        if (!sidePanelResizeState) {
            return;
        }
        const { panelId, startWidth } = sidePanelResizeState;
        const resolvedWidth = statsPanelEl?.getBoundingClientRect().width;
        log('Side panel resize finished', { panelId, startWidth, resolvedWidth });
        sidePanelResizeState = null;
        document.body.classList.remove('panel-resizing');
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

    function handleConvertToCodeResult(code: string): void {
        codePreview = code || '(No code generated)';
    }

    function handleSuggestCodeSyntaxResult(syntax: string): void {
        codeSyntax = syntax;
    }

    function openColumnVisibilityPanel(): void {
        $columnVisibilityOpenStore = !$columnVisibilityOpenStore;
        $statsPanelOpenStore = false;
        $codeModalOpenStore = false;
        $rowFilterPanelOpenStore = false;
    }

    function openCodeModal(): void {
        const shouldOpen = !$codeModalOpenStore;
        if (shouldOpen) {
            vscode.postMessage({ type: 'suggestCodeSyntax' });
        }
        $codeModalOpenStore = shouldOpen;
        $columnVisibilityOpenStore = false;
        $statsPanelOpenStore = false;
        $rowFilterPanelOpenStore = false;
    }

    function getNextSort(columnIndex: number): SortState | null {
        if (!$activeSort || $activeSort.columnIndex !== columnIndex) {
            return { columnIndex, direction: 'asc' };
        }
        if ($activeSort.direction === 'asc') {
            return { columnIndex, direction: 'desc' };
        }
        return null;
    }

    function updateHeaderScroll(scrollLeft: number): void {
        headerScrollLeft = scrollLeft;
    }

    function applyColumnLayout(): void {
        if (bodyInnerEl) {
            bodyInnerEl.style.width = `${totalWidth}px`;
        }
    }

    function startColumnResize(event: MouseEvent, columnIndex: number): void {
        event.preventDefault();
        event.stopPropagation();
        const startWidth = $columnWidths.get(columnIndex) ?? COLUMN_WIDTH;
        activeColumnResize = {
            columnIndex,
            startX: event.clientX,
            startWidth,
        };
        document.body.classList.add('column-resizing');
        log('Column resize started', { columnIndex, startWidth });
    }

    function handleColumnResizeMove(event: MouseEvent): void {
        if (!activeColumnResize) {
            return;
        }
        const delta = event.clientX - activeColumnResize.startX;
        const nextWidth = Math.max(MIN_COLUMN_WIDTH, activeColumnResize.startWidth + delta);
        const currentWidth = $columnWidths.get(activeColumnResize.columnIndex) ?? COLUMN_WIDTH;
        if (currentWidth === nextWidth) {
            return;
        }
        const nextWidths = new Map($columnWidths);
        nextWidths.set(activeColumnResize.columnIndex, nextWidth);
        columnWidths.set(nextWidths);
        log('Column resize update', { columnIndex: activeColumnResize.columnIndex, width: nextWidth });
        applyColumnLayout();
    }

    function handleColumnResizeEnd(): void {
        if (!activeColumnResize) {
            return;
        }
        const columnIndex = activeColumnResize.columnIndex;
        const width = $columnWidths.get(columnIndex) ?? COLUMN_WIDTH;
        log('Column resize ended', { columnIndex, width });
        activeColumnResize = null;
        document.body.classList.remove('column-resizing');
        dataTableComponent?.setIgnoreHeaderSortClick(true);
        scheduleTableLayoutDiagnostics('column-resize-end');
        window.setTimeout(() => {
            dataTableComponent?.setIgnoreHeaderSortClick(false);
        }, 0);
    }

    function updateVirtualizer(): void {
        virtualizer.update();
    }

    function updateRenderColumns(
        schema: ColumnSchema[],
        widths: number[],
        scrollLeft: number,
        viewportWidth: number,
    ): void {
        const windowResult = computeColumnWindow({
            schema,
            widths,
            scrollLeft,
            viewportWidth,
            virtualizationThreshold: COLUMN_VIRTUALIZATION_THRESHOLD,
        });

        renderColumns = windowResult.renderColumns;
        leftSpacerWidth = windowResult.leftSpacerWidth;
        rightSpacerWidth = windowResult.rightSpacerWidth;

        if (windowResult.windowKey !== lastColumnWindowKey) {
            lastColumnWindowKey = windowResult.windowKey;
            log('Column window updated', {
                startIndex: windowResult.startIndex,
                endIndex: windowResult.endIndex,
                leftSpacerWidth: windowResult.leftSpacerWidth,
                rightSpacerWidth: windowResult.rightSpacerWidth,
                viewportWidth,
                scrollLeft,
            });
        }
    }

    function attachTableBodyObserver(target: HTMLDivElement | undefined): void {
        if (!target || tableBodyResizeObserver) {
            return;
        }
        tableBodyResizeObserver = new ResizeObserver(() => {
            const width = target?.clientWidth ?? 0;
            if (width !== tableViewportWidth) {
                tableViewportWidth = width;
                log('Table viewport resized', { width });
            }
        });
        tableBodyResizeObserver.observe(target);
        tableViewportWidth = target.clientWidth;
        log('Table viewport observer attached', { width: tableViewportWidth });
    }

    function buildColumnDefs(): ColumnDef<RowData>[] {
        const columns: ColumnDef<RowData>[] = [];

        // Row label column
        columns.push({
            id: 'row-label',
            header: $backendState?.has_row_labels ? '#' : 'Row',
            accessorFn: (row) => getRowLabel(row.index),
        });

        // Data columns
        for (let i = 0; i < $visibleSchema.length; i++) {
            const column = $visibleSchema[i];
            const schemaIndex = i;
            columns.push({
                id: `col-${column.column_index}`,
                header: getColumnLabel(column),
                accessorFn: (row) => getCellValue(row.index, schemaIndex),
            });
        }

        return columns;
    }

    function setupTable(): void {
        if (!$backendState) {
            return;
        }

        const rowCount = $backendState.table_shape.num_rows;
        const rowData: RowData[] = Array.from({ length: rowCount }, (_, index) => ({ index }));
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

        log('Table setup complete', { rowCount, columnCount: columns.length });
    }

    function requestInitialBlock(): void {
        if (!$backendState) {
            return;
        }
        if ($backendState.table_shape.num_rows === 0) {
            return;
        }
        const endIndex = Math.min($backendState.table_shape.num_rows - 1, ROW_BLOCK_SIZE - 1);
        if ($loadedBlocks.has(0) || $loadingBlocks.has(0)) {
            return;
        }
        loadingBlocks.update((blocks: Set<number>) => {
            const next = new Set(blocks);
            next.add(0);
            return next;
        });
        vscode.postMessage({
            type: 'requestRows',
            startIndex: 0,
            endIndex,
        });
    }

    function scheduleVisibleBlocksRequest(reason: string): void {
        if (rowRequestDebounceId !== undefined) {
            window.clearTimeout(rowRequestDebounceId);
        }
        rowRequestDebounceId = window.setTimeout(() => {
            rowRequestDebounceId = undefined;
            requestVisibleBlocks(reason);
        }, ROW_REQUEST_DEBOUNCE_MS);
    }

    function requestVisibleBlocks(reason: string): void {
        if (!$backendState) {
            return;
        }

        const virtualItems = virtualizer.getVirtualItems();
        if (!virtualItems.length) {
            return;
        }

        const startIndex = virtualItems[0].index;
        const endIndex = virtualItems[virtualItems.length - 1].index;
        const rowCount = $backendState.table_shape.num_rows;
        const rangeResult = buildRowBlockRanges({
            startIndex,
            endIndex,
            rowCount,
            blockSize: ROW_BLOCK_SIZE,
            prefetchBlocks: ROW_PREFETCH_BLOCKS,
            loadedBlocks: $loadedBlocks,
            loadingBlocks: $loadingBlocks,
        });

        if (!rangeResult || rangeResult.ranges.length === 0) {
            return;
        }

        log('Requesting row blocks', {
            reason,
            visibleRange: rangeResult.visibleRange,
            prefetchRange: rangeResult.prefetchRange,
            ranges: rangeResult.ranges.map((range) => ({ startBlock: range.startBlock, endBlock: range.endBlock })),
        });

        for (const range of rangeResult.ranges) {
            loadingBlocks.update((blocks: Set<number>) => {
                const next = new Set(blocks);
                for (let block = range.startBlock; block <= range.endBlock; block += 1) {
                    next.add(block);
                }
                return next;
            });

            const blockStart = range.startBlock * ROW_BLOCK_SIZE;
            const blockEnd = Math.min(rowCount - 1, (range.endBlock + 1) * ROW_BLOCK_SIZE - 1);
            vscode.postMessage({
                type: 'requestRows',
                startIndex: blockStart,
                endIndex: blockEnd,
            });
        }
    }

    function handleRows(message: RowsMessage): void {
        if (!$backendState || $visibleSchema.length === 0) {
            pendingRows.push(message);
            log('Queued rows before init', { startIndex: message.startIndex, endIndex: message.endIndex });
            return;
        }
        const { startIndex, endIndex, columns, rowLabels } = message;
        const rowCount = endIndex - startIndex + 1;
        const columnCount = $visibleSchema.length;
        const nextRowCache = new Map($rowCache);
        const nextRowLabelCache = new Map($rowLabelCache);

        for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
            const rowIndex = startIndex + rowOffset;
            const values: string[] = new Array(columnCount).fill('');

            for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
                const columnValues = columns[columnIndex];
                const value = columnValues ? columnValues[rowOffset] : '';
                values[columnIndex] = formatColumnValue(value);
            }

            nextRowCache.set(rowIndex, values);
            if (rowLabels && rowLabels[rowOffset] !== undefined) {
                nextRowLabelCache.set(rowIndex, rowLabels[rowOffset]);
            }
        }

        const startBlock = Math.floor(startIndex / ROW_BLOCK_SIZE);
        const endBlock = Math.floor(endIndex / ROW_BLOCK_SIZE);
        const nextLoadedBlocks = new Set($loadedBlocks);
        const nextLoadingBlocks = new Set($loadingBlocks);
        for (let block = startBlock; block <= endBlock; block += 1) {
            nextLoadingBlocks.delete(block);
            nextLoadedBlocks.add(block);
        }

        rowCache.set(nextRowCache);
        rowLabelCache.set(nextRowLabelCache);
        loadedBlocks.set(nextLoadedBlocks);
        loadingBlocks.set(nextLoadingBlocks);
        rowCacheVersion.update((version: number) => version + 1);
        virtualizer.measure();
        log('Rows rendered', { startIndex, endIndex, rows: rowCount, columns: columnCount });
    }

    function handleInit(message: InitMessage): void {
        initializeDataStore(message.state, message.schema ?? []);
        columnVisibilityStatus = '';
        columnVisibilitySearchTerm = '';
        if (activeStatsColumnIndex === null) {
            setStatsMessage('Select a column to view statistics.', 'empty');
        } else {
            setStatsMessage('Loading statistics...', 'loading');
        }
        clearStatsContent();
        codePreview = '';
        applySchemaUpdate($visibleSchema);
        if (pendingRows.length > 0) {
            const queued = [...pendingRows];
            pendingRows = [];
            queued.forEach((rowsMessage) => handleRows(rowsMessage));
            log('Applied pending rows', { count: queued.length });
        }
        log('Data explorer initialized', {
            rows: message.state.table_shape.num_rows,
            columns: $visibleSchema.length,
        });
        scheduleTableLayoutDiagnostics('init');
    }

    function openColumnMenu(event: MouseEvent, columnIndex: number): void {
        $columnMenuColumnIndexStore = columnIndex;
        $columnMenuOpenStore = true;
        void tick().then(() => {
            const padding = 8;
            const { innerWidth, innerHeight } = window;
            const menuRect = columnMenuEl?.getBoundingClientRect();
            const menuWidth = menuRect?.width ?? 160;
            const menuHeight = menuRect?.height ?? 80;
            const nextLeft = Math.min(event.clientX, innerWidth - menuWidth - padding);
            const nextTop = Math.min(event.clientY, innerHeight - menuHeight - padding);
            $columnMenuPositionStore = { 
                x: Math.max(nextLeft, padding), 
                y: Math.max(nextTop, padding) 
            };
        });
    }

    function closeColumnMenu(): void {
        storeCloseColumnMenu();
    }

    function handleColumnMenuAddFilter(): void {
        if ($columnMenuColumnIndexStore === null) {
            return;
        }
        const selectedColumnIndex = $columnMenuColumnIndexStore;
        closeColumnMenu();
        openRowFilterEditor(undefined, undefined, selectedColumnIndex);
    }

    function handleColumnMenuHideColumn(): void {
        if ($columnMenuColumnIndexStore === null) {
            return;
        }
        const selectedColumnIndex = $columnMenuColumnIndexStore;
        closeColumnMenu();
        hideColumn(selectedColumnIndex);
    }

    function handleDataTableSort(columnIndex: number): void {
        const nextSort = getNextSort(columnIndex);
        activeSort.set(nextSort);
        vscode.postMessage({
            type: 'setSort',
            sortKey: nextSort
                ? { columnIndex: nextSort.columnIndex, direction: nextSort.direction }
                : null,
        });
    }

    function handleDataTableScroll(): void {
        if ($columnMenuOpenStore) {
            closeColumnMenu();
        }
        if (tableBodyEl && tableBodyEl.scrollLeft !== lastScrollLeft) {
            updateHeaderScroll(tableBodyEl.scrollLeft);
            lastScrollLeft = tableBodyEl.scrollLeft;
        }
    }

    function buildTableMetaText(): string {
        if (!$backendState) {
            return '';
        }
        const { num_rows } = $backendState.table_shape;
        const num_columns = $visibleSchema.length;
        const { num_rows: rawRows, num_columns: rawColumns } = $backendState.table_unfiltered_shape;
        const filteredText = num_rows !== rawRows || num_columns !== rawColumns
            ? ` (${rawRows}x${rawColumns} raw)`
            : '';
        const unnamedCount = $fullSchema.filter((column) => !isColumnNamed(column)).length;
        const unnamedText = unnamedCount
            ? ` - ${unnamedCount === $fullSchema.length ? 'No column names' : `${unnamedCount} unnamed columns`}`
            : '';
        return `${num_rows}x${num_columns}${filteredText}${unnamedText}`;
    }

    function getCellValue(rowIndex: number, columnIndex: number, _version?: number): string {
        const values = $rowCache.get(rowIndex);
        if (!values) {
            return '';
        }
        return values[columnIndex] ?? '';
    }

    function getRowLabel(rowIndex: number, _version?: number): string {
        if ($backendState?.has_row_labels) {
            return $rowLabelCache.get(rowIndex) ?? '';
        }
        return String(rowIndex + 1);
    }

    function formatColumnValue(value: ColumnValue): string {
        if (typeof value === 'number') {
            return formatSpecialValue(value);
        }
        return value ?? '';
    }

    function handleCodeConvert(): void {
        vscode.postMessage({ type: 'convertToCode', syntax: codeSyntax });
    }

    function handleCodeCopy(): void {
        if (codePreview) {
            navigator.clipboard.writeText(codePreview);
        }
    }

    function handleExport(format: 'csv' | 'tsv' | 'html'): void {
        vscode.postMessage({ type: 'exportData', format });
    }

    function handleDocumentClick(event: MouseEvent): void {
        const target = event.target as Node;
        if ($columnMenuOpenStore && columnMenuEl && !columnMenuEl.contains(target)) {
            closeColumnMenu();
        }
        if ($statsPanelOpenStore
            && statsPanelEl
            && !statsPanelEl.contains(target)
            && statsButtonEl
            && !statsButtonEl.contains(target)
            && !isPanelPinned('stats-panel')) {
            $statsPanelOpenStore = false;
        }
        if ($columnVisibilityOpenStore
            && columnVisibilityPanelEl
            && !columnVisibilityPanelEl.contains(target)
            && columnsButtonEl
            && !columnsButtonEl.contains(target)
            && !isPanelPinned('column-visibility-panel')) {
            $columnVisibilityOpenStore = false;
        }
        if ($codeModalOpenStore
            && codeModalEl
            && !codeModalEl.contains(target)
            && codeButtonEl
            && !codeButtonEl.contains(target)) {
            $codeModalOpenStore = false;
        }
        if ($rowFilterPanelOpenStore
            && rowFilterPanelEl
            && !rowFilterPanelEl.contains(target)
            && addRowFilterButtonEl
            && !addRowFilterButtonEl.contains(target)
            && !isPanelPinned('row-filter-panel')) {
            $rowFilterPanelOpenStore = false;
        }
    }

    function handleWindowResize(): void {
        closeColumnMenu();
        statsCharts.resize();
    }

    function handleWindowKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            closeColumnMenu();
        }
    }

    function handleWindowMouseMove(event: MouseEvent): void {
        handleSidePanelResize(event);
        handleColumnResizeMove(event);
    }

    function handleWindowMouseUp(): void {
        finishSidePanelResize();
        handleColumnResizeEnd();
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
        if (rowRequestDebounceId !== undefined) {
            window.clearTimeout(rowRequestDebounceId);
        }
        if (tableBodyResizeObserver) {
            tableBodyResizeObserver.disconnect();
            tableBodyResizeObserver = null;
        }
        disposeStatsController();
        disposeSchemaController();
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

<ColumnVisibilityPanel
    open={$columnVisibilityOpenStore}
    pinned={isPanelPinned('column-visibility-panel')}
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

<RowFilterPanel
    open={$rowFilterPanelOpenStore}
    pinned={isPanelPinned('row-filter-panel')}
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

<StatsPanel
    isOpen={$statsPanelOpenStore}
    isPinned={isPanelPinned('stats-panel')}
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
