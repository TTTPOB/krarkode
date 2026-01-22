import * as vscode from 'vscode';
import { ArkSidecarManager } from './plotWatcher';
import * as util from '../util';

/**
 * PlotId is a string identifier for a plot (matches comm_id).
 */
export type PlotId = string;

/**
 * Validation data for a plot.
 */
export interface PlotValidation {
    id: PlotId;
}

/**
 * Renderer configuration for a plot.
 */
export interface PlotRenderer {
    id: string;
    name: string;
    descr: string;
    ext: string;
}

/**
 * Interface for plot backend implementations.
 */
export interface IPlotBackend extends vscode.Disposable {
    readonly onPlotsChanged: vscode.Event<PlotValidation[]>;
    readonly onConnectionChanged: vscode.Event<void>;
    readonly onDeviceActiveChanged: vscode.Event<void>;
    
    connect(): Promise<void>;
    disconnect(): void;
    getPlots(): PlotValidation[];
    getPlotContent(id: PlotId, width: number, height: number, zoom: number, renderer: string): Promise<string>;
    getRenderers(): PlotRenderer[];
    getFullUrl(): string;
    removePlot(id: PlotId): Promise<void>;
    savePlot(id: PlotId, renderer: string, outFile: string): Promise<void>;
}

interface ArkRenderRequest {
    method: 'render';
    params: {
        size: {
            width: number;
            height: number;
        };
        pixel_ratio: number;
        format: 'png' | 'svg';
    };
}

interface ArkRenderReply {
    method: 'RenderReply';
    result: {
        data: string; // base64
        mime_type: string;
    };
}

/**
 * ArkCommBackend implements IPlotBackend using the positron.plot comm protocol.
 * It communicates with the Ark kernel via the ArkSidecarManager.
 */
export class ArkCommBackend implements IPlotBackend {
    private readonly _onPlotsChanged = new vscode.EventEmitter<PlotValidation[]>();
    public readonly onPlotsChanged = this._onPlotsChanged.event;

    private readonly _onConnectionChanged = new vscode.EventEmitter<void>();
    public readonly onConnectionChanged = this._onConnectionChanged.event;

    private readonly _onDeviceActiveChanged = new vscode.EventEmitter<void>();
    public readonly onDeviceActiveChanged = this._onDeviceActiveChanged.event;

    private readonly disposables: vscode.Disposable[] = [];
    private readonly plots = new Map<PlotId, PlotValidation>();
    private readonly pendingRenders = new Map<PlotId, { resolve: (result: { data: string; mime_type: string }) => void; reject: (err: unknown) => void }>();
    
    private plotPanel: vscode.WebviewPanel | undefined;
    private readonly outputChannel = vscode.window.createOutputChannel('Ark Plot Comm');

    constructor(private readonly sidecarManager: ArkSidecarManager) {
    }

    public async connect(): Promise<void> {
        this.disposables.push(
            this.sidecarManager.onDidOpenPlotComm(e => this.handleOpenPlot(e)),
            this.sidecarManager.onDidReceiveCommMessage(e => this.handleMessage(e)),
            this.sidecarManager.onDidClosePlotComm(e => this.handleClosePlot(e))
        );
        // Initial sync if needed? Usually we wait for events.
        this._onConnectionChanged.fire();
    }

    public disconnect(): void {
        this.dispose();
        this._onConnectionChanged.fire();
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
        this.plots.clear();
        this.pendingRenders.forEach(p => p.reject(new Error('Backend disposed')));
        this.pendingRenders.clear();
        this.plotPanel?.dispose();
        this.plotPanel = undefined;
        this._onPlotsChanged.dispose();
        this._onConnectionChanged.dispose();
        this._onDeviceActiveChanged.dispose();
        this.outputChannel.dispose();
    }

    public getPlots(): PlotValidation[] {
        return Array.from(this.plots.values());
    }

