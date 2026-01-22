import * as vscode from 'vscode';
import { COMMAND_OPEN_HELP, COMMAND_SHOW_HELP_AT_CURSOR } from './helpIds';
import { HelpService } from './helpService';

export function registerHelpCommands(
    context: vscode.ExtensionContext,
    helpService: HelpService
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    disposables.push(
        vscode.commands.registerCommand(COMMAND_OPEN_HELP, async () => {
            const view = vscode.window.createWebviewView(
                'krarkode.help',
                'Help',
                {
                    preserveFocus: true,
                },
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(context.extensionUri, 'html', 'help'),
                    ],
                }
            );

            const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'html', 'help', 'welcome.html');
            view.webview.html = getWebviewHtml(htmlPath.toString(), view.webview.cspSource);

            view.webview.onDidReceiveMessage((message) => {
                if (message.command === 'positron-help-complete') {
                    view.title = message.title ?? 'Help';
                }
            });

            await view.show();
        })
    );

    disposables.push(
        vscode.commands.registerCommand(COMMAND_SHOW_HELP_AT_CURSOR, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const selection = editor.document.getWordRangeAtPosition(
                editor.selection.active,
                /[a-zA-Z0-9_.]/
            );

            if (!selection) {
                return;
            }

            const word = editor.document.getText(selection);
            if (word) {
                await helpService.showHelpTopic(word);
            }
        })
    );

    disposables.push(
        vscode.commands.registerTextEditorCommand('krarkode.help.lookup', async (editor) => {
            const selection = editor.document.getWordRangeAtPosition(
                editor.selection.active,
                /[a-zA-Z0-9_.]/
            );

            if (!selection) {
                return;
            }

            const word = editor.document.getText(selection);
            if (word) {
                await helpService.showHelpTopic(word);
            }
        })
    );

    return disposables;
}

function getWebviewHtml(resourcePath: string, cspSource: string): string {
    const nonce = generateNonce();

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Help</title>
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        }
        iframe {
            width: 100%;
            height: 100vh;
            border: none;
        }
    </style>
</head>
<body>
    <iframe src="${resourcePath}"></iframe>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        window.addEventListener('load', () => {
            vscode.postMessage({ command: 'positron-help-complete', title: document.title });
        });

        document.addEventListener('click', (event) => {
            const target = event.target.closest('a');
            if (target && target.href) {
                if (target.href.startsWith('http')) {
                    vscode.postMessage({ command: 'positron-help-navigate', url: target.href });
                    event.preventDefault();
                }
            }
        });
    </script>
</body>
</html>`;
}

function generateNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
