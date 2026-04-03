<script lang="ts">
    import { variablesStore } from './stores/variablesStore.svelte';
</script>

<div class="toolbar">
    <div class="filter-container">
        <input type="text" placeholder="filter" bind:value={variablesStore.filterText} />
    </div>
</div>

<style>
    .toolbar {
        padding: 5px;
        border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
        background-color: var(--vscode-sideBar-background);
    }

    .filter-container input {
        width: 100%;
        box-sizing: border-box;
        padding: 4px;
        background-color: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 2px;
    }

    .filter-container input:focus {
        outline: 1px solid var(--vscode-focusBorder);
    }
</style>
