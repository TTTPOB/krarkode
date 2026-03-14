import { describe, test, expect } from 'vitest';
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
        const { component } = render(Toolbar, { props: {} });
        const events: CustomEvent[] = [];
        component.$on('openColumns', (e: CustomEvent) => events.push(e));

        await fireEvent.click(screen.getByRole('button', { name: 'Toggle column visibility' }));

        expect(events).toHaveLength(1);
    });

    test('dispatches openStats when Stats button is clicked', async () => {
        const { component } = render(Toolbar, { props: {} });
        const events: CustomEvent[] = [];
        component.$on('openStats', (e: CustomEvent) => events.push(e));

        await fireEvent.click(screen.getByRole('button', { name: 'Toggle column statistics' }));

        expect(events).toHaveLength(1);
    });

    test('dispatches openCode when Code button is clicked', async () => {
        const { component } = render(Toolbar, { props: {} });
        const events: CustomEvent[] = [];
        component.$on('openCode', (e: CustomEvent) => events.push(e));

        await fireEvent.click(screen.getByRole('button', { name: 'Open code conversion' }));

        expect(events).toHaveLength(1);
    });

    test('dispatches refresh when Refresh button is clicked', async () => {
        const { component } = render(Toolbar, { props: {} });
        const events: CustomEvent[] = [];
        component.$on('refresh', (e: CustomEvent) => events.push(e));

        await fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));

        expect(events).toHaveLength(1);
    });

    test('dispatches export with csv format', async () => {
        const { component } = render(Toolbar, { props: {} });
        const events: CustomEvent[] = [];
        component.$on('export', (e: CustomEvent) => events.push(e));

        await fireEvent.click(screen.getByRole('menuitem', { name: 'Export as CSV' }));

        expect(events).toHaveLength(1);
        expect(events[0].detail).toEqual({ format: 'csv' });
    });
});
