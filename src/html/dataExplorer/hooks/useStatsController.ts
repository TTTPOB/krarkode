import { tick } from 'svelte';
import { get, type Writable } from 'svelte/store';
import type {
    ColumnProfileResult,
    ColumnSchema,
    StatsMessageState,
    StatsRow,
    ColumnHistogram,
    ColumnFrequencyTable,
} from '../types';
import {
    DEFAULT_FREQUENCY_LIMIT,
    DEFAULT_HISTOGRAM_BINS,
    FREQUENCY_LIMIT_MAX,
    FREQUENCY_LIMIT_MIN,
    HISTOGRAM_BINS_MAX,
    HISTOGRAM_BINS_MIN,
    SMALL_FREQUENCY_MAX_LIMIT,
    SMALL_HISTOGRAM_MAX_BINS,
    STATS_REFRESH_DEBOUNCE_MS,
} from '../types';
import type { StatsChartsController } from './useStatsCharts';
import {
    buildColumnProfileRequest,
    buildSummaryRows,
    clampNumber,
    formatStatValue,
    getColumnLabel,
    mergeColumnProfiles,
} from '../utils';

type StatsStores = {
    statsMessageText: Writable<string>;
    statsMessageState: Writable<StatsMessageState>;
    statsSectionsVisible: Writable<boolean>;
    statsControlsEnabled: Writable<boolean>;
    statsOverviewRows: Writable<StatsRow[]>;
    statsSummaryRows: Writable<StatsRow[]>;
    statsOverviewEmptyMessage: Writable<string>;
    statsSummaryEmptyMessage: Writable<string>;
    frequencyFootnote: Writable<string>;
    histogramBins: Writable<number>;
    histogramMethod: Writable<string>;
    frequencyLimit: Writable<number>;
    histogramVisible: Writable<boolean>;
    frequencyVisible: Writable<boolean>;
    collapsedSections: Writable<Set<string>>;
};

type StatsControllerOptions = {
    log: (message: string, payload?: unknown) => void;
    postMessage: (message: unknown) => void;
    statsCharts: StatsChartsController;
    getVisibleSchema: () => ColumnSchema[];
    getActiveStatsColumnIndex: () => number | null;
    setActiveStatsColumnIndex: (value: number | null) => void;
    getStatsColumnValue: () => string;
    setStatsColumnValue: (value: string) => void;
    getStatsResultsEl: () => HTMLDivElement | undefined;
    getStatsPanelOpen: () => boolean;
    setStatsPanelOpen: (value: boolean) => void;
    setColumnVisibilityOpen: (value: boolean) => void;
    setRowFilterPanelOpen: (value: boolean) => void;
    setCodeModalOpen: (value: boolean) => void;
    stores: StatsStores;
};

