<script lang="ts">
    import { createEventDispatcher } from 'svelte';

    type StatsRow = {
        label: string;
        value: string;
    };

    export let title = 'Summary Statistics';
    export let sectionId = 'summary';
    export let rows: StatsRow[] = [];
    export let emptyMessage = '';
    export let collapsed = false;

    const dispatch = createEventDispatcher<{ toggle: void }>();

    function handleToggle(): void {
        dispatch('toggle');
    }
</script>

<div class="stats-section collapsible" data-section={sectionId} class:is-collapsed={collapsed}>
    <button class="section-header" type="button" data-target={`stats-${sectionId}-section`} on:click={handleToggle}>
        <span class="codicon codicon-chevron-down"></span>
        <span>{title}</span>
    </button>
    <div class="section-content" id={`stats-${sectionId}-section`}>
        <table class="stats-table">
            {#if rows.length === 0}
                <tr>
                    <td class="stats-empty" colspan="2">{emptyMessage}</td>
                </tr>
            {:else}
                {#each rows as row}
                    <tr>
                        <td>{row.label}</td>
                        <td>{row.value}</td>
                    </tr>
                {/each}
            {/if}
        </table>
    </div>
</div>
