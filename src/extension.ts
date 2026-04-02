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
import { VariablesService } from './variables/variablesService';
import { VariablesManager } from './variables/variablesManager';
import { DataExplorerManager } from './dataExplorer/dataExplorerManager';
import * as util from './util';
import type { ArkSessionEntry } from './ark/sessionRegistry';
import { getLogger, LogCategory } from './logging/logger';
import { runDoctor } from './doctor';
import { ConfigurationWatcher } from './configurationWatcher';
import { invalidateRBinaryCache } from './rBinaryResolver';

let sessionManager: ArkSessionManager | undefined;
let languageService: ArkLanguageService | undefined;
let codeExecutor: CodeExecutor | undefined;
let sidecarManager: ArkSidecarManager | undefined;
let plotBackend: ArkCommBackend | undefined;
let htmlViewer: HtmlViewer | undefined;
let plotManager: PlotManager | undefined;
let helpService: HelpService | undefined;
let helpManager: HelpManager | undefined;
let variablesService: VariablesService | undefined;
let variablesManager: VariablesManager | undefined;
let dataExplorerManager: DataExplorerManager | undefined;
let configurationWatcher: ConfigurationWatcher | undefined;
let activeSessionConnectionFile: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
    setExtensionContext(context);
    context.subscriptions.push(getLogger());

    // Create sidecar manager for plot/comm watching
    sidecarManager = new ArkSidecarManager(
        () => util.resolveSidecarPath(),
        () => util.config().get<number>('krarkode.ark.sidecar.timeoutMs') ?? 30000,
    );
    context.subscriptions.push(sidecarManager);

    // Create plot backend connected to sidecar
    plotBackend = new ArkCommBackend(sidecarManager);
    plotBackend.connect().catch((err) =>
        getLogger().log('runtime', LogCategory.Core, 'error', `Plot backend connection failed: ${err}`),
    );
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
        }),
    );

    // Connect sidecar plot data events to plot manager
    context.subscriptions.push(
        sidecarManager.onDidReceivePlotData((params) => {
            plotManager?.addPlot(params.base64Data, params.mimeType, params.displayId);
        }),
    );

    // Register plot commands
    context.subscriptions.push(
        vscode.commands.registerCommand('krarkode.plot.previous', () => plotManager?.previousPlot()),
        vscode.commands.registerCommand('krarkode.plot.next', () => plotManager?.nextPlot()),
        vscode.commands.registerCommand('krarkode.plot.save', () => plotManager?.savePlot()),
        vscode.commands.registerCommand('krarkode.plot.openInBrowser', () => plotManager?.openInBrowser()),
        vscode.commands.registerCommand('krarkode.plot.clear', () => plotManager?.clearHistory()),
    );

    // Variables Service & Manager must be created before setActiveSessionHandler,
    // because the handler may fire synchronously on registration if a session
    // is already active, and it needs variablesService to be available.
    variablesService = new VariablesService(sidecarManager);
    variablesManager = new VariablesManager(context.extensionUri, variablesService);
    context.subscriptions.push(variablesService);
    context.subscriptions.push(variablesManager);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(VariablesManager.viewType, variablesManager));

    sessionManager = new ArkSessionManager();
    sessionManager.registerCommands(context);

    // When active session changes, attach sidecar to connection file
    sessionManager.setActiveSessionHandler((entry: ArkSessionEntry | undefined) => {
        const nextConnectionFile = entry?.connectionFilePath;
        const connectionChanged = activeSessionConnectionFile !== nextConnectionFile;
        activeSessionConnectionFile = nextConnectionFile;
        if (connectionChanged) {
            const reason = entry ? 'session changed' : 'session cleared';
            sessionManager?.setKernelStatus(undefined);
            variablesService?.disconnect(reason);
            // Clear plot state from the previous session to prevent cross-session leakage
            plotBackend?.resetForNewSession(reason);
            plotManager?.clearHistory();
        }
        if (entry && sidecarManager) {
            sidecarManager.attach(entry.connectionFilePath);
            if (!connectionChanged && variablesService && !variablesService.isConnected()) {
                variablesService.refresh();
            }
        } else if (sidecarManager) {
            sidecarManager.stop();
        }

        // Restart LSP to pick up the new session (or fall back to background kernel)
        if (languageService && connectionChanged) {
            languageService.restart().catch((err) =>
                getLogger().log('runtime', LogCategory.Core, 'error', `LSP restart failed: ${err}`),
            );
        }
    });

    codeExecutor = new CodeExecutor(() => languageService?.getClient());
    codeExecutor.registerCommands(context);

    // Register restart command unconditionally; it checks languageService at call time
    context.subscriptions.push(
        vscode.commands.registerCommand('krarkode.restartArkLanguageServer', () => {
            if (!languageService) {
                void vscode.window.showErrorMessage('Ark language server is not running.');
                return;
            }
            languageService.restart().catch((err) =>
                getLogger().log('runtime', LogCategory.Core, 'error', `LSP restart failed: ${err}`),
            );
        }),
    );

    if (util.config().get<boolean>('krarkode.ark.lsp.enabled') ?? true) {
        languageService = new ArkLanguageService();
        // Not pushed to context.subscriptions — deactivate() handles disposal
    }

    // Centralized configuration change handler
    configurationWatcher = new ConfigurationWatcher({
        enableLsp: () => {
            if (languageService) {
                return;
            }
            languageService = new ArkLanguageService();
            getLogger().log('runtime', LogCategory.Core, 'info', 'LSP enabled by configuration change');
        },
        disableLsp: () => {
            if (!languageService) {
                return;
            }
            languageService.dispose();
            languageService = undefined;
            getLogger().log('runtime', LogCategory.Core, 'info', 'LSP disabled by configuration change');
        },
        isLspEnabled: () => !!languageService,
        restartLsp: () => {
            if (languageService) {
                languageService.restart().catch((err) =>
                    getLogger().log('runtime', LogCategory.Core, 'error', `LSP restart failed: ${err}`),
                );
            }
        },
        setPlotMaxHistory: (value: number) => {
            plotManager?.setMaxHistory(value);
        },
        invalidateRBinaryCache,
    });
    context.subscriptions.push(configurationWatcher);

    context.subscriptions.push(codeExecutor);
    context.subscriptions.push(sessionManager);

    context.subscriptions.push(
        vscode.commands.registerCommand('krarkode.doctor', () => runDoctor()),
    );

    context.subscriptions.push(
        sidecarManager.onDidChangeKernelStatus((status) => {
            sessionManager?.setKernelStatus(status);
        }),
    );

    // Track help comm ID
    let helpCommId: string | undefined;

    helpService = new HelpService(context.extensionUri, (request) => {
        if (helpCommId && sidecarManager) {
            sidecarManager.sendCommMessage(helpCommId, request);
        } else {
            const message = 'Help communication channel not available. Start or attach an Ark session.';
            helpManager?.showErrorBanner(message, 'Use "Krarkode: Create Ark Session" to start an R session.');
            void vscode.window
                .showErrorMessage(message, 'Create Ark Session', 'Open Sidecar Logs')
                .then((selection) => {
                    if (selection === 'Create Ark Session') {
                        void vscode.commands.executeCommand('krarkode.createArkSession');
                    } else if (selection === 'Open Sidecar Logs') {
                        getLogger().show('sidecar');
                    }
                });
        }
    });

    helpManager = new HelpManager(context.extensionUri, helpService);
    context.subscriptions.push(helpManager);

    context.subscriptions.push(
        vscode.commands.registerCommand('krarkode.help.open', () => {
            helpManager?.showHelp(true);
        }),
        vscode.commands.registerCommand('krarkode.help.showAtCursor', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const selection = editor.selection;
            let topic: string | undefined;
            if (!selection.isEmpty) {
                topic = editor.document.getText(selection).trim();
            } else {
                const wordRange = editor.document.getWordRangeAtPosition(selection.active);
                if (wordRange) {
                    topic = editor.document.getText(wordRange).trim();
                }
            }
            if (!topic) {
                void vscode.window.showWarningMessage('No word found at cursor position.');
                return;
            }
            util.logDebug(`Looking up help for topic: ${topic}`);
            helpManager?.showHelp(true);
            await helpService?.showHelpTopic(topic);
        }),
    );

    context.subscriptions.push(
        sidecarManager.onDidOpenHelpComm((e) => {
            helpCommId = e.commId;
            util.logDebug(`Help comm opened: ${helpCommId}`);
        }),
        sidecarManager.onDidShowHelp((e) => {
            void helpService?.showHelpContent(e.content, e.kind, e.focus);
        }),
    );

    // Variables Service & Manager are created earlier (before setActiveSessionHandler).

    dataExplorerManager = new DataExplorerManager(context.extensionUri, sidecarManager);
    context.subscriptions.push(dataExplorerManager);
    context.subscriptions.push(
        sidecarManager.onDidOpenDataExplorerComm((e) => {
            dataExplorerManager?.open(e.commId, e.data);
        }),
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
    dataExplorerManager?.dispose();
    dataExplorerManager = undefined;
    configurationWatcher?.dispose();
    configurationWatcher = undefined;
}
