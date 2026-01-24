/**
 * ECharts rendering utilities for the Data Explorer.
 * Functions for rendering histograms and frequency charts.
 */

import type * as echarts from 'echarts/core';
import type { ColumnHistogram, ColumnFrequencyTable } from '../types';

/**
 * Get chart theme colors from CSS variables.
 */
export function getChartThemeColors(): {
    primary: string;
    foreground: string;
    description: string;
    border: string;
} {
    const style = getComputedStyle(document.body);
    return {
        primary: style.getPropertyValue('--vscode-charts-blue').trim() || '#4e79a7',
        foreground: style.getPropertyValue('--vscode-foreground').trim() || '#cccccc',
        description: style.getPropertyValue('--vscode-descriptionForeground').trim() || '#888888',
        border: style.getPropertyValue('--vscode-editorWidget-border').trim() || '#3c3c3c',
    };
}

/**
 * Render a histogram chart.
 * Returns true if the chart was rendered, false if cleared.
 */
export function renderHistogramChart(
    chart: echarts.ECharts,
    histogram: ColumnHistogram | undefined,
    columnLabel: string
): boolean {
    if (!histogram) {
        chart.clear();
        return false;
    }

    const edges = histogram.bin_edges ?? [];
    const counts = histogram.bin_counts ?? [];
    if (edges.length < 2 || counts.length === 0) {
        chart.clear();
        return false;
    }

    const labels = counts.map((_, index) => {
        const start = edges[index] ?? '';
        const end = edges[index + 1] ?? '';
        return `${start} - ${end}`;
    });

    const colors = getChartThemeColors();

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
                color: colors.description,
            },
            axisLine: {
                lineStyle: { color: colors.border },
            },
        },
        yAxis: {
            type: 'value',
            axisLabel: {
                color: colors.description,
            },
            splitLine: {
                lineStyle: { color: colors.border },
            },
        },
        series: [
            {
                type: 'bar',
                data: counts,
                itemStyle: {
                    color: colors.primary,
                },
            },
        ],
    });
    requestAnimationFrame(() => {
        chart.resize();
    });
    return true;
}

/**
 * Render a frequency chart (horizontal bar chart).
 * Returns true if the chart was rendered, false if cleared.
 */
export function renderFrequencyTableChart(
    chart: echarts.ECharts,
    frequency: ColumnFrequencyTable | undefined,
    container: HTMLDivElement | null
): boolean {
    if (!frequency) {
        chart.clear();
        return false;
    }
    const values = frequency.values ?? [];
    const counts = frequency.counts ?? [];
    if (values.length === 0 || counts.length === 0) {
        chart.clear();
        return false;
    }

    const displayValues = values.map((value) => String(value));
    const reversedValues = [...displayValues].reverse();
    const reversedCounts = [...counts].reverse();
    const chartHeight = Math.max(160, reversedValues.length * 18 + 40);

    if (container) {
        container.style.height = `${chartHeight}px`;
    }

    const colors = getChartThemeColors();

    chart.setOption({
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
        },
        grid: { left: 100, right: 30, top: 10, bottom: 20 },
        xAxis: {
            type: 'value',
            axisLabel: {
                color: colors.description,
            },
            splitLine: {
                lineStyle: { color: colors.border },
            },
        },
        yAxis: {
            type: 'category',
            data: reversedValues,
            axisLabel: {
                color: colors.description,
                width: 84,
                overflow: 'truncate',
                formatter: (value: string) => (value.length > 18 ? `${value.slice(0, 15)}...` : value),
            },
            axisLine: {
                lineStyle: { color: colors.border },
            },
        },
        series: [
            {
                type: 'bar',
                data: reversedCounts,
                itemStyle: {
                    color: colors.primary,
                },
                label: {
                    show: true,
                    position: 'right',
                    fontSize: 10,
                    color: colors.foreground,
                },
            },
        ],
    });
    requestAnimationFrame(() => {
        chart.resize();
    });
    return true;
}
