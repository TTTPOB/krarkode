import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent, screen, within } from '@testing-library/svelte';
import DataTable from '../../DataTable.svelte';
import type { BackendState, ColumnSchema } from '../../types';

function makeState(): BackendState {
    return {
        display_name: 'iris',
        table_shape: { num_rows: 3, num_columns: 2 },
        table_unfiltered_shape: { num_rows: 3, num_columns: 2 },
        has_row_labels: true,
    };
}

function makeSchema(): ColumnSchema[] {
    return [
        {
            column_name: 'age',
            column_index: 0,
            type_name: 'number',
            type_display: 'number',
        },
        {
            column_name: 'species',
            column_index: 1,
            type_name: 'string',
            type_display: 'string',
        },
    ];
}

function renderDataTable(overrides: Record<string, unknown> = {}) {
    const schema = makeSchema();

    return render(DataTable, {
        props: {
            state: makeState(),
            schema,
            renderColumns: schema.map((column, schemaIndex) => ({ column, schemaIndex })),
            columnWidths: new Map<number, number>(),
            activeSort: null,
            sortSupported: true,
            rowFilterSupported: true,
            virtualRows: [],
            virtualizerTotalHeight: 0,
            rowCacheVersion: 0,
            headerScrollLeft: 0,
            leftSpacerWidth: 0,
            rightSpacerWidth: 0,
            getCellValue: () => '',
            getRowLabel: () => '',
            getColumnLabel: (column: ColumnSchema) => column.column_name,
            ...overrides,
        },
    });
}

describe('DataTable', () => {
    test('renders visible column action labels', () => {
        renderDataTable();

        const ageHeader = screen.getByRole('columnheader', { name: 'age' });
        expect(within(ageHeader).getByText('Filter')).toBeInTheDocument();
        expect(within(ageHeader).getByText('Stats')).toBeInTheDocument();
        expect(within(ageHeader).getByText('Hide')).toBeInTheDocument();
    });

    test('dispatches column action callbacks without triggering sort', async () => {
        const onSort = vi.fn();
        const onOpenRowFilter = vi.fn();
        const onOpenStats = vi.fn();
        const onHideColumn = vi.fn();

        renderDataTable({
            onSort,
            onOpenRowFilter,
            onOpenStats,
            onHideColumn,
        });

        const ageHeader = screen.getByRole('columnheader', { name: 'age' });

        await fireEvent.click(within(ageHeader).getByRole('button', { name: 'Filter rows by this column' }));
        await fireEvent.click(within(ageHeader).getByRole('button', { name: 'Show statistics for this column' }));
        await fireEvent.click(within(ageHeader).getByRole('button', { name: 'Hide this column' }));

        expect(onOpenRowFilter).toHaveBeenCalledTimes(1);
        expect(onOpenRowFilter.mock.calls[0][0]).toEqual({ columnIndex: 0 });

        expect(onOpenStats).toHaveBeenCalledTimes(1);
        expect(onOpenStats.mock.calls[0][0]).toEqual({ columnIndex: 0 });

        expect(onHideColumn).toHaveBeenCalledTimes(1);
        expect(onHideColumn.mock.calls[0][0]).toEqual({ columnIndex: 0 });

        expect(onSort).not.toHaveBeenCalled();
    });
});
