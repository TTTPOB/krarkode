import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ColumnFrequencyTable, ColumnHistogram } from '../types';
import { renderFrequencyTableChart, renderHistogramChart } from '../utils';

echarts.use([BarChart, GridComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

type StatsChartOptions = {
    getHistogramContainer: () => HTMLDivElement | undefined;
    getFrequencyContainer: () => HTMLDivElement | undefined;
    log?: (message: string, payload?: unknown) => void;
};

export type StatsChartsController = {
    renderHistogram: (histogram: ColumnHistogram | undefined, columnLabel: string) => boolean;
    renderFrequency: (frequency: ColumnFrequencyTable | undefined) => boolean;
    clearHistogram: () => void;
    clearFrequency: () => void;
    resize: () => void;
    dispose: () => void;
};

export function useStatsCharts(options: StatsChartOptions): StatsChartsController {
    const log = options.log ?? (() => undefined);
    let histogramChart: echarts.ECharts | null = null;
    let frequencyChart: echarts.ECharts | null = null;

    const ensureHistogramChart = (): echarts.ECharts | null => {
        const container = options.getHistogramContainer();
        if (!container) {
            return null;
        }
        if (!histogramChart) {
            histogramChart = echarts.init(container);
            log('Histogram chart created');
        }
        return histogramChart;
    };

    const ensureFrequencyChart = (): echarts.ECharts | null => {
        const container = options.getFrequencyContainer();
        if (!container) {
            return null;
        }
        if (!frequencyChart) {
            frequencyChart = echarts.init(container);
            log('Frequency chart created');
        }
        return frequencyChart;
    };

    const renderHistogram = (histogram: ColumnHistogram | undefined, columnLabel: string): boolean => {
        const chart = ensureHistogramChart();
        if (!chart) {
            return false;
        }
        const rendered = renderHistogramChart(chart, histogram, columnLabel);
        if (!rendered) {
            chart.clear();
        }
        return rendered;
    };

    const renderFrequency = (frequency: ColumnFrequencyTable | undefined): boolean => {
        const chart = ensureFrequencyChart();
        if (!chart) {
            return false;
        }
        const rendered = renderFrequencyTableChart(chart, frequency, options.getFrequencyContainer() ?? null);
        if (!rendered) {
            chart.clear();
        }
        return rendered;
    };

    const clearHistogram = (): void => {
        histogramChart?.clear();
    };

    const clearFrequency = (): void => {
        frequencyChart?.clear();
    };

    const resize = (): void => {
        histogramChart?.resize();
        frequencyChart?.resize();
    };

    const dispose = (): void => {
        histogramChart?.dispose();
        frequencyChart?.dispose();
        histogramChart = null;
        frequencyChart = null;
    };

    return {
        renderHistogram,
        renderFrequency,
        clearHistogram,
        clearFrequency,
        resize,
        dispose,
    };
}
