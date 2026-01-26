import * as vscode from 'vscode';
import {
    HELP_VIEW_TITLE,
    COMMAND_HELP_GO_BACK,
    COMMAND_HELP_GO_FORWARD,
    COMMAND_HELP_GO_HOME,
    COMMAND_HELP_FIND,
} from './helpIds';
import { HelpService } from './helpService';
import * as util from '../util';
import { getLogger, LogCategory, logWebviewMessage } from '../logging/logger';

export class HelpManager implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private readonly disposables: vscode.Disposable[] = [];
    private isFirstLoad = true;
    private readonly outputChannel = getLogger().createChannel('ark', LogCategory.Help);

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly helpService: HelpService,
    ) {
        this.disposables.push(
            this.helpService.onDidChangeHelpEntry(() => {
                if (this.panel && this.panel.visible) {
                    this.updateNavigationState();
                    this.updateContent();
                } else if (this.panel) {
                    // Content changed but panel hidden/background?
                    // Usually we might want to reveal it if it's a new request
                    // But let's leave that policy to the caller or service
                }
            }),
        );

        this.registerCommands();
    }

    public showHelp(focus: boolean = true): void {
        const viewColumn = this.getViewColumn();

        if (this.panel) {
            this.panel.reveal(viewColumn, focus);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'krarkode.help',
                HELP_VIEW_TITLE,
                { viewColumn, preserveFocus: !focus },
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    enableFindWidget: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this.extensionUri, 'dist', 'html', 'help'),
                        vscode.Uri.joinPath(this.extensionUri, 'resources'),
                    ],
                },
            );

            this.panel.onDidDispose(
                () => {
                    this.panel = undefined;
                    this.isFirstLoad = true;
                },
                null,
                this.disposables,
            );

            this.panel.webview.onDidReceiveMessage(
                (message) => {
                    this.handleMessage(message);
                },
                null,
                this.disposables,
            );

            this.panel.webview.html = this.getWebviewHtml();
        }

        this.updateNavigationState();
        this.updateContent();
    }

    public showErrorBanner(message: string, detail?: string, focus: boolean = true): void {
        if (!this.panel) {
            this.showHelp(focus);
        }
        this.panel?.webview.postMessage({ command: 'show-error', message, detail });
    }

    public clearErrorBanner(): void {
        this.panel?.webview.postMessage({ command: 'clear-error' });
    }

    private getViewColumn(): vscode.ViewColumn {
        const configured = util.config().get<string>('krarkode.plot.viewColumn'); // Reuse plot column preference
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

    private updateContent(): void {
        const entry = this.helpService.currentHelpEntry;
        if (!entry || !this.panel) {
            return;
        }

        if (entry.entryType === 'welcome') {
            this.panel.webview.postMessage({
                command: 'show-welcome',
                title: entry.title,
            });
        } else if (entry.content) {
            this.panel.webview.postMessage({
                command: 'show-content',
                html: entry.content,
                title: entry.title,
                kind: entry.kind,
                scrollPosition: entry.scrollPosition,
            });
        }
    }

    private registerCommands(): void {
        this.disposables.push(
            vscode.commands.registerCommand(COMMAND_HELP_GO_BACK, () => {
                this.helpService.goBack();
            }),
            vscode.commands.registerCommand(COMMAND_HELP_GO_FORWARD, () => {
                this.helpService.goForward();
            }),
            vscode.commands.registerCommand(COMMAND_HELP_GO_HOME, () => {
                this.helpService.goHome();
            }),
            vscode.commands.registerCommand(COMMAND_HELP_FIND, () => {
                this.panel?.webview.postMessage({ command: 'positron-help-find' });
            }),
        );
    }

    private getWebviewHtml(): string {
        const extensionUri = this.extensionUri.toString();
        const nonce = this.generateNonce();
        // CSP needs to be updated dynamically or generic enough
        // Since we don't have the webview instance available in a static string context easily if we want to use webview.cspSource
        // But we have this.panel.webview.cspSource when we call this.
        const cspSource = this.panel?.webview.cspSource || '';

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data: https: http://127.0.0.1:*; frame-src http://127.0.0.1:*; base-uri http://127.0.0.1:*;">
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
        .error-banner {
            display: none;
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-inputValidation-errorBorder);
            background-color: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
            font-size: 12px;
        }
        .error-banner.visible {
            display: block;
        }
        .error-banner .error-detail {
            margin-top: 4px;
            opacity: 0.8;
        }
        .content {
            flex: 1;
            overflow: auto; /* Ensure scrollable */
            position: relative;
            background-color: var(--vscode-editor-background);
            padding: 0;
        }
        .welcome-content {
            height: 100%;
            overflow-y: auto;
            padding: 20px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
        }
        .welcome-content h1 {
            font-size: 1.5em;
            margin-bottom: 0.5em;
            color: var(--vscode-textLink-foreground);
        }
        .welcome-content p {
            color: var(--vscode-editor-foreground);
            max-width: 400px;
            margin-bottom: 1.5em;
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
        <span id="status" style="font-size: 12px; opacity: 0.7;">R Help</span>
    </div>
    <div id="error-banner" class="error-banner"></div>
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
            const errorBanner = document.getElementById('error-banner');

            function renderWelcomePage() {
                if (!contentDiv) return;
                contentDiv.innerHTML = \`
                    <div class="welcome-content">
                        <h1>R Help Viewer</h1>
                        <p>Search for functions or view R documentation.</p>
                        <p><em>Run R code or use "Look Up Help" to start.</em></p>
                    </div>
                \`;
                if (status) status.textContent = 'R Help';
            }

            function showErrorBanner(message, detail) {
                if (!errorBanner) return;
                errorBanner.innerHTML = '';
                const title = document.createElement('div');
                title.textContent = message;
                errorBanner.appendChild(title);
                if (detail) {
                    const detailEl = document.createElement('div');
                    detailEl.className = 'error-detail';
                    detailEl.textContent = detail;
                    errorBanner.appendChild(detailEl);
                }
                errorBanner.classList.add('visible');
            }

            function clearErrorBanner() {
                if (!errorBanner) return;
                errorBanner.innerHTML = '';
                errorBanner.classList.remove('visible');
            }

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

            // Global click handler to intercept links
            document.addEventListener('click', e => {
                const link = e.target.closest('a');
                if (link && link.href) {
                    e.preventDefault();
                    e.stopPropagation();
                    vscode.postMessage({ command: 'navigate-url', url: link.href });
                }
            });

            // Scroll handling
            let scrollTimeout;
            contentDiv.addEventListener('scroll', () => {
                if (scrollTimeout) clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    vscode.postMessage({ 
                        command: 'positron-help-scroll', 
                        scrollTop: contentDiv.scrollTop 
                    });
                }, 200);
            });

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
                            if (msg.kind === 'url') {
                                contentDiv.innerHTML = \`<iframe src="\${msg.html}" style="width: 100%; height: 100%; border: none;"></iframe>\`;
                            } else {
                                contentDiv.innerHTML = msg.html;
                            }
                            
                            if (typeof msg.scrollPosition === 'number') {
                                contentDiv.scrollTop = msg.scrollPosition;
                            } else {
                                contentDiv.scrollTop = 0;
                            }
                        }
                        if (status) status.textContent = msg.title || 'Help';
                        clearErrorBanner();
                        break;
                    case 'show-welcome':
                        renderWelcomePage();
                        if (status) status.textContent = msg.title || 'Welcome';
                        clearErrorBanner();
                        break;
                    case 'show-error':
                        showErrorBanner(msg.message || 'Help is unavailable.', msg.detail);
                        break;
                    case 'clear-error':
                        clearErrorBanner();
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
            vscode.postMessage({
                command: 'log',
                level: 'error',
                message: 'Error initializing help view',
                detail: e instanceof Error ? e.message : String(e),
            });
        }
    </script>
</body>
</html>`;
    }

    private handleMessage(message: {
        command: string;
        title?: string;
        url?: string;
        query?: string;
        scrollTop?: number;
        message?: string;
        detail?: string;
    }): void {
        switch (message.command) {
            case 'view-ready':
                if (this.isFirstLoad) {
                    this.isFirstLoad = false;
                }
                break;
            case 'positron-help-scroll':
                if (typeof message.scrollTop === 'number' && this.helpService.currentHelpEntry) {
                    this.helpService.currentHelpEntry.scrollPosition = message.scrollTop;
                }
                break;
            case 'positron-help-back':
                this.helpService.goBack();
                break;
            case 'positron-help-forward':
                this.helpService.goForward();
                break;
            case 'positron-help-home':
                this.helpService.goHome();
                break;
            case 'positron-help-navigate':
                if (message.url) {
                    this.panel?.webview.postMessage({ command: 'navigate', url: message.url });
                }
                break;
            case 'navigate-url':
                if (message.url) {
                    void this.helpService.loadUrl(message.url);
                }
                break;
            case 'search-help':
                if (message.query) {
                    void this.helpService.showHelpTopic(message.query);
                }
                break;
            case 'log': {
                const base = typeof message.message === 'string' ? message.message : 'Help webview log.';
                const detail = typeof message.detail === 'string' ? message.detail : undefined;
                logWebviewMessage('ark', LogCategory.Help, base, detail);
                break;
            }
        }
    }

    private updateNavigationState(): void {
        this.panel?.webview.postMessage({
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
        this.disposables.forEach((d) => d.dispose());
        this.disposables.length = 0;
        this.panel?.dispose();
        this.outputChannel.dispose();
    }
}
