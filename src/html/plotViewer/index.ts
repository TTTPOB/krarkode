interface VsCodeApi {
    postMessage: (msg: OutMessage) => void;
    setState: (state: string) => void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface InMessage {
    message: string;
}

interface UpdatePlotMessage extends InMessage {
    message: 'updatePlot';
    plotId: string;
    data: string;
}

interface FocusPlotMessage extends InMessage {
    message: 'focusPlot';
    plotId: string;
}

interface AddPlotMessage extends InMessage {
    message: 'addPlot';
    plotId: string;
    data: string;
    isActive: boolean;
}

interface HidePlotMessage extends InMessage {
    message: 'hidePlot';
    plotId: string;
}

interface ToggleFullWindowMessage extends InMessage {
    message: 'toggleFullWindow';
    useFullWindow: boolean;
}

interface SetZoomMessage extends InMessage {
    message: 'setZoom';
    zoom: number;
    fit: boolean;
}

interface SetLayoutMessage extends InMessage {
    message: 'setLayout';
    layout: string;
}

interface UpdateStateMessage extends InMessage {
    message: 'updateState';
    currentIndex: number;
    totalPlots: number;
    zoom: number;
    fit: boolean;
    hasPrevious: boolean;
    hasNext: boolean;
    fullWindow: boolean;
    layout: string;
}

type InboundMessage =
    | UpdatePlotMessage
    | FocusPlotMessage
    | AddPlotMessage
    | HidePlotMessage
    | ToggleFullWindowMessage
    | SetZoomMessage
    | SetLayoutMessage
    | UpdateStateMessage;

interface ResizeMessage {
    message: 'resize';
    width: number;
    height: number;
    userTriggered: boolean;
    dpr: number;
}

interface CommandMessage {
    message: 'command';
    command: string;
    plotId?: string;
    value?: number;
}

type OutMessage = ResizeMessage | CommandMessage;

const vscode = acquireVsCodeApi();

let isFullWindow = false;
let isHandlerDragging = false;
let oldHeight = -1;
let oldWidth = -1;
let lastDpr = 1;
let currentZoom = 100;
let fitToWindow = true;

const largePlotDiv = document.querySelector('#largePlot') as HTMLDivElement;
const handler = document.querySelector('#handler') as HTMLDivElement;
const smallPlotsDiv = document.querySelector('#smallPlots') as HTMLDivElement;
const navInfo = document.querySelector('.nav-info') as HTMLSpanElement;
const zoomInfo = document.querySelector('.zoom-info') as HTMLSpanElement;

function postResizeMessage(userTriggered = false): void {
    let newWidth = largePlotDiv.clientWidth;
    let newHeight = largePlotDiv.clientHeight;

    if (isFullWindow) {
        newWidth = window.innerWidth;
        newHeight = window.innerHeight;
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

function getSmallPlotWrappers(): HTMLDivElement[] {
    const wrappers: HTMLDivElement[] = [];
    document.querySelectorAll('#smallPlots .wrapper').forEach((elm) => {
        wrappers.push(elm as HTMLDivElement);
    });
    return wrappers;
}

function focusPlot(plotId: string): void {
    const wrappers = getSmallPlotWrappers();

    if (!plotId) {
        wrappers.forEach((wrapper) => wrapper.classList.remove('active'));
        largePlotDiv.innerHTML = '';
        return;
    }

    wrappers.forEach((wrapper) => {
        if (wrapper.dataset.plotId === plotId) {
            wrapper.classList.add('active');
            wrapper.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        } else {
            wrapper.classList.remove('active');
        }
    });

    const activeWrapper = wrappers.find((wrapper) => wrapper.dataset.plotId === plotId);
    if (activeWrapper) {
        const content = activeWrapper.querySelector('.plotContent')?.innerHTML || '';
        largePlotDiv.innerHTML = content;
        setTimeout(() => postResizeMessage(true), 0);
    }
}

function updatePlot(plotId: string, data: string): void {
    const wrappers = getSmallPlotWrappers();

    for (const wrapper of wrappers) {
        if (wrapper.dataset.plotId === plotId) {
            const contentDiv = wrapper.querySelector('.plotContent');
            if (contentDiv) {
                contentDiv.innerHTML = data;
            }
            if (wrapper.classList.contains('active')) {
                largePlotDiv.innerHTML = data;
                setTimeout(() => postResizeMessage(true), 0);
            }
            break;
        }
    }
}

function addPlot(plotId: string, data: string, isActive: boolean): void {
    const wrapper = document.createElement('div');
    wrapper.className = `wrapper${isActive ? ' active' : ''}`;
    wrapper.dataset.plotId = plotId;
    wrapper.innerHTML = `
        <div class="plotContent">${data}</div>
        <button class="hidePlot" title="Hide plot">×</button>
    `;

    wrapper.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).classList.contains('hidePlot')) {
            return;
        }
        sendCommand('goTo', plotId);
    });

    const hideBtn = wrapper.querySelector('.hidePlot');
    if (hideBtn) {
        hideBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            sendCommand('hide', plotId);
        });
    }

    smallPlotsDiv.appendChild(wrapper);

    if (isActive) {
        focusPlot(plotId);
        wrapper.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
    }
}

function hidePlot(plotId: string): void {
    const wrappers = getSmallPlotWrappers();
    const wrapper = wrappers.find((item) => item.dataset.plotId === plotId);

    if (wrapper) {
        const wasActive = wrapper.classList.contains('active');
        wrapper.remove();

        if (wasActive) {
            largePlotDiv.innerHTML = '';
        }
    }
}

