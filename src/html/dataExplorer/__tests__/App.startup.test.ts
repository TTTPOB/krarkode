/**
 * App startup and message sequence tests.
 *
 * Verifies:
 *   - App mounts without throwing
 *   - Posts { type: 'ready' } on mount
 *   - Handles init message: updates title and meta
 *   - After init, requests first batch of rows
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/svelte';
import { dataStore, uiStore, statsStore } from '../../dataExplorer/stores';

// Stub acquireVsCodeApi before any module that imports types.ts is loaded
const postMessageMock = vi.fn();
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage: postMessageMock,
    getState: () => null,
    setState: () => {},
});

// Stub ResizeObserver (not available in jsdom)
(globalThis as Record<string, unknown>).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
};

// Must import App after stubs are in place
import App from '../../dataExplorer/App.svelte';
import type { BackendState, ColumnSchema, InitMessage } from '../../dataExplorer/types';

function makeInitMessage(overrides?: Partial<InitMessage>): InitMessage {
    const state: BackendState = {
        display_name: 'test_df',
        table_shape: { num_rows: 100, num_columns: 3 },
        table_unfiltered_shape: { num_rows: 100, num_columns: 3 },
        has_row_labels: false,
        sort_keys: [],
        supported_features: {
            set_row_filters: { support_status: 'supported', supported_types: [] },
            get_column_profiles: { support_status: 'supported', supported_types: [] },
            search_schema: { support_status: 'supported' },
            set_column_filters: { support_status: 'unsupported' },
            export_data_selection: { support_status: 'unsupported' },
        },
        row_filters: [],
    };
    const schema: ColumnSchema[] = [
        { column_name: 'id', column_index: 0, type_name: 'integer', type_display: 'number' },
        { column_name: 'name', column_index: 1, type_name: 'character', type_display: 'string' },
        { column_name: 'value', column_index: 2, type_name: 'double', type_display: 'number' },
    ];
    return { state, schema, ...overrides };
}

function resetStores() {
    dataStore.backendState = null;
    dataStore.fullSchema = [];
    dataStore.hiddenColumnIndices = new Set();
    dataStore.columnFilterMatches = null;
    dataStore.columnWidths = new Map();
    dataStore.rowFilters = [];
    dataStore.rowCache = new Map();
    dataStore.rowLabelCache = new Map();
    dataStore.rowCacheVersion = 0;
    dataStore.loadedBlocks = new Set();
    dataStore.loadingBlocks = new Set();
    dataStore.activeSort = null;

    uiStore.columnVisibilityOpen = false;
    uiStore.columnVisibilityStatus = '';
    uiStore.columnVisibilitySearchTerm = '';
    uiStore.activeStatsColumnIndex = null;
    uiStore.codePreview = '';

    statsStore.messageText = '';
    statsStore.messageState = 'empty';
    statsStore.overviewRows = [];
    statsStore.overviewEmptyMessage = '';
}

describe('App startup', () => {
    beforeEach(() => {
        postMessageMock.mockClear();
        resetStores();
    });

    afterEach(() => {
        cleanup();
    });

    test('mounts without throwing', () => {
        expect(() => render(App)).not.toThrow();
    });

    test('posts { type: "ready" } on mount', async () => {
        render(App);

        await waitFor(() => {
            expect(postMessageMock).toHaveBeenCalledWith({ type: 'ready' });
        });
    });

    test('shows default title before init', () => {
        render(App);

        expect(screen.getByText('Data Explorer')).toBeInTheDocument();
    });

    test('updates title and meta after receiving init message', async () => {
        render(App);

        // Wait for ready message first
        await waitFor(() => {
            expect(postMessageMock).toHaveBeenCalledWith({ type: 'ready' });
        });

        // Simulate the extension sending an init message
        const initMsg = makeInitMessage();
        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'init', ...initMsg },
            }),
        );

        // Title should update to the display name
        await waitFor(() => {
            expect(screen.getByText('test_df')).toBeInTheDocument();
        });
    });

    test('populates data store after receiving init message', async () => {
        render(App);

        await waitFor(() => {
            expect(postMessageMock).toHaveBeenCalledWith({ type: 'ready' });
        });

        const initMsg = makeInitMessage();
        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'init', ...initMsg },
            }),
        );

        // After init, the data store should be populated with schema and backend state
        await waitFor(() => {
            expect(dataStore.backendState).not.toBeNull();
            expect(dataStore.backendState!.display_name).toBe('test_df');
            expect(dataStore.fullSchema).toHaveLength(3);
            expect(dataStore.fullSchema[0].column_name).toBe('id');
        });
    });

    test('handles init then rows sequence without errors', async () => {
        render(App);

        await waitFor(() => {
            expect(postMessageMock).toHaveBeenCalledWith({ type: 'ready' });
        });

        // Send init
        const initMsg = makeInitMessage();
        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'init', ...initMsg },
            }),
        );

        await waitFor(() => {
            expect(screen.getByText('test_df')).toBeInTheDocument();
        });

        // Send rows response
        window.dispatchEvent(
            new MessageEvent('message', {
                data: {
                    type: 'rows',
                    startIndex: 0,
                    endIndex: 20,
                    columns: [
                        Array.from({ length: 20 }, (_, i) => String(i)),
                        Array.from({ length: 20 }, (_, i) => `name_${i}`),
                        Array.from({ length: 20 }, (_, i) => String(i * 1.5)),
                    ],
                },
            }),
        );

        // Should not throw — if we get here the sequence is stable
        await waitFor(() => {
            expect(dataStore.rowCache.size).toBeGreaterThan(0);
        });
    });
});
