<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import type {
        ColumnSchema,
        RowFilter,
        RowFilterDraft,
        RowFilterType,
        RowFilterCondition,
        FilterComparisonOp,
        TextSearchType,
        SetRowFiltersFeatures,
    } from './types';
    import { ROW_FILTER_TYPE_LABELS, ROW_FILTER_SECTION_MAP } from './types';

    export let open = false;
    export let pinned = false;
    export let schema: ColumnSchema[] = [];
    export let draft: RowFilterDraft;
    export let error = '';
    export let rowFilterSupport: SetRowFiltersFeatures | undefined = undefined;

    const dispatch = createEventDispatcher<{
        close: void;
        togglePin: void;
        save: { draft: RowFilterDraft };
        cancel: void;
        startResize: { event: MouseEvent };
    }>();

    function getColumnLabel(column: ColumnSchema): string {
        const rawLabel = column.column_label ?? column.column_name;
        const trimmed = rawLabel?.trim();
        return trimmed || `Unnamed ${column.column_index + 1}`;
    }

    function supportsRowFilterConditions(): boolean {
        const supportStatus = rowFilterSupport?.supports_conditions;
        if (!supportStatus) {
            return true;
        }
        return supportStatus === 'supported';
    }

    function getSupportedRowFilterTypes(): RowFilterType[] {
        const supported = rowFilterSupport?.supported_types
            ?.filter((entry) => entry.support_status === 'supported')
            .map((entry) => entry.row_filter_type);

        if (supported && supported.length > 0) {
            return supported;
        }

        return Object.keys(ROW_FILTER_TYPE_LABELS) as RowFilterType[];
    }

    function handleColumnChange(event: Event): void {
        const target = event.target as HTMLSelectElement | null;
        if (!target) {
            return;
        }
        draft = {
            ...draft,
            columnIndex: parseInt(target.value, 10),
        };
    }

    $: rowFilterSection = ROW_FILTER_SECTION_MAP[draft.filterType] ?? 'none';
</script>

<div
    class="side-panel"
    id="row-filter-panel"
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
        <span>Row Filter</span>
        <div class="panel-actions">
            <button
                class="panel-pin"
                data-panel-id="row-filter-panel"
                aria-pressed={pinned}
                title="Pin panel"
                on:click|stopPropagation={() => dispatch('togglePin')}
            >
                <span class="codicon codicon-pin"></span>
            </button>
            <button class="close-btn" id="close-row-filter" on:click={() => dispatch('close')}>
                &times;
            </button>
        </div>
    </div>
    <div class="panel-content">
        <div class="filter-section">
            <label for="row-filter-column">Column</label>
            <select id="row-filter-column" value={draft.columnIndex} on:change={handleColumnChange}>
                {#each schema as column}
                    <option value={column.column_index}>{getColumnLabel(column)}</option>
                {/each}
            </select>
        </div>
        <div class="filter-section">
            <label for="row-filter-type">Filter Type</label>
            <select id="row-filter-type" bind:value={draft.filterType}>
                {#each getSupportedRowFilterTypes() as filterType}
                    <option value={filterType}>{ROW_FILTER_TYPE_LABELS[filterType] ?? filterType}</option>
                {/each}
            </select>
        </div>
        {#if rowFilterSection === 'compare'}
            <div class="filter-section" id="row-filter-compare-section">
                <label for="row-filter-compare-op">Comparison</label>
                <div class="row-filter-inline">
                    <select id="row-filter-compare-op" bind:value={draft.compareOp}>
                        <option value="=">=</option>
                        <option value="!=">!=</option>
                        <option value="<">&lt;</option>
                        <option value="<=">&lt;=</option>
                        <option value=">">&gt;</option>
                        <option value=">=">&gt;=</option>
                    </select>
                    <input type="text" id="row-filter-compare-value" placeholder="Value" bind:value={draft.compareValue}>
                </div>
            </div>
        {/if}
        {#if rowFilterSection === 'between'}
            <div class="filter-section" id="row-filter-between-section">
                <label for="row-filter-between-left">Between</label>
                <div class="row-filter-inline">
                    <input type="text" id="row-filter-between-left" placeholder="From" bind:value={draft.betweenLeft}>
                    <input type="text" id="row-filter-between-right" placeholder="To" bind:value={draft.betweenRight}>
                </div>
            </div>
        {/if}
        {#if rowFilterSection === 'search'}
            <div class="filter-section" id="row-filter-search-section">
                <label for="row-filter-search-type">Text Search</label>
                <select id="row-filter-search-type" bind:value={draft.searchType}>
                    <option value="contains">contains</option>
                    <option value="not_contains">not contains</option>
                    <option value="starts_with">starts with</option>
                    <option value="ends_with">ends with</option>
                    <option value="regex_match">regex</option>
                </select>
                <input type="text" id="row-filter-search-term" placeholder="Search term" bind:value={draft.searchTerm}>
                <label class="checkbox-inline">
                    <input type="checkbox" id="row-filter-search-case" bind:checked={draft.searchCase}> Case sensitive
                </label>
            </div>
        {/if}
        {#if rowFilterSection === 'set'}
            <div class="filter-section" id="row-filter-set-section">
                <label for="row-filter-set-values">Set Membership</label>
                <input type="text" id="row-filter-set-values" placeholder="Comma-separated values" bind:value={draft.setValues}>
                <label class="checkbox-inline">
                    <input type="checkbox" id="row-filter-set-inclusive" bind:checked={draft.setInclusive}> Include values
                </label>
            </div>
        {/if}
        {#if supportsRowFilterConditions()}
            <div class="filter-section" id="row-filter-condition-section">
                <label for="row-filter-condition">Condition</label>
                <select id="row-filter-condition" bind:value={draft.condition}>
                    <option value="and">AND</option>
                    <option value="or">OR</option>
                </select>
            </div>
        {/if}
        <div class="filter-status" id="row-filter-error">{error}</div>
        <div class="filter-actions">
            <button class="action" id="save-row-filter" on:click={() => dispatch('save', { draft })}>Save</button>
            <button class="action secondary" id="cancel-row-filter" on:click={() => dispatch('cancel')}>Cancel</button>
        </div>
    </div>
</div>
