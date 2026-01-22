import * as vscode from 'vscode';
import { VariablesService } from './variablesService';
import { VariablesEvent } from './protocol';

export class VariablesManager implements vscode.WebviewViewProvider {
    public static readonly viewType = 'positronVariables';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _service: VariablesService
    ) {
        _service.onDidReceiveUpdate(e => this.updateView(e));
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'view':
                    this._service.view(data.path);
                    break;
                case 'refresh':
                    this._service.refresh();
                    break;
            }
        });

        // Request initial refresh when view is visible
        this._service.refresh();
    }

    private updateView(event: VariablesEvent) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'update', event });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Use 'dist' as outDir per tsconfig.json
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'html', 'variables', 'variables.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'html', 'variables', 'variables.css'));

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <title>Variables</title>
            </head>
            <body>
                <div class="toolbar">
                    <div class="filter-container">
                        <input type="text" id="filter-input" placeholder="filter">
                    </div>
                </div>
                <div id="variables-list"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
