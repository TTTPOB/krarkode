<script lang="ts">
    import { onDestroy, onMount, tick } from 'svelte';
    import {
        Virtualizer,
        elementScroll,
        observeElementOffset,
        observeElementRect,
    } from '@tanstack/virtual-core';
    import {
        ColumnDef,
        RowModel,
        Table,
        createTable,
        getCoreRowModel,
    } from '@tanstack/table-core';
    import * as echarts from 'echarts/core';
    import { BarChart } from 'echarts/charts';
    import { GridComponent, TitleComponent, TooltipComponent } from 'echarts/components';
    import { CanvasRenderer } from 'echarts/renderers';
    import StatsColumnSelector from './stats/StatsColumnSelector.svelte';
    import StatsSummarySection from './stats/StatsSummarySection.svelte';
    import StatsDistributionSection from './stats/StatsDistributionSection.svelte';
    import StatsFrequencySection from './stats/StatsFrequencySection.svelte';

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

    type StatsMessageState = 'loading' | 'empty' | 'error';

    type StatsRow = {
        label: string;
        value: string;
    };

    type RowFilterDraft = {
        columnIndex: number;
        filterType: RowFilterType;
        compareOp: FilterComparisonOp;
        compareValue: string;
        betweenLeft: string;
        betweenRight: string;
        searchType: TextSearchType;
        searchTerm: string;
        searchCase: boolean;
        setValues: string;
        setInclusive: boolean;
        condition: RowFilterCondition;
    };

    declare const acquireVsCodeApi: () => {
        postMessage: (message: unknown) => void;
    };

    const vscode = acquireVsCodeApi();

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
    const SIDE_PANEL_MIN_WIDTH = 280;
    const SIDE_PANEL_MAX_WIDTH = 600;

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

    let state: BackendState | null = null;
    let schema: ColumnSchema[] = [];
    let fullSchema: ColumnSchema[] = [];
    let columnFilterMatches: number[] | null = null;
    let hiddenColumnIndices = new Set<number>();
    let columnWidths = new Map<number, number>();
    let rowCache = new Map<number, string[]>();
    let rowLabelCache = new Map<number, string>();
    let rowCacheVersion = 0;
    let loadedBlocks = new Set<number>();
    let loadingBlocks = new Set<number>();
    let pendingRows: RowsMessage[] = [];
    let activeSort: SortState | null = null;
    let rowFilters: RowFilter[] = [];
    let editingRowFilterIndex: number | null = null;
    let rowFilterSupport: SetRowFiltersFeatures | undefined;
    let columnFilterSupport: SearchSchemaFeatures | undefined;
    let setColumnFilterSupport: SetColumnFiltersFeatures | undefined;

    let columnVisibilityOpen = false;
    let rowFilterPanelOpen = false;
    let statsPanelOpen = false;
    let codeModalOpen = false;
    let columnMenuOpen = false;
    let columnMenuX = 0;
    let columnMenuY = 0;
    let columnMenuColumnIndex: number | null = null;
    let pinnedPanels = new Set<string>();

    let columnVisibilitySearchTerm = '';
    let columnVisibilityStatus = '';

    let rowFilterError = '';
    let rowFilterDraft: RowFilterDraft = createRowFilterDraft();

    let statsMessageText = 'Select a column to view statistics.';
    let statsMessageState: StatsMessageState = 'empty';
    let statsSectionsVisible = false;
    let statsControlsEnabled = false;
    let statsOverviewRows: StatsRow[] = [];
    let statsSummaryRows: StatsRow[] = [];
    let statsOverviewEmptyMessage = '';
    let statsSummaryEmptyMessage = '';
    let frequencyFootnote = '';
    let histogramBins = DEFAULT_HISTOGRAM_BINS;
    let histogramMethod = 'freedman_diaconis';
    let frequencyLimit = DEFAULT_FREQUENCY_LIMIT;
    let histogramVisible = false;
    let frequencyVisible = false;
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
    let columnVisibilityPanelEl: HTMLDivElement;
    let rowFilterPanelEl: HTMLDivElement;
    let statsPanelEl: HTMLDivElement;
    let codeModalEl: HTMLDivElement;
    let columnMenuEl: HTMLDivElement;
    let statsResultsEl: HTMLDivElement;
    let columnVisibilitySearchInput: HTMLInputElement;
    let columnsButtonEl: HTMLButtonElement;
    let statsButtonEl: HTMLButtonElement;
    let codeButtonEl: HTMLButtonElement;
    let addRowFilterButtonEl: HTMLButtonElement;
    let histogramContainer: HTMLDivElement;
    let frequencyContainer: HTMLDivElement;

    let histogramChart: echarts.ECharts | null = null;
    let frequencyChart: echarts.ECharts | null = null;

    let rowVirtualizer: Virtualizer<HTMLDivElement, HTMLDivElement> | null = null;
    let rowVirtualizerCleanup: (() => void) | null = null;
    let virtualRows: { index: number; start: number; size: number; key: number }[] = [];
    let virtualizerTotalHeight = 0;
    let headerScrollLeft = 0;
    let lastScrollLeft = 0;

    // TanStack Table state
    interface RowData {
        index: number;
    }
    let tableInstance: Table<RowData> | null = null;
    let rowModel: RowModel<RowData> | null = null;

    let activeColumnResize: { columnIndex: number; startX: number; startWidth: number } | null = null;
    let ignoreHeaderSortClick = false;
    let sidePanelResizeState: { startX: number; startWidth: number; panelId?: string } | null = null;

    let collapsedSections = new Set<string>();

    let tableTitleText = 'Data Explorer';
    let tableMetaText = '';

    $: resolvedColumnWidths = schema.map((column) => columnWidths.get(column.column_index) ?? COLUMN_WIDTH);
    $: columnTemplate = resolvedColumnWidths.length > 0
        ? `${ROW_LABEL_WIDTH}px ${resolvedColumnWidths.map((width) => `${width}px`).join(' ')}`
        : `${ROW_LABEL_WIDTH}px`;
    $: totalWidth = ROW_LABEL_WIDTH + resolvedColumnWidths.reduce((sum, width) => sum + width, 0);
    $: rowFilterSection = ROW_FILTER_SECTION_MAP[rowFilterDraft.filterType] ?? 'none';
    $: rowFilterSupported = isRowFilterSupported();
    $: sortSupported = isSortSupported();
    $: tableTitleText = state?.display_name || 'Data Explorer';
    $: tableMetaText = buildTableMetaText();

    function log(message: string, payload?: unknown): void {
        if (payload !== undefined) {
            console.log(`[dataExplorer] ${message}`, payload);
        } else {
            console.log(`[dataExplorer] ${message}`);
        }
    }

    function clampNumber(value: number, min: number, max: number, fallback: number): number {
        if (!Number.isFinite(value)) {
            return fallback;
        }
        return Math.min(Math.max(Math.round(value), min), max);
    }


    function setPanelPinned(panelId: string, pinned: boolean): void {
        const next = new Set(pinnedPanels);
        if (pinned) {
            next.add(panelId);
        } else {
            next.delete(panelId);
        }
        pinnedPanels = next;
        log('Panel pin updated', { panelId, pinned });
    }

    function isPanelPinned(panelId: string): boolean {
        return pinnedPanels.has(panelId);
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

    function createRowFilterDraft(filter?: RowFilter, columnIndex?: number): RowFilterDraft {
        const fallbackColumnIndex = schema[0]?.column_index ?? 0;
        const selectedColumnIndex = filter?.column_schema.column_index ?? columnIndex ?? fallbackColumnIndex;
        const selectedType = filter?.filter_type ?? getSupportedRowFilterTypes()[0] ?? 'compare';
        return {
            columnIndex: selectedColumnIndex,
            filterType: selectedType,
            compareOp: (filter?.params as { op?: string })?.op as FilterComparisonOp ?? '=',
            compareValue: (filter?.params as { value?: string })?.value ?? '',
            betweenLeft: (filter?.params as { left_value?: string })?.left_value ?? '',
            betweenRight: (filter?.params as { right_value?: string })?.right_value ?? '',
            searchType: (filter?.params as { search_type?: string })?.search_type as TextSearchType ?? 'contains',
            searchTerm: (filter?.params as { term?: string })?.term ?? '',
            searchCase: (filter?.params as { case_sensitive?: boolean })?.case_sensitive ?? false,
            setValues: ((filter?.params as { values?: string[] })?.values ?? []).join(', '),
            setInclusive: (filter?.params as { inclusive?: boolean })?.inclusive !== false,
            condition: filter?.condition ?? 'and',
        };
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
        rowFilterDraft = createRowFilterDraft(filter, columnIndex);
        rowFilterError = '';
        rowFilterPanelOpen = true;
        columnVisibilityOpen = false;
        statsPanelOpen = false;
        codeModalOpen = false;
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
        const column = schema.find((item) => item.column_index === rowFilterDraft.columnIndex);
        if (!column) {
            rowFilterError = 'Select a column.';
            return;
        }

        const params = buildRowFilterParams(rowFilterDraft.filterType);
        if (!params.valid) {
            rowFilterError = params.errorMessage ?? '';
            return;
        }

        const condition: RowFilterCondition = supportsRowFilterConditions()
            ? rowFilterDraft.condition
            : 'and';

        const filterId = editingRowFilterIndex !== null
            ? rowFilters[editingRowFilterIndex]?.filter_id
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

        const nextFilters = [...rowFilters];
        if (editingRowFilterIndex !== null) {
            nextFilters[editingRowFilterIndex] = filter;
        } else {
            nextFilters.push(filter);
        }
        rowFilters = nextFilters;
        rowFilterPanelOpen = false;
        rowFilterError = '';
        vscode.postMessage({ type: 'setRowFilters', filters: rowFilters });
        log('Row filters saved', { count: rowFilters.length, filter });
    }

    function buildRowFilterParams(filterType: RowFilterType): { valid: boolean; value?: Record<string, unknown>; errorMessage?: string } {
        switch (filterType) {
            case 'compare':
                if (!rowFilterDraft.compareValue.trim()) {
                    return { valid: false, errorMessage: 'Enter a comparison value.' };
                }
                return {
                    valid: true,
                    value: {
                        op: rowFilterDraft.compareOp,
                        value: rowFilterDraft.compareValue.trim(),
                    },
                };
            case 'between':
            case 'not_between':
                if (!rowFilterDraft.betweenLeft.trim() || !rowFilterDraft.betweenRight.trim()) {
                    return { valid: false, errorMessage: 'Enter both range values.' };
                }
                return {
                    valid: true,
                    value: {
                        left_value: rowFilterDraft.betweenLeft.trim(),
                        right_value: rowFilterDraft.betweenRight.trim(),
                    },
                };
            case 'search':
                if (!rowFilterDraft.searchTerm.trim()) {
                    return { valid: false, errorMessage: 'Enter a search term.' };
                }
                return {
                    valid: true,
                    value: {
                        search_type: rowFilterDraft.searchType,
                        term: rowFilterDraft.searchTerm.trim(),
                        case_sensitive: rowFilterDraft.searchCase,
                    },
                };
            case 'set_membership': {
                const values = rowFilterDraft.setValues
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
                        inclusive: rowFilterDraft.setInclusive,
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
        const nextFilters = [...rowFilters];
        nextFilters.splice(index, 1);
        rowFilters = nextFilters;
        vscode.postMessage({ type: 'setRowFilters', filters: rowFilters });
        log('Row filter removed', { index, count: rowFilters.length });
    }

    function setStatsMessage(message: string, stateValue: StatsMessageState): void {
        statsMessageText = message;
        statsMessageState = stateValue;
        statsSectionsVisible = false;
        statsControlsEnabled = stateValue !== 'empty';
    }

    function showStatsSections(): void {
        statsSectionsVisible = true;
        statsControlsEnabled = true;
    }

    function clearStatsContent(options: { preserveScrollTop?: boolean } = {}): void {
        const preserveScrollTop = options.preserveScrollTop === true;
        // When preserving scroll, keep existing data to prevent DOM rebuild
        // New data will replace it when profiles arrive
        if (!preserveScrollTop) {
            statsOverviewRows = [];
            statsSummaryRows = [];
            statsOverviewEmptyMessage = 'No overview data.';
            statsSummaryEmptyMessage = 'No summary statistics.';
            frequencyFootnote = '';
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
        const rawValue = histogramBins;
        const nextValue = clampNumber(rawValue, HISTOGRAM_BINS_MIN, HISTOGRAM_BINS_MAX, DEFAULT_HISTOGRAM_BINS);
        histogramBins = nextValue;
        if (histogramMethod !== 'fixed') {
            const previousMethod = histogramMethod;
            histogramMethod = 'fixed';
            log('Histogram method forced to fixed for bins update', { previousMethod });
        }
        log('Histogram bins updated', { value: nextValue, source });
        scheduleStatsRefresh('histogram-bins');
    }

    function syncFrequencyLimit(source: 'slider' | 'input'): void {
        const rawValue = frequencyLimit;
        const nextValue = clampNumber(rawValue, FREQUENCY_LIMIT_MIN, FREQUENCY_LIMIT_MAX, DEFAULT_FREQUENCY_LIMIT);
        frequencyLimit = nextValue;
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
        const histogramBinsValue = clampNumber(histogramBins, HISTOGRAM_BINS_MIN, HISTOGRAM_BINS_MAX, DEFAULT_HISTOGRAM_BINS);
        const frequencyLimitValue = clampNumber(frequencyLimit, FREQUENCY_LIMIT_MIN, FREQUENCY_LIMIT_MAX, DEFAULT_FREQUENCY_LIMIT);
        const histogramProfile = histogramBinsValue > SMALL_HISTOGRAM_MAX_BINS ? 'large_histogram' : 'small_histogram';
        const frequencyProfile = frequencyLimitValue > SMALL_FREQUENCY_MAX_LIMIT ? 'large_frequency_table' : 'small_frequency_table';
        const profileTypes = ['null_count', 'summary_stats', histogramProfile, frequencyProfile];
        const histogramParams = {
            method: histogramMethod,
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
        if (!histogram || histogramMethod === 'fixed') {
            return;
        }
        const binCount = histogram.bin_counts?.length ?? 0;
        if (binCount <= 0) {
            return;
        }
        const nextValue = clampNumber(binCount, HISTOGRAM_BINS_MIN, HISTOGRAM_BINS_MAX, DEFAULT_HISTOGRAM_BINS);
        if (histogramBins !== nextValue) {
            histogramBins = nextValue;
            log('Histogram bins synced from profile', { value: nextValue, method: histogramMethod });
        }
    }

    function setSidePanelWidth(width: number): void {
        document.body.style.setProperty('--side-panel-width', `${width}px`);
        requestAnimationFrame(() => {
            histogramChart?.resize();
            frequencyChart?.resize();
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

    function buildSummaryRows(summaryStats: ColumnSummaryStats | undefined, quantiles: ColumnQuantileValue[]): StatsRow[] {
        if (!summaryStats) {
            return [];
        }
        if (summaryStats.number_stats) {
            const rows: StatsRow[] = [];
            rows.push({ label: 'Minimum', value: formatStatValue(summaryStats.number_stats.min_value) });
            const quantileRows = quantiles
                .filter((quantile) => typeof quantile.q === 'number')
                .sort((a, b) => a.q - b.q)
                .map((quantile) => ({
                    label: formatQuantileLabel(quantile.q),
                    value: formatQuantileValue(quantile),
                }));
            if (quantileRows.length > 0) {
                rows.push(...quantileRows);
            } else if (summaryStats.number_stats.median !== undefined) {
                rows.push({ label: 'Median', value: formatStatValue(summaryStats.number_stats.median) });
            }
            rows.push({ label: 'Maximum', value: formatStatValue(summaryStats.number_stats.max_value) });
            rows.push({ label: 'Mean', value: formatStatValue(summaryStats.number_stats.mean) });
            rows.push({ label: 'Std Dev', value: formatStatValue(summaryStats.number_stats.stdev) });
            return rows;
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
        histogramBins = DEFAULT_HISTOGRAM_BINS;
        histogramMethod = 'freedman_diaconis';
        frequencyLimit = DEFAULT_FREQUENCY_LIMIT;
        statsControlsEnabled = false;
    }

    function ensureHistogramChart(): echarts.ECharts {
        if (!histogramChart && histogramContainer) {
            histogramChart = echarts.init(histogramContainer);
        }
        return histogramChart as echarts.ECharts;
    }

    function clearHistogram(): void {
        histogramVisible = false;
        histogramChart?.clear();
    }

    function ensureFrequencyChart(): echarts.ECharts {
        if (!frequencyChart && frequencyContainer) {
            frequencyChart = echarts.init(frequencyContainer);
        }
        return frequencyChart as echarts.ECharts;
    }

    function clearFrequency(): void {
        frequencyVisible = false;
        frequencyFootnote = '';
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

        histogramVisible = true;
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
        requestAnimationFrame(() => {
            chart.resize();
        });
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
        frequencyVisible = true;
        if (frequencyContainer) {
            frequencyContainer.style.height = `${chartHeight}px`;
        }
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
        requestAnimationFrame(() => {
            chart.resize();
        });
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

        const column = schema.find((col) => col.column_index === columnIndex);
        const columnLabel = column ? getColumnLabel(column) : `Column ${columnIndex + 1}`;
        const summaryStats = combined.summary_stats;
        const histogram = combined.large_histogram ?? combined.small_histogram;
        const frequency = combined.large_frequency_table ?? combined.small_frequency_table;
        const quantiles = histogram?.quantiles ?? [];

        statsOverviewRows = [
            { label: 'Column', value: columnLabel },
            { label: 'Type', value: formatStatValue(summaryStats?.type_display) },
            { label: 'Null Count', value: formatStatValue(combined.null_count) },
        ];
        statsSummaryRows = buildSummaryRows(summaryStats, quantiles);
        statsOverviewEmptyMessage = 'No overview data.';
        statsSummaryEmptyMessage = 'No summary statistics.';

        syncHistogramBinsFromProfile(histogram);
        renderHistogram(histogram, columnLabel);
        renderFrequencyChart(frequency);
        if (!frequency) {
            frequencyFootnote = 'No frequency data.';
        } else if (frequency.other_count !== undefined) {
            frequencyFootnote = `Other values: ${frequency.other_count}`;
            log('Frequency table contains other values', { otherCount: frequency.other_count });
        } else {
            frequencyFootnote = '';
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

    function handleSearchSchemaResult(matches: number[]): void {
        columnFilterMatches = matches;
        if (!isSetColumnFiltersSupported()) {
            applySchemaUpdate(resolveVisibleSchema());
        }
        columnVisibilityStatus = `Found ${matches.length} matching columns.`;
        log('Column search results', { matches: matches.length });
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
        const previousWidths = new Map(columnWidths);
        const nextWidths = new Map<number, number>();
        fullSchema.forEach((column) => {
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
        columnWidths = nextWidths;
        setupTable();
        refreshVirtualRows();
        requestInitialBlock();
        requestVisibleBlocks();
        if (statsPanelOpen) {
            if (activeStatsColumnIndex !== null) {
                const stillExists = schema.some((column) => column.column_index === activeStatsColumnIndex);
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
            columnFilterMatches = null;
            columnVisibilityStatus = 'Showing all columns.';
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
        if (hiddenColumnIndices.has(columnIndex)) {
            return;
        }
        const nextHidden = new Set(hiddenColumnIndices);
        nextHidden.add(columnIndex);
        hiddenColumnIndices = nextHidden;
        log('Column hidden', { columnIndex });
        applySchemaUpdate(resolveVisibleSchema());
    }

    function showColumn(columnIndex: number): void {
        if (!hiddenColumnIndices.has(columnIndex)) {
            return;
        }
        const nextHidden = new Set(hiddenColumnIndices);
        nextHidden.delete(columnIndex);
        hiddenColumnIndices = nextHidden;
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

        hiddenColumnIndices = nextHidden;
        applySchemaUpdate(resolveVisibleSchema());
    }

    function openStatsPanel(options: { columnIndex?: number; toggle?: boolean } = {}): void {
        const { columnIndex, toggle = false } = options;
        const shouldOpen = toggle ? !statsPanelOpen : true;
        columnVisibilityOpen = false;
        codeModalOpen = false;
        rowFilterPanelOpen = false;
        if (!shouldOpen) {
            statsPanelOpen = false;
            return;
        }

        statsPanelOpen = true;
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
            histogramChart?.resize();
            frequencyChart?.resize();
        });
    }

    function openColumnVisibilityPanel(): void {
        columnVisibilityOpen = !columnVisibilityOpen;
        statsPanelOpen = false;
        codeModalOpen = false;
        rowFilterPanelOpen = false;
        if (columnVisibilityOpen) {
            void tick().then(() => {
                columnVisibilitySearchInput?.focus();
            });
        }
    }

    function openCodeModal(): void {
        const shouldOpen = !codeModalOpen;
        if (shouldOpen) {
            vscode.postMessage({ type: 'suggestCodeSyntax' });
        }
        codeModalOpen = shouldOpen;
        columnVisibilityOpen = false;
        statsPanelOpen = false;
        rowFilterPanelOpen = false;
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

    function handleHeaderSort(event: Event, columnIndex: number): void {
        if (ignoreHeaderSortClick) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (!isSortSupported()) {
            return;
        }
        activeSort = getNextSort(columnIndex);
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

    function isSortSupported(): boolean {
        const status = state?.supported_features?.set_sort_columns?.support_status;
        if (!status) {
            return true;
        }
        return status === 'supported';
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
        const startWidth = columnWidths.get(columnIndex) ?? COLUMN_WIDTH;
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
        const currentWidth = columnWidths.get(activeColumnResize.columnIndex) ?? COLUMN_WIDTH;
        if (currentWidth === nextWidth) {
            return;
        }
        const nextWidths = new Map(columnWidths);
        nextWidths.set(activeColumnResize.columnIndex, nextWidth);
        columnWidths = nextWidths;
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
        ignoreHeaderSortClick = true;
        window.setTimeout(() => {
            ignoreHeaderSortClick = false;
        }, 0);
    }

    function refreshVirtualRows(): void {
        if (!rowVirtualizer) {
            return;
        }
        virtualRows = rowVirtualizer.getVirtualItems().map((item) => ({
            index: item.index,
            start: item.start,
            size: item.size,
            key: item.key,
        }));
        virtualizerTotalHeight = rowVirtualizer.getTotalSize();
        requestVisibleBlocks();
    }

    function buildColumnDefs(): ColumnDef<RowData>[] {
        const columns: ColumnDef<RowData>[] = [];

        // Row label column
        columns.push({
            id: 'row-label',
            header: state?.has_row_labels ? '#' : 'Row',
            accessorFn: (row) => getRowLabel(row.index),
        });

        // Data columns
        for (let i = 0; i < schema.length; i++) {
            const column = schema[i];
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
        if (!state) {
            return;
        }

        const rowCount = state.table_shape.num_rows;
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

        rowModel = tableInstance.getRowModel();
        log('Table setup complete', { rowCount, columnCount: columns.length });
    }

    function setupVirtualizer(): void {
        if (!state || !tableBodyEl) {
            return;
        }

        if (!rowVirtualizer) {
            rowVirtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
                count: state.table_shape.num_rows,
                getScrollElement: () => tableBodyEl,
                estimateSize: () => ROW_HEIGHT,
                overscan: 8,
                scrollToFn: elementScroll,
                observeElementRect,
                observeElementOffset,
                onChange: () => {
                    refreshVirtualRows();
                },
            });
            rowVirtualizerCleanup = rowVirtualizer._didMount();
        }

        rowVirtualizer.setOptions((prev) => ({
            ...prev,
            count: state.table_shape.num_rows,
        }));
        rowVirtualizer._willUpdate();
        rowVirtualizer.measure();
        refreshVirtualRows();
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

    function requestVisibleBlocks(): void {
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

    function handleRows(message: RowsMessage): void {
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

        rowCache = new Map(rowCache);
        rowLabelCache = new Map(rowLabelCache);
        rowCacheVersion += 1;
        rowVirtualizer?.measure();
        refreshVirtualRows();
        log('Rows rendered', { startIndex, endIndex, rows: rowCount, columns: columnCount });
    }

    function handleInit(message: InitMessage): void {
        state = message.state;
        fullSchema = message.schema ?? [];
        columnFilterMatches = null;
        hiddenColumnIndices = new Set();
        schema = resolveVisibleSchema();
        rowCache.clear();
        rowLabelCache.clear();
        loadedBlocks.clear();
        loadingBlocks.clear();
        const previousWidths = new Map(columnWidths);
        columnWidths = new Map();
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
        columnVisibilityStatus = '';
        columnVisibilitySearchTerm = '';
        if (activeStatsColumnIndex === null) {
            setStatsMessage('Select a column to view statistics.', 'empty');
        } else {
            setStatsMessage('Loading statistics...', 'loading');
        }
        clearStatsContent();
        codePreview = '';
        if (columnFilterMatches && !isSetColumnFiltersSupported()) {
            schema = resolveVisibleSchema();
        }
        applySchemaUpdate(schema);
        setupTable();
        setupVirtualizer();
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

    function openColumnMenu(event: MouseEvent, columnIndex: number): void {
        columnMenuColumnIndex = columnIndex;
        columnMenuOpen = true;
        void tick().then(() => {
            const padding = 8;
            const { innerWidth, innerHeight } = window;
            const menuRect = columnMenuEl?.getBoundingClientRect();
            const menuWidth = menuRect?.width ?? 160;
            const menuHeight = menuRect?.height ?? 80;
            const nextLeft = Math.min(event.clientX, innerWidth - menuWidth - padding);
            const nextTop = Math.min(event.clientY, innerHeight - menuHeight - padding);
            columnMenuX = Math.max(nextLeft, padding);
            columnMenuY = Math.max(nextTop, padding);
        });
    }

    function closeColumnMenu(): void {
        columnMenuOpen = false;
        columnMenuColumnIndex = null;
    }

    function handleColumnMenuAddFilter(): void {
        if (columnMenuColumnIndex === null) {
            return;
        }
        const selectedColumnIndex = columnMenuColumnIndex;
        closeColumnMenu();
        openRowFilterEditor(undefined, undefined, selectedColumnIndex);
    }

    function handleColumnMenuHideColumn(): void {
        if (columnMenuColumnIndex === null) {
            return;
        }
        const selectedColumnIndex = columnMenuColumnIndex;
        closeColumnMenu();
        hideColumn(selectedColumnIndex);
    }

    function handleTableScroll(): void {
        if (columnMenuOpen) {
            closeColumnMenu();
        }
        if (tableBodyEl.scrollLeft !== lastScrollLeft) {
            updateHeaderScroll(tableBodyEl.scrollLeft);
            lastScrollLeft = tableBodyEl.scrollLeft;
        }
    }

    function buildTableMetaText(): string {
        if (!state) {
            return '';
        }
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
        return `${num_rows}x${num_columns}${filteredText}${unnamedText}`;
    }

    function getSortIndicator(columnIndex: number): string {
        if (!activeSort || activeSort.columnIndex !== columnIndex) {
            return '';
        }
        return activeSort.direction === 'asc' ? '^' : 'v';
    }

    function getCellValue(rowIndex: number, columnIndex: number, _version?: number): string {
        const values = rowCache.get(rowIndex);
        if (!values) {
            return '';
        }
        return values[columnIndex] ?? '';
    }

    function getRowLabel(rowIndex: number, _version?: number): string {
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
        const next = new Set(collapsedSections);
        if (next.has(sectionId)) {
            next.delete(sectionId);
        } else {
            next.add(sectionId);
        }
        collapsedSections = next;
        requestAnimationFrame(() => {
            histogramChart?.resize();
            frequencyChart?.resize();
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
        if (columnMenuOpen && columnMenuEl && !columnMenuEl.contains(target)) {
            closeColumnMenu();
        }
        if (statsPanelOpen
            && statsPanelEl
            && !statsPanelEl.contains(target)
            && statsButtonEl
            && !statsButtonEl.contains(target)
            && !isPanelPinned('stats-panel')) {
            statsPanelOpen = false;
        }
        if (columnVisibilityOpen
            && columnVisibilityPanelEl
            && !columnVisibilityPanelEl.contains(target)
            && columnsButtonEl
            && !columnsButtonEl.contains(target)
            && !isPanelPinned('column-visibility-panel')) {
            columnVisibilityOpen = false;
        }
        if (codeModalOpen
            && codeModalEl
            && !codeModalEl.contains(target)
            && codeButtonEl
            && !codeButtonEl.contains(target)) {
            codeModalOpen = false;
        }
        if (rowFilterPanelOpen
            && rowFilterPanelEl
            && !rowFilterPanelEl.contains(target)
            && addRowFilterButtonEl
            && !addRowFilterButtonEl.contains(target)
            && !isPanelPinned('row-filter-panel')) {
            rowFilterPanelOpen = false;
        }
    }

    function handleWindowResize(): void {
        closeColumnMenu();
        histogramChart?.resize();
        frequencyChart?.resize();
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

    function handleMessage(event: MessageEvent): void {
        const message = event.data;
        switch (message.type) {
            case 'init':
                handleInit(message as InitMessage);
                break;
            case 'rows':
                handleRows(message as RowsMessage);
                break;
            case 'error':
                tableMetaText = message.message as string;
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
        rowVirtualizerCleanup?.();
        histogramChart?.dispose();
        frequencyChart?.dispose();
    });
</script>

<svelte:window
    on:message={handleMessage}
    on:resize={handleWindowResize}
    on:keydown={handleWindowKeydown}
    on:mousemove={handleWindowMouseMove}
    on:mouseup={handleWindowMouseUp}
/>

<div class="toolbar">
    <div class="title" id="table-title">{tableTitleText}</div>
    <div class="meta" id="table-meta">{tableMetaText}</div>
    <div class="toolbar-actions">
        <button class="action" id="columns-btn" title="Column Visibility" bind:this={columnsButtonEl} on:click={openColumnVisibilityPanel}>
            Columns
        </button>
        <button class="action" id="stats-btn" title="Column Statistics" bind:this={statsButtonEl} on:click={() => openStatsPanel({ toggle: true })}>
            Stats
        </button>
        <div class="dropdown">
            <button class="action" id="export-btn">Export ▾</button>
            <div class="dropdown-content" id="export-dropdown">
                <button data-format="csv" on:click={() => handleExport('csv')}>Export as CSV</button>
                <button data-format="tsv" on:click={() => handleExport('tsv')}>Export as TSV</button>
                <button data-format="html" on:click={() => handleExport('html')}>Export as HTML</button>
            </div>
        </div>
        <button class="action" id="code-btn" title="Convert to Code" bind:this={codeButtonEl} on:click={openCodeModal}>
            Code
        </button>
        <button class="action" id="refresh-btn" on:click={() => vscode.postMessage({ type: 'refresh' })}>
            Refresh
        </button>
    </div>
</div>

{#if rowFilterSupported}
    <div class="row-filter-bar" id="row-filter-bar">
        <div class="row-filter-label">Row Filters</div>
        <div class="row-filter-chips" id="row-filter-chips">
            {#if rowFilters.length === 0}
                <span class="row-filter-label">No filters</span>
            {:else}
                {#each rowFilters as filter, index}
                    <div
                        class="row-filter-chip"
                        role="button"
                        tabindex="0"
                        on:click={() => openRowFilterEditor(filter, index)}
                        on:keydown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openRowFilterEditor(filter, index);
                            }
                        }}
                    >
                        <span>{formatRowFilterChip(filter, index)}</span>
                        <button on:click|stopPropagation={() => removeRowFilter(index)}>×</button>
                    </div>
                {/each}
            {/if}
        </div>
        <button class="action secondary" id="add-row-filter" bind:this={addRowFilterButtonEl} on:click={() => openRowFilterEditor()}>
            + Filter
        </button>
    </div>
{/if}

<div
    class="side-panel"
    id="column-visibility-panel"
    bind:this={columnVisibilityPanelEl}
    class:open={columnVisibilityOpen}
    class:is-pinned={isPanelPinned('column-visibility-panel')}
>
    <button
        type="button"
        class="panel-resizer"
        aria-label="Resize panel"
        on:mousedown={(event) => startSidePanelResize(event, 'column-visibility-panel')}
    ></button>
    <div class="panel-header">
        <span>Column Visibility</span>
        <div class="panel-actions">
            <button
                class="panel-pin"
                data-panel-id="column-visibility-panel"
                aria-pressed={isPanelPinned('column-visibility-panel')}
                title="Pin panel"
                on:click={(event) => {
                    event.stopPropagation();
                    setPanelPinned('column-visibility-panel', !isPanelPinned('column-visibility-panel'));
                }}
            >
                <span class="codicon codicon-pin"></span>
            </button>
            <button class="close-btn" id="close-column-visibility" on:click={() => {
                setPanelPinned('column-visibility-panel', false);
                columnVisibilityOpen = false;
            }}>
                &times;
            </button>
        </div>
    </div>
    <div class="panel-content">
        <div class="filter-section">
            <label for="column-visibility-search">Search Columns</label>
            <input
                type="text"
                id="column-visibility-search"
                placeholder="Column name..."
                bind:this={columnVisibilitySearchInput}
                bind:value={columnVisibilitySearchTerm}
                on:keydown={(event) => event.key === 'Enter' && applyColumnSearch()}
                on:input={scheduleColumnVisibilitySearch}
            >
        </div>
        <div class="filter-actions">
            <button class="action" id="apply-column-visibility-filter" on:click={applyColumnSearch}>Apply</button>
            <button class="action secondary" id="clear-column-visibility-filter" on:click={() => {
                columnVisibilitySearchTerm = '';
                applyColumnSearch();
            }}>Clear</button>
            <button class="action secondary" id="invert-column-visibility" on:click={invertColumnVisibility}>Invert</button>
        </div>
        <div class="filter-status" id="column-visibility-status">{columnVisibilityStatus}</div>
        <div class="column-visibility-list" id="column-visibility-list">
            {#if (columnFilterMatches ? resolveSchemaMatches(columnFilterMatches) : fullSchema).length === 0}
                <div class="column-visibility-empty">No columns available.</div>
            {:else}
                {#each (columnFilterMatches ? resolveSchemaMatches(columnFilterMatches) : fullSchema) as column}
                    <div class="column-visibility-item">
                        <div class="column-visibility-details">
                            <div class="column-visibility-name" title={getColumnLabel(column)}>{getColumnLabel(column)}</div>
                            <div class="column-visibility-meta">{column.type_display || column.type_name}</div>
                        </div>
                        <button
                            class="column-visibility-toggle"
                            class:is-hidden={hiddenColumnIndices.has(column.column_index)}
                            title={hiddenColumnIndices.has(column.column_index) ? 'Show column' : 'Hide column'}
                            aria-pressed={!hiddenColumnIndices.has(column.column_index)}
                            disabled={!hiddenColumnIndices.has(column.column_index) && resolveVisibleSchema().length <= 1}
                            on:click={() => toggleColumnVisibility(column.column_index)}
                        >
                            <span class={`codicon ${hiddenColumnIndices.has(column.column_index) ? 'codicon-eye-closed' : 'codicon-eye'}`}></span>
                        </button>
                    </div>
                {/each}
            {/if}
        </div>
    </div>
</div>

<div
    class="side-panel"
    id="row-filter-panel"
    bind:this={rowFilterPanelEl}
    class:open={rowFilterPanelOpen}
    class:is-pinned={isPanelPinned('row-filter-panel')}
>
    <button
        type="button"
        class="panel-resizer"
        aria-label="Resize panel"
        on:mousedown={(event) => startSidePanelResize(event, 'row-filter-panel')}
    ></button>
    <div class="panel-header">
        <span>Row Filter</span>
        <div class="panel-actions">
            <button
                class="panel-pin"
                data-panel-id="row-filter-panel"
                aria-pressed={isPanelPinned('row-filter-panel')}
                title="Pin panel"
                on:click={(event) => {
                    event.stopPropagation();
                    setPanelPinned('row-filter-panel', !isPanelPinned('row-filter-panel'));
                }}
            >
                <span class="codicon codicon-pin"></span>
            </button>
            <button class="close-btn" id="close-row-filter" on:click={() => {
                setPanelPinned('row-filter-panel', false);
                rowFilterPanelOpen = false;
            }}>
                &times;
            </button>
        </div>
    </div>
    <div class="panel-content">
        <div class="filter-section">
            <label for="row-filter-column">Column</label>
            <select id="row-filter-column" value={rowFilterDraft.columnIndex} on:change={handleRowFilterColumnChange}>
                {#each schema as column}
                    <option value={column.column_index}>{getColumnLabel(column)}</option>
                {/each}
            </select>
        </div>
        <div class="filter-section">
            <label for="row-filter-type">Filter Type</label>
            <select id="row-filter-type" bind:value={rowFilterDraft.filterType}>
                {#each getSupportedRowFilterTypes() as filterType}
                    <option value={filterType}>{ROW_FILTER_TYPE_LABELS[filterType] ?? filterType}</option>
                {/each}
            </select>
        </div>
        {#if rowFilterSection === 'compare'}
            <div class="filter-section" id="row-filter-compare-section">
                <label for="row-filter-compare-op">Comparison</label>
                <div class="row-filter-inline">
                    <select id="row-filter-compare-op" bind:value={rowFilterDraft.compareOp}>
                        <option value="=">=</option>
                        <option value="!=">!=</option>
                        <option value="<">&lt;</option>
                        <option value="<=">&lt;=</option>
                        <option value=">">&gt;</option>
                        <option value=">=">&gt;=</option>
                    </select>
                    <input type="text" id="row-filter-compare-value" placeholder="Value" bind:value={rowFilterDraft.compareValue}>
                </div>
            </div>
        {/if}
        {#if rowFilterSection === 'between'}
            <div class="filter-section" id="row-filter-between-section">
                <label for="row-filter-between-left">Between</label>
                <div class="row-filter-inline">
                    <input type="text" id="row-filter-between-left" placeholder="From" bind:value={rowFilterDraft.betweenLeft}>
                    <input type="text" id="row-filter-between-right" placeholder="To" bind:value={rowFilterDraft.betweenRight}>
                </div>
            </div>
        {/if}
        {#if rowFilterSection === 'search'}
            <div class="filter-section" id="row-filter-search-section">
                <label for="row-filter-search-type">Text Search</label>
                <select id="row-filter-search-type" bind:value={rowFilterDraft.searchType}>
                    <option value="contains">contains</option>
                    <option value="not_contains">not contains</option>
                    <option value="starts_with">starts with</option>
                    <option value="ends_with">ends with</option>
                    <option value="regex_match">regex</option>
                </select>
                <input type="text" id="row-filter-search-term" placeholder="Search term" bind:value={rowFilterDraft.searchTerm}>
                <label class="checkbox-inline">
                    <input type="checkbox" id="row-filter-search-case" bind:checked={rowFilterDraft.searchCase}> Case sensitive
                </label>
            </div>
        {/if}
        {#if rowFilterSection === 'set'}
            <div class="filter-section" id="row-filter-set-section">
                <label for="row-filter-set-values">Set Membership</label>
                <input type="text" id="row-filter-set-values" placeholder="Comma-separated values" bind:value={rowFilterDraft.setValues}>
                <label class="checkbox-inline">
                    <input type="checkbox" id="row-filter-set-inclusive" bind:checked={rowFilterDraft.setInclusive}> Include values
                </label>
            </div>
        {/if}
        {#if supportsRowFilterConditions()}
            <div class="filter-section" id="row-filter-condition-section">
                <label for="row-filter-condition">Condition</label>
                <select id="row-filter-condition" bind:value={rowFilterDraft.condition}>
                    <option value="and">AND</option>
                    <option value="or">OR</option>
                </select>
            </div>
        {/if}
        <div class="filter-status" id="row-filter-error">{rowFilterError}</div>
        <div class="filter-actions">
            <button class="action" id="save-row-filter" on:click={saveRowFilter}>Save</button>
            <button class="action secondary" id="cancel-row-filter" on:click={() => {
                rowFilterPanelOpen = false;
            }}>Cancel</button>
        </div>
    </div>
</div>

<div
    class="side-panel"
    id="stats-panel"
    bind:this={statsPanelEl}
    class:open={statsPanelOpen}
    class:is-pinned={isPanelPinned('stats-panel')}
>
    <button
        type="button"
        class="panel-resizer"
        id="stats-panel-resizer"
        aria-label="Resize panel"
        on:mousedown={(event) => startSidePanelResize(event, 'stats-panel')}
    ></button>
    <div class="panel-header">
        <span>Column Statistics</span>
        <div class="panel-actions">
            <button
                class="panel-pin"
                data-panel-id="stats-panel"
                aria-pressed={isPanelPinned('stats-panel')}
                title="Pin panel"
                on:click={(event) => {
                    event.stopPropagation();
                    setPanelPinned('stats-panel', !isPanelPinned('stats-panel'));
                }}
            >
                <span class="codicon codicon-pin"></span>
            </button>
            <button class="close-btn" id="close-stats" on:click={() => {
                setPanelPinned('stats-panel', false);
                statsPanelOpen = false;
            }}>
                &times;
            </button>
        </div>
    </div>
    <div class="panel-content">
        <StatsColumnSelector
            schema={schema}
            bind:value={statsColumnValue}
            getColumnLabel={getColumnLabel}
            on:change={handleStatsColumnChange}
        />
        <div class="stats-results" id="stats-results" bind:this={statsResultsEl}>
            <div
                class="stats-message"
                id="stats-message"
                class:is-hidden={statsSectionsVisible}
                class:is-loading={statsMessageState === 'loading'}
                class:is-error={statsMessageState === 'error'}
            >
                {statsMessageText}
            </div>
            <div class="stats-sections" id="stats-sections" class:is-hidden={!statsSectionsVisible}>
                <div class="stats-section collapsible" data-section="overview" class:is-collapsed={collapsedSections.has('overview')}>
                    <button class="section-header" type="button" data-target="stats-overview-section" on:click={() => toggleStatsSection('overview')}>
                        <span class="codicon codicon-chevron-down"></span>
                        <span>Overview</span>
                    </button>
                    <div class="section-content" id="stats-overview-section">
                        <table class="stats-table" id="stats-overview-table">
                            {#if statsOverviewRows.length === 0}
                                <tr>
                                    <td class="stats-empty" colspan="2">{statsOverviewEmptyMessage}</td>
                                </tr>
                            {:else}
                                {#each statsOverviewRows as row}
                                    <tr>
                                        <td>{row.label}</td>
                                        <td>{row.value}</td>
                                    </tr>
                                {/each}
                            {/if}
                        </table>
                    </div>
                </div>
                <StatsSummarySection
                    title="Summary Statistics"
                    sectionId="summary"
                    rows={statsSummaryRows}
                    emptyMessage={statsSummaryEmptyMessage}
                    collapsed={collapsedSections.has('summary')}
                    on:toggle={() => toggleStatsSection('summary')}
                />
                <StatsDistributionSection
                    bind:histogramContainer={histogramContainer}
                    histogramVisible={histogramVisible}
                    histogramBins={histogramBins}
                    bind:histogramMethod={histogramMethod}
                    statsControlsEnabled={statsControlsEnabled}
                    collapsed={collapsedSections.has('distribution')}
                    on:toggle={() => toggleStatsSection('distribution')}
                    on:binsInput={(event) => {
                        histogramBins = event.detail.value;
                        handleHistogramBinsInput(event.detail.source);
                    }}
                    on:methodChange={handleStatsMethodChange}
                />
                <StatsFrequencySection
                    bind:frequencyContainer={frequencyContainer}
                    frequencyVisible={frequencyVisible}
                    frequencyLimit={frequencyLimit}
                    statsControlsEnabled={statsControlsEnabled}
                    frequencyFootnote={frequencyFootnote}
                    collapsed={collapsedSections.has('frequency')}
                    on:toggle={() => toggleStatsSection('frequency')}
                    on:limitInput={(event) => {
                        frequencyLimit = event.detail.value;
                        handleFrequencyLimitInput(event.detail.source);
                    }}
                />
            </div>
        </div>
    </div>
</div>

<div class="modal" id="code-modal" bind:this={codeModalEl} class:open={codeModalOpen}>
    <div class="modal-content">
        <div class="modal-header">
            <span>Convert to Code</span>
            <button class="close-btn" id="close-code" on:click={() => { codeModalOpen = false; }}>&times;</button>
        </div>
        <div class="modal-body">
            <div class="code-section">
                <label for="code-syntax">Syntax</label>
                <select id="code-syntax" bind:value={codeSyntax}>
                    <option value="pandas">Python (pandas)</option>
                    <option value="polars">Python (polars)</option>
                    <option value="dplyr">R (dplyr)</option>
                    <option value="data.table">R (data.table)</option>
                </select>
            </div>
            <div class="code-actions">
                <button class="action" id="convert-code" on:click={handleCodeConvert}>Convert</button>
                <button class="action secondary" id="copy-code" on:click={handleCodeCopy}>Copy to Clipboard</button>
            </div>
            <pre id="code-preview">{codePreview}</pre>
        </div>
    </div>
</div>

<div
    class="context-menu"
    id="column-menu"
    bind:this={columnMenuEl}
    class:open={columnMenuOpen}
    style={`left: ${columnMenuX}px; top: ${columnMenuY}px;`}
>
    <button class="context-menu-item" id="column-menu-add-filter" disabled={!rowFilterSupported} on:click={handleColumnMenuAddFilter}>Add Filter</button>
    <button class="context-menu-item" id="column-menu-hide-column" disabled={schema.length <= 1} on:click={handleColumnMenuHideColumn}>Hide Column</button>
</div>

<div class="table-container">
    <div class="table-header" id="table-header" bind:this={tableHeaderEl}>
        <div class="table-header-bar">Columns</div>
        <div
            class="table-row header-row"
            style={`grid-template-columns: ${columnTemplate}; width: ${totalWidth}px; transform: translateX(${-headerScrollLeft}px);`}
        >
            <div class="table-cell row-label">{state?.has_row_labels ? '#' : 'Row'}</div>
            {#each schema as column, columnIndex}
                <div
                    class="table-cell header-cell"
                    class:sortable={sortSupported}
                    class:sorted-asc={activeSort?.columnIndex === column.column_index && activeSort.direction === 'asc'}
                    class:sorted-desc={activeSort?.columnIndex === column.column_index && activeSort.direction === 'desc'}
                    data-column-index={column.column_index}
                    role="button"
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
                    on:contextmenu|preventDefault={(event) => openColumnMenu(event, column.column_index)}
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
                                on:click|stopPropagation={() => openRowFilterEditor(undefined, undefined, column.column_index)}
                            >
                                <span class="codicon codicon-filter"></span>
                            </button>
                            <span class="header-action-separator">|</span>
                            <button
                                class="header-action"
                                title="Show statistics for this column"
                                aria-label="Show statistics for this column"
                                on:click|stopPropagation={() => openStatsPanel({ columnIndex: column.column_index })}
                            >
                                <span class="codicon codicon-graph"></span>
                            </button>
                            <span class="header-action-separator">|</span>
                            <button
                                class="header-action"
                                title="Hide this column"
                                aria-label="Hide this column"
                                disabled={schema.length <= 1}
                                on:click|stopPropagation={() => hideColumn(column.column_index)}
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
                            on:mousedown={(event) => startColumnResize(event, column.column_index)}
                            on:click|stopPropagation
                        ></button>
                    {/if}
                </div>
            {/each}
        </div>
    </div>
    <div class="table-body" id="table-body" bind:this={tableBodyEl} on:scroll={handleTableScroll}>
        <div class="table-body-inner" bind:this={bodyInnerEl} style={`height: ${virtualizerTotalHeight}px; width: ${totalWidth}px;`}
            >
            {#each virtualRows as virtualRow (virtualRow.key)}
                {@const row = rowModel?.rows[virtualRow.index]}
                {#if row}
                    <div
                        class="table-row"
                        style={`grid-template-columns: ${columnTemplate}; width: ${totalWidth}px; transform: translateY(${virtualRow.start}px);`}
                    >
                        <div class="table-cell row-label">{getRowLabel(row.original.index, rowCacheVersion)}</div>
                        {#each schema as column, columnIndex}
                            {@const value = getCellValue(row.original.index, columnIndex, rowCacheVersion)}
                            <div class="table-cell" class:cell-special={isSpecialValue(value)}>{value}</div>
                        {/each}
                    </div>
                {:else}
                    <div
                        class="table-row"
                        style={`grid-template-columns: ${columnTemplate}; width: ${totalWidth}px; transform: translateY(${virtualRow.start}px);`}
                    >
                        <div class="table-cell row-label">{getRowLabel(virtualRow.index, rowCacheVersion)}</div>
                        {#each schema as column, columnIndex}
                            {@const value = getCellValue(virtualRow.index, columnIndex, rowCacheVersion)}
                            <div class="table-cell" class:cell-special={isSpecialValue(value)}>{value}</div>
                        {/each}
                    </div>
                {/if}
            {/each}
        </div>
    </div>
</div>
