<script lang="ts">
    import { createEventDispatcher, tick } from 'svelte';
    import StatsColumnSelector from './stats/StatsColumnSelector.svelte';
    import StatsSummarySection from './stats/StatsSummarySection.svelte';
    import StatsDistributionSection from './stats/StatsDistributionSection.svelte';
    import StatsFrequencySection from './stats/StatsFrequencySection.svelte';
    import type { ColumnSchema, StatsRow, StatsMessageState } from './types';
    import { SIDE_PANEL_MIN_WIDTH, SIDE_PANEL_MAX_WIDTH } from './types';

    // Props
    export let isOpen = false;
    export let isPinned = false;
    export let schema: ColumnSchema[] = [];
    export let getColumnLabel: (column: ColumnSchema) => string;

    // Stats state
    export let statsColumnValue = '';
    export let statsMessageText = 'Select a column to view statistics.';
    export let statsMessageState: StatsMessageState = 'empty';
    export let statsSectionsVisible = false;
    export let statsControlsEnabled = false;
    export let statsOverviewRows: StatsRow[] = [];
    export let statsSummaryRows: StatsRow[] = [];
    export let statsOverviewEmptyMessage = 'No overview data.';
    export let statsSummaryEmptyMessage = 'No summary statistics.';
    export let frequencyFootnote = '';
    export let histogramBins = 20;
    export let histogramMethod = 'freedman_diaconis';
    export let frequencyLimit = 10;
    export let histogramVisible = false;
    export let frequencyVisible = false;
    export let collapsedSections: Set<string> = new Set();

    // Bound elements for parent access
    export let statsPanelEl: HTMLDivElement | undefined = undefined;
    export let statsResultsEl: HTMLDivElement | undefined = undefined;
    export let histogramContainer: HTMLDivElement | undefined = undefined;
    export let frequencyContainer: HTMLDivElement | undefined = undefined;

    const dispatch = createEventDispatcher<{
        close: void;
        togglePin: void;
        columnChange: void;
        toggleSection: { sectionId: string };
        binsInput: { source: 'slider' | 'input'; value: number };
        methodChange: void;
        limitInput: { source: 'slider' | 'input'; value: number };
        resize: { width: number };
    }>();

    // Local state
    let sidePanelResizeState: { startX: number; startWidth: number } | null = null;

    function clampNumber(value: number, min: number, max: number, fallback: number): number {
        if (!Number.isFinite(value)) {
            return fallback;
        }
        return Math.min(Math.max(Math.round(value), min), max);
    }

    function startSidePanelResize(event: MouseEvent): void {
        const startWidth = statsPanelEl?.getBoundingClientRect().width ?? SIDE_PANEL_MIN_WIDTH;
        sidePanelResizeState = {
            startX: event.clientX,
            startWidth,
        };
        document.body.classList.add('panel-resizing');
        event.preventDefault();
    }

    function handleSidePanelResize(event: MouseEvent): void {
        if (!sidePanelResizeState) {
            return;
        }
        const delta = sidePanelResizeState.startX - event.clientX;
        const nextWidth = clampNumber(
            sidePanelResizeState.startWidth + delta,
            SIDE_PANEL_MIN_WIDTH,
            SIDE_PANEL_MAX_WIDTH,
            sidePanelResizeState.startWidth
        );
        dispatch('resize', { width: nextWidth });
    }

    function finishSidePanelResize(): void {
        if (!sidePanelResizeState) {
            return;
        }
        sidePanelResizeState = null;
        document.body.classList.remove('panel-resizing');
    }

    // Expose resize handlers to parent
    export function onWindowMouseMove(event: MouseEvent): void {
        handleSidePanelResize(event);
    }

    export function onWindowMouseUp(): void {
        finishSidePanelResize();
    }

    function handleClose(): void {
        dispatch('close');
    }

    function handleTogglePin(event: MouseEvent): void {
        event.stopPropagation();
        dispatch('togglePin');
    }

    function handleColumnChange(): void {
        dispatch('columnChange');
    }

    function handleToggleSection(sectionId: string): void {
        dispatch('toggleSection', { sectionId });
    }

    function handleBinsInput(event: CustomEvent<{ source: 'slider' | 'input'; value: number }>): void {
        dispatch('binsInput', event.detail);
    }

    function handleMethodChange(): void {
        dispatch('methodChange');
    }

    function handleLimitInput(event: CustomEvent<{ source: 'slider' | 'input'; value: number }>): void {
        dispatch('limitInput', event.detail);
    }
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
        on:mousedown={startSidePanelResize}
    ></button>
    <div class="panel-header">
        <span>Column Statistics</span>
        <div class="panel-actions">
            <button
                class="panel-pin"
                data-panel-id="stats-panel"
                aria-pressed={isPinned}
                title="Pin panel"
                on:click={handleTogglePin}
            >
                <span class="codicon codicon-pin"></span>
            </button>
            <button class="close-btn" id="close-stats" on:click={handleClose}>
                &times;
            </button>
        </div>
    </div>
    <div class="panel-content">
        <StatsColumnSelector
            schema={schema}
            bind:value={statsColumnValue}
            getColumnLabel={getColumnLabel}
            on:change={handleColumnChange}
        />
        <div class="stats-results" id="stats-results" bind:this={statsResultsEl}>
            <div
                class="stats-message"
                id="stats-message"
                class:is-hidden={statsSectionsVisible}
                class:is-loading={statsMessageState === 'loading'}
                class:is-error={statsMessageState === 'error'}
            >
                {statsMessageText}
            </div>
            <div class="stats-sections" id="stats-sections" class:is-hidden={!statsSectionsVisible}>
                <div class="stats-section collapsible" data-section="overview" class:is-collapsed={collapsedSections.has('overview')}>
                    <button class="section-header" type="button" data-target="stats-overview-section" on:click={() => handleToggleSection('overview')}>
                        <span class="codicon codicon-chevron-down"></span>
                        <span>Overview</span>
                    </button>
                    <div class="section-content" id="stats-overview-section">
                        <table class="stats-table" id="stats-overview-table">
                            {#if statsOverviewRows.length === 0}
                                <tr>
                                    <td class="stats-empty" colspan="2">{statsOverviewEmptyMessage}</td>
                                </tr>
                            {:else}
                                {#each statsOverviewRows as row}
                                    <tr>
                                        <td>{row.label}</td>
                                        <td>{row.value}</td>
                                    </tr>
                                {/each}
                            {/if}
                        </table>
                    </div>
                </div>
                <StatsSummarySection
                    title="Summary Statistics"
                    sectionId="summary"
                    rows={statsSummaryRows}
                    emptyMessage={statsSummaryEmptyMessage}
                    collapsed={collapsedSections.has('summary')}
                    on:toggle={() => handleToggleSection('summary')}
                />
                <StatsDistributionSection
                    bind:histogramContainer={histogramContainer}
                    histogramVisible={histogramVisible}
                    histogramBins={histogramBins}
                    bind:histogramMethod={histogramMethod}
                    statsControlsEnabled={statsControlsEnabled}
                    collapsed={collapsedSections.has('distribution')}
                    on:toggle={() => handleToggleSection('distribution')}
                    on:binsInput={handleBinsInput}
                    on:methodChange={handleMethodChange}
                />
                <StatsFrequencySection
                    bind:frequencyContainer={frequencyContainer}
                    frequencyVisible={frequencyVisible}
                    frequencyLimit={frequencyLimit}
                    statsControlsEnabled={statsControlsEnabled}
                    frequencyFootnote={frequencyFootnote}
                    collapsed={collapsedSections.has('frequency')}
                    on:toggle={() => handleToggleSection('frequency')}
                    on:limitInput={handleLimitInput}
                />
            </div>
        </div>
    </div>
</div>
