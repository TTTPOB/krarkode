<script lang="ts">
    import StatsColumnSelector from './stats/StatsColumnSelector.svelte';
    import StatsSummarySection from './stats/StatsSummarySection.svelte';
    import StatsDistributionSection from './stats/StatsDistributionSection.svelte';
    import StatsFrequencySection from './stats/StatsFrequencySection.svelte';
    import type { ColumnSchema } from './types';
    import { statsStore } from './stores';

    // Props
    let {
        isOpen = false,
        isPinned = false,
        schema = [],
        getColumnLabel,
        statsColumnValue = $bindable(''),
        collapsedSections = new Set<string>(),
        statsPanelEl = $bindable<HTMLDivElement | undefined>(),
        statsResultsEl = $bindable<HTMLDivElement | undefined>(),
        histogramContainer = $bindable<HTMLDivElement | undefined>(),
        frequencyContainer = $bindable<HTMLDivElement | undefined>(),
        onClose,
        onTogglePin,
        onColumnChange,
        onToggleSection,
        onBinsInput,
        onLimitInput,
        onStartResize,
    }: {
        isOpen?: boolean;
        isPinned?: boolean;
        schema?: ColumnSchema[];
        getColumnLabel: (column: ColumnSchema) => string;
        statsColumnValue?: string;
        collapsedSections?: Set<string>;
        statsPanelEl?: HTMLDivElement | undefined;
        statsResultsEl?: HTMLDivElement | undefined;
        histogramContainer?: HTMLDivElement | undefined;
        frequencyContainer?: HTMLDivElement | undefined;
        onClose?: () => void;
        onTogglePin?: () => void;
        onColumnChange?: () => void;
        onToggleSection?: (data: { sectionId: string }) => void;
        onBinsInput?: (data: { source: 'slider' | 'input'; value: number }) => void;
        onLimitInput?: (data: { source: 'slider' | 'input'; value: number }) => void;
        onStartResize?: (data: { event: MouseEvent }) => void;
    } = $props();
</script>

<div
    class="side-panel"
    id="stats-panel"
    bind:this={statsPanelEl}
    class:open={isOpen}
    class:is-pinned={isPinned}
