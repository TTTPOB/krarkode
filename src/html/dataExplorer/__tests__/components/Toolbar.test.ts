import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import Toolbar from '../../Toolbar.svelte';

describe('Toolbar', () => {
    test('renders title and meta', () => {
        render(Toolbar, { props: { title: 'iris', meta: '150 rows' } });
        expect(screen.getByText('iris')).toBeInTheDocument();
        expect(screen.getByText('150 rows')).toBeInTheDocument();
    });

    test('renders default title when not provided', () => {
        render(Toolbar, { props: {} });
        expect(screen.getByText('Data Explorer')).toBeInTheDocument();
    });

    test('dispatches openColumns when Columns button is clicked', async () => {
        const handler = vi.fn();
        render(Toolbar, { props: {}, events: { openColumns: handler } });

        await fireEvent.click(screen.getByRole('button', { name: 'Toggle column visibility' }));

        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('dispatches openStats when Stats button is clicked', async () => {
        const handler = vi.fn();
        render(Toolbar, { props: {}, events: { openStats: handler } });

        await fireEvent.click(screen.getByRole('button', { name: 'Toggle column statistics' }));

        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('dispatches openCode when Code button is clicked', async () => {
        const handler = vi.fn();
        render(Toolbar, { props: {}, events: { openCode: handler } });

        await fireEvent.click(screen.getByRole('button', { name: 'Open code conversion' }));

        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('dispatches refresh when Refresh button is clicked', async () => {
        const handler = vi.fn();
        render(Toolbar, { props: {}, events: { refresh: handler } });

        await fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));

        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('dispatches export with csv format', async () => {
        const handler = vi.fn();
        render(Toolbar, { props: {}, events: { export: handler } });

        await fireEvent.click(screen.getByRole('menuitem', { name: 'Export as CSV' }));

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail).toEqual({ format: 'csv' });
    });
});
