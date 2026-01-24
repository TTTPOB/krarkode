<script lang="ts">
    import { createEventDispatcher } from 'svelte';

    export let title = 'Data Explorer';
    export let meta = '';

    // Expose button elements for click-outside detection
    export let columnsButtonEl: HTMLButtonElement | undefined = undefined;
    export let statsButtonEl: HTMLButtonElement | undefined = undefined;
    export let codeButtonEl: HTMLButtonElement | undefined = undefined;

    const dispatch = createEventDispatcher<{
        openColumns: void;
        openStats: void;
        openCode: void;
        refresh: void;
        export: { format: 'csv' | 'tsv' | 'html' };
    }>();

    function handleExport(format: 'csv' | 'tsv' | 'html'): void {
        dispatch('export', { format });
    }
</script>

<div class="toolbar" role="toolbar" aria-label="Data explorer toolbar">
    <div class="title" id="table-title">{title}</div>
    <div class="meta" id="table-meta">{meta}</div>
    <div class="toolbar-actions" role="group" aria-label="Table actions">
        <button
            class="action"
            id="columns-btn"
            title="Column Visibility"
            aria-label="Toggle column visibility"
            bind:this={columnsButtonEl}
            on:click={() => dispatch('openColumns')}
        >
            Columns
        </button>
        <button
            class="action"
            id="stats-btn"
            title="Column Statistics"
            aria-label="Toggle column statistics"
            bind:this={statsButtonEl}
            on:click={() => dispatch('openStats')}
        >
            Stats
        </button>
        <div class="dropdown">
            <button class="action" id="export-btn" aria-haspopup="menu">Export &#9662;</button>
            <div class="dropdown-content" id="export-dropdown" role="menu" aria-label="Export formats">
                <button role="menuitem" data-format="csv" on:click={() => handleExport('csv')}>Export as CSV</button>
                <button role="menuitem" data-format="tsv" on:click={() => handleExport('tsv')}>Export as TSV</button>
                <button role="menuitem" data-format="html" on:click={() => handleExport('html')}>Export as HTML</button>
            </div>
        </div>
        <button
            class="action"
            id="code-btn"
            title="Convert to Code"
            aria-label="Open code conversion"
            bind:this={codeButtonEl}
            on:click={() => dispatch('openCode')}
        >
            Code
        </button>
        <button class="action" id="refresh-btn" aria-label="Refresh data" on:click={() => dispatch('refresh')}>
            Refresh
        </button>
    </div>
</div>
