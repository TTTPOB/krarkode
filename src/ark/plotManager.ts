import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getExtensionContext } from '../context';
import type { PlotRenderResult } from './arkCommBackend';
import * as util from '../util';
import { getLogger, LogCategory } from '../logging/logger';

interface PlotEntry {
    id: string;
    timestamp: number;
    base64Data: string;
    mimeType: string;
    displayId?: string;
    renderable?: boolean;
    renderFormat?: 'png' | 'svg';
}

type PreviewLayout = 'multirow' | 'scroll' | 'hidden';

export interface DynamicPlotSource {
    readonly onDidOpenPlot: vscode.Event<{ plotId: string; preRender?: PlotRenderResult }>;
    readonly onDidClosePlot: vscode.Event<{ plotId: string }>;
    renderPlot(
        id: string,
        size: { width: number; height: number },
        pixelRatio: number,
        format: 'png' | 'svg' | 'pdf',
    ): Promise<PlotRenderResult>;
}

export class PlotManager implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private readonly plots: PlotEntry[] = [];
    private currentIndex = -1;
    private currentZoom = 100;
    private fitToWindow = true;
    private fullWindow = false;
    private previewLayout: PreviewLayout = 'multirow';
    private renderSource?: DynamicPlotSource;
    private renderTimeout?: NodeJS.Timeout;
    private lastRenderSize: { width: number; height: number; dpr: number } | undefined;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly maxHistory: number;
    private readonly outputChannel = getLogger().createChannel('ark', LogCategory.Plot);

    constructor(renderSource?: DynamicPlotSource) {
        this.maxHistory = util.config().get<number>('krarkode.plot.maxHistory') ?? 50;
        this.renderSource = renderSource;
        if (renderSource) {
            this.disposables.push(
                renderSource.onDidOpenPlot((event) => this.addDynamicPlot(event.plotId, event.preRender)),
                renderSource.onDidClosePlot((event) => this.removePlot(event.plotId)),
            );
        }
    }

    public addPlot(base64Data: string, mimeType: string = 'image/png', displayId?: string): void {
        const configured = util.config().get<string>('krarkode.plot.viewColumn');
        if (configured === 'Disable') {
            return;
        }

        const entry: PlotEntry = {
            id: `plot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            base64Data,
            mimeType,
            displayId,
            renderable: false,
            renderFormat: mimeType === 'image/svg+xml' ? 'svg' : 'png',
        };

        if (displayId) {
            const existingIndex = this.plots.findIndex((plot) => plot.displayId === displayId);
            if (existingIndex >= 0) {
                const existing = this.plots[existingIndex];
                this.plots[existingIndex] = { ...entry, id: existing.id };
                if (this.panel) {
                    this.postWebviewMessage({
                        message: 'updatePlot',
                        plotId: existing.id,
                        data: this.plotToHtml(this.plots[existingIndex]),
                    });
                    this.focusPlotByIndex(existingIndex);
                }
                return;
            }
        }

        this.plots.push(entry);

        while (this.plots.length > this.maxHistory) {
            this.plots.shift();
            if (this.currentIndex > 0) {
                this.currentIndex--;
            }
        }

        this.currentIndex = this.plots.length - 1;
        const hadPanel = !!this.panel;
        this.showPanel();

        if (this.panel && hadPanel) {
            this.postWebviewMessage({
                message: 'addPlot',
                plotId: entry.id,
                data: this.plotToHtml(entry),
                isActive: true,
            });
            this.focusPlotByIndex(this.currentIndex);
        }
        this.updateWebviewState();
    }

    private addDynamicPlot(plotId: string, preRender?: PlotRenderResult): void {
        const configured = util.config().get<string>('krarkode.plot.viewColumn');
        if (configured === 'Disable') {
            return;
        }

        const hasRenderablePreRender = preRender?.format === 'png' || preRender?.format === 'svg';
        const preRenderFormat = preRender?.format === 'svg' ? 'svg' : preRender?.format === 'png' ? 'png' : undefined;
        const mimeType = hasRenderablePreRender ? (preRender?.mimeType ?? 'image/png') : 'image/png';
        const entry: PlotEntry = {
            id: plotId,
            timestamp: Date.now(),
            base64Data: hasRenderablePreRender ? (preRender?.data ?? '') : '',
            mimeType,
            renderable: true,
            renderFormat: preRenderFormat ?? (mimeType === 'image/svg+xml' ? 'svg' : 'png'),
        };

        this.plots.push(entry);

        while (this.plots.length > this.maxHistory) {
            this.plots.shift();
            if (this.currentIndex > 0) {
                this.currentIndex--;
            }
        }

        this.currentIndex = this.plots.length - 1;
        const hadPanel = !!this.panel;
        this.showPanel();

        if (this.panel && hadPanel) {
            this.postWebviewMessage({
                message: 'addPlot',
                plotId: entry.id,
                data: this.plotToHtml(entry),
                isActive: true,
            });
            this.focusPlotByIndex(this.currentIndex);
        }
        this.updateWebviewState();
        if (!preRender?.data) {
            this.scheduleRender(true);
        }
    }

    public getPlotCount(): number {
        return this.plots.length;
    }

    public clearHistory(): void {
        this.plots.length = 0;
        this.currentIndex = -1;
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
            this.renderTimeout = undefined;
        }
        this.renderWebview();
    }

    public previousPlot(): void {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.focusPlotByIndex(this.currentIndex);
        }
    }

    public nextPlot(): void {
        if (this.currentIndex < this.plots.length - 1) {
            this.currentIndex++;
            this.focusPlotByIndex(this.currentIndex);
        }
    }

    public setZoom(zoom: number): void {
        this.currentZoom = Math.max(10, Math.min(500, zoom));
        this.fitToWindow = false;
        this.postWebviewMessage({
            message: 'setZoom',
            zoom: this.currentZoom,
            fit: false,
        });
        this.updateWebviewState();
        this.scheduleRender(true);
    }

    public async savePlot(): Promise<void> {
        if (this.currentIndex < 0 || this.currentIndex >= this.plots.length) {
            void vscode.window.showWarningMessage('No plot to save');
            return;
        }

        const plot = this.plots[this.currentIndex];
        type PlotSaveFormat = 'png' | 'svg' | 'pdf';

        const currentFormat: PlotSaveFormat = plot.mimeType === 'image/svg+xml' ? 'svg' : 'png';
        const isRenderable = !!this.renderSource && !!plot.renderable;
        const formatOptions: PlotSaveFormat[] = isRenderable ? ['png', 'svg', 'pdf'] : [currentFormat];
        const orderedFormats = [currentFormat, ...formatOptions.filter((format) => format !== currentFormat)];

        let targetFormat: PlotSaveFormat = currentFormat;
        if (orderedFormats.length > 1) {
            const formatItems: Array<vscode.QuickPickItem & { format: PlotSaveFormat }> = orderedFormats.map(
                (format) => {
                    const label = format === 'png' ? 'PNG Image' : format === 'svg' ? 'SVG Image' : 'PDF Document';
                    const description = format === currentFormat ? 'Current render' : 'Render from Ark';
                    return {
                        label,
                        description,
                        format,
                    };
                },
            );
            const picked = await vscode.window.showQuickPick(formatItems, {
                placeHolder: 'Select plot export format',
            });
            if (!picked) {
                return;
            }
            targetFormat = picked.format;
        }

        const filterLabel =
            targetFormat === 'png' ? 'PNG Image' : targetFormat === 'svg' ? 'SVG Image' : 'PDF Document';
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`plot-${this.currentIndex + 1}.${targetFormat}`),
            filters: {
                [filterLabel]: [targetFormat],
            },
        });

        if (!uri) {
            return;
        }

        try {
            let data = plot.base64Data;
            if (!data || targetFormat !== currentFormat) {
                if (!isRenderable || !this.renderSource) {
                    void vscode.window.showWarningMessage('Plot data is not ready for the requested format');
                    return;
                }
                const renderSize = this.lastRenderSize ?? { width: 800, height: 600, dpr: 1 };
                const { size, pixelRatio } = this.buildRenderRequest(renderSize, targetFormat);
                const result = await this.renderSource.renderPlot(plot.id, size, pixelRatio, targetFormat);
                data = result.data;
            }

            if (!data) {
                void vscode.window.showWarningMessage('Plot data is not ready to save');
                return;
            }

            this.outputChannel.appendLine(`Saving plot ${plot.id} as ${targetFormat} to ${uri.fsPath}`);
            const buffer = Buffer.from(data, 'base64');
            await fs.promises.writeFile(uri.fsPath, buffer);
            void vscode.window.showInformationMessage(`Plot saved to ${uri.fsPath}`);
        } catch (err) {
            void vscode.window.showErrorMessage(`Failed to save plot: ${String(err)}`);
        }
    }

    public async openInBrowser(): Promise<void> {
        if (this.currentIndex < 0 || this.currentIndex >= this.plots.length) {
            void vscode.window.showWarningMessage('No plot to open');
            return;
        }

        const plot = this.plots[this.currentIndex];
        const ext = plot.mimeType === 'image/svg+xml' ? 'svg' : 'png';

        const tempDir = path.join(require('os').tmpdir(), 'krarkode-plots');
        await fs.promises.mkdir(tempDir, { recursive: true });
        const tempFile = path.join(tempDir, `plot-${Date.now()}.${ext}`);

        const buffer = Buffer.from(plot.base64Data, 'base64');
        await fs.promises.writeFile(tempFile, buffer);

        await vscode.env.openExternal(vscode.Uri.file(tempFile));
    }

    public dispose(): void {
        this.panel?.dispose();
        this.panel = undefined;
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
            this.renderTimeout = undefined;
        }
        this.disposables.forEach((disposable) => disposable.dispose());
        this.disposables.length = 0;
        this.outputChannel.dispose();
    }

    private showPanel(): void {
        const configured = util.config().get<string>('krarkode.plot.viewColumn');
        if (configured === 'Disable') {
            return;
        }

        const viewColumn = this.asViewColumn(configured, vscode.ViewColumn.Two);

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'arkPlotManager',
                'Ark Plots',
                { preserveFocus: true, viewColumn },
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.joinPath(getExtensionContext().extensionUri, 'html', 'plotViewer')],
                },
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            this.panel.webview.onDidReceiveMessage(
                (message: {
                    message: string;
                    command?: string;
                    plotId?: string;
                    value?: number;
                    width?: number;
                    height?: number;
                    dpr?: number;
                    userTriggered?: boolean;
                }) => {
                    if (message.message === 'resize') {
                        if (typeof message.width === 'number' && typeof message.height === 'number') {
                            this.handleResize({
                                width: message.width,
                                height: message.height,
                                dpr: typeof message.dpr === 'number' ? message.dpr : 1,
                                userTriggered: !!message.userTriggered,
                            });
                        }
                        return;
                    }
                    if (message.message !== 'command' || !message.command) {
                        return;
                    }
                    switch (message.command) {
                        case 'previous':
                            this.previousPlot();
                            break;
                        case 'next':
                            this.nextPlot();
                            break;
                        case 'zoomIn':
                            this.setZoom(this.currentZoom + 25);
                            break;
                        case 'zoomOut':
                            this.setZoom(this.currentZoom - 25);
                            break;
                        case 'zoomReset':
                            this.setZoom(100);
                            break;
                        case 'zoomFit':
                            this.fitToWindow = true;
                            this.postWebviewMessage({
                                message: 'setZoom',
                                zoom: this.currentZoom,
                                fit: true,
                            });
                            this.updateWebviewState();
                            this.scheduleRender(true);
                            break;
                        case 'save':
                            void this.savePlot();
                            break;
                        case 'openInBrowser':
                            void this.openInBrowser();
                            break;
                        case 'clear':
                            this.clearHistory();
                            break;
                        case 'goTo':
                            if (message.plotId) {
                                const index = this.plots.findIndex((plot) => plot.id === message.plotId);
                                if (index >= 0) {
                                    this.currentIndex = index;
                                    this.focusPlotByIndex(this.currentIndex);
                                }
                            }
                            break;
                        case 'hide':
                            if (message.plotId) {
                                this.hidePlot(message.plotId);
                            }
                            break;
                        case 'toggleFullWindow':
                            this.fullWindow = !this.fullWindow;
                            this.postWebviewMessage({
                                message: 'toggleFullWindow',
                                useFullWindow: this.fullWindow,
                            });
                            this.updateWebviewState();
                            break;
                        case 'toggleLayout':
                            this.cyclePreviewLayout();
                            break;
                    }
                },
            );

            this.renderWebview();
        }

        this.panel.reveal(viewColumn, true);
        this.updateWebviewState();
    }

    private renderWebview(): void {
        if (!this.panel) {
            return;
        }

        this.panel.webview.html = this.renderHtml();
        this.updateWebviewState();
        if (this.currentIndex >= 0) {
            this.focusPlotByIndex(this.currentIndex);
        }
    }

    private renderHtml(): string {
        const webview = this.panel?.webview;
        if (!webview) {
            return '';
        }

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(getExtensionContext().extensionUri, 'html', 'plotViewer', 'dist', 'index.js'),
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(getExtensionContext().extensionUri, 'html', 'plotViewer', 'style.css'),
        );

        const plotsHtml = this.plots
            .map((plot, index) => this.renderSmallPlot(plot, index === this.currentIndex))
            .join('');
        const activePlot = this.plots[this.currentIndex];
        const activePlotHtml = activePlot ? this.plotToHtml(activePlot) : '';

        const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src ${webview.cspSource};`;

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <link href="${styleUri}" rel="stylesheet">
</head>
<body>
    <div id="toolbar">
        <div class="toolbar-group">
            <button data-cmd="previous" title="Previous plot (Left Arrow)">◀ Prev</button>
            <span class="nav-info">0 / 0</span>
            <button data-cmd="next" title="Next plot (Right Arrow)">Next ▶</button>
        </div>
        <div class="toolbar-separator"></div>
        <div class="toolbar-group">
            <button data-cmd="zoomOut" title="Zoom out (-)">−</button>
            <span class="zoom-info">Fit</span>
            <button data-cmd="zoomIn" title="Zoom in (+)">+</button>
            <button data-cmd="zoomReset" title="Reset zoom to 100%">100%</button>
            <button data-cmd="zoomFit" title="Fit to window">Fit</button>
        </div>
        <div class="toolbar-separator"></div>
        <div class="toolbar-group">
            <button data-cmd="toggleLayout" title="Toggle thumbnail layout">Layout</button>
            <button data-cmd="toggleFullWindow" title="Toggle full window">Full</button>
        </div>
        <div class="toolbar-separator"></div>
        <div class="toolbar-group">
            <button data-cmd="save" title="Save plot to file">Save</button>
            <button data-cmd="clear" title="Clear all plots">Clear</button>
        </div>
    </div>
    <div id="largePlot" class="${this.fitToWindow ? 'fit-to-window' : ''}">
        ${activePlotHtml}
    </div>
    <div id="handler"></div>
    <div id="smallPlots" class="${this.previewLayout}">
        ${plotsHtml}
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    private renderSmallPlot(plot: PlotEntry, isActive: boolean): string {
        return `<div class="wrapper${isActive ? ' active' : ''}" data-plot-id="${plot.id}">
    <div class="plotContent">${this.plotToHtml(plot)}</div>
    <button class="hidePlot" title="Hide plot">×</button>
</div>`;
    }

    private plotToHtml(plot: PlotEntry): string {
        if (!plot.base64Data) {
            return '<div class="no-plot">Rendering plot...</div>';
        }
        const dataUri = `data:${plot.mimeType};base64,${plot.base64Data}`;
        return `<img src="${dataUri}" alt="Plot ${plot.id}">`;
    }

    private focusPlotByIndex(index: number): void {
        const plot = this.plots[index];
        if (!plot) {
            return;
        }

        this.postWebviewMessage({
            message: 'focusPlot',
            plotId: plot.id,
        });
        this.updateWebviewState();
        this.scheduleRender(true);
    }

    private hidePlot(plotId: string): void {
        this.removePlot(plotId);
    }

    private removePlot(plotId: string): void {
        const index = this.plots.findIndex((plot) => plot.id === plotId);
        if (index < 0) {
            return;
        }

        this.plots.splice(index, 1);
        if (this.currentIndex >= this.plots.length) {
            this.currentIndex = this.plots.length - 1;
        } else if (index < this.currentIndex) {
            this.currentIndex -= 1;
        }

        this.postWebviewMessage({
            message: 'hidePlot',
            plotId,
        });

        if (this.currentIndex >= 0) {
            this.focusPlotByIndex(this.currentIndex);
        } else {
            this.postWebviewMessage({
                message: 'focusPlot',
                plotId: '',
            });
        }

        this.updateWebviewState();
    }

    private cyclePreviewLayout(): void {
        switch (this.previewLayout) {
            case 'multirow':
                this.previewLayout = 'scroll';
                break;
            case 'scroll':
                this.previewLayout = 'hidden';
                break;
            case 'hidden':
                this.previewLayout = 'multirow';
                break;
        }

        this.postWebviewMessage({
            message: 'setLayout',
            layout: this.previewLayout,
        });
        this.updateWebviewState();
    }

    private handleResize(payload: { width: number; height: number; dpr: number; userTriggered: boolean }): void {
        this.lastRenderSize = {
            width: payload.width,
            height: payload.height,
            dpr: payload.dpr,
        };
        this.scheduleRender(payload.userTriggered);
    }

    private scheduleRender(userTriggered: boolean): void {
        if (!this.isActivePlotRenderable()) {
            return;
        }

        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
        }

        const delay = userTriggered ? 0 : 150;
        if (delay === 0) {
            void this.renderActivePlot();
            return;
        }

        this.renderTimeout = setTimeout(() => {
            this.renderTimeout = undefined;
            void this.renderActivePlot();
        }, delay);
    }

    private isActivePlotRenderable(): boolean {
        const plot = this.plots[this.currentIndex];
        return !!this.renderSource && !!plot?.renderable;
    }

    private async renderActivePlot(): Promise<void> {
        if (!this.renderSource) {
            return;
        }

        const plot = this.plots[this.currentIndex];
        if (!plot?.renderable) {
            return;
        }

        const renderSize = this.lastRenderSize ?? { width: 800, height: 600, dpr: 1 };
        const format = plot.renderFormat ?? (plot.mimeType === 'image/svg+xml' ? 'svg' : 'png');
        const { size, pixelRatio } = this.buildRenderRequest(renderSize, format);
        const plotId = plot.id;

        try {
            const result = await this.renderSource.renderPlot(plotId, size, pixelRatio, format);
            const updated = this.plots.find((entry) => entry.id === plotId);
            if (!updated) {
                return;
            }
            updated.base64Data = result.data;
            updated.mimeType = result.mimeType;
            updated.renderFormat = result.format === 'svg' ? 'svg' : 'png';
            this.postWebviewMessage({
                message: 'updatePlot',
                plotId,
                data: this.plotToHtml(updated),
            });
        } catch (err) {
            this.outputChannel.appendLine(`Failed to render plot ${plotId}: ${String(err)}`);
        }
    }

    private buildRenderRequest(
        renderSize: { width: number; height: number; dpr: number },
        format: 'png' | 'svg' | 'pdf',
    ): { size: { width: number; height: number }; pixelRatio: number } {
        const zoomScale = this.fitToWindow ? 1 : this.currentZoom / 100;
        const width = Math.max(1, Math.round(renderSize.width * zoomScale));
        const height = Math.max(1, Math.round(renderSize.height * zoomScale));
        const pixelRatio = format === 'png' ? Math.max(0.1, renderSize.dpr) : 1;
        return {
            size: { width, height },
            pixelRatio,
        };
    }

    private updateWebviewState(): void {
        if (!this.panel) {
            return;
        }

        const hasPrevious = this.currentIndex > 0;
        const hasNext = this.currentIndex < this.plots.length - 1;
        this.postWebviewMessage({
            message: 'updateState',
            currentIndex: this.currentIndex,
            totalPlots: this.plots.length,
            zoom: this.currentZoom,
            fit: this.fitToWindow,
            hasPrevious,
            hasNext,
            fullWindow: this.fullWindow,
            layout: this.previewLayout,
        });
        this.postWebviewMessage({
            message: 'setZoom',
            zoom: this.currentZoom,
            fit: this.fitToWindow,
        });
    }

    private postWebviewMessage(message: Record<string, unknown>): void {
        void this.panel?.webview.postMessage(message);
    }

    private asViewColumn(value: string | undefined, defaultColumn: vscode.ViewColumn): vscode.ViewColumn {
        switch (value) {
            case 'Active':
                return vscode.ViewColumn.Active;
            case 'Beside':
                return vscode.ViewColumn.Beside;
            case 'One':
                return vscode.ViewColumn.One;
            case 'Two':
                return vscode.ViewColumn.Two;
            case 'Three':
                return vscode.ViewColumn.Three;
            default:
                return defaultColumn;
        }
    }
}
