import * as vscode from 'vscode';
import { HELP_VIEW_ID, HELP_VIEW_TITLE, COMMAND_HELP_GO_BACK, COMMAND_HELP_GO_FORWARD, COMMAND_HELP_GO_HOME, COMMAND_HELP_FIND } from './helpIds';
import { HelpService } from './helpService';

export class HelpViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = HELP_VIEW_ID;

    private view?: vscode.WebviewView;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly helpService: HelpService
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'html', 'help')],
        };

        webviewView.webview.html = this.getWebviewHtml();

        webviewView.webview.onDidReceiveMessage((message) => {
            this.handleMessage(message);
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.updateNavigationState();
            }
        });

        this.registerCommands();
    }

    private registerCommands(): void {
        this.disposables.push(
            vscode.commands.registerCommand(COMMAND_HELP_GO_BACK, () => {
                this.helpService.goBack();
                this.updateNavigationState();
            }),
            vscode.commands.registerCommand(COMMAND_HELP_GO_FORWARD, () => {
                this.helpService.goForward();
                this.updateNavigationState();
            }),
            vscode.commands.registerCommand(COMMAND_HELP_GO_HOME, () => {
                this.helpService.goHome();
                this.updateNavigationState();
            }),
            vscode.commands.registerCommand(COMMAND_HELP_FIND, () => {
                this.view?.webview.postMessage({ command: 'positron-help-find' });
            })
        );
    }

    private getWebviewHtml(): string {
        const welcomePath = vscode.Uri.joinPath(this.extensionUri, 'html', 'help', 'welcome.html');
        const nonce = this.generateNonce();

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${HELP_VIEW_TITLE}</title>
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-editorWidget-border);
            background-color: var(--vscode-editorWidget-background);
        }
        .toolbar button {
            background: none;
            border: 1px solid transparent;
            padding: 6px 10px;
            cursor: pointer;
            border-radius: 4px;
            color: var(--vscode-editor-foreground);
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .toolbar button:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        .toolbar button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .toolbar .separator {
            width: 1px;
            height: 20px;
            background-color: var(--vscode-editorWidget-border);
            margin: 0 4px;
        }
        .content {
            flex: 1;
            overflow: hidden;
            position: relative;
        }
        iframe {
            width: 100%;
            height: 100%;
            border: none;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button id="btn-back" title="Go Back" disabled>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" fill="none"/>
            </svg>
        </button>
        <button id="btn-forward" title="Go Forward" disabled>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" fill="none"/>
            </svg>
        </button>
        <button id="btn-home" title="Go Home">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2l6 5H9v8H6V9H2V7h4V2z"/>
            </svg>
        </button>
        <div class="separator"></div>
        <button id="btn-find" title="Find (Ctrl+F)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 5a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" opacity="0.5"/>
                <path d="M10 10l4 4" stroke="currentColor" stroke-width="1.5" fill="none"/>
            </svg>
        </button>
        <div style="flex:1"></div>
        <span id="status" style="font-size: 12px; opacity: 0.7;">Welcome</span>
    </div>
    <div class="content">
        <iframe id="help-frame" src="${welcomePath}" sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"></iframe>
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const iframe = document.getElementById('help-frame');
        const btnBack = document.getElementById('btn-back');
        const btnForward = document.getElementById('btn-forward');
        const btnHome = document.getElementById('btn-home');
        const btnFind = document.getElementById('btn-find');
        const status = document.getElementById('status');

        btnBack.addEventListener('click', () => {
            vscode.postMessage({ command: 'positron-help-back' });
        });

        btnForward.addEventListener('click', () => {
            vscode.postMessage({ command: 'positron-help-forward' });
        });

        btnHome.addEventListener('click', () => {
            vscode.postMessage({ command: 'positron-help-home' });
        });

        btnFind.addEventListener('click', () => {
            vscode.postMessage({ command: 'positron-help-find' });
        });

        iframe.addEventListener('load', () => {
            try {
                const title = iframe.contentDocument?.title || 'Help';
                status.textContent = title;
                vscode.postMessage({ command: 'positron-help-complete', title });
            } catch (e) {
                // Cross-origin restriction - can't access content
            }
        });

        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.command) {
                case 'update-navigation':
                    btnBack.disabled = !msg.canGoBack;
                    btnForward.disabled = !msg.canGoForward;
                    break;
                case 'navigate':
                    iframe.src = msg.url;
                    break;
                case 'positron-help-find':
                    iframe.contentWindow?.focus();
                    break;
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey || event.metaKey) {
                if (event.key === 'f') {
                    event.preventDefault();
                    btnFind.click();
                }
            }
        });
    </script>
</body>
</html>`;
    }

    private handleMessage(message: { command: string; title?: string; url?: string }): void {
        switch (message.command) {
            case 'positron-help-complete':
                if (this.view) {
                    this.view.title = message.title ?? HELP_VIEW_TITLE;
                }
                break;
            case 'positron-help-back':
                this.helpService.goBack();
                this.updateNavigationState();
                break;
            case 'positron-help-forward':
                this.helpService.goForward();
                this.updateNavigationState();
                break;
            case 'positron-help-home':
                this.helpService.goHome();
                this.updateNavigationState();
                break;
            case 'positron-help-navigate':
                if (message.url) {
                    this.view?.webview.postMessage({ command: 'navigate', url: message.url });
                }
                break;
        }
    }

    private updateNavigationState(): void {
        this.view?.webview.postMessage({
            command: 'update-navigation',
            canGoBack: this.helpService.canGoBack,
            canGoForward: this.helpService.canGoForward,
        });
    }

    private generateNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
    }
}
