import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as util from '../util';
import type { ShowHtmlFileParams } from './sidecarManager';

/**
 * HtmlViewer handles ShowHtmlFile events from Ark.
 * It displays HTML files in webview panels based on the destination parameter.
 */
export class HtmlViewer implements vscode.Disposable {
    private readonly panels = new Map<string, vscode.WebviewPanel>();
    private readonly outputChannel = vscode.window.createOutputChannel('Ark HTML Viewer');

    public async showHtmlFile(params: ShowHtmlFileParams): Promise<void> {
        const { path: filePath, title, destination, height } = params;

        // Validate file exists
        if (!fs.existsSync(filePath)) {
            this.outputChannel.appendLine(`HTML file not found: ${filePath}`);
            void vscode.window.showErrorMessage(`HTML file not found: ${filePath}`);
            return;
        }

        switch (destination) {
            case 'viewer':
                await this.showInViewer(filePath, title, height);
                break;
            case 'plot':
                await this.showInPlotPane(filePath, title, height);
                break;
            case 'editor':
                await this.openInEditor(filePath);
                break;
            default:
                this.outputChannel.appendLine(`Unknown destination: ${destination}, defaulting to viewer`);
                await this.showInViewer(filePath, title, height);
        }
    }

    private async showInViewer(filePath: string, title: string, height: number): Promise<void> {
        const viewColumn = this.getViewColumn();
        const panel = this.getOrCreatePanel('viewer', title || 'HTML Viewer', viewColumn);
        
        await this.loadHtmlIntoPanel(panel, filePath, title, height);
        panel.reveal(viewColumn, true);
    }

    private async showInPlotPane(filePath: string, title: string, height: number): Promise<void> {
        // Plot pane uses the same view column as plots
        const configured = util.config().get<string>('krarkode.plot.viewColumn');
        if (configured === 'Disable') {
            return;
        }

        const viewColumn = this.asViewColumn(configured, vscode.ViewColumn.Two);
        const panel = this.getOrCreatePanel('plot', title || 'Plot', viewColumn);
        
        await this.loadHtmlIntoPanel(panel, filePath, title, height);
        panel.reveal(viewColumn, true);
    }

    private async openInEditor(filePath: string): Promise<void> {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    private async loadHtmlIntoPanel(
        panel: vscode.WebviewPanel,
        filePath: string,
        title: string,
        _height: number
    ): Promise<void> {
        try {
            let htmlContent = await fs.promises.readFile(filePath, 'utf8');
            
            // Get the directory of the HTML file for resource loading
            const baseDir = path.dirname(filePath);
            const baseUri = panel.webview.asWebviewUri(vscode.Uri.file(baseDir));
            
            // Inject base tag to resolve relative paths
            // Also add CSP meta tag for security
            const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data: file: https:; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline' ${panel.webview.cspSource}; font-src ${panel.webview.cspSource} data:;">`;
            const baseTag = `<base href="${baseUri}/">`;
            
            // Insert base and csp tags into head
            if (htmlContent.includes('<head>')) {
                htmlContent = htmlContent.replace('<head>', `<head>\n${cspMeta}\n${baseTag}`);
            } else if (htmlContent.includes('<html>')) {
                htmlContent = htmlContent.replace('<html>', `<html>\n<head>${cspMeta}\n${baseTag}</head>`);
            } else {
                htmlContent = `<!DOCTYPE html><html><head>${cspMeta}\n${baseTag}</head><body>${htmlContent}</body></html>`;
            }
            
            panel.webview.html = htmlContent;
            
            if (title) {
                panel.title = title;
            }
        } catch (err) {
            this.outputChannel.appendLine(`Failed to load HTML file: ${filePath}, error: ${String(err)}`);
            panel.webview.html = `<html><body><p>Failed to load HTML file: ${filePath}</p><p>${String(err)}</p></body></html>`;
        }
    }

    private getOrCreatePanel(type: string, title: string, viewColumn: vscode.ViewColumn): vscode.WebviewPanel {
        const panelKey = `${type}:${title}`;
        const existing = this.panels.get(panelKey);
        if (existing) {
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            `arkHtml${type}`,
            title,
            {
                preserveFocus: true,
                viewColumn,
            },
            {
                enableScripts: true,
                enableFindWidget: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file('/')], // Allow loading from any local path
            }
        );

        panel.onDidDispose(() => {
            this.panels.delete(panelKey);
        });

        this.panels.set(panelKey, panel);
        return panel;
    }

    private getViewColumn(): vscode.ViewColumn {
        const configured = util.config().get<string>('krarkode.html.viewColumn');
        return this.asViewColumn(configured, vscode.ViewColumn.Two);
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

    dispose(): void {
        for (const panel of this.panels.values()) {
            panel.dispose();
        }
        this.panels.clear();
        this.outputChannel.dispose();
    }
}
