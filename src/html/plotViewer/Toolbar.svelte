<script lang="ts">
    import { plotStore } from './stores';

    let {
        sendCommand,
    }: {
        sendCommand: (cmd: string) => void;
    } = $props();

    let showEscHint = $state(false);
    let escHintTimeout: ReturnType<typeof setTimeout> | undefined;

    function handleFullPanel() {
        sendCommand('toggleFullWindow');
        if (!plotStore.fullWindow) {
            // Will enter full window mode
            showEscHint = true;
            clearTimeout(escHintTimeout);
            escHintTimeout = setTimeout(() => { showEscHint = false; }, 3000);
        } else {
            showEscHint = false;
        }
    }
</script>

<div class="toolbar">
    <div class="toolbar-group">
        <button onclick={() => sendCommand('previous')} disabled={!plotStore.hasPrevious} title="Previous plot (Left Arrow)">&#9664; Prev</button>
        <span class="nav-info">{plotStore.navText}</span>
        <button onclick={() => sendCommand('next')} disabled={!plotStore.hasNext} title="Next plot (Right Arrow)">Next &#9654;</button>
    </div>
    <div class="toolbar-separator"></div>
    <div class="toolbar-group">
        <button onclick={() => sendCommand('zoomOut')} title="Zoom out (-)">&#8722;</button>
        <span class="zoom-info">{plotStore.zoomText}</span>
        <button onclick={() => sendCommand('zoomIn')} title="Zoom in (+)">+</button>
        <button onclick={() => sendCommand('zoomReset')} title="Reset zoom to 100%">100%</button>
    </div>
    <div class="toolbar-separator"></div>
    <div class="toolbar-group">
        <button onclick={() => sendCommand('toggleLayout')} title="Toggle thumbnail layout">Thumbnail Layout: {plotStore.layout}</button>
    </div>
    <div class="toolbar-separator"></div>
    <div class="toolbar-group">
        <button class:active={plotStore.fullWindow} onclick={handleFullPanel} title="Toggle full panel (Esc to exit)">Show in Full Panel</button>
        {#if showEscHint}
            <span class="esc-hint">Press Esc to exit</span>
        {/if}
    </div>
    <div class="toolbar-separator"></div>
    <div class="toolbar-group">
        <button onclick={() => sendCommand('save')} title="Save plot to file">Save</button>
        <button onclick={() => sendCommand('clear')} title="Clear all plots">Clear</button>
    </div>
</div>

<style>
    .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: color-mix(in srgb, var(--vscode-sideBar-background) 85%, transparent);
        backdrop-filter: blur(8px);
        flex-wrap: wrap;
        position: sticky;
        top: 0;
        z-index: 10;
        flex-shrink: 0;
    }

    .toolbar-group {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .toolbar-separator {
        width: 1px;
        height: 20px;
        background: var(--vscode-editorWidget-border);
        margin: 0 4px;
    }

    .toolbar button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 4px 10px;
        cursor: pointer;
        border-radius: 3px;
        font-size: 0.9em;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .toolbar button:hover:not(:disabled) {
        background: var(--vscode-button-hoverBackground);
    }

    .toolbar button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .toolbar button.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        outline: 1px solid var(--vscode-focusBorder);
    }

    .nav-info {
        font-size: 0.9em;
        min-width: 60px;
        text-align: center;
    }

    .zoom-info {
        font-size: 0.85em;
        min-width: 45px;
        text-align: center;
    }

    .esc-hint {
        font-size: 0.8em;
        opacity: 0.7;
        white-space: nowrap;
        animation: fade-in 0.2s ease-in;
    }

    @keyframes fade-in {
        from { opacity: 0; }
        to { opacity: 0.7; }
    }
</style>
