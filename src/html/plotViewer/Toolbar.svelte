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
        padding: 8px 12px;
        background: color-mix(in srgb, var(--vscode-sideBar-background) 85%, transparent);
        backdrop-filter: blur(8px);
        flex-wrap: wrap;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10;
        border-radius: 0 0 6px 6px;
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
</style>