>
    <button
        type="button"
        class="panel-resizer"
        id="stats-panel-resizer"
        aria-label="Resize panel"
        onmousedown={(event) => onStartResize?.({ event })}
    ></button>
    <div class="panel-header">
        <span>Column Statistics</span>
        <div class="panel-actions">
            <button
                class="panel-pin"
                data-panel-id="stats-panel"
                aria-pressed={isPinned}
                title="Pin panel"
                onclick={(e) => { e.stopPropagation(); onTogglePin?.(); }}
            >
                <span class="codicon codicon-pin"></span>
            </button>
            <button class="close-btn" id="close-stats" onclick={() => onClose?.()}>
                &times;
            </button>
        </div>
    </div>
    <div class="panel-content">
        <StatsColumnSelector
            schema={schema}
            bind:value={statsColumnValue}
            getColumnLabel={getColumnLabel}
            onChange={() => onColumnChange?.()}
        />
        <div class="stats-results" id="stats-results" bind:this={statsResultsEl}>
            <div
                class="stats-message"
                id="stats-message"
                class:is-hidden={statsStore.sectionsVisible}
                class:is-loading={statsStore.messageState === 'loading'}
                class:is-error={statsStore.messageState === 'error'}
            >
                {statsStore.messageText}
            </div>
            <div class="stats-sections" id="stats-sections" class:is-hidden={!statsStore.sectionsVisible}>
                <div class="stats-section collapsible" data-section="overview" class:is-collapsed={collapsedSections.has('overview')}>
                    <button class="section-header" type="button" data-target="stats-overview-section" onclick={() => onToggleSection?.({ sectionId: 'overview' })}>
                        <span class="codicon codicon-chevron-down"></span>
                        <span>Overview</span>
                    </button>
                    <div class="section-content" id="stats-overview-section">
                        <table class="stats-table" id="stats-overview-table">
                            <tbody>
                                {#if statsStore.overviewRows.length === 0}
                                    <tr>
                                        <td class="stats-empty" colspan="2">{statsStore.overviewEmptyMessage}</td>
                                    </tr>
                                {:else}
                                    {#each statsStore.overviewRows as row (row.label)}
                                        <tr>
                                            <td>{row.label}</td>
                                            <td>{row.value}</td>
                                        </tr>
                                    {/each}
                                {/if}
                            </tbody>
                        </table>
                    </div>
                </div>
                <StatsSummarySection
                    title="Summary Statistics"
                    sectionId="summary"
                    rows={statsStore.summaryRows}
                    emptyMessage={statsStore.summaryEmptyMessage}
                    collapsed={collapsedSections.has('summary')}
                    onToggle={() => onToggleSection?.({ sectionId: 'summary' })}
                />
                <StatsDistributionSection
                    bind:histogramContainer={histogramContainer}
                    histogramVisible={statsStore.histogramVisible}
                    histogramBins={statsStore.histogramBins}
                    statsControlsEnabled={statsStore.controlsEnabled}
                    collapsed={collapsedSections.has('distribution')}
                    onToggle={() => onToggleSection?.({ sectionId: 'distribution' })}
                    onBinsInput={(data) => onBinsInput?.(data)}
                />
                <StatsFrequencySection
                    bind:frequencyContainer={frequencyContainer}
                    frequencyVisible={statsStore.frequencyVisible}
                    frequencyLimit={statsStore.frequencyLimit}
                    statsControlsEnabled={statsStore.controlsEnabled}
                    frequencyFootnote={statsStore.frequencyFootnote}
                    collapsed={collapsedSections.has('frequency')}
                    onToggle={() => onToggleSection?.({ sectionId: 'frequency' })}
                    onLimitInput={(data) => onLimitInput?.(data)}
                />
            </div>
        </div>
    </div>
</div>

<style>
    .side-panel {
        position: fixed;
        top: var(--table-area-top, 0);
        bottom: 0;
        right: calc(-1 * var(--side-panel-width) - 20px);
        width: var(--side-panel-width);
        min-width: 280px;
        max-width: 600px;
        background: var(--vscode-sideBar-background);
        border-left: 1px solid var(--vscode-editorWidget-border);
        z-index: 500;
        transition: right 0.2s ease;
        display: flex;
        flex-direction: column;
    }

    :global(body.panel-resizing) .side-panel {
        transition: none;
    }

    .side-panel.open {
        right: 0;
    }

    /* Pinned panels become flex items within .table-area */
    .side-panel.is-pinned {
        position: relative;
        top: auto;
        right: auto;
        height: auto;
        flex: 0 0 var(--side-panel-width);
        z-index: auto;
        transition: none;
    }

    .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        border-bottom: 1px solid var(--vscode-editorWidget-border);
        font-weight: 600;
    }

    .panel-actions {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .panel-pin {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--vscode-descriptionForeground);
        padding: 0;
        line-height: 1;
    }

    .panel-pin:hover {
        color: var(--vscode-editor-foreground);
    }

    .panel-pin[aria-pressed='true'] {
        color: var(--vscode-button-background);
    }

    .panel-pin .codicon {
        font-size: 14px;
        transition: transform 0.15s ease;
    }

    .panel-pin[aria-pressed='true'] .codicon {
        transform: rotate(-45deg);
    }

    .panel-resizer {
        position: absolute;
        left: -4px;
        top: 0;
        width: 8px;
        height: 100%;
        cursor: ew-resize;
        z-index: 10;
        background: none;
        border: none;
        padding: 0;
        appearance: none;
    }

    .panel-resizer::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 2px;
        transform: translateY(-50%);
        width: 4px;
        height: 40px;
        border-radius: 2px;
        background: var(--vscode-scrollbarSlider-background);
        opacity: 0;
        transition: opacity 0.2s ease;
    }

    .panel-resizer:hover::after,
    :global(body.panel-resizing) .panel-resizer::after {
        opacity: 0.9;
    }

    .close-btn {
        background: none;
        border: none;
        font-size: 1.4em;
        cursor: pointer;
        color: var(--vscode-descriptionForeground);
        padding: 0;
        line-height: 1;
    }

    .close-btn:hover {
        color: var(--vscode-editor-foreground);
    }

    .panel-content {
        padding: 12px;
        overflow-y: auto;
        flex: 1;
    }

    .stats-results {
        margin-top: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .stats-message {
        padding: 12px;
        border-radius: 4px;
        border: 1px dashed var(--vscode-editorWidget-border);
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        text-align: center;
        background: var(--vscode-editor-background);
    }

    .stats-message.is-hidden {
        display: none;
    }

    .stats-message.is-loading::before {
        content: '';
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid var(--vscode-button-background);
        border-top-color: transparent;
        border-radius: 50%;
        margin-right: 8px;
        vertical-align: -2px;
        animation: stats-spin 0.8s linear infinite;
    }

    .stats-message.is-error {
        border-color: var(--vscode-inputValidation-errorBorder);
        color: var(--vscode-inputValidation-errorForeground);
        background: var(--vscode-inputValidation-errorBackground);
    }

    .stats-sections {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .stats-sections.is-hidden {
        display: none;
    }

    :global(.stats-section) {
        margin-bottom: 16px;
    }

    :global(.stats-section label) {
        display: block;
        margin-bottom: 6px;
        font-weight: 500;
        font-size: 0.9em;
    }

    :global(.stats-section select) {
        width: 100%;
        padding: 6px 8px;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        color: var(--vscode-dropdown-foreground);
        border-radius: 3px;
        box-sizing: border-box;
    }

    :global(.stats-section.collapsible) {
        border: 1px solid var(--vscode-editorWidget-border);
        border-radius: 4px;
        overflow: hidden;
        background: var(--vscode-editor-background);
    }

    :global(.stats-results .stats-section.collapsible) {
        margin-bottom: 0;
    }

    :global(.stats-section.collapsible .section-header) {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        background: var(--vscode-sideBarSectionHeader-background);
        border: none;
        cursor: pointer;
        text-align: left;
        font-family: inherit;
        font-weight: 600;
        font-size: 0.78em;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: var(--vscode-foreground);
    }

    :global(.stats-section.collapsible .section-header:hover) {
        background: var(--vscode-list-hoverBackground);
    }

    :global(.stats-section.collapsible .section-header .codicon) {
        font-size: 12px;
        transition: transform 0.15s ease;
    }

    :global(.stats-section.collapsible.is-collapsed .section-header .codicon) {
        transform: rotate(-90deg);
    }

    :global(.stats-section.collapsible .section-content) {
        padding: 10px;
    }

    :global(.stats-section.collapsible.is-collapsed .section-content) {
        display: none;
    }

    :global(.stats-table) {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.88em;
    }

    :global(.stats-table tr) {
        border-bottom: 1px solid var(--vscode-editorWidget-border);
    }

    :global(.stats-table tr:last-child) {
        border-bottom: none;
    }

    :global(.stats-table td) {
        padding: 5px 6px;
        vertical-align: top;
    }

    :global(.stats-table td:first-child) {
        color: var(--vscode-descriptionForeground);
        width: 45%;
    }

    :global(.stats-table td:last-child) {
        font-family: var(--vscode-editor-font-family);
        text-align: right;
        word-break: break-word;
    }

    :global(.stats-table .stats-empty) {
        text-align: center;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
    }

    :global(.stats-subheader) {
        margin: 10px 0 6px;
        font-size: 0.75em;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--vscode-descriptionForeground);
    }

    :global(.slider-row) {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 10px 0 4px;
        padding-top: 10px;
        border-top: 1px solid var(--vscode-editorWidget-border);
        flex-wrap: wrap;
    }

    :global(.slider-row label) {
        font-size: 0.78em;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: var(--vscode-descriptionForeground);
    }

    :global(.slider-row input[type='range']) {
        flex: 1;
        min-width: 80px;
        height: 4px;
        -webkit-appearance: none;
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 2px;
    }

    :global(.slider-row input[type='range']::-webkit-slider-thumb) {
        -webkit-appearance: none;
        width: 12px;
        height: 12px;
        background: var(--vscode-button-background);
        border-radius: 50%;
        cursor: pointer;
    }

    :global(.slider-row input[type='number']) {
        width: 56px;
        padding: 3px 5px;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        color: var(--vscode-dropdown-foreground);
        border-radius: 3px;
        text-align: center;
        font-size: 0.85em;
    }

    :global(.slider-row select) {
        padding: 3px 5px;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        color: var(--vscode-dropdown-foreground);
        border-radius: 3px;
        font-size: 0.85em;
    }

    :global(.chart-container) {
        width: 100%;
        height: 180px;
    }

    :global(#frequency-chart) {
        height: 160px;
    }

    :global(.stats-footnote) {
        margin-top: 6px;
        font-size: 0.78em;
        color: var(--vscode-descriptionForeground);
    }

    @keyframes stats-spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
