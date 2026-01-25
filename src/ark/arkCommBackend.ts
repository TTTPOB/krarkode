import * as fs from 'fs';
import * as vscode from 'vscode';
import { ArkSidecarManager } from './sidecarManager';

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

export interface PlotRenderResult {
    data: string;
    mimeType: string;
    format: 'png' | 'svg';
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
    id?: string;
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

    private readonly _onDidOpenPlot = new vscode.EventEmitter<{ plotId: PlotId; preRender?: PlotRenderResult }>();
    public readonly onDidOpenPlot = this._onDidOpenPlot.event;

    private readonly _onDidClosePlot = new vscode.EventEmitter<{ plotId: PlotId }>();
    public readonly onDidClosePlot = this._onDidClosePlot.event;

    private readonly disposables: vscode.Disposable[] = [];
    private readonly plots = new Map<PlotId, PlotValidation>();
    private readonly pendingRenders = new Map<PlotId, { resolve: (result: { data: string; mime_type: string }) => void; reject: (err: unknown) => void }>();
    
    private readonly outputChannel = vscode.window.createOutputChannel('Ark Plot Comm');

    private uiCommId: string | undefined;

    constructor(private readonly sidecarManager: ArkSidecarManager) {
    }

    public async connect(): Promise<void> {
        this.disposables.push(
            this.sidecarManager.onDidOpenPlotComm(e => this.handleOpenPlot(e)),
            this.sidecarManager.onDidReceiveCommMessage(e => this.handleMessage(e)),
            this.sidecarManager.onDidClosePlotComm(e => this.handleClosePlot(e)),
            this.sidecarManager.onDidStart(() => this.initializeComm())
        );
        // Initial sync if needed? Usually we wait for events.
        this._onConnectionChanged.fire();
    }

    private initializeComm(): void {
        // Close existing UI comm if present to avoid leaks
        if (this.uiCommId) {
            this.sidecarManager.sendCommClose(this.uiCommId);
            this.uiCommId = undefined;
        }

        // Establish positron.ui comm connection to enable dynamic plots
        // This tells Ark that the UI is connected, so it should use dynamic plots instead of static images
        const uiCommId = `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.sidecarManager.sendCommOpen(uiCommId, 'positron.ui', {});
        this.uiCommId = uiCommId;
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
        this._onPlotsChanged.dispose();
        this._onConnectionChanged.dispose();
        this._onDeviceActiveChanged.dispose();
        this._onDidOpenPlot.dispose();
        this._onDidClosePlot.dispose();
        this.outputChannel.dispose();
    }

    public getPlots(): PlotValidation[] {
        return Array.from(this.plots.values());
    }

    public async getPlotContent(id: PlotId, width: number, height: number, zoom: number, renderer: string): Promise<string> {
        const format = (renderer === 'svg' || renderer === 'svgp') ? 'svg' : 'png';
        const result = await this.renderPlot(id, { width, height }, zoom, format);
        return `<img src="data:${result.mimeType};base64,${result.data}" style="max-width: 100%; max-height: 100%;" />`;
    }

    public async renderPlot(id: PlotId, size: { width: number; height: number }, pixelRatio: number, format: 'png' | 'svg'): Promise<PlotRenderResult> {
        return new Promise<{ data: string; mime_type: string }>((resolve, reject) => {
            const pending = this.pendingRenders.get(id);
            if (pending) {
                pending.reject(new Error('Cancelled by new render request'));
            }

            this.pendingRenders.set(id, { resolve, reject });

            const request = {
                method: 'render',
                params: {
                    size: { width: size.width, height: size.height },
                    pixel_ratio: pixelRatio,
                    format: format,
                },
                id: id, // Required for Ark to treat this as an RPC request
            };

            this.sidecarManager.sendCommMessage(id, request);
        }).then(({ data, mime_type }) => {
            return {
                data,
                mimeType: mime_type,
                format: mime_type === 'image/svg+xml' ? 'svg' : 'png',
            };
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

    public async savePlot(id: PlotId, renderer: string, outFile: string): Promise<void> {
        const format = renderer === 'svg' || renderer === 'svgp'
            ? 'svg'
            : renderer === 'png'
                ? 'png'
                : undefined;
        if (!format) {
            throw new Error(`Unsupported plot renderer: ${renderer}`);
        }

        this.outputChannel.appendLine(`Saving plot ${id} as ${format} to ${outFile}`);

        const result = await this.renderPlot(id, { width: 800, height: 600 }, 1, format);
        const buffer = Buffer.from(result.data, 'base64');
        await fs.promises.writeFile(outFile, buffer);

        this.outputChannel.appendLine(`Saved plot ${id} to ${outFile}`);
    }

    private handleOpenPlot(e: { commId: string; data: unknown }): void {
        const plot: PlotValidation = { id: e.commId };
        this.plots.set(e.commId, plot);
        this._onPlotsChanged.fire(this.getPlots());

        const payload = e.data as Record<string, unknown> | undefined;
        const preRenderData = payload?.pre_render as Record<string, unknown> | undefined;
        let preRender: PlotRenderResult | undefined;
        if (preRenderData && typeof preRenderData.data === 'string' && typeof preRenderData.mime_type === 'string') {
            preRender = {
                data: preRenderData.data,
                mimeType: preRenderData.mime_type,
                format: preRenderData.mime_type === 'image/svg+xml' ? 'svg' : 'png',
            };
        }

        this._onDidOpenPlot.fire({ plotId: e.commId, preRender });
    }

    private handleClosePlot(e: { commId: string }): void {
        if (this.plots.has(e.commId)) {
            this.plots.delete(e.commId);
            this._onPlotsChanged.fire(this.getPlots());
        }
        this._onDidClosePlot.fire({ plotId: e.commId });
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
