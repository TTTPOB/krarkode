import * as vscode from 'vscode';
import { setExtensionContext } from './context';
import { ArkSessionManager } from './ark/sessionManager';
import { ArkLanguageService } from './ark/arkLanguageService';
import * as util from './util';
import * as sessionRegistry from './ark/sessionRegistry';

let sessionManager: ArkSessionManager | undefined;
let languageService: ArkLanguageService | undefined;

export function activate(context: vscode.ExtensionContext): void {
    setExtensionContext(context);
    sessionManager = new ArkSessionManager();
    sessionManager.registerCommands(context);
    if (util.config().get<boolean>('ark.lsp.enabled') ?? true) {
        languageService = new ArkLanguageService();
        sessionManager.setActiveSessionHandler((entry) => {
            void languageService?.startFromSession(entry);
        });
        void languageService.startFromSession(sessionRegistry.getActiveSession());
        context.subscriptions.push(
            vscode.commands.registerCommand('ark.restartLanguageServer', () => {
                if (!languageService) {
                    void vscode.window.showErrorMessage('Ark language server is not running.');
                    return;
                }
                void languageService.restartActiveSession();
            })
        );
        context.subscriptions.push(languageService);
    }
    context.subscriptions.push(sessionManager);
}

export function deactivate(): void {
    languageService?.dispose();
    languageService = undefined;
    sessionManager?.dispose();
    sessionManager = undefined;
}
