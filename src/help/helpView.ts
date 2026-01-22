import * as vscode from 'vscode';
import { HELP_VIEW_ID, HELP_VIEW_TITLE, COMMAND_HELP_GO_BACK, COMMAND_HELP_GO_FORWARD, COMMAND_HELP_GO_HOME, COMMAND_HELP_FIND } from './helpIds';
import { HelpService } from './helpService';

export class HelpViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = HELP_VIEW_ID;

    private view?: vscode.WebviewView;
    private readonly disposables: vscode.Disposable[] = [];
    private isFirstLoad = true;

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
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'html', 'help'),
                vscode.Uri.joinPath(this.extensionUri, 'resources'),
            ],
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
        const extensionUri = this.extensionUri.toString();
        const nonce = this.generateNonce();
        const cspSource = this.view?.webview.cspSource;

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data: https:;">
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
            overflow: hidden;
        }
        .toolbar {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 6px 10px;
            border-bottom: 1px solid var(--vscode-editorWidget-border);
            background-color: var(--vscode-editorWidget-background);
            flex-shrink: 0;
        }
        .toolbar button {
            background: none;
            border: 1px solid transparent;
            padding: 5px 8px;
            cursor: pointer;
            border-radius: 4px;
            color: var(--vscode-editor-foreground);
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 28px;
        }
        .toolbar button:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        .toolbar button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .toolbar button:disabled:hover {
            background: none;
        }
        .toolbar .separator {
            width: 1px;
            height: 16px;
            background-color: var(--vscode-editorWidget-border);
            margin: 0 4px;
        }
        .content {
            flex: 1;
            overflow: hidden;
            position: relative;
            background-color: var(--vscode-editor-background);
        }
        .welcome-content {
            height: 100%;
            overflow-y: auto;
            padding: 20px;
            box-sizing: border-box;
        }
        .welcome-content h1 {
            font-size: 1.8em;
            margin-bottom: 0.5em;
            color: var(--vscode-textLink-foreground);
        }
        .welcome-content h2 {
            font-size: 1.2em;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
            color: var(--vscode-editor-foreground);
        }
        .welcome-content p {
            color: var(--vscode-editor-foreground);
            line-height: 1.6;
        }
        .quick-links {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 10px;
            margin-top: 20px;
        }
        .quick-link {
            padding: 12px 16px;
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s;
        }
        .quick-link:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
            border-color: var(--vscode-textLink-foreground);
        }
        .quick-link h3 {
            margin: 0 0 4px 0;
            font-size: 0.95em;
            color: var(--vscode-textLink-foreground);
        }
        .quick-link p {
            margin: 0;
            font-size: 0.8em;
            color: var(--vscode-editorLineNumber-foreground);
        }
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--vscode-editorLineNumber-foreground);
        }
        .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid var(--vscode-editorWidget-border);
            border-top-color: var(--vscode-textLink-foreground);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-right: 10px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
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
                <path d="M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 5a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
                <path d="M10 10l4 4" stroke="currentColor" stroke-width="1.5" fill="none"/>
            </svg>
        </button>
        <div style="flex:1"></div>
        <span id="status" style="font-size: 12px; opacity: 0.7;">Welcome</span>
    </div>
    <div class="content" id="content">
        <div class="loading">
            <div class="spinner"></div>
            <span>Loading...</span>
        </div>
    </div>
    <script nonce="${nonce}">
        try {
            const vscode = acquireVsCodeApi();
            const contentDiv = document.getElementById('content');
            const btnBack = document.getElementById('btn-back');
            const btnForward = document.getElementById('btn-forward');
            const btnHome = document.getElementById('btn-home');
            const btnFind = document.getElementById('btn-find');
            const status = document.getElementById('status');

            const extensionUri = "${extensionUri}";

            function renderWelcomePage() {
                if (!contentDiv) return;
                contentDiv.innerHTML = \`
                    <div class="welcome-content">
                        <h1>Krarkode Help</h1>
                        <p>Welcome to the Krarkode Help Panel. Use the navigation buttons above or search for R function documentation.</p>
                        
                        <h2>Quick Actions</h2>
                        <div class="quick-links">
                            <div class="quick-link" onclick="executeCommand('krarkode.openArkConsole')">
                                <h3>New R Session</h3>
                                <p>Start a new Ark R session</p>
                            </div>
                            <div class="quick-link" onclick="executeCommand('krarkode.attachArkSession')">
                                <h3>Attach to Session</h3>
                                <p>Connect to an existing R session</p>
                            </div>
                            <div class="quick-link" onclick="searchHelp()">
                                <h3>Search Help</h3>
                                <p>Search R documentation</p>
                            </div>
                            <div class="quick-link" onclick="executeCommand('krarkode.plot.focus')">
                                <h3>Plot Viewer</h3>
                                <p>View and manage R plots</p>
                            </div>
                        </div>

                        <h2>Keyboard Shortcuts</h2>
                        <p><strong>Ctrl+Shift+H</strong> - Open Help Panel</p>
                        <p><strong>F1</strong> - Look up help at cursor</p>
                        <p><strong>Ctrl+Enter</strong> - Run selection/line in R file</p>

                        <h2>Getting Help</h2>
                        <p>To get help for an R function, place your cursor on the function name and press <strong>F1</strong>, or use the command palette to search for "Look Up Help at Cursor".</p>
                    </div>
                \`;
                if (status) status.textContent = 'Welcome';
            }

            // Expose functions to global scope for onclick handlers
            window.executeCommand = function(commandId) {
                vscode.postMessage({ command: 'execute-command', id: commandId });
            };

            window.searchHelp = function() {
                const query = prompt('Enter R function or topic to search for:');
                if (query && query.trim()) {
                    vscode.postMessage({ command: 'search-help', query: query.trim() });
                }
            };

            if (btnBack) {
                btnBack.addEventListener('click', () => {
                    vscode.postMessage({ command: 'positron-help-back' });
                });
            }

            if (btnForward) {
                btnForward.addEventListener('click', () => {
                    vscode.postMessage({ command: 'positron-help-forward' });
                });
            }

            if (btnHome) {
                btnHome.addEventListener('click', () => {
                    vscode.postMessage({ command: 'positron-help-home' });
                });
            }

            if (btnFind) {
                btnFind.addEventListener('click', () => {
                    vscode.postMessage({ command: 'positron-help-find' });
                });
            }

            window.addEventListener('message', (event) => {
                const msg = event.data;
                switch (msg.command) {
                    case 'update-navigation':
                        if (btnBack) btnBack.disabled = !msg.canGoBack;
                        if (btnForward) btnForward.disabled = !msg.canGoForward;
                        break;
                    case 'navigate':
                        if (status) status.textContent = msg.title || 'Loading...';
                        break;
                    case 'positron-help-find':
                        if (btnFind) btnFind.click();
                        break;
                    case 'show-content':
                        if (contentDiv) {
                            contentDiv.innerHTML = msg.html;
                            // Re-bind links if necessary, or assume default behavior
                        }
                        if (status) status.textContent = msg.title || 'Help';
                        break;
                }
            });

            document.addEventListener('keydown', (event) => {
                if (event.ctrlKey || event.metaKey) {
                    if (event.key === 'f') {
                        event.preventDefault();
                        if (btnFind) btnFind.click();
                    }
                }
            });

            // Initial load
            renderWelcomePage();
            vscode.postMessage({ command: 'view-ready' });
        
        } catch (e) {
            console.error('Error initializing help view:', e);
            const contentDiv = document.getElementById('content');
            if (contentDiv) {
                contentDiv.innerHTML = '<div style="color:red; padding: 20px;">Error initializing help view: ' + e.message + '</div>';
            }
        }
    </script>
</body>
</html>`;
    }

    private handleMessage(message: { command: string; title?: string; url?: string; query?: string }): void {
        switch (message.command) {
            case 'view-ready':
                if (this.isFirstLoad) {
                    this.isFirstLoad = false;
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
            case 'execute-command':
                if (message.url) {
                    vscode.commands.executeCommand(message.id);
                }
                break;
            case 'search-help':
                if (message.query) {
                    void this.helpService.showHelpTopic(message.query);
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
