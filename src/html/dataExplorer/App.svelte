<script lang="ts">
    import { onDestroy, onMount, tick } from 'svelte';
    import { useVirtualizer, type VirtualRow } from './hooks/useVirtualizer';
    import { useStatsCharts } from './hooks/useStatsCharts';
    import { useVscodeMessages } from './hooks/useVscodeMessages';
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
        type ColumnFilter,
        type RowFilter,
        type RowFilterType,
        type RowFilterCondition,
        type ColumnHistogram,
        type ColumnFrequencyTable,
        type ColumnProfileResult,
        type ColumnValue,
        type RowsMessage,
        type InitMessage,
        type SortDirection,
        type SortState,
        type StatsMessageState,
        type RowFilterDraft,
        ROW_HEIGHT,
        ROW_BLOCK_SIZE,
        COLUMN_WIDTH,
        MIN_COLUMN_WIDTH,
        ROW_LABEL_WIDTH,
        DEFAULT_HISTOGRAM_BINS,
        DEFAULT_FREQUENCY_LIMIT,
        HISTOGRAM_BINS_MIN,
        HISTOGRAM_BINS_MAX,
        FREQUENCY_LIMIT_MIN,
        FREQUENCY_LIMIT_MAX,
        SMALL_HISTOGRAM_MAX_BINS,
        SMALL_FREQUENCY_MAX_LIMIT,
        STATS_REFRESH_DEBOUNCE_MS,
        SIDE_PANEL_MIN_WIDTH,
        SIDE_PANEL_MAX_WIDTH,
        ROW_FILTER_SECTION_MAP,
        getVsCodeApi,
    } from './types';
    import {
        formatStatValue,
        formatQuantileLabel,
        formatQuantileValue,
        buildSummaryRows,
        formatSpecialValue,
        getColumnLabel,
        isColumnNamed,
        formatRowFilterChip,
        createRowFilterDraft,
        buildRowFilterParams,
        createRowFilterId,
        getSupportedRowFilterTypes,
        resolveSchemaMatches,
        computeDisplayedColumns,
        resolveVisibleSchema,
        isRowFilterSupported as checkRowFilterSupported,
        isColumnFilterSupported as checkColumnFilterSupported,
        isSetColumnFiltersSupported as checkSetColumnFiltersSupported,
        supportsRowFilterConditions as checkSupportsRowFilterConditions,
        isSortSupported as checkSortSupported,
    } from './utils';

    const vscode = getVsCodeApi();
    const debugEnabled = typeof window !== 'undefined'
        && (window as { __krarkodeDebug?: boolean }).__krarkodeDebug === true;

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

    let statsRefreshDebounceId: number | undefined;
    let columnVisibilityDebounceId: number | undefined;
    let pendingStatsScrollTop: number | null = null;

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
            requestVisibleBlocks();
        },
        log,
    });

    const statsCharts = useStatsCharts({
        getHistogramContainer: () => histogramContainer,
        getFrequencyContainer: () => frequencyContainer,
        log,
    });

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

    function clampNumber(value: number, min: number, max: number, fallback: number): number {
        if (!Number.isFinite(value)) {
            return fallback;
        }
        return Math.min(Math.max(Math.round(value), min), max);
    }

    function resolveColumnWidth(width: number | undefined): number {
        if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
            return COLUMN_WIDTH;
        }
        return Math.max(MIN_COLUMN_WIDTH, Math.round(width));
    }

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

    function openRowFilterEditor(filter?: RowFilter, index?: number, columnIndex?: number): void {
        if (!isRowFilterSupported()) {
            return;
        }

        if (!$visibleSchema.length) {
            log('Row filter editor skipped; schema not loaded.');
            return;
        }

        editingRowFilterIndex = index ?? null;
        rowFilterDraft = createRowFilterDraft(
            $visibleSchema,
            filter,
            columnIndex,
            getSupportedRowFilterTypes($rowFilterSupport)
        );
        rowFilterError = '';
        $rowFilterPanelOpenStore = true;
        $columnVisibilityOpenStore = false;
        $statsPanelOpenStore = false;
        $codeModalOpenStore = false;
        closeColumnMenu();
        log('Row filter editor opened', { filter, index });
    }

    function handleRowFilterColumnChange(event: Event): void {
        const target = event.target as HTMLSelectElement | null;
        if (!target) {
            return;
        }
        rowFilterDraft = {
            ...rowFilterDraft,
            columnIndex: parseInt(target.value, 10),
        };
    }

    function saveRowFilter(): void {
        const column = $visibleSchema.find((item) => item.column_index === rowFilterDraft.columnIndex);
        if (!column) {
            rowFilterError = 'Select a column.';
            return;
        }

        const params = buildRowFilterParams(rowFilterDraft.filterType, rowFilterDraft);
        if (!params.valid) {
            rowFilterError = params.errorMessage ?? '';
            return;
        }

        const condition: RowFilterCondition = supportsRowFilterConditions()
            ? rowFilterDraft.condition
            : 'and';

        const filterId = editingRowFilterIndex !== null
            ? $rowFilters[editingRowFilterIndex]?.filter_id
            : createRowFilterId();

        if (!filterId) {
            rowFilterError = 'Unable to create filter ID.';
            return;
        }

        const filter: RowFilter = {
            filter_id: filterId,
            filter_type: rowFilterDraft.filterType,
            column_schema: column,
            condition,
            params: params.value,
        };

        const nextFilters = [...$rowFilters];
        if (editingRowFilterIndex !== null) {
            nextFilters[editingRowFilterIndex] = filter;
        } else {
            nextFilters.push(filter);
        }
        rowFilters.set(nextFilters);
        $rowFilterPanelOpenStore = false;
        rowFilterError = '';
        vscode.postMessage({ type: 'setRowFilters', filters: nextFilters });
        log('Row filters saved', { count: nextFilters.length, filter });
    }

    function removeRowFilter(index: number): void {
        const nextFilters = [...$rowFilters];
        nextFilters.splice(index, 1);
        rowFilters.set(nextFilters);
        vscode.postMessage({ type: 'setRowFilters', filters: nextFilters });
        log('Row filter removed', { index, count: nextFilters.length });
    }

    function setStatsMessage(message: string, stateValue: StatsMessageState): void {
        statsMessageTextStore.set(message);
        statsMessageStateStore.set(stateValue);
        statsSectionsVisibleStore.set(false);
        statsControlsEnabledStore.set(stateValue !== 'empty');
    }

    function showStatsSections(): void {
        statsSectionsVisibleStore.set(true);
        statsControlsEnabledStore.set(true);
    }

    function clearStatsContent(options: { preserveScrollTop?: boolean } = {}): void {
        const preserveScrollTop = options.preserveScrollTop === true;
        // When preserving scroll, keep existing data to prevent DOM rebuild
        // New data will replace it when profiles arrive
        if (!preserveScrollTop) {
            statsOverviewRowsStore.set([]);
            statsSummaryRowsStore.set([]);
            statsOverviewEmptyMessageStore.set('No overview data.');
            statsSummaryEmptyMessageStore.set('No summary statistics.');
            frequencyFootnoteStore.set('');
            clearHistogram();
            clearFrequency();
            if (statsResultsEl) {
                statsResultsEl.scrollTop = 0;
            }
        }
        // Charts are cleared regardless since they will be redrawn
        // but histogram/frequency data is kept visually until new data arrives
    }

    function syncHistogramBins(source: 'slider' | 'input'): void {
        const rawValue = $histogramBinsStore;
        const nextValue = clampNumber(rawValue, HISTOGRAM_BINS_MIN, HISTOGRAM_BINS_MAX, DEFAULT_HISTOGRAM_BINS);
        histogramBinsStore.set(nextValue);
        if ($histogramMethodStore !== 'fixed') {
            const previousMethod = $histogramMethodStore;
            histogramMethodStore.set('fixed');
            log('Histogram method forced to fixed for bins update', { previousMethod });
        }
        log('Histogram bins updated', { value: nextValue, source });
        scheduleStatsRefresh('histogram-bins');
    }

    function syncFrequencyLimit(source: 'slider' | 'input'): void {
        const rawValue = $frequencyLimitStore;
        const nextValue = clampNumber(rawValue, FREQUENCY_LIMIT_MIN, FREQUENCY_LIMIT_MAX, DEFAULT_FREQUENCY_LIMIT);
        frequencyLimitStore.set(nextValue);
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
        const preserveScrollTop = ['histogram-bins', 'histogram-method', 'frequency-limit'].includes(reason);
        statsRefreshDebounceId = window.setTimeout(() => {
            requestColumnProfiles(reason, { preserveScrollTop });
        }, STATS_REFRESH_DEBOUNCE_MS);
    }

    function requestColumnProfiles(reason: string, options: { preserveScrollTop?: boolean } = {}): void {
        if (activeStatsColumnIndex === null) {
            return;
        }
        const preserveScrollTop = options.preserveScrollTop === true;
        const histogramBinsValue = clampNumber($histogramBinsStore, HISTOGRAM_BINS_MIN, HISTOGRAM_BINS_MAX, DEFAULT_HISTOGRAM_BINS);
        const frequencyLimitValue = clampNumber($frequencyLimitStore, FREQUENCY_LIMIT_MIN, FREQUENCY_LIMIT_MAX, DEFAULT_FREQUENCY_LIMIT);
        const histogramProfile = histogramBinsValue > SMALL_HISTOGRAM_MAX_BINS ? 'large_histogram' : 'small_histogram';
        const frequencyProfile = frequencyLimitValue > SMALL_FREQUENCY_MAX_LIMIT ? 'large_frequency_table' : 'small_frequency_table';
        const profileTypes = ['null_count', 'summary_stats', histogramProfile, frequencyProfile];
        const histogramParams = {
            method: $histogramMethodStore,
            num_bins: histogramBinsValue,
            quantiles: [0.25, 0.5, 0.75],
        };
        const frequencyParams = {
            limit: frequencyLimitValue,
        };

        log('Requesting column profiles', {
            columnIndex: activeStatsColumnIndex,
            profileTypes,
            histogramParams,
            frequencyParams,
            reason,
        });

        if (preserveScrollTop && statsResultsEl) {
            pendingStatsScrollTop = statsResultsEl.scrollTop;
            log('Preserving stats scroll position', { scrollTop: pendingStatsScrollTop, reason });
        } else {
            pendingStatsScrollTop = null;
        }

        // When preserving scroll (slider adjustments), keep sections visible
        // to prevent DOM rebuild and scroll jump
        if (!preserveScrollTop) {
            setStatsMessage('Loading statistics...', 'loading');
        }
        clearStatsContent({ preserveScrollTop });
        vscode.postMessage({
            type: 'getColumnProfiles',
            columnIndex: activeStatsColumnIndex,
            profileTypes,
            histogramParams,
            frequencyParams,
        });
    }

    async function finalizeStatsScroll(): Promise<void> {
        await tick();
        if (!statsResultsEl) {
            pendingStatsScrollTop = null;
            return;
        }
        if (pendingStatsScrollTop === null) {
            statsResultsEl.scrollTop = 0;
            return;
        }
        const maxScrollTop = Math.max(statsResultsEl.scrollHeight - statsResultsEl.clientHeight, 0);
        const nextScrollTop = Math.min(pendingStatsScrollTop, maxScrollTop);
        statsResultsEl.scrollTop = nextScrollTop;
        pendingStatsScrollTop = null;
    }

    function syncHistogramBinsFromProfile(histogram: ColumnHistogram | undefined): void {
        if (!histogram || $histogramMethodStore === 'fixed') {
            return;
        }
        const binCount = histogram.bin_counts?.length ?? 0;
        if (binCount <= 0) {
            return;
        }
        const nextValue = clampNumber(binCount, HISTOGRAM_BINS_MIN, HISTOGRAM_BINS_MAX, DEFAULT_HISTOGRAM_BINS);
        if ($histogramBinsStore !== nextValue) {
            histogramBinsStore.set(nextValue);
            log('Histogram bins synced from profile', { value: nextValue, method: $histogramMethodStore });
        }
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

    function initializeStatsDefaults(): void {
        histogramBinsStore.set(DEFAULT_HISTOGRAM_BINS);
        histogramMethodStore.set('freedman_diaconis');
        frequencyLimitStore.set(DEFAULT_FREQUENCY_LIMIT);
        statsControlsEnabledStore.set(false);
    }

    function clearHistogram(): void {
        histogramVisibleStore.set(false);
        statsCharts.clearHistogram();
    }

    function clearFrequency(): void {
        frequencyVisibleStore.set(false);
        frequencyFootnoteStore.set('');
        statsCharts.clearFrequency();
    }

    function renderHistogram(histogram: ColumnHistogram | undefined, columnLabel: string): void {
        const rendered = statsCharts.renderHistogram(histogram, columnLabel);
        histogramVisibleStore.set(rendered);
        if (rendered) {
            log('Rendering histogram', { columnLabel, bins: histogram?.bin_counts?.length ?? 0 });
        } else {
            clearHistogram();
        }
    }

    function renderFrequencyChart(frequency: ColumnFrequencyTable | undefined): void {
        const rendered = statsCharts.renderFrequency(frequency);
        frequencyVisibleStore.set(rendered);
        if (rendered) {
            log('Rendering frequency chart', { values: frequency?.values?.length ?? 0 });
        } else {
            clearFrequency();
        }
    }

    function handleColumnProfilesResult(columnIndex: number, profiles: ColumnProfileResult[], errorMessage?: string): void {
        if (activeStatsColumnIndex !== null && columnIndex !== activeStatsColumnIndex) {
            log('Ignoring stale column profiles', { columnIndex, activeStatsColumnIndex });
            return;
        }
        if (errorMessage) {
            setStatsMessage(`Error: ${errorMessage}`, 'error');
            clearStatsContent();
            void finalizeStatsScroll();
            return;
        }

        log('Column profiles received', { columnIndex, profiles });
        if (!profiles || profiles.length === 0) {
            setStatsMessage('No statistics available for this column.', 'empty');
            clearStatsContent();
            void finalizeStatsScroll();
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

        const column = $visibleSchema.find((col) => col.column_index === columnIndex);
        const columnLabel = column ? getColumnLabel(column) : `Column ${columnIndex + 1}`;
        const summaryStats = combined.summary_stats;
        const histogram = combined.large_histogram ?? combined.small_histogram;
        const frequency = combined.large_frequency_table ?? combined.small_frequency_table;
        const quantiles = histogram?.quantiles ?? [];

        statsOverviewRowsStore.set([
            { label: 'Column', value: columnLabel },
            { label: 'Type', value: formatStatValue(summaryStats?.type_display) },
            { label: 'Null Count', value: formatStatValue(combined.null_count) },
        ]);
        statsSummaryRowsStore.set(buildSummaryRows(summaryStats, quantiles));
        statsOverviewEmptyMessageStore.set('No overview data.');
        statsSummaryEmptyMessageStore.set('No summary statistics.');

        syncHistogramBinsFromProfile(histogram);
        renderHistogram(histogram, columnLabel);
        renderFrequencyChart(frequency);
        if (!frequency) {
            frequencyFootnoteStore.set('No frequency data.');
        } else if (frequency.other_count !== undefined) {
            frequencyFootnoteStore.set(`Other values: ${frequency.other_count}`);
            log('Frequency table contains other values', { otherCount: frequency.other_count });
        } else {
            frequencyFootnoteStore.set('');
        }

        showStatsSections();
        void finalizeStatsScroll();
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

    function handleSearchSchemaResult(matches: Array<number | string | Record<string, unknown>>): void {
        const searchTerm = columnVisibilitySearchTerm.trim();
        if (!searchTerm) {
            columnFilterMatches.set(null);
            columnVisibilityStatus = 'Showing all columns.';
            return;
        }
        columnFilterMatches.set(matches);
        if (!isSetColumnFiltersSupported()) {
            applySchemaUpdate(getResolvedVisibleSchema());
        }
        columnVisibilityStatus = `Found ${matches.length} matching columns.`;
    }

    function getResolvedVisibleSchema(): ColumnSchema[] {
        return resolveVisibleSchema($fullSchema, $columnFilterMatches, $hiddenColumnIndices, isSetColumnFiltersSupported());
    }

    function applySchemaUpdate(nextSchema: ColumnSchema[]): void {
        rowCache.set(new Map());
        rowLabelCache.set(new Map());
        loadedBlocks.set(new Set());
        loadingBlocks.set(new Set());
        rowCacheVersion.set(0);
        const previousWidths = new Map($columnWidths);
        const nextWidths = new Map<number, number>();
        $fullSchema.forEach((column) => {
            const width = previousWidths.get(column.column_index);
            if (width !== undefined) {
                nextWidths.set(column.column_index, width);
            }
        });
        nextSchema.forEach((column) => {
            if (!nextWidths.has(column.column_index)) {
                nextWidths.set(column.column_index, COLUMN_WIDTH);
            }
        });
        columnWidths.set(nextWidths);
        setupTable();
        updateVirtualizer();
        requestInitialBlock();
        if ($statsPanelOpenStore) {
            if (activeStatsColumnIndex !== null) {
                const stillExists = nextSchema.some((column) => column.column_index === activeStatsColumnIndex);
                if (!stillExists) {
                    activeStatsColumnIndex = null;
                    statsColumnValue = '';
                    setStatsMessage('Select a column to view statistics.', 'empty');
                    clearStatsContent();
                } else {
                    statsColumnValue = String(activeStatsColumnIndex);
                }
            }
        }
        scheduleTableLayoutDiagnostics('schema-update');
    }

    function applyColumnSearch(): void {
        if (!isColumnFilterSupported()) {
            columnVisibilityStatus = 'Column filtering is not supported.';
            log('Column filter unavailable; search_schema unsupported.');
            return;
        }
        const searchTerm = columnVisibilitySearchTerm.trim();
        const sortOrder = 'original';

        const filters: ColumnFilter[] = [];
        if (!searchTerm) {
            columnFilterMatches.set(null);
            columnVisibilityStatus = 'Showing all columns.';
            if (!isSetColumnFiltersSupported()) {
                applySchemaUpdate(getResolvedVisibleSchema());
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
        columnVisibilityStatus = 'Searching...';
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
        if ($hiddenColumnIndices.has(columnIndex)) {
            return;
        }
        hiddenColumnIndices.update((indices) => {
            const nextHidden = new Set(indices);
            nextHidden.add(columnIndex);
            return nextHidden;
        });
        log('Column hidden', { columnIndex });
        applySchemaUpdate(getResolvedVisibleSchema());
    }

    function showColumn(columnIndex: number): void {
        if (!$hiddenColumnIndices.has(columnIndex)) {
            return;
        }
        hiddenColumnIndices.update((indices) => {
            const nextHidden = new Set(indices);
            nextHidden.delete(columnIndex);
            return nextHidden;
        });
        log('Column shown', { columnIndex });
        applySchemaUpdate(getResolvedVisibleSchema());
    }

    function toggleColumnVisibility(columnIndex: number): void {
        if ($hiddenColumnIndices.has(columnIndex)) {
            showColumn(columnIndex);
            return;
        }
        if (getResolvedVisibleSchema().length <= 1) {
            return;
        }
        hideColumn(columnIndex);
    }

    function invertColumnVisibility(): void {
        if (!$fullSchema.length) {
            return;
        }

        const baseSchema = $columnFilterMatches
            ? resolveSchemaMatches($fullSchema, $columnFilterMatches)
            : $fullSchema;
        if (!baseSchema.length) {
            return;
        }

        log('Inverting column visibility', { matches: baseSchema.length });
        const nextHidden = new Set($hiddenColumnIndices);
        for (const column of baseSchema) {
            const index = column.column_index;
            if (nextHidden.has(index)) {
                nextHidden.delete(index);
            } else {
                nextHidden.add(index);
            }
        }

        if (nextHidden.size >= $fullSchema.length) {
            nextHidden.delete($fullSchema[0]?.column_index ?? 0);
        }

        hiddenColumnIndices.set(nextHidden);
        applySchemaUpdate(getResolvedVisibleSchema());
    }

    function openStatsPanel(options: { columnIndex?: number; toggle?: boolean } = {}): void {
        const { columnIndex, toggle = false } = options;
        const shouldOpen = toggle ? !$statsPanelOpenStore : true;
        $columnVisibilityOpenStore = false;
        $codeModalOpenStore = false;
        $rowFilterPanelOpenStore = false;
        if (!shouldOpen) {
            $statsPanelOpenStore = false;
            return;
        }

        $statsPanelOpenStore = true;
        if (columnIndex !== undefined) {
            statsColumnValue = String(columnIndex);
        }
        const resolvedIndex = parseInt(statsColumnValue, 10);
        if (!Number.isNaN(resolvedIndex)) {
            activeStatsColumnIndex = resolvedIndex;
            requestColumnProfiles('panel-open');
        } else {
            activeStatsColumnIndex = null;
            setStatsMessage('Select a column to view statistics.', 'empty');
            clearStatsContent();
        }
        requestAnimationFrame(() => {
            statsCharts.resize();
        });
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

    function requestVisibleBlocks(): void {
        if (!$backendState) {
            return;
        }

        const virtualItems = virtualizer.getVirtualItems();
        if (!virtualItems.length) {
            return;
        }

        const startIndex = virtualItems[0].index;
        const endIndex = virtualItems[virtualItems.length - 1].index;
        const startBlock = Math.floor(startIndex / ROW_BLOCK_SIZE);
        const endBlock = Math.floor(endIndex / ROW_BLOCK_SIZE);

        for (let block = startBlock; block <= endBlock; block += 1) {
            if ($loadedBlocks.has(block) || $loadingBlocks.has(block)) {
                continue;
            }
            const blockStart = block * ROW_BLOCK_SIZE;
            const blockEnd = Math.min($backendState.table_shape.num_rows - 1, blockStart + ROW_BLOCK_SIZE - 1);
            loadingBlocks.update((blocks: Set<number>) => {
                const next = new Set(blocks);
                next.add(block);
                return next;
            });
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

    function handleStatsColumnChange(): void {
        const columnIndex = parseInt(statsColumnValue, 10);
        if (Number.isNaN(columnIndex)) {
            activeStatsColumnIndex = null;
            setStatsMessage('Select a column to view statistics.', 'empty');
            clearStatsContent();
            return;
        }
        activeStatsColumnIndex = columnIndex;
        requestColumnProfiles('column-change');
    }

    function toggleStatsSection(sectionId: string): void {
        collapsedSectionsStore.update((sections) => {
            const next = new Set(sections);
            if (next.has(sectionId)) {
                next.delete(sectionId);
            } else {
                next.add(sectionId);
            }
            return next;
        });
        requestAnimationFrame(() => {
            statsCharts.resize();
        });
    }

    function handleStatsMethodChange(): void {
        scheduleStatsRefresh('histogram-method');
    }

    function handleHistogramBinsInput(source: 'slider' | 'input'): void {
        syncHistogramBins(source);
    }

    function handleFrequencyLimitInput(source: 'slider' | 'input'): void {
        syncFrequencyLimit(source);
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
        if (statsRefreshDebounceId !== undefined) {
            window.clearTimeout(statsRefreshDebounceId);
        }
        if (columnVisibilityDebounceId !== undefined) {
            window.clearTimeout(columnVisibilityDebounceId);
        }
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
    columnWidths={$columnWidths}
    activeSort={$activeSort}
    {sortSupported}
    {rowFilterSupported}
    {virtualRows}
    {virtualizerTotalHeight}
    rowCacheVersion={$rowCacheVersion}
    {headerScrollLeft}
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
