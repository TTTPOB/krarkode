<script lang="ts">
    import { plotStore } from './stores';

    let {
        sendCommand,
    }: {
        sendCommand: (cmd: string) => void;
    } = $props();
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
        <button onclick={() => sendCommand('zoomFit')} title="Fit to window">Fit</button>
    </div>
    <div class="toolbar-separator"></div>
    <div class="toolbar-group">
        <button onclick={() => sendCommand('toggleLayout')} title="Toggle thumbnail layout">Layout: {plotStore.layout}</button>
        <button class:active={plotStore.fullWindow} onclick={() => sendCommand('toggleFullWindow')} title="Toggle full window">Full</button>
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
        padding: 6px 12px;
        border-bottom: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
        flex-wrap: wrap;
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
        background: var(--vscode-panel-border);
        margin: 0 4px;
    }

    .toolbar button {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        padding: 3px 8px;
        cursor: pointer;
        border-radius: 3px;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .toolbar button:hover:not(:disabled) {
        background: var(--vscode-button-secondaryHoverBackground);
    }

    .toolbar button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .toolbar button.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }

    .nav-info {
        font-size: 12px;
        min-width: 60px;
        text-align: center;
    }

    .zoom-info {
        font-size: 11px;
        min-width: 45px;
        text-align: center;
    }
</style>
