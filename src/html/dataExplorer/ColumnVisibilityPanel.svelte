<script lang="ts">
    import { onDestroy } from 'svelte';
    import type { ColumnSchema } from './types';
    import { getColumnLabel } from './utils';

    let {
        open = false,
        pinned = false,
        displayedColumns = [],
        hiddenColumnIndices = new Set<number>(),
        searchTerm = $bindable(''),
        status = '',
        panelEl = $bindable<HTMLDivElement | undefined>(),
        onClose,
        onTogglePin,
        onSearch,
        onClear,
        onInvert,
        onToggleVisibility,
        onStartResize,
    }: {
        open?: boolean;
        pinned?: boolean;
        displayedColumns?: ColumnSchema[];
        hiddenColumnIndices?: Set<number>;
        searchTerm?: string;
        status?: string;
        panelEl?: HTMLDivElement | undefined;
        onClose?: () => void;
        onTogglePin?: () => void;
        onSearch?: (data: { term: string }) => void;
        onClear?: () => void;
        onInvert?: () => void;
        onToggleVisibility?: (data: { columnIndex: number }) => void;
        onStartResize?: (data: { event: MouseEvent }) => void;
    } = $props();

    let searchInput: HTMLInputElement;
    let debounceId: number | undefined;

    function resolveVisibleSchema(): ColumnSchema[] {
        return displayedColumns.filter((column) => !hiddenColumnIndices.has(column.column_index));
    }

    function scheduleSearch(): void {
        if (debounceId !== undefined) {
            window.clearTimeout(debounceId);
        }
        debounceId = window.setTimeout(() => {
            onSearch?.({ term: searchTerm });
        }, 250);
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter') {
            onSearch?.({ term: searchTerm });
        }
    }

    $effect(() => {
        if (open && searchInput) {
            searchInput.focus();
        }
    });

    onDestroy(() => {
        if (debounceId !== undefined) {
            window.clearTimeout(debounceId);
        }
    });
</script>

<div
    class="side-panel"
    id="column-visibility-panel"
    bind:this={panelEl}
    class:open={open}
    class:is-pinned={pinned}
>
    <button
        type="button"
        class="panel-resizer"
        aria-label="Resize panel"
        onmousedown={(event) => onStartResize?.({ event })}
    ></button>
    <div class="panel-header">
        <span>Column Visibility</span>
        <div class="panel-actions">
            <button
                class="panel-pin"
                data-panel-id="column-visibility-panel"
                aria-pressed={pinned}
                title="Pin panel"
                onclick={(e) => { e.stopPropagation(); onTogglePin?.(); }}
            >
                <span class="codicon codicon-pin"></span>
            </button>
            <button class="close-btn" id="close-column-visibility" onclick={() => onClose?.()}>
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
                onkeydown={handleKeydown}
                oninput={scheduleSearch}
            >
        </div>
        <div class="filter-actions">
            <button class="action" id="apply-column-visibility-filter" onclick={() => onSearch?.({ term: searchTerm })}>Apply</button>
            <button class="action secondary" id="clear-column-visibility-filter" onclick={() => {
                searchTerm = '';
                onClear?.();
            }}>Clear</button>
            <button class="action secondary" id="invert-column-visibility" onclick={() => onInvert?.()}>Invert</button>
        </div>
        <div class="filter-status" id="column-visibility-status">{status}</div>
        <div class="column-visibility-list" id="column-visibility-list">
            {#if displayedColumns.length === 0}
                <div class="column-visibility-empty">No columns available.</div>
            {:else}
                {#each displayedColumns as column (column.column_index)}
                    <div class="column-visibility-item">
                        <div class="column-visibility-details">
                            <span class="column-visibility-name" title={getColumnLabel(column)}>{getColumnLabel(column)}</span>
                            <span class="column-visibility-meta">{column.type_display || column.type_name}</span>
                        </div>
                        <button
                            class="column-visibility-toggle"
                            class:is-hidden={hiddenColumnIndices.has(column.column_index)}
                            title={hiddenColumnIndices.has(column.column_index) ? 'Show column' : 'Hide column'}
                            aria-pressed={!hiddenColumnIndices.has(column.column_index)}
                            disabled={!hiddenColumnIndices.has(column.column_index) && resolveVisibleSchema().length <= 1}
                            onclick={() => onToggleVisibility?.({ columnIndex: column.column_index })}
                        >
                            <span class={`codicon ${hiddenColumnIndices.has(column.column_index) ? 'codicon-eye-closed' : 'codicon-eye'}`}></span>
                        </button>
                    </div>
                {/each}
            {/if}
        </div>
    </div>
</div>

<style>
    .side-panel {
        position: fixed;
        top: var(--table-area-top, 0);
        bottom: 0;
        right: calc(-1 * var(--side-panel-width) - 20px);
        width: var(--side-panel-width);
        min-width: 280px;
        max-width: 600px;
        background: var(--vscode-sideBar-background);
        border-left: 1px solid var(--vscode-editorWidget-border);
        z-index: 500;
        transition: right 0.2s ease;
        display: flex;
        flex-direction: column;
    }

    :global(body.panel-resizing) .side-panel {
        transition: none;
    }

    .side-panel.open {
        right: 0;
    }

    /* Pinned panels become flex items within .table-area */
    .side-panel.is-pinned {
        position: relative;
        top: auto;
        right: auto;
        height: auto;
        flex: 0 0 var(--side-panel-width);
        z-index: auto;
        transition: none;
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

    .column-visibility-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .column-visibility-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 3px 6px;
        border: 1px solid var(--vscode-editorWidget-border);
        border-radius: 3px;
        background: var(--vscode-editor-background);
    }

    .column-visibility-details {
        display: flex;
        flex-direction: row;
        align-items: baseline;
        gap: 6px;
        min-width: 0;
        flex: 1;
    }

    .column-visibility-name {
        font-weight: 600;
        font-size: 0.85em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .column-visibility-meta {
        font-size: 0.75em;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        flex-shrink: 0;
    }

    .column-visibility-toggle {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        padding: 4px 6px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
    }

    .column-visibility-toggle:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }

    .column-visibility-toggle.is-hidden {
        opacity: 0.7;
    }

    .column-visibility-toggle .codicon {
        display: block;
    }

    .column-visibility-toggle:disabled {
        cursor: default;
        color: var(--vscode-disabledForeground);
        background: var(--vscode-button-secondaryBackground);
    }

    .column-visibility-empty {
        padding: 8px;
        font-size: 0.9em;
        color: var(--vscode-descriptionForeground);
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

    .filter-section input {
        width: 100%;
        padding: 6px 8px;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        color: var(--vscode-dropdown-foreground);
        border-radius: 3px;
        box-sizing: border-box;
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
