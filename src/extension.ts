import * as vscode from 'vscode';
import { setExtensionContext } from './context';
import { ArkSessionManager } from './ark/sessionManager';
import { ArkLanguageService } from './ark/arkLanguageService';
import * as util from './util';

let sessionManager: ArkSessionManager | undefined;
let languageService: ArkLanguageService | undefined;

export function activate(context: vscode.ExtensionContext): void {
    setExtensionContext(context);
    
    sessionManager = new ArkSessionManager();
    sessionManager.registerCommands(context);
    
    if (util.config().get<boolean>('krarkode.ark.lsp.enabled') ?? true) {
        // ArkLanguageService now auto-starts in constructor
        languageService = new ArkLanguageService();
        
        context.subscriptions.push(
            vscode.commands.registerCommand('krarkode.restartArkLanguageServer', () => {
                if (!languageService) {
                    void vscode.window.showErrorMessage('Ark language server is not running.');
                    return;
                }
                void languageService.restart();
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
