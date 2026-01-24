<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import type { ColumnSchema } from './types';

    export let open = false;
    export let pinned = false;
    export let fullSchema: ColumnSchema[] = [];
    export let columnFilterMatches: number[] | null = null;
    export let hiddenColumnIndices: Set<number> = new Set();
    export let searchTerm = '';
    export let status = '';

    const dispatch = createEventDispatcher<{
        close: void;
        togglePin: void;
        search: { term: string };
        clear: void;
        invert: void;
        toggleVisibility: { columnIndex: number };
        startResize: { event: MouseEvent };
    }>();

    let searchInput: HTMLInputElement;
    let debounceId: number | undefined;

    function getColumnLabel(column: ColumnSchema): string {
        const rawLabel = column.column_label ?? column.column_name;
        const trimmed = rawLabel?.trim();
        return trimmed || `Unnamed ${column.column_index + 1}`;
    }

    function resolveSchemaMatches(matches: number[]): ColumnSchema[] {
        if (!fullSchema.length || matches.length === 0) {
            return [];
        }
        const lookup = new Map(fullSchema.map((column) => [column.column_index, column]));
        const resolved: ColumnSchema[] = [];
        for (const index of matches) {
            const column = lookup.get(index);
            if (column) {
                resolved.push(column);
            }
        }
        return resolved;
    }

    function resolveVisibleSchema(): ColumnSchema[] {
        const baseSchema = columnFilterMatches
            ? resolveSchemaMatches(columnFilterMatches)
            : fullSchema;
        return baseSchema.filter((column) => !hiddenColumnIndices.has(column.column_index));
    }

    function getDisplayedColumns(): ColumnSchema[] {
        return columnFilterMatches ? resolveSchemaMatches(columnFilterMatches) : fullSchema;
    }

    function scheduleSearch(): void {
        if (debounceId !== undefined) {
            window.clearTimeout(debounceId);
        }
        debounceId = window.setTimeout(() => {
            dispatch('search', { term: searchTerm });
        }, 250);
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter') {
            dispatch('search', { term: searchTerm });
        }
    }

    $: if (open && searchInput) {
        searchInput.focus();
    }
</script>

<div
    class="side-panel"
    id="column-visibility-panel"
    class:open={open}
    class:is-pinned={pinned}
>
    <button
        type="button"
        class="panel-resizer"
        aria-label="Resize panel"
        on:mousedown={(event) => dispatch('startResize', { event })}
    ></button>
    <div class="panel-header">
        <span>Column Visibility</span>
        <div class="panel-actions">
            <button
                class="panel-pin"
                data-panel-id="column-visibility-panel"
                aria-pressed={pinned}
                title="Pin panel"
                on:click|stopPropagation={() => dispatch('togglePin')}
            >
                <span class="codicon codicon-pin"></span>
            </button>
            <button class="close-btn" id="close-column-visibility" on:click={() => dispatch('close')}>
                &times;
            </button>
        </div>
    </div>
    <div class="panel-content">
        <div class="filter-section">
            <label for="column-visibility-search">Search Columns</label>
            <input
                type="text"
                id="column-visibility-search"
                placeholder="Column name..."
                bind:this={searchInput}
                bind:value={searchTerm}
                on:keydown={handleKeydown}
                on:input={scheduleSearch}
            >
        </div>
        <div class="filter-actions">
            <button class="action" id="apply-column-visibility-filter" on:click={() => dispatch('search', { term: searchTerm })}>Apply</button>
            <button class="action secondary" id="clear-column-visibility-filter" on:click={() => {
                searchTerm = '';
                dispatch('clear');
            }}>Clear</button>
            <button class="action secondary" id="invert-column-visibility" on:click={() => dispatch('invert')}>Invert</button>
        </div>
        <div class="filter-status" id="column-visibility-status">{status}</div>
        <div class="column-visibility-list" id="column-visibility-list">
            {#if getDisplayedColumns().length === 0}
                <div class="column-visibility-empty">No columns available.</div>
            {:else}
                {#each getDisplayedColumns() as column}
                    <div class="column-visibility-item">
                        <div class="column-visibility-details">
                            <div class="column-visibility-name" title={getColumnLabel(column)}>{getColumnLabel(column)}</div>
                            <div class="column-visibility-meta">{column.type_display || column.type_name}</div>
                        </div>
                        <button
                            class="column-visibility-toggle"
                            class:is-hidden={hiddenColumnIndices.has(column.column_index)}
                            title={hiddenColumnIndices.has(column.column_index) ? 'Show column' : 'Hide column'}
                            aria-pressed={!hiddenColumnIndices.has(column.column_index)}
                            disabled={!hiddenColumnIndices.has(column.column_index) && resolveVisibleSchema().length <= 1}
                            on:click={() => dispatch('toggleVisibility', { columnIndex: column.column_index })}
                        >
                            <span class={`codicon ${hiddenColumnIndices.has(column.column_index) ? 'codicon-eye-closed' : 'codicon-eye'}`}></span>
                        </button>
                    </div>
                {/each}
            {/if}
        </div>
    </div>
</div>
