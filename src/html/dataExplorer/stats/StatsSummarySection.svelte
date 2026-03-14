<script lang="ts">
    type StatsRow = {
        label: string;
        value: string;
    };

    let {
        title = 'Summary Statistics',
        sectionId = 'summary',
        rows = [],
        emptyMessage = '',
        collapsed = false,
        onToggle,
    }: {
        title?: string;
        sectionId?: string;
        rows?: StatsRow[];
        emptyMessage?: string;
        collapsed?: boolean;
        onToggle?: () => void;
    } = $props();
</script>

<div class="stats-section collapsible" data-section={sectionId} class:is-collapsed={collapsed}>
    <button class="section-header" type="button" data-target={`stats-${sectionId}-section`} onclick={() => onToggle?.()}>
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
