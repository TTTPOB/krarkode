import * as assert from 'assert';
import {
    buildSummaryRows,
    formatQuantileLabel,
    formatQuantileValue,
    formatRowFilterChip,
    formatSpecialValue,
    formatStatValue,
    getColumnLabel,
    isColumnNamed,
} from '../../html/dataExplorer/utils/statsFormatters';
import {
    buildRowFilterParams,
    createRowFilterDraft,
    getSupportedRowFilterTypes,
} from '../../html/dataExplorer/utils/rowFilterHelpers';
import {
    isColumnFilterSupported,
    isRowFilterSupported,
    isSetColumnFiltersSupported,
    isSortSupported,
    supportsRowFilterConditions,
} from '../../html/dataExplorer/utils/featureSupport';
import {
    computeDisplayedColumns,
    resolveSchemaMatches,
    resolveVisibleSchema,
} from '../../html/dataExplorer/utils/schemaHelpers';
import type { ColumnSchema, ColumnQuantileValue, ColumnSummaryStats, RowFilter } from '../../html/dataExplorer/types';

function createColumnSchema(overrides: Partial<ColumnSchema> = {}): ColumnSchema {
    return {
        column_name: 'col',
        column_index: 0,
        type_name: 'string',
        type_display: 'string',
        ...overrides,
    };
}

suite('Data Explorer utils', () => {
    test('formats stat and quantile values consistently', () => {
        assert.strictEqual(formatStatValue(undefined), '-');
        assert.strictEqual(formatStatValue(''), '-');
        assert.strictEqual(formatStatValue(0), '0');
        assert.strictEqual(formatQuantileValue({ q: 0.5, value: '10', exact: true }), '10');
        assert.strictEqual(formatQuantileValue({ q: 0.5, value: '10', exact: false }), '~10');
        assert.strictEqual(formatQuantileLabel(0.25), 'Q1 (25%)');
        assert.strictEqual(formatQuantileLabel(0.1), '10%');
    });

    test('builds summary rows for numeric stats with sorted quantiles', () => {
        const summary: ColumnSummaryStats = {
            type_display: 'number',
            number_stats: {
                min_value: '1',
                max_value: '9',
                mean: '5',
                median: '4',
                stdev: '2',
            },
        };
        const quantiles: ColumnQuantileValue[] = [
            { q: 0.75, value: '7', exact: true },
            { q: 0.25, value: '3', exact: false },
        ];
        const rows = buildSummaryRows(summary, quantiles);
        assert.deepStrictEqual(
            rows.map((row) => row.label),
            ['Minimum', 'Q1 (25%)', 'Q3 (75%)', 'Maximum', 'Mean', 'Std Dev'],
        );
        assert.strictEqual(rows[1].value, '~3');
    });

    test('formats column labels and row filter chips', () => {
        const unnamed = createColumnSchema({ column_label: ' ', column_index: 2 });
        assert.strictEqual(getColumnLabel(unnamed), 'Unnamed 3');
        assert.strictEqual(isColumnNamed(unnamed), false);
        const filter: RowFilter = {
            filter_id: 'f1',
            filter_type: 'compare',
            column_schema: createColumnSchema({ column_label: 'Age' }),
            condition: 'and',
            params: { op: '>=', value: '21' },
        };
        assert.strictEqual(formatRowFilterChip(filter, 0), 'Age >= 21');
        const setFilter: RowFilter = {
            filter_id: 'f2',
            filter_type: 'set_membership',
            column_schema: createColumnSchema({ column_name: 'status' }),
            condition: 'or',
            params: { values: ['new', 'old'], inclusive: false },
        };
        assert.strictEqual(formatRowFilterChip(setFilter, 1), 'OR status not in [new, old]');
        assert.strictEqual(formatSpecialValue(2), 'NaN');
        assert.strictEqual(formatSpecialValue(99), 'UNKNOWN');
    });

    test('builds row filter drafts and validates params', () => {
        const schema = [createColumnSchema({ column_index: 4, column_name: 'city' })];
        const draft = createRowFilterDraft(schema);
        assert.strictEqual(draft.columnIndex, 4);
        const invalidCompare = buildRowFilterParams('compare', { ...draft, compareValue: '  ' });
        assert.strictEqual(invalidCompare.valid, false);
        const validSet = buildRowFilterParams('set_membership', {
            ...draft,
            setValues: 'alpha, beta , gamma',
            setInclusive: true,
        });
        assert.deepStrictEqual(validSet.value, { values: ['alpha', 'beta', 'gamma'], inclusive: true });
        const supported = getSupportedRowFilterTypes({
            supported_types: [
                { row_filter_type: 'compare', support_status: 'supported' },
                { row_filter_type: 'search', support_status: 'unsupported' },
            ],
        });
        assert.deepStrictEqual(supported, ['compare']);
    });

    test('evaluates feature support flags consistently', () => {
        assert.strictEqual(isRowFilterSupported(), true);
        assert.strictEqual(isRowFilterSupported({ support_status: 'unsupported' }), false);
        assert.strictEqual(isColumnFilterSupported({ support_status: 'supported' }), true);
        assert.strictEqual(isSetColumnFiltersSupported({ support_status: 'unsupported' }), false);
        assert.strictEqual(supportsRowFilterConditions({ supports_conditions: 'unsupported' }), false);
        assert.strictEqual(
            isSortSupported({
                display_name: 'df',
                table_shape: { num_rows: 1, num_columns: 1 },
                table_unfiltered_shape: { num_rows: 1, num_columns: 1 },
                has_row_labels: false,
                supported_features: { set_sort_columns: { support_status: 'unsupported' } },
            }),
            false,
        );
    });

    test('resolves schema matches and visibility filters', () => {
        const schema = [
            createColumnSchema({ column_index: 0, column_name: 'alpha', column_label: 'Alpha' }),
            createColumnSchema({ column_index: 1, column_name: 'beta' }),
            createColumnSchema({ column_index: 2, column_name: 'gamma' }),
        ];
        const matches = resolveSchemaMatches(schema, [1, '2']);
        assert.deepStrictEqual(
            matches.map((col) => col.column_index),
            [1, 2],
        );
        const nameMatches = resolveSchemaMatches(schema, ['alpha']);
        assert.deepStrictEqual(
            nameMatches.map((col) => col.column_index),
            [0],
        );
        const displayed = computeDisplayedColumns(schema, [{ column_name: 'beta' }], '');
        assert.deepStrictEqual(
            displayed.map((col) => col.column_index),
            [1],
        );
        const visible = resolveVisibleSchema(schema, [2], new Set([0]), false);
        assert.deepStrictEqual(
            visible.map((col) => col.column_index),
            [2],
        );
    });
});
