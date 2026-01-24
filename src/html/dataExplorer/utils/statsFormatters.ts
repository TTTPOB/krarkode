/**
 * Statistics formatting utilities for the Data Explorer.
 * Pure functions for formatting stats values and building summary rows.
 */

import type {
    ColumnSummaryStats,
    ColumnQuantileValue,
    StatsRow,
    RowFilter,
    ColumnSchema,
} from '../types';
import { UNNAMED_COLUMN_PREFIX } from '../types';

/**
 * Format a stat value for display, returning '-' for empty values.
 */
export function formatStatValue(value: string | number | undefined | null): string {
    if (value === undefined || value === null || value === '') {
        return '-';
    }
    return String(value);
}

/**
 * Format a quantile value with approximate prefix if not exact.
 */
export function formatQuantileValue(quantile: ColumnQuantileValue): string {
    const prefix = quantile.exact ? '' : '~';
    return `${prefix}${quantile.value}`;
}

/**
 * Format a quantile label for display.
 */
export function formatQuantileLabel(q: number): string {
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

/**
 * Build summary rows from column summary stats and quantiles.
 */
export function buildSummaryRows(
    summaryStats: ColumnSummaryStats | undefined,
    quantiles: ColumnQuantileValue[]
): StatsRow[] {
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

/**
 * Format special numeric codes as display values.
 */
export function formatSpecialValue(code: number): string {
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

/**
 * Get the display label for a column.
 */
export function getColumnLabel(column: ColumnSchema): string {
    const rawLabel = column.column_label ?? column.column_name;
    const trimmed = rawLabel?.trim();
    if (trimmed) {
        return trimmed;
    }
    return `${UNNAMED_COLUMN_PREFIX} ${column.column_index + 1}`;
}

/**
 * Check if a column has a name defined.
 */
export function isColumnNamed(column: ColumnSchema): boolean {
    const rawLabel = column.column_label ?? column.column_name;
    return Boolean(rawLabel?.trim());
}

/**
 * Format a row filter for display as a chip label.
 */
export function formatRowFilterChip(filter: RowFilter, index: number): string {
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
