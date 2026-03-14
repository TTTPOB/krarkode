<script lang="ts">
    let {
        frequencyVisible = false,
        frequencyLimit = 0,
        statsControlsEnabled = false,
        frequencyFootnote = '',
        collapsed = false,
        frequencyContainer = $bindable<HTMLDivElement | null>(null),
        onToggle,
        onLimitInput,
    }: {
        frequencyVisible?: boolean;
        frequencyLimit?: number;
        statsControlsEnabled?: boolean;
        frequencyFootnote?: string;
        collapsed?: boolean;
        frequencyContainer?: HTMLDivElement | null;
        onToggle?: () => void;
        onLimitInput?: (data: { source: 'slider' | 'input'; value: number }) => void;
    } = $props();

    function readInputValue(event: Event): number {
        const target = event.currentTarget as HTMLInputElement | null;
        if (!target) {
            return 0;
        }
        return parseInt(target.value, 10);
    }

    function handleLimitInput(source: 'slider' | 'input', event: Event): void {
        onLimitInput?.({ source, value: readInputValue(event) });
    }
</script>

<div class="stats-section collapsible" data-section="frequency" class:is-collapsed={collapsed}>
    <button class="section-header" type="button" data-target="stats-frequency-section" onclick={() => onToggle?.()}>
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
                oninput={(event) => handleLimitInput('slider', event)}
            >
            <input
                type="number"
                id="frequency-limit-input"
                min="5"
                max="50"
                value={frequencyLimit}
                disabled={!statsControlsEnabled}
                oninput={(event) => handleLimitInput('input', event)}
            >
        </div>
        <div class="stats-footnote" id="frequency-footnote" style:display={frequencyFootnote ? 'block' : 'none'}>{frequencyFootnote}</div>
    </div>
</div>
