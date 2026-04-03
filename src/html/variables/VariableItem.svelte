<script lang="ts">
    import type { Variable } from './types';
    import { variablesStore } from './stores/variablesStore.svelte';
    import { getIconForKind, buildDimensionsText, cleanDisplayType } from './utils';
    import VariableItem from './VariableItem.svelte';

    let {
        variable,
        path,
        depth,
        onView,
        onToggle,
    }: {
        variable: Variable;
        path: string[];
        depth: number;
        onView: (path: string[]) => void;
        onToggle: (path: string[]) => void;
    } = $props();

    let isExpanded = $derived(variablesStore.isExpanded(path));
    let children = $derived(variablesStore.getChildren(path));
    let childrenLength = $derived(variablesStore.getChildrenLength(path));
    let isLoading = $derived(variablesStore.isLoading(path));
    let dimensions = $derived(buildDimensionsText(variable));
    let paddingLeft = $derived(8 + depth * 14);

    function handleRowClick() {
        if (variable.has_children) {
            onToggle(path);
        }
    }

    function handleViewClick(e: MouseEvent) {
        e.stopPropagation();
        onView(path);
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="variable-row" onclick={handleRowClick}>
    <div class="cell-name" style:padding-left="{paddingLeft}px">
        <span class="var-toggle">{variable.has_children ? (isExpanded ? '▾' : '▸') : ''}</span>
        <span class="var-icon">{getIconForKind(variable.kind)}</span>
        <span class="var-label" title={variable.display_name}>{variable.display_name}</span>
    </div>
    <div class="cell-type" title={variable.display_type}>{cleanDisplayType(variable.display_type)}</div>
    <div class="cell-dims">{dimensions}</div>
    <div class="cell-value" title={variable.display_value}>{variable.display_value}</div>
    <div class="cell-action">
        {#if variable.has_viewer}
            <button class="action-btn" title="View Data" onclick={handleViewClick}>◫</button>
        {/if}
    </div>
</div>

{#if variable.has_children && isExpanded}
    {#if children}
        {#if children.length === 0}
            <div class="variable-placeholder" style:padding-left="{28 + (depth + 1) * 14}px">No entries</div>
        {:else}
            {#each children as child (child.access_key)}
                <VariableItem
                    variable={child}
                    path={[...path, child.access_key]}
                    depth={depth + 1}
                    {onView}
                    {onToggle}
                />
            {/each}
            {#if childrenLength && childrenLength > children.length}
                <div class="variable-overflow" style:padding-left="{28 + (depth + 1) * 14}px">
                    &hellip; {childrenLength - children.length} more
                </div>
            {/if}
        {/if}
    {:else if isLoading}
        <div class="variable-placeholder" style:padding-left="{28 + (depth + 1) * 14}px">Loading&hellip;</div>
    {/if}
{/if}

<style>
    .variable-row {
        display: grid;
        grid-template-columns: minmax(120px, 2fr) minmax(80px, 1fr) minmax(80px, 1fr) minmax(100px, 2fr) 24px;
        align-items: center;
        padding: 3px 0;
        border-bottom: 1px solid var(--vscode-tree-tableColumnsBorder);
        cursor: pointer;
    }

    .variable-row:hover {
        background-color: var(--vscode-list-hoverBackground);
    }

    .cell-name {
        display: flex;
        align-items: center;
        overflow: hidden;
        white-space: nowrap;
        padding-right: 4px;
    }

    .var-toggle {
        width: 12px;
        margin-right: 4px;
        text-align: center;
        color: var(--vscode-descriptionForeground);
        flex-shrink: 0;
    }

    .var-icon {
        margin-right: 6px;
        width: 16px;
        text-align: center;
        flex-shrink: 0;
    }

    .var-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--vscode-editor-font-family);
    }

    .cell-type {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.85;
        padding: 0 4px;
    }

    .cell-dims {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.7;
        padding: 0 4px;
    }

    .cell-value {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.9;
        padding: 0 4px;
    }

    .cell-action {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .action-btn {
        background: none;
        border: none;
        color: var(--vscode-icon-foreground);
        cursor: pointer;
        padding: 2px;
        font-size: 1em;
    }

    .action-btn:hover {
        color: var(--vscode-foreground);
    }

    .variable-placeholder,
    .variable-overflow {
        font-size: 0.85em;
        opacity: 0.7;
        padding: 1px 8px 4px 0;
        font-style: italic;
        grid-column: 1 / -1;
    }

    .variable-placeholder::before {
        content: '';
        display: inline-block;
        width: 10px;
        height: 10px;
        border: 1.5px solid var(--vscode-button-background);
        border-top-color: transparent;
        border-radius: 50%;
        margin-right: 6px;
        vertical-align: -1px;
        animation: var-spin 0.8s linear infinite;
    }

    @keyframes var-spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
