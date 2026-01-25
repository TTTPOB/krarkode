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

    // Expose panel element for click-outside detection
    export let panelEl: HTMLDivElement | undefined = undefined;

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
    bind:this={panelEl}
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

<style>
    .side-panel {
        position: fixed;
        top: 0;
        right: calc(-1 * var(--side-panel-width) - 20px);
        width: var(--side-panel-width);
        min-width: 280px;
        max-width: 600px;
        height: 100%;
        background: var(--vscode-sideBar-background);
        border-left: 1px solid var(--vscode-editorWidget-border);
        z-index: 500;
        transition: right 0.2s ease;
        display: flex;
        flex-direction: column;
    }

    .side-panel.open {
        right: 0;
    }

    .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        border-bottom: 1px solid var(--vscode-editorWidget-border);
        font-weight: 600;
    }

    .panel-actions {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .panel-pin {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--vscode-descriptionForeground);
        padding: 0;
        line-height: 1;
    }

    .panel-pin:hover {
        color: var(--vscode-editor-foreground);
    }

    .panel-pin[aria-pressed='true'] {
        color: var(--vscode-button-background);
    }

    .panel-pin .codicon {
        font-size: 14px;
    }

    .panel-resizer {
        position: absolute;
        left: -4px;
        top: 0;
        width: 8px;
        height: 100%;
        cursor: ew-resize;
        z-index: 10;
        background: none;
        border: none;
        padding: 0;
        appearance: none;
    }

    .panel-resizer::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 2px;
        transform: translateY(-50%);
        width: 4px;
        height: 40px;
        border-radius: 2px;
        background: var(--vscode-scrollbarSlider-background);
        opacity: 0;
        transition: opacity 0.2s ease;
    }

    .panel-resizer:hover::after,
    :global(body.panel-resizing) .panel-resizer::after {
        opacity: 0.9;
    }

    .close-btn {
        background: none;
        border: none;
        font-size: 1.4em;
        cursor: pointer;
        color: var(--vscode-descriptionForeground);
        padding: 0;
        line-height: 1;
    }

    .close-btn:hover {
        color: var(--vscode-editor-foreground);
    }

    .panel-content {
        padding: 12px;
        overflow-y: auto;
        flex: 1;
    }

    .filter-section {
        margin-bottom: 16px;
    }

    .filter-section label {
        display: block;
        margin-bottom: 6px;
        font-weight: 500;
        font-size: 0.9em;
    }

    .filter-section input,
    .filter-section select {
        width: 100%;
        padding: 6px 8px;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        color: var(--vscode-dropdown-foreground);
        border-radius: 3px;
        box-sizing: border-box;
    }

    .row-filter-inline {
        display: flex;
        gap: 8px;
    }

    .row-filter-inline input,
    .row-filter-inline select {
        flex: 1;
    }

    .checkbox-inline {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: normal;
        font-size: 0.85em;
        margin-top: 8px;
    }

    .filter-actions {
        display: flex;
        gap: 8px;
        margin-top: 16px;
    }

    .filter-status {
        margin-top: 12px;
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
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
</style>
