<script lang="ts">
    import type { Variable } from './types';
    import VariableItem from './VariableItem.svelte';

    let {
        title,
        variables,
        onView,
        onToggle,
    }: {
        title: string;
        variables: Variable[];
        onView: (path: string[]) => void;
        onToggle: (path: string[]) => void;
    } = $props();
</script>

<div class="group-header">{title}</div>
{#each variables as variable (variable.access_key)}
    <VariableItem
        {variable}
        path={[variable.access_key]}
        depth={0}
        {onView}
        {onToggle}
    />
{/each}

<style>
    .group-header {
        padding: 4px 8px;
        font-weight: bold;
        background-color: var(--vscode-sideBarSectionHeader-background);
        color: var(--vscode-sideBarSectionHeader-foreground);
        cursor: pointer;
        display: flex;
        align-items: center;
    }
</style>
