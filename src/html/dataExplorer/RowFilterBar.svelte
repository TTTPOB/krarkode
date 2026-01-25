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
    <div class="row-filter-bar" id="row-filter-bar" role="region" aria-label="Row filters">
        <div class="row-filter-label">Row Filters</div>
        <div class="row-filter-chips" id="row-filter-chips" role="list" aria-label="Active row filters">
            {#if rowFilters.length === 0}
                <span class="row-filter-label">No filters</span>
            {:else}
                {#each rowFilters as filter, index}
                    <div
                        class="row-filter-chip"
                        role="button"
                        tabindex="0"
                        aria-label={`Edit filter ${formatRowFilterChip(filter, index)}`}
                        on:click={() => dispatch('editFilter', { filter, index })}
                        on:keydown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                dispatch('editFilter', { filter, index });
                            }
                        }}
                    >
                        <span>{formatRowFilterChip(filter, index)}</span>
                        <button aria-label="Remove filter" on:click|stopPropagation={() => dispatch('removeFilter', { index })}>x</button>
                    </div>
                {/each}
            {/if}
        </div>
        <button
            class="action secondary"
            id="add-row-filter"
            aria-label="Add row filter"
            bind:this={addFilterButtonEl}
            on:click={() => dispatch('addFilter')}
        >
            + Filter
        </button>
    </div>
{/if}

<style>
    .row-filter-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--vscode-editorWidget-border);
        background: var(--vscode-sideBarSectionHeader-background);
        flex-wrap: wrap;
    }

    .row-filter-label {
        font-weight: 600;
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }

    .row-filter-chips {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        flex: 1;
    }

    .row-filter-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 12px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        font-size: 0.85em;
    }

    .row-filter-chip button {
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        padding: 0;
        font-size: 1em;
    }

    .row-filter-chip button:hover {
        color: var(--vscode-editor-foreground);
    }

    .action {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 4px 10px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 0.9em;
    }

    .action:hover {
        background: var(--vscode-button-hoverBackground);
    }

    .action.secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
    }

    .action.secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }

    .row-filter-bar .action.secondary {
        padding: 3px 8px;
    }
</style>
