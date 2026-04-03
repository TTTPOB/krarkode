<script lang="ts">
    import { onMount } from 'svelte';
    import { variablesStore } from './stores/variablesStore.svelte';
    import {
        type VariablesEvent,
        type RefreshParams,
        type InspectResult,
        type ConnectionParams,
        type ErrorParams,
        getVsCodeApi,
    } from './types';
    import FilterInput from './FilterInput.svelte';
    import ErrorBanner from './ErrorBanner.svelte';
    import VariableGroup from './VariableGroup.svelte';

    const vscode = getVsCodeApi();

    function autoInspectDataFrames() {
        for (const v of variablesStore.variables) {
            if ((v.kind === 'table' || v.kind === 'dataframe') && v.has_children) {
                const path = [v.access_key];
                const needsInspect = variablesStore.requestChildren(path);
                if (needsInspect) {
                    vscode.postMessage({ type: 'inspect', path });
                }
            }
        }
    }

    function handleMessage(event: MessageEvent) {
        const message = event.data;
        if (message.type !== 'update') {
            return;
        }
        const varEvent: VariablesEvent = message.event;
        switch (varEvent.method) {
            case 'refresh':
                variablesStore.handleRefresh(varEvent.params as RefreshParams);
                autoInspectDataFrames();
                break;
            case 'update':
                variablesStore.handleUpdate(varEvent.params);
                autoInspectDataFrames();
                break;
            case 'inspect':
                variablesStore.handleInspect(varEvent.params as InspectResult);
                break;
            case 'connection':
                variablesStore.handleConnection(varEvent.params as ConnectionParams);
                break;
            case 'error': {
                const params = varEvent.params as ErrorParams;
                if (params.message) {
                    variablesStore.setError(params.message, params.detail);
                } else {
                    variablesStore.clearError();
                }
                break;
            }
        }
    }

    function onView(path: string[]) {
        vscode.postMessage({ type: 'view', path });
    }

    function onToggle(path: string[]) {
        const needsInspect = variablesStore.toggleExpanded(path);
        if (needsInspect) {
            vscode.postMessage({ type: 'inspect', path });
        }
    }

    onMount(() => {
        window.addEventListener('message', handleMessage);
        vscode.postMessage({ type: 'ready' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    });
</script>

<FilterInput />
<ErrorBanner message={variablesStore.errorMessage} detail={variablesStore.errorDetail} />

{#if !variablesStore.isConnected}
    <div class="empty-state">No active Ark session. Run "Krarkode: Create Ark Session" to connect.</div>
{:else if variablesStore.variables.length === 0}
    <div class="empty-state">No variables</div>
{:else}
    <div class="table-header">
        <div class="header-cell">NAME</div>
        <div class="header-cell">TYPE</div>
        <div class="header-cell">DIMENSIONS</div>
        <div class="header-cell">VALUE/PREVIEW</div>
        <div class="header-cell"></div>
    </div>
    {#if variablesStore.filteredDataVars.length > 0}
        <VariableGroup title="DATA" variables={variablesStore.filteredDataVars} {onView} {onToggle} />
    {/if}
    {#if variablesStore.filteredValueVars.length > 0}
        <VariableGroup title="VALUES" variables={variablesStore.filteredValueVars} {onView} {onToggle} />
    {/if}
    {#if variablesStore.filteredDataVars.length === 0 && variablesStore.filteredValueVars.length === 0}
        <div class="empty-state">No matching variables</div>
    {/if}
{/if}

<style>
    :global(body) {
        padding: 0;
        margin: 0;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background-color: var(--vscode-sideBar-background);
    }

    .empty-state {
        padding: 10px;
        opacity: 0.7;
    }

    .table-header {
        display: grid;
        grid-template-columns: minmax(120px, 2fr) minmax(80px, 1fr) minmax(80px, 1fr) minmax(100px, 2fr) 24px;
        padding: 4px 0;
        font-weight: bold;
        background-color: var(--vscode-sideBarSectionHeader-background);
        color: var(--vscode-sideBarSectionHeader-foreground);
        border-bottom: 1px solid var(--vscode-tree-tableColumnsBorder);
    }

    .header-cell {
        padding: 0 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .header-cell:first-child {
        padding-left: 8px;
    }
</style>
