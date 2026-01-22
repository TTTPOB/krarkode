import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as util from '../util';

/**
 * Represents a single plot in history
 */
interface PlotEntry {
    id: string;
    timestamp: number;
    base64Data: string;
    mimeType: string;
    displayId?: string;
}

/**
 * PlotManager provides a full-featured plot viewer with:
 * - Plot history navigation
 * - Zoom controls
 * - Resize support
 * - Save to file
 * - Open in browser
 */
export class PlotManager implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private readonly plots: PlotEntry[] = [];
    private currentIndex = -1;
    private currentZoom = 100;
    private readonly maxHistory: number;
    private readonly outputChannel = vscode.window.createOutputChannel('Ark Plot Manager');

    constructor() {
        this.maxHistory = util.config().get<number>('krarkode.plot.maxHistory') ?? 50;
    }

    /**
     * Add a new plot to history and display it
     */
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
        };

        // If displayId matches existing plot, update it instead of adding new
        if (displayId) {
            const existingIndex = this.plots.findIndex(p => p.displayId === displayId);
            if (existingIndex >= 0) {
                this.plots[existingIndex] = entry;
                if (this.currentIndex === existingIndex) {
                    this.updateWebview();
                }
                return;
            }
        }

        // Add new plot
        this.plots.push(entry);
        
        // Trim history if needed
        while (this.plots.length > this.maxHistory) {
            this.plots.shift();
            if (this.currentIndex > 0) {
                this.currentIndex--;
            }
        }

        // Navigate to the new plot
        this.currentIndex = this.plots.length - 1;
        this.showPanel();
        this.updateWebview();
    }

    /**
     * Get current plot count
     */
    public getPlotCount(): number {
        return this.plots.length;
    }

    /**
     * Clear all plots
     */
    public clearHistory(): void {
        this.plots.length = 0;
        this.currentIndex = -1;
        this.updateWebview();
    }

    /**
     * Navigate to previous plot
     */
    public previousPlot(): void {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.updateWebview();
        }
    }

    /**
     * Navigate to next plot
     */
    public nextPlot(): void {
        if (this.currentIndex < this.plots.length - 1) {
            this.currentIndex++;
            this.updateWebview();
        }
    }

    /**
     * Set zoom level
     */
    public setZoom(zoom: number): void {
        this.currentZoom = Math.max(10, Math.min(500, zoom));
        this.updateWebview();
    }

    /**
     * Save current plot to file
     */
    public async savePlot(): Promise<void> {
        if (this.currentIndex < 0 || this.currentIndex >= this.plots.length) {
            void vscode.window.showWarningMessage('No plot to save');
            return;
        }

        const plot = this.plots[this.currentIndex];
        const ext = plot.mimeType === 'image/svg+xml' ? 'svg' : 'png';
        
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`plot-${this.currentIndex + 1}.${ext}`),
            filters: {
                'PNG Image': ['png'],
                'SVG Image': ['svg'],
            },
        });

        if (!uri) {
            return;
        }

        try {
            const buffer = Buffer.from(plot.base64Data, 'base64');
            await fs.promises.writeFile(uri.fsPath, buffer);
            void vscode.window.showInformationMessage(`Plot saved to ${uri.fsPath}`);
        } catch (err) {
            void vscode.window.showErrorMessage(`Failed to save plot: ${String(err)}`);
        }
    }

    /**
     * Open current plot in browser
     */
    public async openInBrowser(): Promise<void> {
        if (this.currentIndex < 0 || this.currentIndex >= this.plots.length) {
            void vscode.window.showWarningMessage('No plot to open');
            return;
        }

        const plot = this.plots[this.currentIndex];
        const ext = plot.mimeType === 'image/svg+xml' ? 'svg' : 'png';
        
        // Create temp file
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
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            // Handle messages from webview
            this.panel.webview.onDidReceiveMessage((message: { command: string; value?: number }) => {
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
                        this.setZoom(0); // 0 means fit to container
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
                        if (typeof message.value === 'number') {
                            this.currentIndex = Math.max(0, Math.min(this.plots.length - 1, message.value));
                            this.updateWebview();
                        }
                        break;
                }
            });
        }

        this.panel.reveal(viewColumn, true);
    }

    private updateWebview(): void {
        if (!this.panel) {
            return;
        }

        const plot = this.plots[this.currentIndex];
        const hasPlot = plot !== undefined;
        const hasPrevious = this.currentIndex > 0;
        const hasNext = this.currentIndex < this.plots.length - 1;

        this.panel.webview.html = this.renderHtml({
            hasPlot,
            hasPrevious,
            hasNext,
            currentIndex: this.currentIndex,
            totalPlots: this.plots.length,
            zoom: this.currentZoom,
            imageData: plot ? `data:${plot.mimeType};base64,${plot.base64Data}` : '',
        });
    }

    private renderHtml(state: {
        hasPlot: boolean;
        hasPrevious: boolean;
        hasNext: boolean;
        currentIndex: number;
        totalPlots: number;
        zoom: number;
        imageData: string;
    }): string {
        const { hasPlot, hasPrevious, hasNext, currentIndex, totalPlots, zoom, imageData } = state;
        
        const zoomStyle = zoom === 0 
            ? 'max-width: 100%; max-height: calc(100vh - 60px); object-fit: contain;'
            : `width: ${zoom}%; height: auto;`;

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --button-bg: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
            --button-hover: var(--vscode-button-hoverBackground);
            --border: var(--vscode-panel-border);
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 0;
            background: var(--bg);
            color: var(--fg);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            overflow: hidden;
        }
        .toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--border);
            background: var(--bg);
            flex-wrap: wrap;
        }
        .toolbar-group {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .toolbar-separator {
            width: 1px;
            height: 20px;
            background: var(--border);
            margin: 0 4px;
        }
        button {
            background: var(--button-bg);
            color: var(--button-fg);
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        button:hover:not(:disabled) {
            background: var(--button-hover);
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .nav-info {
            font-size: 12px;
            min-width: 80px;
            text-align: center;
        }
        .zoom-info {
            font-size: 11px;
            min-width: 50px;
            text-align: center;
        }
        .plot-container {
            height: calc(100vh - 50px);
            overflow: auto;
            display: flex;
            justify-content: center;
            align-items: ${zoom === 0 ? 'center' : 'flex-start'};
            padding: 10px;
        }
        .plot-image {
            ${zoomStyle}
            display: block;
        }
        .no-plot {
            display: flex;
            justify-content: center;
            align-items: center;
            height: calc(100vh - 50px);
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-group">
            <button onclick="send('previous')" ${!hasPrevious ? 'disabled' : ''} title="Previous plot (Left Arrow)">
                ◀ Prev
            </button>
            <span class="nav-info">${hasPlot ? `${currentIndex + 1} / ${totalPlots}` : '0 / 0'}</span>
            <button onclick="send('next')" ${!hasNext ? 'disabled' : ''} title="Next plot (Right Arrow)">
                Next ▶
            </button>
        </div>
        
        <div class="toolbar-separator"></div>
        
        <div class="toolbar-group">
            <button onclick="send('zoomOut')" ${!hasPlot ? 'disabled' : ''} title="Zoom out (-)">−</button>
            <span class="zoom-info">${zoom === 0 ? 'Fit' : zoom + '%'}</span>
            <button onclick="send('zoomIn')" ${!hasPlot ? 'disabled' : ''} title="Zoom in (+)">+</button>
            <button onclick="send('zoomReset')" ${!hasPlot ? 'disabled' : ''} title="Reset zoom to 100%">100%</button>
            <button onclick="send('zoomFit')" ${!hasPlot ? 'disabled' : ''} title="Fit to window">Fit</button>
        </div>
        
        <div class="toolbar-separator"></div>
        
        <div class="toolbar-group">
            <button onclick="send('save')" ${!hasPlot ? 'disabled' : ''} title="Save plot to file">💾 Save</button>
            <button onclick="send('openInBrowser')" ${!hasPlot ? 'disabled' : ''} title="Open in browser">🌐 Browser</button>
        </div>
        
        <div class="toolbar-separator"></div>
        
        <div class="toolbar-group">
            <button onclick="send('clear')" ${!hasPlot ? 'disabled' : ''} title="Clear all plots">🗑 Clear</button>
        </div>
    </div>
    
    ${hasPlot 
        ? `<div class="plot-container"><img class="plot-image" src="${imageData}" alt="Plot ${currentIndex + 1}"></div>`
        : `<div class="no-plot">No plots yet. Run some R code that generates plots.</div>`
    }
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function send(command, value) {
            vscode.postMessage({ command, value });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                send('previous');
            } else if (e.key === 'ArrowRight') {
                send('next');
            } else if (e.key === '+' || e.key === '=') {
                send('zoomIn');
            } else if (e.key === '-') {
                send('zoomOut');
            } else if (e.key === '0') {
                send('zoomReset');
            } else if (e.key === 'f' || e.key === 'F') {
                send('zoomFit');
            } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send('save');
            }
        });
    </script>
</body>
</html>`;
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
