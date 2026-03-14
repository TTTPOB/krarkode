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

export class StatsCharts implements StatsChartsController {
    private readonly getHistogramContainer: () => HTMLDivElement | undefined;
    private readonly getFrequencyContainer: () => HTMLDivElement | undefined;
    private readonly log: (message: string, payload?: unknown) => void;
    private histogramChart: echarts.ECharts | null = null;
    private frequencyChart: echarts.ECharts | null = null;

    constructor(options: StatsChartOptions) {
        this.getHistogramContainer = options.getHistogramContainer;
        this.getFrequencyContainer = options.getFrequencyContainer;
        this.log = options.log ?? (() => undefined);
    }

    private ensureHistogramChart(): echarts.ECharts | null {
        const container = this.getHistogramContainer();
        if (!container) {
            return null;
        }
        if (!this.histogramChart) {
            this.histogramChart = echarts.init(container);
            this.log('Histogram chart created');
        }
        return this.histogramChart;
    }

    private ensureFrequencyChart(): echarts.ECharts | null {
        const container = this.getFrequencyContainer();
        if (!container) {
            return null;
        }
        if (!this.frequencyChart) {
            this.frequencyChart = echarts.init(container);
            this.log('Frequency chart created');
        }
        return this.frequencyChart;
    }

    renderHistogram(histogram: ColumnHistogram | undefined, columnLabel: string): boolean {
        const chart = this.ensureHistogramChart();
        if (!chart) {
            return false;
        }
        const rendered = renderHistogramChart(chart, histogram, columnLabel);
        if (!rendered) {
            chart.clear();
        }
        return rendered;
    }

    renderFrequency(frequency: ColumnFrequencyTable | undefined): boolean {
        const chart = this.ensureFrequencyChart();
        if (!chart) {
            return false;
        }
        const rendered = renderFrequencyTableChart(chart, frequency, this.getFrequencyContainer() ?? null);
        if (!rendered) {
            chart.clear();
        }
        return rendered;
    }

    clearHistogram(): void {
        this.histogramChart?.clear();
    }

    clearFrequency(): void {
        this.frequencyChart?.clear();
    }

    resize(): void {
        this.histogramChart?.resize();
        this.frequencyChart?.resize();
    }

    dispose(): void {
        this.histogramChart?.dispose();
        this.frequencyChart?.dispose();
        this.histogramChart = null;
        this.frequencyChart = null;
    }
}
