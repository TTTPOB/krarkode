import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import RowFilterBar from '../../RowFilterBar.svelte';
import type { RowFilter } from '../../types';

function makeFilter(partial: Partial<RowFilter> = {}): RowFilter {
    return {
        filter_id: 'f1',
        filter_type: 'compare',
        column_schema: {
            column_name: 'age',
            column_index: 0,
            type_name: 'number',
            type_display: 'number',
        },
        condition: 'and',
        params: { op: '>=', value: '18' },
        ...partial,
    };
}

describe('RowFilterBar', () => {
    test('is not rendered when visible=false', () => {
        render(RowFilterBar, { props: { visible: false, rowFilters: [] } });
        expect(screen.queryByRole('region', { name: 'Row filters' })).not.toBeInTheDocument();
    });

    test('is rendered when visible=true', () => {
        render(RowFilterBar, { props: { visible: true, rowFilters: [] } });
        expect(screen.getByRole('region', { name: 'Row filters' })).toBeInTheDocument();
    });

    test('shows "No filters" when rowFilters is empty', () => {
        render(RowFilterBar, { props: { rowFilters: [] } });
        expect(screen.getByText('No filters')).toBeInTheDocument();
    });

    test('renders a chip for each filter', () => {
        const filters = [
            makeFilter({ filter_id: 'a', params: { op: '>=', value: '18' } }),
            makeFilter({ filter_id: 'b', filter_type: 'is_null', params: undefined, condition: 'or' }),
        ];
        render(RowFilterBar, { props: { rowFilters: filters } });

        const chips = screen.getAllByRole('button', { name: /Edit filter/ });
        expect(chips).toHaveLength(2);
    });

    test('chip label formats compare filter correctly', () => {
        render(RowFilterBar, { props: { rowFilters: [makeFilter()] } });
        expect(screen.getByText('age >= 18')).toBeInTheDocument();
    });

    test('second chip label includes OR condition prefix', () => {
        const filters = [
            makeFilter({ filter_id: 'a' }),
            makeFilter({ filter_id: 'b', column_schema: { column_name: 'name', column_index: 1, type_name: 'string', type_display: 'string' }, condition: 'or', params: { op: '=', value: 'Alice' } }),
        ];
        render(RowFilterBar, { props: { rowFilters: filters } });
        expect(screen.getByText('OR name = Alice')).toBeInTheDocument();
    });

    test('dispatches addFilter when + Filter button is clicked', async () => {
        const handler = vi.fn();
        render(RowFilterBar, { props: { rowFilters: [], onAddFilter: handler } });

        await fireEvent.click(screen.getByRole('button', { name: 'Add row filter' }));

        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('dispatches editFilter with filter and index when chip is clicked', async () => {
        const filter = makeFilter();
        const handler = vi.fn();
        render(RowFilterBar, { props: { rowFilters: [filter], onEditFilter: handler } });

        await fireEvent.click(screen.getByRole('button', { name: /Edit filter/ }));

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].index).toBe(0);
        expect(handler.mock.calls[0][0].filter.filter_id).toBe('f1');
    });

    test('dispatches removeFilter with correct index when x button is clicked', async () => {
        const filters = [makeFilter({ filter_id: 'a' }), makeFilter({ filter_id: 'b' })];
        const handler = vi.fn();
        render(RowFilterBar, { props: { rowFilters: filters, onRemoveFilter: handler } });

        const removeButtons = screen.getAllByRole('button', { name: 'Remove filter' });
        await fireEvent.click(removeButtons[1]);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].index).toBe(1);
    });
});
