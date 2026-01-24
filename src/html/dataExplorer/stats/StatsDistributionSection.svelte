<script lang="ts">
    import { createEventDispatcher } from 'svelte';

    export let histogramVisible = false;
    export let histogramBins = 0;
    export let histogramMethod = 'freedman_diaconis';
    export let statsControlsEnabled = false;
    export let collapsed = false;
    export let histogramContainer: HTMLDivElement | null = null;

    const dispatch = createEventDispatcher<{
        toggle: void;
        binsInput: { source: 'slider' | 'input'; value: number };
        methodChange: void;
    }>();

    function handleToggle(): void {
        dispatch('toggle');
    }

    function readInputValue(event: Event): number {
        const target = event.currentTarget as HTMLInputElement | null;
        if (!target) {
            return 0;
        }
        return parseInt(target.value, 10);
    }

    function handleBinsInput(source: 'slider' | 'input', event: Event): void {
        dispatch('binsInput', { source, value: readInputValue(event) });
    }

    function handleMethodChange(): void {
        dispatch('methodChange');
    }
</script>

<div class="stats-section collapsible" data-section="distribution" class:is-collapsed={collapsed}>
    <button class="section-header" type="button" data-target="stats-distribution-section" on:click={handleToggle}>
        <span class="codicon codicon-chevron-down"></span>
        <span>Distribution</span>
    </button>
    <div class="section-content" id="stats-distribution-section">
        <div
            class="chart-container"
            id="histogram-chart"
            bind:this={histogramContainer}
            style:display={histogramVisible ? 'block' : 'none'}
        ></div>
        <div class="slider-row">
            <label for="histogram-bins">Bins</label>
            <input
                type="range"
                id="histogram-bins"
                min="5"
                max="200"
                value={histogramBins}
                disabled={!statsControlsEnabled}
                on:input={(event) => handleBinsInput('slider', event)}
            >
            <input
                type="number"
                id="histogram-bins-input"
                min="5"
                max="200"
                value={histogramBins}
                disabled={!statsControlsEnabled}
                on:input={(event) => handleBinsInput('input', event)}
            >
            <select id="histogram-method" bind:value={histogramMethod} disabled={!statsControlsEnabled} on:change={handleMethodChange}>
                <option value="freedman_diaconis">Auto (F-D)</option>
                <option value="sturges">Sturges</option>
                <option value="scott">Scott</option>
                <option value="fixed">Fixed</option>
            </select>
        </div>
    </div>
</div>
