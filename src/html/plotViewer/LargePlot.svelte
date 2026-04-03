<script lang="ts">
    import type { PlotInfo } from './types';

    let {
        plot,
        fit,
        zoom,
        fullWindow,
        explicitHeight,
        element = $bindable<HTMLDivElement | undefined>(),
    }: {
        plot: PlotInfo | undefined;
        fit: boolean;
        zoom: number;
        fullWindow: boolean;
        explicitHeight: string | null;
        element?: HTMLDivElement;
    } = $props();
</script>

<div
    bind:this={element}
    class="large-plot"
    class:fit-to-window={fit}
    class:full-window={fullWindow}
    style:height={explicitHeight}
    style:flex-grow={explicitHeight ? '0' : undefined}
>
    {#if plot?.base64Data}
        <img
            src="data:{plot.mimeType};base64,{plot.base64Data}"
            alt="Plot {plot.id}"
            style:width={!fit ? `${zoom}%` : undefined}
            style:height={!fit ? 'auto' : undefined}
        />
    {:else if plot}
        <div class="no-plot">Rendering plot...</div>
    {/if}
</div>

<style>
    .large-plot {
        flex: 1 1 auto;
        overflow-x: auto;
        overflow-y: auto;
        padding: 10px;
        width: 100%;
        min-height: 240px;
        height: auto;
        display: flex;
        justify-content: center;
        align-items: flex-start;
    }

    .large-plot.fit-to-window {
        align-items: center;
    }

    .large-plot.full-window {
        overflow-x: hidden;
        width: 100vw !important;
        height: 100vh !important;
    }

    .large-plot img,
    .large-plot :global(svg) {
        max-width: 100%;
        user-select: none;
    }

    .large-plot.fit-to-window img,
    .large-plot.fit-to-window :global(svg) {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
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
