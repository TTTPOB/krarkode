<script lang="ts">
    import type { PlotInfo } from './types';

    let {
        plot,
        fullWindow,
        element = $bindable<HTMLDivElement | undefined>(),
    }: {
        plot: PlotInfo | undefined;
        fullWindow: boolean;
        element?: HTMLDivElement;
    } = $props();
</script>

<div
    bind:this={element}
    class="large-plot"
    class:full-window={fullWindow}
>
    {#if plot?.base64Data}
        <img
            src="data:{plot.mimeType};base64,{plot.base64Data}"
            alt="Plot {plot.id}"
        />
    {:else if plot}
        <div class="no-plot">Rendering plot...</div>
    {/if}
</div>

<style>
    .large-plot {
        flex: 1 1 0;
        min-height: 0;
        overflow: hidden;
        padding: 10px;
        width: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .large-plot.full-window {
        overflow-x: hidden;
        width: 100vw !important;
        height: 100vh !important;
    }

    .large-plot img,
    .large-plot :global(svg) {
        width: 100%;
        height: 100%;
        object-fit: contain;
        user-select: none;
    }

    .no-plot {
        display: flex;
        justify-content: center;
        align-items: center;
        width: 100%;
        min-height: 100%;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
    }
</style>
