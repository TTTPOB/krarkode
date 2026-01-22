import * as vscode from 'vscode';
import { setExtensionContext } from './context';
import { ArkSessionManager } from './ark/sessionManager';
import { ArkLanguageService } from './ark/arkLanguageService';
import { CodeExecutor } from './ark/codeExecutor';
import { ArkSidecarManager } from './ark/sidecarManager';
import { ArkCommBackend } from './ark/arkCommBackend';
import { HtmlViewer } from './ark/htmlViewer';
import { PlotManager } from './ark/plotManager';
import { HelpService } from './help/helpService';
import { HelpManager } from './help/helpManager';
import * as util from './util';
import type { ArkSessionEntry } from './ark/sessionRegistry';

let sessionManager: ArkSessionManager | undefined;
let languageService: ArkLanguageService | undefined;
let codeExecutor: CodeExecutor | undefined;
let sidecarManager: ArkSidecarManager | undefined;
let plotBackend: ArkCommBackend | undefined;
let htmlViewer: HtmlViewer | undefined;
let plotManager: PlotManager | undefined;
let helpService: HelpService | undefined;
let helpManager: HelpManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
    setExtensionContext(context);
    
    // Create sidecar manager for plot/comm watching
    sidecarManager = new ArkSidecarManager(
        () => util.resolveSidecarPath(),
        () => util.config().get<number>('krarkode.ark.sidecarTimeoutMs') ?? 30000
    );
    context.subscriptions.push(sidecarManager);
    
    // Create plot backend connected to sidecar
    plotBackend = new ArkCommBackend(sidecarManager);
    void plotBackend.connect();
    context.subscriptions.push(plotBackend);
    
    // Create HTML viewer for ShowHtmlFile events
    htmlViewer = new HtmlViewer();
    context.subscriptions.push(htmlViewer);
    
    // Create plot manager for display_data plots
    plotManager = new PlotManager(plotBackend);
    context.subscriptions.push(plotManager);
    
    // Connect sidecar events to HTML viewer
    context.subscriptions.push(
        sidecarManager.onDidShowHtmlFile((params) => {
            void htmlViewer?.showHtmlFile(params);
        })
    );
    
    // Connect sidecar plot data events to plot manager
    context.subscriptions.push(
        sidecarManager.onDidReceivePlotData((params) => {
            plotManager?.addPlot(params.base64Data, params.mimeType, params.displayId);
        })
    );
    
    // Register plot commands
    context.subscriptions.push(
        vscode.commands.registerCommand('krarkode.plot.previous', () => plotManager?.previousPlot()),
        vscode.commands.registerCommand('krarkode.plot.next', () => plotManager?.nextPlot()),
        vscode.commands.registerCommand('krarkode.plot.save', () => plotManager?.savePlot()),
        vscode.commands.registerCommand('krarkode.plot.openInBrowser', () => plotManager?.openInBrowser()),
        vscode.commands.registerCommand('krarkode.plot.clear', () => plotManager?.clearHistory())
    );
    
    sessionManager = new ArkSessionManager();
    sessionManager.registerCommands(context);
    
    // When active session changes, attach sidecar to connection file
    sessionManager.setActiveSessionHandler((entry: ArkSessionEntry | undefined) => {
        if (entry && sidecarManager) {
            sidecarManager.attach(entry.connectionFilePath);
        } else if (sidecarManager) {
            sidecarManager.stop();
        }

        // Restart LSP to pick up the new session (or fall back to background kernel)
        if (languageService) {
            void languageService.restart();
        }
    });
    
    codeExecutor = new CodeExecutor();
    codeExecutor.registerCommands(context);
    
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
    
    context.subscriptions.push(codeExecutor);
    context.subscriptions.push(sessionManager);
    
    // Track help comm ID
    let helpCommId: string | undefined;

    helpService = new HelpService(
        context.extensionUri,
        (method, params) => {
            if (helpCommId && sidecarManager) {
                sidecarManager.sendCommMessage(helpCommId, {
                    method,
                    params
                });
            } else {
                void vscode.window.showErrorMessage('Help communication channel not available.');
            }
        }
    );
    
    helpManager = new HelpManager(context.extensionUri, helpService);
    context.subscriptions.push(helpManager);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('krarkode.help.open', () => {
            helpManager?.showHelp(true);
        })
    );
    
    context.subscriptions.push(
        sidecarManager.onDidOpenHelpComm((e) => {
            helpCommId = e.commId;
            console.log(`Help comm opened: ${helpCommId}`);
        }),
        sidecarManager.onDidShowHelp((e) => {
            void helpService?.showHelpContent(e.content, e.kind, e.focus);
        })
    );
}

export function deactivate(): void {
    languageService?.dispose();
    languageService = undefined;
    codeExecutor?.dispose();
    codeExecutor = undefined;
    htmlViewer?.dispose();
    htmlViewer = undefined;
    plotManager?.dispose();
    plotManager = undefined;
    plotBackend?.dispose();
    plotBackend = undefined;
    sidecarManager?.dispose();
    sidecarManager = undefined;
    sessionManager?.dispose();
    sessionManager = undefined;
    helpManager?.dispose();
    helpManager = undefined;
    helpService?.dispose();
    helpService = undefined;
}
