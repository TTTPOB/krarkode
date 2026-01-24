<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import type { RowFilter, ColumnSchema, RowFilterType } from './types';
    import { ROW_FILTER_TYPE_LABELS } from './types';

    export let rowFilters: RowFilter[] = [];
    export let visible = true;

    // Expose button element for click-outside detection
    export let addFilterButtonEl: HTMLButtonElement | undefined = undefined;

    const dispatch = createEventDispatcher<{
        addFilter: void;
        editFilter: { filter: RowFilter; index: number };
        removeFilter: { index: number };
    }>();

    function getColumnLabel(column: ColumnSchema): string {
        const rawLabel = column.column_label ?? column.column_name;
        const trimmed = rawLabel?.trim();
        return trimmed || `Unnamed ${column.column_index + 1}`;
    }

    function formatRowFilterChip(filter: RowFilter, index: number): string {
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
</script>

{#if visible}
    <div class="row-filter-bar" id="row-filter-bar">
        <div class="row-filter-label">Row Filters</div>
        <div class="row-filter-chips" id="row-filter-chips">
            {#if rowFilters.length === 0}
                <span class="row-filter-label">No filters</span>
            {:else}
                {#each rowFilters as filter, index}
                    <div
                        class="row-filter-chip"
                        role="button"
                        tabindex="0"
                        on:click={() => dispatch('editFilter', { filter, index })}
                        on:keydown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                dispatch('editFilter', { filter, index });
                            }
                        }}
                    >
                        <span>{formatRowFilterChip(filter, index)}</span>
                        <button on:click|stopPropagation={() => dispatch('removeFilter', { index })}>x</button>
                    </div>
                {/each}
            {/if}
        </div>
        <button class="action secondary" id="add-row-filter" bind:this={addFilterButtonEl} on:click={() => dispatch('addFilter')}>
            + Filter
        </button>
    </div>
{/if}
