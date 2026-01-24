<script lang="ts">
    import { createEventDispatcher } from 'svelte';

    export let frequencyVisible = false;
    export let frequencyLimit = 0;
    export let statsControlsEnabled = false;
    export let frequencyFootnote = '';
    export let collapsed = false;
    export let frequencyContainer: HTMLDivElement | null = null;

    const dispatch = createEventDispatcher<{
        toggle: void;
        limitInput: { source: 'slider' | 'input'; value: number };
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

    function handleLimitInput(source: 'slider' | 'input', event: Event): void {
        dispatch('limitInput', { source, value: readInputValue(event) });
    }
</script>

<div class="stats-section collapsible" data-section="frequency" class:is-collapsed={collapsed}>
    <button class="section-header" type="button" data-target="stats-frequency-section" on:click={handleToggle}>
        <span class="codicon codicon-chevron-down"></span>
        <span>Top Values</span>
    </button>
    <div class="section-content" id="stats-frequency-section">
        <div
            class="chart-container"
            id="frequency-chart"
            bind:this={frequencyContainer}
            style:display={frequencyVisible ? 'block' : 'none'}
        ></div>
        <div class="slider-row">
            <label for="frequency-limit">Show top</label>
            <input
                type="range"
                id="frequency-limit"
                min="5"
                max="50"
                value={frequencyLimit}
                disabled={!statsControlsEnabled}
                on:input={(event) => handleLimitInput('slider', event)}
            >
            <input
                type="number"
                id="frequency-limit-input"
                min="5"
                max="50"
                value={frequencyLimit}
                disabled={!statsControlsEnabled}
                on:input={(event) => handleLimitInput('input', event)}
            >
        </div>
        <div class="stats-footnote" id="frequency-footnote" style:display={frequencyFootnote ? 'block' : 'none'}>{frequencyFootnote}</div>
    </div>
</div>
