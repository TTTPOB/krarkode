<script lang="ts">
    import type { PlotInfo } from './types';
    import SmallPlotItem from './SmallPlotItem.svelte';

    let {
        plots,
        activeIndex,
        layout,
        sendCommand,
    }: {
        plots: PlotInfo[];
        activeIndex: number;
        layout: string;
        sendCommand: (cmd: string, plotId?: string) => void;
    } = $props();
</script>

<div
    class="small-plots"
    class:multirow={layout === 'multirow'}
    class:scroll={layout === 'scroll'}
    class:hidden={layout === 'hidden'}
>
    {#each plots as plot, i (plot.id)}
        <SmallPlotItem
            {plot}
            active={i === activeIndex}
            onSelect={() => sendCommand('goTo', plot.id)}
            onHide={() => sendCommand('hide', plot.id)}
        />
    {/each}
</div>

<style>
    .small-plots {
        display: flex;
        flex-direction: row;
        position: relative;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 8px;
        gap: 8px;
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        border-top: 1px solid var(--vscode-panel-border);
        flex-shrink: 0;
        min-height: 100px;
    }

    .small-plots.multirow {
        overflow-x: hidden;
        flex-wrap: wrap;
    }

    .small-plots.hidden {
        display: none;
    }
</style>