    public async getPlotContent(id: PlotId, width: number, height: number, zoom: number, renderer: string): Promise<string> {
        return new Promise<{ data: string; mime_type: string }>((resolve, reject) => {
            // Cancel any previous pending render for this plot
            const pending = this.pendingRenders.get(id);
            if (pending) {
                pending.reject(new Error('Cancelled by new render request'));
            }

            this.pendingRenders.set(id, { resolve, reject });

            // renderer can be 'svg', 'svgp', 'png'
            const format = (renderer === 'svg' || renderer === 'svgp') ? 'svg' : 'png';

            const request: ArkRenderRequest = {
                method: 'render',
                params: {
                    size: { width, height },
                    pixel_ratio: zoom,
                    format: format
                }
            };
            
            this.sidecarManager.sendCommMessage(id, request);
        }).then(({ data, mime_type }) => {
             if (mime_type === 'image/svg+xml') {
                 // data is base64 encoded SVG
                 // We can display it using data URI or decode it.
                 // Data URI is safer and easier.
                 return `<img src="data:${mime_type};base64,${data}" style="max-width: 100%; max-height: 100%;" />`;
             } else {
                 return `<img src="data:${mime_type};base64,${data}" style="max-width: 100%; max-height: 100%;" />`;
             }
        });
    }

    public getRenderers(): PlotRenderer[] {
        return [{
            id: 'svg',
            name: 'SVG Image',
            descr: 'Scalable Vector Graphics',
            ext: '.svg'
        }, {
            id: 'png',
            name: 'PNG Image',
            descr: 'Rasterized PNG image',
            ext: '.png'
        }];
    }

    public getFullUrl(): string {
        return '';
    }

    public async removePlot(id: PlotId): Promise<void> {
        this.plots.delete(id);
        this._onPlotsChanged.fire(this.getPlots());
    }

    public async savePlot(_id: PlotId, _renderer: string, _outFile: string): Promise<void> {
        // Not implemented yet
        throw new Error('Not implemented');
    }

    private handleOpenPlot(e: { commId: string; data: unknown }): void {
        const plot: PlotValidation = { id: e.commId };
        this.plots.set(e.commId, plot);
        this._onPlotsChanged.fire(this.getPlots());
        
        // Auto-render the new plot
        void this.autoRenderPlot(e.commId);
    }

    private handleClosePlot(e: { commId: string }): void {
        if (this.plots.has(e.commId)) {
            this.plots.delete(e.commId);
            this._onPlotsChanged.fire(this.getPlots());
        }
    }

    private handleMessage(e: { commId: string; data: unknown }): void {
        const pending = this.pendingRenders.get(e.commId);
        const data = e.data as Record<string, unknown> | undefined;
        if (pending && data && data.method === 'RenderReply') {
            const reply = data as unknown as ArkRenderReply;
            if (reply.result && reply.result.data) {
                 pending.resolve(reply.result);
            } else {
                pending.reject(new Error('Invalid RenderReply: missing data'));
            }
            this.pendingRenders.delete(e.commId);
        }
    }

    private async autoRenderPlot(plotId: PlotId): Promise<void> {
        const configured = util.config().get<string>('krarkode.plot.viewColumn');
        if (configured === 'Disable') {
            return;
        }

        try {
            // Request render with default size
            const htmlContent = await this.getPlotContent(plotId, 800, 600, 1, 'png');
            this.showPlotInPanel(plotId, htmlContent);
        } catch (err) {
            this.outputChannel.appendLine(`Failed to render plot ${plotId}: ${String(err)}`);
        }
    }

    private showPlotInPanel(plotId: PlotId, htmlContent: string): void {
        const configured = util.config().get<string>('krarkode.plot.viewColumn');
        if (configured === 'Disable') {
            return;
        }

        const viewColumn = this.asViewColumn(configured, vscode.ViewColumn.Two);

        if (!this.plotPanel) {
            this.plotPanel = vscode.window.createWebviewPanel(
                'arkCommPlot',
                'Ark Plot',
                { preserveFocus: true, viewColumn },
                { enableScripts: true, retainContextWhenHidden: true }
            );
            this.plotPanel.onDidDispose(() => {
                this.plotPanel = undefined;
            });
        }

        this.plotPanel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { margin: 0; padding: 0; background: var(--vscode-editor-background); display: flex; justify-content: center; align-items: center; height: 100vh; }
        img { max-width: 100%; max-height: 100%; }
    </style>
</head>
<body>
    ${htmlContent}
</body>
</html>`;
        this.plotPanel.reveal(viewColumn, true);
    }

    private asViewColumn(value: string | undefined, defaultColumn: vscode.ViewColumn): vscode.ViewColumn {
        switch (value) {
            case 'Active': return vscode.ViewColumn.Active;
            case 'Beside': return vscode.ViewColumn.Beside;
            case 'One': return vscode.ViewColumn.One;
            case 'Two': return vscode.ViewColumn.Two;
            case 'Three': return vscode.ViewColumn.Three;
            default: return defaultColumn;
        }
    }
}
