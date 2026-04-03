<script lang="ts">
    import type { Variable } from './types';
    import { variablesStore } from './stores/variablesStore.svelte';
    import { getIconForKind, isComplexVariable, buildMetaText } from './utils';
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
    let isComplex = $derived(isComplexVariable(variable));
    let children = $derived(variablesStore.getChildren(path));
    let childrenLength = $derived(variablesStore.getChildrenLength(path));
    let isLoading = $derived(variablesStore.isLoading(path));
    let metaText = $derived(isComplex ? buildMetaText(variable) : undefined);
    let paddingLeft = $derived(8 + depth * 14);
    let metaPaddingLeft = $derived(28 + depth * 14);

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

<div class="variable-item" class:is-complex={isComplex}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="variable-row" style:padding-left="{paddingLeft}px" onclick={handleRowClick}>
        <div class="var-toggle">{variable.has_children ? (isExpanded ? '▾' : '▸') : ''}</div>
        <div class="var-icon">{getIconForKind(variable.kind)}</div>
        <div class="var-name" title={variable.display_name}>{variable.display_name}</div>
        <div class="var-value" title={variable.display_value}>{variable.display_value}</div>
        <div class="var-type">{variable.display_type}</div>
        {#if variable.has_viewer}
            <div class="var-actions">
                <button class="action-btn" title="View Data" onclick={handleViewClick}>◫</button>
            </div>
        {/if}
    </div>

    {#if metaText}
        <div class="variable-meta" style:padding-left="{metaPaddingLeft}px">{metaText}</div>
    {/if}
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
    .variable-item {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        cursor: pointer;
        border-bottom: 1px solid var(--vscode-tree-tableColumnsBorder);
    }

    .variable-row {
        display: flex;
        align-items: center;
        padding: 3px 8px 3px 0;
    }

    .variable-item:hover {
        background-color: var(--vscode-list-hoverBackground);
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

    .var-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-right: 8px;
        font-family: var(--vscode-editor-font-family);
    }

    .var-value {
        flex: 2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.9;
        margin-right: 8px;
    }

    .var-type {
        flex: 0 0 auto;
        opacity: 0.7;
        font-size: 0.9em;
        text-align: right;
        margin-right: 4px;
    }

    .var-actions {
        display: flex;
        visibility: hidden;
        margin-left: 6px;
    }

    .variable-item:hover .var-actions {
        visibility: visible;
    }

    .variable-meta,
    .variable-placeholder,
    .variable-overflow {
        font-size: 0.85em;
        opacity: 0.7;
        padding: 1px 8px 4px 0;
    }

    .variable-placeholder,
    .variable-overflow {
        font-style: italic;
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

    .action-btn {
        background: none;
        border: none;
        color: var(--vscode-icon-foreground);
        cursor: pointer;
        padding: 2px;
    }

    .action-btn:hover {
        color: var(--vscode-foreground);
    }
</style>
