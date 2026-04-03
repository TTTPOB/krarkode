// -- Plot data model --

export interface PlotInfo {
    id: string;
    base64Data: string;
    mimeType: string;
}

// -- Inbound messages (extension → webview) --

export interface AddPlotMessage {
    message: 'addPlot';
    plotId: string;
    base64Data: string;
    mimeType: string;
    isActive: boolean;
}

export interface UpdatePlotMessage {
    message: 'updatePlot';
    plotId: string;
    base64Data: string;
    mimeType: string;
}

export interface FocusPlotMessage {
    message: 'focusPlot';
    plotId: string;
}

export interface HidePlotMessage {
    message: 'hidePlot';
    plotId: string;
}

export interface ToggleFullWindowMessage {
    message: 'toggleFullWindow';
    useFullWindow: boolean;
}

export interface SetZoomMessage {
    message: 'setZoom';
    zoom: number;
    fit: boolean;
}

export interface SetLayoutMessage {
    message: 'setLayout';
    layout: string;
}

export interface UpdateStateMessage {
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

export type InboundMessage =
    | AddPlotMessage
    | UpdatePlotMessage
    | FocusPlotMessage
    | HidePlotMessage
    | ToggleFullWindowMessage
    | SetZoomMessage
    | SetLayoutMessage
    | UpdateStateMessage;

// -- Outbound messages (webview → extension) --

export interface ResizeMessage {
    message: 'resize';
    width: number;
    height: number;
    userTriggered: boolean;
    dpr: number;
}

export interface CommandMessage {
    message: 'command';
    command: string;
    plotId?: string;
    value?: number;
}

export interface ReadyMessage {
    message: 'ready';
}

export type OutMessage = ResizeMessage | CommandMessage | ReadyMessage;

// -- VS Code API accessor --

declare function acquireVsCodeApi(): {
    postMessage: (message: unknown) => void;
};

let vsCodeApi: ReturnType<typeof acquireVsCodeApi> | null = null;

export function getVsCodeApi(): ReturnType<typeof acquireVsCodeApi> {
    if (!vsCodeApi) {
        vsCodeApi = acquireVsCodeApi();
    }
    return vsCodeApi;
}
