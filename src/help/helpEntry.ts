import * as vscode from 'vscode';
import { HELP_WEBVIEW_CSP_SOURCE } from './helpIds';

export class HelpEntry {
    private readonly webview: vscode.Webview;
    private readonly viewId: string;
    private isVisible = false;

    constructor(
        public readonly sourceUrl: string,
        public readonly title: string | undefined,
        private readonly extensionUri: vscode.Uri,
        private readonly entryType: 'help' | 'welcome' = 'help'
    ) {
        const panel = vscode.window.createWebviewPanel(
            `help-${entryType}-${Date.now()}`,
            title ?? 'Help',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                enableFindWidget: true,
                disableServiceWorker: true,
                localResourceRoots: [extensionUri],
            }
        );
        
        this.webview = panel;
        this.viewId = panel.viewType;

        panel.webview.onDidReceiveMessage((message) => {
            this.handleWebviewMessage(message);
        });

        panel.onDidDispose(() => {
            this.isVisible = false;
        });
    }

    public show(targetElement?: HTMLElement): void {
        this.isVisible = true;
        
        if (this.entryType === 'welcome') {
            this.showWelcomePage();
        } else {
            this.showHelpPage();
        }
    }

    private showWelcomePage(): void {
        const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'html', 'help', 'welcome.html');
        this.webview.html = this.getWebviewContent(htmlPath.toString());
    }

    private showHelpPage(): void {
        const helpPath = vscode.Uri.joinPath(this.extensionUri, 'html', 'help', 'help.html');
        this.webview.html = this.getWebviewContent(helpPath.toString());
    }

    private getWebviewContent(resourcePath: string): string {
        const nonce = this.generateNonce();
        
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.title ?? 'Help'}</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        }
        iframe {
            width: 100%;
            height: 100%;
            border: none;
        }
    </style>
</head>
<body>
    <iframe 
        src="${resourcePath}"
        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
        allow="clipboard-read; clipboard-write"
    ></iframe>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.command === 'navigate') {
                window.location.href = message.url;
            }
        });

        window.addEventListener('load', () => {
            vscode.postMessage({ command: 'positron-help-complete', title: document.title });
        });

        document.addEventListener('click', (event) => {
            const target = event.target.closest('a');
            if (target && target.href) {
                if (target.href.startsWith('http')) {
                    // External link - let VSCode open it
                    vscode.postMessage({ command: 'positron-help-navigate', url: target.href });
                    event.preventDefault();
                }
            }
        });
    </script>
</body>
</html>`;
    }

    public hide(): void {
        this.isVisible = false;
    }

    public dispose(): void {
        this.webview.dispose();
    }

    private handleWebviewMessage(message: { command: string; url?: string; title?: string }): void {
        switch (message.command) {
            case 'positron-help-complete':
                console.log('Help content loaded:', message.title);
                break;
            case 'positron-help-navigate':
                if (message.url) {
                    console.log('Navigation to:', message.url);
                }
                break;
        }
    }

    private generateNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}

export function createHelpEntry(
    sourceUrl: string,
    title: string | undefined,
    extensionUri: vscode.Uri,
    entryType: 'help' | 'welcome' = 'help'
): HelpEntry {
    return new HelpEntry(sourceUrl, title, extensionUri, entryType);
}
