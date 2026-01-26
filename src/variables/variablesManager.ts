import * as vscode from 'vscode';
import { VariablesService } from './variablesService';
import { VariablesEvent } from './protocol';
import { getNonce } from '../util';

export class VariablesManager implements vscode.WebviewViewProvider {
    public static readonly viewType = 'krarkodeVariables';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _service: VariablesService,
    ) {
        _service.onDidReceiveUpdate((e) => this.updateView(e));
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((data) => {
            switch (data.type) {
                case 'ready':
                    this.updateView({
                        method: 'connection',
                        params: { connected: this._service.isConnected() },
                    });
                    this._service.refresh();
                    break;
                case 'view':
                    this._service.view(data.path);
                    break;
                case 'inspect':
                    this._service.inspect(data.path);
                    break;
                case 'refresh':
                    this._service.refresh();
                    break;
            }
        });

        // Initial state is sent when the webview signals ready.
    }

    private updateView(event: VariablesEvent) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'update', event });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Load webview assets from dist
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'html', 'variables', 'variables.js'),
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'html', 'variables', 'variables.css'),
        );

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
                <div id="error-banner" class="error-banner hidden"></div>
                <div id="variables-list"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