function toggleFullWindow(useFullWindow: boolean): void {
    isFullWindow = useFullWindow;
    if (useFullWindow) {
        document.body.classList.add('fullWindow');
        window.scrollTo(0, 0);
    } else {
        document.body.classList.remove('fullWindow');
    }
    postResizeMessage(true);
}

function setZoom(zoom: number, fit: boolean): void {
    currentZoom = zoom;
    fitToWindow = fit;

    if (fit) {
        largePlotDiv.classList.add('fit-to-window');
        const img = largePlotDiv.querySelector('img') as HTMLImageElement | null;
        if (img) {
            img.style.width = '';
            img.style.height = '';
        }
    } else {
        largePlotDiv.classList.remove('fit-to-window');
        const img = largePlotDiv.querySelector('img') as HTMLImageElement | null;
        if (img) {
            img.style.width = `${zoom}%`;
            img.style.height = 'auto';
        }
    }
}

function applyLayout(layout: string): void {
    smallPlotsDiv.classList.remove('multirow', 'scroll', 'hidden');
    smallPlotsDiv.classList.add(layout);
}

function updateState(state: UpdateStateMessage): void {
    navInfo.textContent = state.totalPlots > 0 ? `${state.currentIndex + 1} / ${state.totalPlots}` : '0 / 0';

    zoomInfo.textContent = state.fit ? 'Fit' : `${state.zoom}%`;

    const prevBtn = document.querySelector('[data-cmd="previous"]') as HTMLButtonElement | null;
    const nextBtn = document.querySelector('[data-cmd="next"]') as HTMLButtonElement | null;
    if (prevBtn) {
        prevBtn.disabled = !state.hasPrevious;
    }
    if (nextBtn) {
        nextBtn.disabled = !state.hasNext;
    }

    const fullBtn = document.querySelector('[data-cmd="toggleFullWindow"]') as HTMLButtonElement | null;
    if (fullBtn) {
        fullBtn.classList.toggle('active', state.fullWindow);
    }

    const layoutBtn = document.querySelector('[data-cmd="toggleLayout"]') as HTMLButtonElement | null;
    if (layoutBtn && state.layout) {
        layoutBtn.textContent = `Layout: ${state.layout}`;
        applyLayout(state.layout);
    }

    currentZoom = state.zoom;
    fitToWindow = state.fit;
}

window.addEventListener('message', (ev: MessageEvent<InboundMessage>) => {
    const msg = ev.data;

    switch (msg.message) {
        case 'updatePlot':
            updatePlot(msg.plotId, msg.data);
            break;
        case 'focusPlot':
            focusPlot(msg.plotId);
            break;
        case 'addPlot':
            addPlot(msg.plotId, msg.data, msg.isActive);
            break;
        case 'hidePlot':
            hidePlot(msg.plotId);
            break;
        case 'toggleFullWindow':
            toggleFullWindow(msg.useFullWindow);
            break;
        case 'setZoom':
            setZoom(msg.zoom, msg.fit);
            break;
        case 'setLayout':
            applyLayout(msg.layout);
            break;
        case 'updateState':
            updateState(msg);
            break;
    }
});

document.addEventListener('keydown', (event: KeyboardEvent) => {
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
    } else if (event.key === 'f' || event.key === 'F') {
        sendCommand('zoomFit');
    } else if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        sendCommand('save');
    } else if (event.key === 'Escape' && isFullWindow) {
        sendCommand('toggleFullWindow');
    }
});

document.addEventListener('mousedown', (event: MouseEvent) => {
    if (!isFullWindow && event.target === handler) {
        isHandlerDragging = true;
        handler.classList.add('dragging');
        document.body.style.cursor = 'ns-resize';
    }
});

document.addEventListener('mousemove', (event: MouseEvent) => {
    if (isFullWindow || !isHandlerDragging) {
        return;
    }

    const containerOffsetTop = document.body.offsetTop;
    const pointerRelativeYpos = event.clientY - containerOffsetTop + window.scrollY;
    const minHeight = 100;
    const toolbarHeight = document.querySelector('#toolbar')?.clientHeight || 0;

    const newHeight = Math.max(minHeight, pointerRelativeYpos - toolbarHeight - 5);
    const newHeightString = `${newHeight}px`;

    if (largePlotDiv.style.height !== newHeightString) {
        largePlotDiv.style.height = newHeightString;
        postResizeMessage();
    }
});

document.addEventListener('mouseup', () => {
    if (isHandlerDragging) {
        postResizeMessage(true);
        document.body.style.cursor = '';
    }
    handler.classList.remove('dragging');
    isHandlerDragging = false;
});

window.onresize = () => postResizeMessage();

window.onload = () => {
    postResizeMessage(true);

    document.querySelectorAll('#toolbar button[data-cmd]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const cmd = (btn as HTMLButtonElement).dataset.cmd;
            if (cmd) {
                sendCommand(cmd);
            }
        });
    });

    getSmallPlotWrappers().forEach((wrapper) => {
        wrapper.addEventListener('click', (event) => {
            if ((event.target as HTMLElement).classList.contains('hidePlot')) {
                return;
            }
            const plotId = wrapper.dataset.plotId;
            if (plotId) {
                sendCommand('goTo', plotId);
            }
        });

        const hideBtn = wrapper.querySelector('.hidePlot');
        if (hideBtn) {
            hideBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                const plotId = wrapper.dataset.plotId;
                if (plotId) {
                    sendCommand('hide', plotId);
                }
            });
        }
    });
};
