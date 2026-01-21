import * as vscode from 'vscode';
import { setExtensionContext } from './context';
import { ArkSessionManager } from './ark/sessionManager';

let sessionManager: ArkSessionManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
    setExtensionContext(context);
    sessionManager = new ArkSessionManager();
    sessionManager.registerCommands(context);
    context.subscriptions.push(sessionManager);
}

export function deactivate(): void {
    sessionManager?.dispose();
    sessionManager = undefined;
}
