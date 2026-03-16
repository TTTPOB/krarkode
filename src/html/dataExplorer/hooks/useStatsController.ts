import { tick } from 'svelte';
import { uiStore, statsStore } from '../stores';
import type {
    ColumnProfileResult,
    ColumnSchema,
    StatsMessageState,
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

type StatsControllerOptions = {
    log: (message: string, payload?: unknown) => void;
    postMessage: (message: unknown) => void;
    statsCharts: StatsChartsController;
    getVisibleSchema: () => ColumnSchema[];
    getStatsResultsEl: () => HTMLDivElement | undefined;
};

export class StatsController {
    private readonly log: (message: string, payload?: unknown) => void;
    private readonly postMessage: (message: unknown) => void;
    private readonly statsCharts: StatsChartsController;
    private readonly getVisibleSchema: () => ColumnSchema[];
    private readonly getStatsResultsEl: () => HTMLDivElement | undefined;
    private statsRefreshDebounceId: number | undefined;
    private pendingStatsScrollTop: number | null = null;

    constructor(options: StatsControllerOptions) {
        this.log = options.log;
        this.postMessage = options.postMessage;
        this.statsCharts = options.statsCharts;
        this.getVisibleSchema = options.getVisibleSchema;
        this.getStatsResultsEl = options.getStatsResultsEl;
    }

    setStatsMessage(message: string, stateValue: StatsMessageState): void {
        statsStore.messageText = message;
        statsStore.messageState = stateValue;
        statsStore.sectionsVisible = false;
        statsStore.controlsEnabled = stateValue !== 'empty';
    }

    private showStatsSections(): void {
        statsStore.sectionsVisible = true;
        statsStore.controlsEnabled = true;
    }

    private clearHistogram(): void {
        statsStore.histogramVisible = false;
        this.statsCharts.clearHistogram();
    }

    private clearFrequency(): void {
        statsStore.frequencyVisible = false;
        statsStore.frequencyFootnote = '';
        this.statsCharts.clearFrequency();
    }

    clearStatsContent(options: { preserveScrollTop?: boolean } = {}): void {
        const preserveScrollTop = options.preserveScrollTop === true;
        if (!preserveScrollTop) {
            statsStore.overviewRows = [];
            statsStore.summaryRows = [];
            statsStore.overviewEmptyMessage = 'No overview data.';
            statsStore.summaryEmptyMessage = 'No summary statistics.';
            statsStore.frequencyFootnote = '';
            this.clearHistogram();
            this.clearFrequency();
            const statsResultsEl = this.getStatsResultsEl();
            if (statsResultsEl) {
                statsResultsEl.scrollTop = 0;
            }
        }
    }

    private syncHistogramBins(source: 'slider' | 'input'): void {
        const rawValue = statsStore.histogramBins;
        const nextValue = clampNumber(rawValue, HISTOGRAM_BINS_MIN, HISTOGRAM_BINS_MAX, DEFAULT_HISTOGRAM_BINS);
        statsStore.histogramBins = nextValue;
        if (statsStore.histogramMethod !== 'fixed') {
            const previousMethod = statsStore.histogramMethod;
            statsStore.histogramMethod = 'fixed';
            this.log('Histogram method forced to fixed for bins update', { previousMethod });
        }
        this.log('Histogram bins updated', { value: nextValue, source });
        this.scheduleStatsRefresh('histogram-bins');
    }

    private syncFrequencyLimit(source: 'slider' | 'input'): void {
        const rawValue = statsStore.frequencyLimit;
        const nextValue = clampNumber(rawValue, FREQUENCY_LIMIT_MIN, FREQUENCY_LIMIT_MAX, DEFAULT_FREQUENCY_LIMIT);
        statsStore.frequencyLimit = nextValue;
        this.log('Frequency limit updated', { value: nextValue, source });
        this.scheduleStatsRefresh('frequency-limit');
    }

    private scheduleStatsRefresh(reason: string): void {
        if (uiStore.activeStatsColumnIndex === null) {
            return;
        }
        if (this.statsRefreshDebounceId !== undefined) {
            window.clearTimeout(this.statsRefreshDebounceId);
        }
        const preserveScrollTop = ['histogram-bins', 'frequency-limit'].includes(reason);
        this.statsRefreshDebounceId = window.setTimeout(() => {
            this.requestColumnProfiles(reason, { preserveScrollTop });
        }, STATS_REFRESH_DEBOUNCE_MS);
    }

    private requestColumnProfiles(reason: string, options: { preserveScrollTop?: boolean } = {}): void {
        const activeColumnIndex = uiStore.activeStatsColumnIndex;
        if (activeColumnIndex === null) {
            return;
        }
        const preserveScrollTop = options.preserveScrollTop === true;
        const profileRequest = buildColumnProfileRequest({
            histogramBins: statsStore.histogramBins,
            histogramMethod: statsStore.histogramMethod,
            frequencyLimit: statsStore.frequencyLimit,
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

        this.log('Requesting column profiles', {
            columnIndex: activeColumnIndex,
            profileTypes,
            histogramParams,
            frequencyParams,
            reason,
        });

        if (preserveScrollTop) {
            const statsResultsEl = this.getStatsResultsEl();
            if (statsResultsEl) {
                this.pendingStatsScrollTop = statsResultsEl.scrollTop;
                this.log('Preserving stats scroll position', { scrollTop: this.pendingStatsScrollTop, reason });
            }
        } else {
            this.pendingStatsScrollTop = null;
        }

        if (!preserveScrollTop) {
            this.setStatsMessage('Loading statistics...', 'loading');
        }
        this.clearStatsContent({ preserveScrollTop });
        this.postMessage({
            type: 'getColumnProfiles',
            columnIndex: activeColumnIndex,
            profileTypes,
            histogramParams,
            frequencyParams,
        });
    }

    private async finalizeStatsScroll(): Promise<void> {
        await tick();
        const statsResultsEl = this.getStatsResultsEl();
        if (!statsResultsEl) {
            this.pendingStatsScrollTop = null;
            return;
        }
        if (this.pendingStatsScrollTop === null) {
            statsResultsEl.scrollTop = 0;
            return;
        }
        const maxScrollTop = Math.max(statsResultsEl.scrollHeight - statsResultsEl.clientHeight, 0);
        const nextScrollTop = Math.min(this.pendingStatsScrollTop, maxScrollTop);
        statsResultsEl.scrollTop = nextScrollTop;
        this.pendingStatsScrollTop = null;
    }

    private syncHistogramBinsFromProfile(histogram: ColumnHistogram | undefined): void {
        if (!histogram || statsStore.histogramMethod === 'fixed') {
            return;
        }
        const binCount = histogram.bin_counts?.length ?? 0;
        if (binCount <= 0) {
            return;
        }
        const nextValue = clampNumber(binCount, HISTOGRAM_BINS_MIN, HISTOGRAM_BINS_MAX, DEFAULT_HISTOGRAM_BINS);
        if (statsStore.histogramBins !== nextValue) {
            statsStore.histogramBins = nextValue;
            this.log('Histogram bins synced from profile', { value: nextValue, method: statsStore.histogramMethod });
        }
    }

    private renderHistogram(histogram: ColumnHistogram | undefined, columnLabel: string): void {
        const rendered = this.statsCharts.renderHistogram(histogram, columnLabel);
        statsStore.histogramVisible = rendered;
        if (rendered) {
            this.log('Rendering histogram', { columnLabel, bins: histogram?.bin_counts?.length ?? 0 });
        } else {
            this.clearHistogram();
        }
    }

    private renderFrequencyChart(frequency: ColumnFrequencyTable | undefined): void {
        const rendered = this.statsCharts.renderFrequency(frequency);
        statsStore.frequencyVisible = rendered;
        if (rendered) {
            this.log('Rendering frequency chart', { values: frequency?.values?.length ?? 0 });
        } else {
            this.clearFrequency();
        }
    }

    handleColumnProfilesResult(
        columnIndex: number,
        profiles: ColumnProfileResult[],
        errorMessage?: string,
    ): void {
        const activeColumnIndex = uiStore.activeStatsColumnIndex;
        if (activeColumnIndex !== null && columnIndex !== activeColumnIndex) {
            this.log('Ignoring stale column profiles', { columnIndex, activeStatsColumnIndex: activeColumnIndex });
            return;
        }
        if (errorMessage) {
            this.setStatsMessage(`Error: ${errorMessage}`, 'error');
            this.clearStatsContent();
            void this.finalizeStatsScroll();
            return;
        }

        this.log('Column profiles received', { columnIndex, profiles });
        if (!profiles || profiles.length === 0) {
            this.setStatsMessage('No statistics available for this column.', 'empty');
            this.clearStatsContent();
            void this.finalizeStatsScroll();
            return;
        }

        const combined = mergeColumnProfiles(profiles);

        const column = this.getVisibleSchema().find((col) => col.column_index === columnIndex);
        const columnLabel = column ? getColumnLabel(column) : `Column ${columnIndex + 1}`;
        const summaryStats = combined.summary_stats;
        const histogram = combined.large_histogram ?? combined.small_histogram;
        const frequency = combined.large_frequency_table ?? combined.small_frequency_table;
        const quantiles = histogram?.quantiles ?? [];

        statsStore.overviewRows = [
            { label: 'Column', value: columnLabel },
            { label: 'Type', value: formatStatValue(summaryStats?.type_display) },
            { label: 'Null Count', value: formatStatValue(combined.null_count) },
        ];
        statsStore.summaryRows = buildSummaryRows(summaryStats, quantiles);
        statsStore.overviewEmptyMessage = 'No overview data.';
        statsStore.summaryEmptyMessage = 'No summary statistics.';

        this.syncHistogramBinsFromProfile(histogram);
        this.renderHistogram(histogram, columnLabel);
        this.renderFrequencyChart(frequency);
        if (!frequency) {
            statsStore.frequencyFootnote = 'No frequency data.';
        } else if (frequency.other_count !== undefined) {
            statsStore.frequencyFootnote = `Other values: ${frequency.other_count}`;
            this.log('Frequency table contains other values', { otherCount: frequency.other_count });
        } else {
            statsStore.frequencyFootnote = '';
        }

        this.showStatsSections();
        void this.finalizeStatsScroll();
    }

    handleStatsColumnChange(): void {
        const columnIndex = parseInt(uiStore.statsColumnValue, 10);
        if (Number.isNaN(columnIndex)) {
            uiStore.activeStatsColumnIndex = null;
            this.setStatsMessage('Select a column to view statistics.', 'empty');
            this.clearStatsContent();
            return;
        }
        uiStore.activeStatsColumnIndex = columnIndex;
        this.requestColumnProfiles('column-change');
    }

    toggleStatsSection(sectionId: string): void {
        uiStore.toggleSectionCollapsed(sectionId);
        requestAnimationFrame(() => {
            this.statsCharts.resize();
        });
    }

    handleHistogramBinsInput(source: 'slider' | 'input'): void {
        this.syncHistogramBins(source);
    }

    handleFrequencyLimitInput(source: 'slider' | 'input'): void {
        this.syncFrequencyLimit(source);
    }

    initializeStatsDefaults(): void {
        statsStore.histogramBins = DEFAULT_HISTOGRAM_BINS;
        statsStore.histogramMethod = 'freedman_diaconis';
        statsStore.frequencyLimit = DEFAULT_FREQUENCY_LIMIT;
        statsStore.controlsEnabled = false;
    }

    openStatsPanel(options: { columnIndex?: number; toggle?: boolean } = {}): void {
        const { columnIndex, toggle = false } = options;
        const shouldOpen = toggle ? !uiStore.statsPanelOpen : true;
        const isPinned = uiStore.isPanelPinned('stats-panel');

        if (!isPinned) {
            // Close other non-pinned panels when opening stats panel
            if (!uiStore.isPanelPinned('column-visibility-panel')) {
                uiStore.columnVisibilityOpen = false;
            }
            if (!uiStore.isPanelPinned('row-filter-panel')) {
                uiStore.rowFilterPanelOpen = false;
            }
            // Code modal is never pinned
            uiStore.codeModalOpen = false;
        }

        if (!shouldOpen) {
            uiStore.statsPanelOpen = false;
            return;
        }

        uiStore.statsPanelOpen = true;
        if (columnIndex !== undefined) {
            uiStore.statsColumnValue = String(columnIndex);
        }
        const resolvedIndex = parseInt(uiStore.statsColumnValue, 10);
        if (!Number.isNaN(resolvedIndex)) {
            uiStore.activeStatsColumnIndex = resolvedIndex;
            this.requestColumnProfiles('panel-open');
        } else {
            uiStore.activeStatsColumnIndex = null;
            this.setStatsMessage('Select a column to view statistics.', 'empty');
            this.clearStatsContent();
        }
        requestAnimationFrame(() => {
            this.statsCharts.resize();
        });
    }

    dispose(): void {
        if (this.statsRefreshDebounceId !== undefined) {
            window.clearTimeout(this.statsRefreshDebounceId);
        }
    }
}
