<script lang="ts">
    import type { PlotInfo } from './types';

    let {
        plot,
        active,
        onSelect,
        onHide,
    }: {
        plot: PlotInfo;
        active: boolean;
        onSelect: () => void;
        onHide: () => void;
    } = $props();

    let wrapperEl: HTMLDivElement | undefined = $state();

    $effect(() => {
        if (active && wrapperEl) {
            wrapperEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={wrapperEl}
    class="wrapper"
    class:active
    onclick={onSelect}
>
    <div class="plot-content">
        {#if plot.base64Data}
            <img src="data:{plot.mimeType};base64,{plot.base64Data}" alt="Plot thumbnail" />
        {:else}
            <div class="no-plot">...</div>
        {/if}
    </div>
    <button
        class="hide-plot"
        title="Hide plot"
        onclick={(e) => { e.stopPropagation(); onHide(); }}
    >&times;</button>
</div>

<style>
    .wrapper {
        position: relative;
        height: 80px;
        width: 100px;
        flex: none;
        cursor: pointer;
        border-radius: 4px;
        overflow: hidden;
        border: 2px solid transparent;
        transition: border-color 0.15s ease;
    }

    .wrapper:hover {
        border-color: var(--vscode-focusBorder);
    }

    .wrapper.active {
        border-color: var(--vscode-button-background);
    }

    .plot-content {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        background: var(--vscode-editor-background);
    }

    .plot-content img,
    .plot-content :global(svg) {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
    }

    .hide-plot {
        display: none;
        position: absolute;
        top: 2px;
        right: 2px;
        width: 18px;
        height: 18px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 50%;
        font-size: 10px;
        cursor: pointer;
        justify-content: center;
        align-items: center;
        line-height: 1;
    }

    .wrapper:hover .hide-plot {
        display: flex;
    }

    .hide-plot:hover {
        background: var(--vscode-errorForeground);
    }

    .no-plot {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
    }
</style>
