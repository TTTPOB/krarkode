<script lang="ts">
    let {
        histogramVisible = false,
        histogramBins = 0,
        histogramMethod = 'freedman_diaconis',
        statsControlsEnabled = false,
        collapsed = false,
        histogramContainer = $bindable<HTMLDivElement | null>(null),
        onToggle,
        onBinsInput,
        onMethodChange,
    }: {
        histogramVisible?: boolean;
        histogramBins?: number;
        histogramMethod?: string;
        statsControlsEnabled?: boolean;
        collapsed?: boolean;
        histogramContainer?: HTMLDivElement | null;
        onToggle?: () => void;
        onBinsInput?: (data: { source: 'slider' | 'input'; value: number }) => void;
        onMethodChange?: () => void;
    } = $props();

    function readInputValue(event: Event): number {
        const target = event.currentTarget as HTMLInputElement | null;
        if (!target) {
            return 0;
        }
        return parseInt(target.value, 10);
    }

    function handleBinsInput(source: 'slider' | 'input', event: Event): void {
        onBinsInput?.({ source, value: readInputValue(event) });
    }
</script>

<div class="stats-section collapsible" data-section="distribution" class:is-collapsed={collapsed}>
    <button class="section-header" type="button" data-target="stats-distribution-section" onclick={() => onToggle?.()}>
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
                oninput={(event) => handleBinsInput('slider', event)}
            >
            <input
                type="number"
                id="histogram-bins-input"
                min="5"
                max="200"
                value={histogramBins}
                disabled={!statsControlsEnabled}
                oninput={(event) => handleBinsInput('input', event)}
            >
            <select id="histogram-method" bind:value={histogramMethod} disabled={!statsControlsEnabled} onchange={() => onMethodChange?.()}>
                <option value="freedman_diaconis">Auto (F-D)</option>
                <option value="sturges">Sturges</option>
                <option value="scott">Scott</option>
                <option value="fixed">Fixed</option>
            </select>
        </div>
    </div>
</div>
