<script lang="ts">
    import { onMount } from 'svelte';
    import { plotStore } from './stores';
    import { type InboundMessage, type CommandMessage, type ResizeMessage, getVsCodeApi } from './types';
    import Toolbar from './Toolbar.svelte';
    import LargePlot from './LargePlot.svelte';
    import DragHandler from './DragHandler.svelte';
    import SmallPlots from './SmallPlots.svelte';

    const vscode = getVsCodeApi();

    let largePlotEl: HTMLDivElement | undefined = $state();
    let oldWidth = -1;
    let oldHeight = -1;
    let lastDpr = 1;

    function postResizeMessage(userTriggered = false): void {
        let newWidth: number;
        let newHeight: number;

        if (plotStore.fullWindow) {
            newWidth = window.innerWidth;
            newHeight = window.innerHeight;
        } else if (largePlotEl) {
            const style = getComputedStyle(largePlotEl);
            const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
            const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
            newWidth = largePlotEl.clientWidth - padX;
            newHeight = largePlotEl.clientHeight - padY;
        } else {
            return;
        }

        const dpr = window.devicePixelRatio || 1;

        if (newHeight !== oldHeight || newWidth !== oldWidth || dpr !== lastDpr) {
            const msg: ResizeMessage = {
                message: 'resize',
                width: newWidth,
                height: newHeight,
                userTriggered: userTriggered || dpr !== lastDpr,
                dpr,
            };
            vscode.postMessage(msg);
            oldHeight = newHeight;
            oldWidth = newWidth;
            lastDpr = dpr;
        }
    }

    function sendCommand(command: string, plotId?: string, value?: number): void {
        const msg: CommandMessage = {
            message: 'command',
            command,
            plotId,
            value,
        };
        vscode.postMessage(msg);
    }

    function handleMessage(ev: MessageEvent<InboundMessage>): void {
        const msg = ev.data;

        switch (msg.message) {
            case 'addPlot':
                plotStore.addPlot(msg.plotId, msg.base64Data, msg.mimeType, msg.isActive);
                if (msg.isActive) {
                    setTimeout(() => postResizeMessage(true), 0);
                }
                break;
            case 'updatePlot':
                plotStore.updatePlot(msg.plotId, msg.base64Data, msg.mimeType);
                break;
            case 'focusPlot':
                plotStore.focusPlot(msg.plotId);
                setTimeout(() => postResizeMessage(true), 0);
                break;
            case 'hidePlot':
                plotStore.hidePlot(msg.plotId);
                break;
            case 'toggleFullWindow':
                plotStore.toggleFullWindow(msg.useFullWindow);
                if (msg.useFullWindow) {
                    window.scrollTo(0, 0);
                }
                postResizeMessage(true);
                break;
            case 'setZoom':
                plotStore.setZoom(msg.zoom);
                break;
            case 'setLayout':
                plotStore.setLayout(msg.layout);
                break;
            case 'updateState':
                plotStore.updateState(msg);
                break;
        }
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === 'ArrowLeft') {
            sendCommand('previous');
        } else if (event.key === 'ArrowRight') {
            sendCommand('next');
        } else if (event.key === '+' || event.key === '=') {
            sendCommand('zoomIn');
        } else if (event.key === '-') {
            sendCommand('zoomOut');
        } else if (event.key === '0') {
            sendCommand('zoomReset');
        } else if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            sendCommand('save');
        } else if (event.key === 'Escape' && plotStore.fullWindow) {
            sendCommand('toggleFullWindow');
        }
    }

    $effect(() => {
        if (plotStore.fullWindow) {
            document.body.classList.add('fullWindow');
        } else {
            document.body.classList.remove('fullWindow');
        }
    });

    onMount(() => {
        window.addEventListener('message', handleMessage);
        vscode.postMessage({ message: 'ready' });
        // Tell VS Code to persist this panel across reloads
        vscode.setState({ restored: true });

        // Use ResizeObserver to reliably detect when the panel has its final layout.
        // setTimeout(0) can fire before VS Code finishes laying out a newly-created panel,
        // producing a tiny height measurement that results in a narrow first render.
        let observer: ResizeObserver | undefined;
        if (largePlotEl) {
            observer = new ResizeObserver(() => {
                // Suppress resize messages while the user is dragging the resize handle.
                // The drag handler sends a single resize on drag-end, which avoids
                // flooding the extension with intermediate renders that race and leave
                // the final image sized for a stale intermediate dimension.
                if (!plotStore.handlerDragging) {
                    postResizeMessage(true);
                }
            });
            observer.observe(largePlotEl);
        }

        return () => {
            observer?.disconnect();
            window.removeEventListener('message', handleMessage);
        };
    });
</script>

<svelte:window onresize={() => postResizeMessage()} onkeydown={handleKeydown} />

<div class="plot-area" style:height={plotStore.largePlotHeight} style:flex={plotStore.largePlotHeight ? 'none' : undefined}>
    {#if !plotStore.fullWindow}
        <Toolbar {sendCommand} />
    {/if}

    <LargePlot
        plot={plotStore.activePlot}
        fullWindow={plotStore.fullWindow}
        bind:element={largePlotEl}
    />
</div>

{#if !plotStore.fullWindow}
    <DragHandler
        onDragStart={() => { plotStore.handlerDragging = true; }}
        onDrag={(newHeight) => { plotStore.largePlotHeight = `${newHeight}px`; }}
        onDragEnd={() => { plotStore.handlerDragging = false; postResizeMessage(true); }}
    />
    <SmallPlots
        plots={plotStore.plots}
        activeIndex={plotStore.currentIndex}
        layout={plotStore.layout}
        {sendCommand}
    />
{/if}

<style>
    :global(html),
    :global(body) {
        height: 100%;
    }

    :global(html) {
        box-sizing: border-box;
    }

    :global(*),
    :global(*::before),
    :global(*::after) {
        box-sizing: inherit;
    }

    :global(body) {
        margin: 0;
        padding: 0;
        background: var(--vscode-editor-background);
        color: var(--vscode-foreground);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        overflow-x: hidden;
        overflow-y: auto;
    }

    :global(#svelte-root) {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
    }

    :global(body.fullWindow) {
        overflow-x: hidden;
        overflow-y: hidden;
        height: 100vh;
    }

    .plot-area {
        position: relative;
        flex: 1 1 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
</style>