export function useStatsController(options: StatsControllerOptions) {
    const {
        log,
        postMessage,
        statsCharts,
        getVisibleSchema,
        getActiveStatsColumnIndex,
        setActiveStatsColumnIndex,
        getStatsColumnValue,
        setStatsColumnValue,
        getStatsResultsEl,
        getStatsPanelOpen,
        setStatsPanelOpen,
        setColumnVisibilityOpen,
        setRowFilterPanelOpen,
        setCodeModalOpen,
        stores,
    } = options;

    let statsRefreshDebounceId: number | undefined;
    let pendingStatsScrollTop: number | null = null;

    const setStatsMessage = (message: string, stateValue: StatsMessageState): void => {
        stores.statsMessageText.set(message);
        stores.statsMessageState.set(stateValue);
        stores.statsSectionsVisible.set(false);
        stores.statsControlsEnabled.set(stateValue !== 'empty');
    };

    const showStatsSections = (): void => {
        stores.statsSectionsVisible.set(true);
        stores.statsControlsEnabled.set(true);
    };

    const clearHistogram = (): void => {
        stores.histogramVisible.set(false);
        statsCharts.clearHistogram();
    };

    const clearFrequency = (): void => {
        stores.frequencyVisible.set(false);
        stores.frequencyFootnote.set('');
        statsCharts.clearFrequency();
    };

    const clearStatsContent = (options: { preserveScrollTop?: boolean } = {}): void => {
        const preserveScrollTop = options.preserveScrollTop === true;
        if (!preserveScrollTop) {
            stores.statsOverviewRows.set([]);
            stores.statsSummaryRows.set([]);
            stores.statsOverviewEmptyMessage.set('No overview data.');
            stores.statsSummaryEmptyMessage.set('No summary statistics.');
            stores.frequencyFootnote.set('');
            clearHistogram();
            clearFrequency();
            const statsResultsEl = getStatsResultsEl();
            if (statsResultsEl) {
                statsResultsEl.scrollTop = 0;
            }
        }
    };

    const syncHistogramBins = (source: 'slider' | 'input'): void => {
        const rawValue = get(stores.histogramBins);
        const nextValue = clampNumber(rawValue, HISTOGRAM_BINS_MIN, HISTOGRAM_BINS_MAX, DEFAULT_HISTOGRAM_BINS);
        stores.histogramBins.set(nextValue);
        if (get(stores.histogramMethod) !== 'fixed') {
            const previousMethod = get(stores.histogramMethod);
            stores.histogramMethod.set('fixed');
            log('Histogram method forced to fixed for bins update', { previousMethod });
        }
        log('Histogram bins updated', { value: nextValue, source });
        scheduleStatsRefresh('histogram-bins');
    };

    const syncFrequencyLimit = (source: 'slider' | 'input'): void => {
        const rawValue = get(stores.frequencyLimit);
        const nextValue = clampNumber(rawValue, FREQUENCY_LIMIT_MIN, FREQUENCY_LIMIT_MAX, DEFAULT_FREQUENCY_LIMIT);
        stores.frequencyLimit.set(nextValue);
        log('Frequency limit updated', { value: nextValue, source });
        scheduleStatsRefresh('frequency-limit');
    };

    const scheduleStatsRefresh = (reason: string): void => {
        if (getActiveStatsColumnIndex() === null) {
            return;
        }
        if (statsRefreshDebounceId !== undefined) {
            window.clearTimeout(statsRefreshDebounceId);
        }
        const preserveScrollTop = ['histogram-bins', 'histogram-method', 'frequency-limit'].includes(reason);
        statsRefreshDebounceId = window.setTimeout(() => {
            requestColumnProfiles(reason, { preserveScrollTop });
        }, STATS_REFRESH_DEBOUNCE_MS);
    };

    const requestColumnProfiles = (reason: string, options: { preserveScrollTop?: boolean } = {}): void => {
        const activeColumnIndex = getActiveStatsColumnIndex();
        if (activeColumnIndex === null) {
            return;
        }
        const preserveScrollTop = options.preserveScrollTop === true;
        const profileRequest = buildColumnProfileRequest({
            histogramBins: get(stores.histogramBins),
            histogramMethod: get(stores.histogramMethod),
            frequencyLimit: get(stores.frequencyLimit),
            histogramBinsMin: HISTOGRAM_BINS_MIN,
            histogramBinsMax: HISTOGRAM_BINS_MAX,
            histogramBinsDefault: DEFAULT_HISTOGRAM_BINS,
            frequencyLimitMin: FREQUENCY_LIMIT_MIN,
            frequencyLimitMax: FREQUENCY_LIMIT_MAX,
            frequencyLimitDefault: DEFAULT_FREQUENCY_LIMIT,
            smallHistogramMaxBins: SMALL_HISTOGRAM_MAX_BINS,
            smallFrequencyMaxLimit: SMALL_FREQUENCY_MAX_LIMIT,
        });
        const { profileTypes, histogramParams, frequencyParams } = profileRequest;

        log('Requesting column profiles', {
            columnIndex: activeColumnIndex,
            profileTypes,
            histogramParams,
            frequencyParams,
            reason,
        });

        if (preserveScrollTop) {
            const statsResultsEl = getStatsResultsEl();
            if (statsResultsEl) {
                pendingStatsScrollTop = statsResultsEl.scrollTop;
                log('Preserving stats scroll position', { scrollTop: pendingStatsScrollTop, reason });
            }
        } else {
            pendingStatsScrollTop = null;
        }

        if (!preserveScrollTop) {
            setStatsMessage('Loading statistics...', 'loading');
        }
        clearStatsContent({ preserveScrollTop });
        postMessage({
            type: 'getColumnProfiles',
            columnIndex: activeColumnIndex,
            profileTypes,
            histogramParams,
            frequencyParams,
        });
    };

    const finalizeStatsScroll = async (): Promise<void> => {
        await tick();
        const statsResultsEl = getStatsResultsEl();
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
    };

    const syncHistogramBinsFromProfile = (histogram: ColumnHistogram | undefined): void => {
        if (!histogram || get(stores.histogramMethod) === 'fixed') {
            return;
        }
        const binCount = histogram.bin_counts?.length ?? 0;
        if (binCount <= 0) {
            return;
        }
        const nextValue = clampNumber(binCount, HISTOGRAM_BINS_MIN, HISTOGRAM_BINS_MAX, DEFAULT_HISTOGRAM_BINS);
        if (get(stores.histogramBins) !== nextValue) {
            stores.histogramBins.set(nextValue);
            log('Histogram bins synced from profile', { value: nextValue, method: get(stores.histogramMethod) });
        }
    };

    const renderHistogram = (histogram: ColumnHistogram | undefined, columnLabel: string): void => {
        const rendered = statsCharts.renderHistogram(histogram, columnLabel);
        stores.histogramVisible.set(rendered);
        if (rendered) {
            log('Rendering histogram', { columnLabel, bins: histogram?.bin_counts?.length ?? 0 });
        } else {
            clearHistogram();
        }
    };

    const renderFrequencyChart = (frequency: ColumnFrequencyTable | undefined): void => {
        const rendered = statsCharts.renderFrequency(frequency);
        stores.frequencyVisible.set(rendered);
        if (rendered) {
            log('Rendering frequency chart', { values: frequency?.values?.length ?? 0 });
        } else {
            clearFrequency();
        }
    };

    const handleColumnProfilesResult = (
        columnIndex: number,
        profiles: ColumnProfileResult[],
        errorMessage?: string,
    ): void => {
        const activeColumnIndex = getActiveStatsColumnIndex();
        if (activeColumnIndex !== null && columnIndex !== activeColumnIndex) {
            log('Ignoring stale column profiles', { columnIndex, activeStatsColumnIndex: activeColumnIndex });
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

        const combined = mergeColumnProfiles(profiles);

        const column = getVisibleSchema().find((col) => col.column_index === columnIndex);
        const columnLabel = column ? getColumnLabel(column) : `Column ${columnIndex + 1}`;
        const summaryStats = combined.summary_stats;
        const histogram = combined.large_histogram ?? combined.small_histogram;
        const frequency = combined.large_frequency_table ?? combined.small_frequency_table;
        const quantiles = histogram?.quantiles ?? [];

        stores.statsOverviewRows.set([
            { label: 'Column', value: columnLabel },
            { label: 'Type', value: formatStatValue(summaryStats?.type_display) },
            { label: 'Null Count', value: formatStatValue(combined.null_count) },
        ]);
        stores.statsSummaryRows.set(buildSummaryRows(summaryStats, quantiles));
        stores.statsOverviewEmptyMessage.set('No overview data.');
        stores.statsSummaryEmptyMessage.set('No summary statistics.');

        syncHistogramBinsFromProfile(histogram);
        renderHistogram(histogram, columnLabel);
        renderFrequencyChart(frequency);
        if (!frequency) {
            stores.frequencyFootnote.set('No frequency data.');
        } else if (frequency.other_count !== undefined) {
            stores.frequencyFootnote.set(`Other values: ${frequency.other_count}`);
            log('Frequency table contains other values', { otherCount: frequency.other_count });
        } else {
            stores.frequencyFootnote.set('');
        }

        showStatsSections();
        void finalizeStatsScroll();
    };

    const handleStatsColumnChange = (): void => {
        const columnIndex = parseInt(getStatsColumnValue(), 10);
        if (Number.isNaN(columnIndex)) {
            setActiveStatsColumnIndex(null);
            setStatsMessage('Select a column to view statistics.', 'empty');
            clearStatsContent();
            return;
        }
        setActiveStatsColumnIndex(columnIndex);
        requestColumnProfiles('column-change');
    };

    const toggleStatsSection = (sectionId: string): void => {
        stores.collapsedSections.update((sections) => {
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
    };

    const handleStatsMethodChange = (): void => {
        scheduleStatsRefresh('histogram-method');
    };

    const handleHistogramBinsInput = (source: 'slider' | 'input'): void => {
        syncHistogramBins(source);
    };

    const handleFrequencyLimitInput = (source: 'slider' | 'input'): void => {
        syncFrequencyLimit(source);
    };

    const initializeStatsDefaults = (): void => {
        stores.histogramBins.set(DEFAULT_HISTOGRAM_BINS);
        stores.histogramMethod.set('freedman_diaconis');
        stores.frequencyLimit.set(DEFAULT_FREQUENCY_LIMIT);
        stores.statsControlsEnabled.set(false);
    };

    const openStatsPanel = (options: { columnIndex?: number; toggle?: boolean } = {}): void => {
        const { columnIndex, toggle = false } = options;
        const shouldOpen = toggle ? !getStatsPanelOpen() : true;
        setColumnVisibilityOpen(false);
        setCodeModalOpen(false);
        setRowFilterPanelOpen(false);
        if (!shouldOpen) {
            setStatsPanelOpen(false);
            return;
        }

        setStatsPanelOpen(true);
        if (columnIndex !== undefined) {
            setStatsColumnValue(String(columnIndex));
        }
        const resolvedIndex = parseInt(getStatsColumnValue(), 10);
        if (!Number.isNaN(resolvedIndex)) {
            setActiveStatsColumnIndex(resolvedIndex);
            requestColumnProfiles('panel-open');
        } else {
            setActiveStatsColumnIndex(null);
            setStatsMessage('Select a column to view statistics.', 'empty');
            clearStatsContent();
        }
        requestAnimationFrame(() => {
            statsCharts.resize();
        });
    };

    const dispose = (): void => {
        if (statsRefreshDebounceId !== undefined) {
            window.clearTimeout(statsRefreshDebounceId);
        }
    };

    return {
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
        dispose,
    };
}
