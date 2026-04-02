import * as vscode from 'vscode';
import { getLogger, LogCategory } from './logging/logger';
import * as util from './util';

/**
 * Callbacks that ConfigurationWatcher dispatches to when
 * relevant configuration keys change.
 */
export interface ConfigurationWatcherDeps {
    enableLsp: () => void;
    disableLsp: () => void;
    isLspEnabled: () => boolean;
    restartLsp: () => void;
    setPlotMaxHistory: (value: number) => void;
    invalidateRBinaryCache: () => void;
}

// Keys whose change auto-restarts the LSP (debounced)
const LSP_RESTART_KEYS = [
    'krarkode.ark.sidecar.ipAddress',
    'krarkode.ark.lsp.timeoutMs',
];

// Keys that prompt the user to restart (with button)
const PROMPT_RESTART_KEYS = [
    'krarkode.r.binaryPath',
    'krarkode.ark.path',
    'krarkode.ark.sidecar.path',
];

// Keys that only take effect on next session creation
const NEXT_SESSION_KEYS = [
    'krarkode.ark.console.driver',
    'krarkode.ark.console.commandTemplate',
    'krarkode.ark.kernel.commandTemplate',
    'krarkode.ark.kernel.startupFileTemplate',
    'krarkode.ark.tmux.path',
    'krarkode.ark.tmux.manageKernel',
];

const RESTART_DEBOUNCE_MS = 1000;

export class ConfigurationWatcher implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private restartDebounceTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly deps: ConfigurationWatcherDeps) {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => this.handleChange(e)),
        );
        getLogger().debug('runtime', LogCategory.Config, 'Initialized');
    }

    private handleChange(event: vscode.ConfigurationChangeEvent): void {
        // Skip keys already handled by LoggerService / SidecarManager / ArkLanguageService
        // (logging.*, ark.logLevel are handled elsewhere)

        this.handleLspEnabled(event);
        this.handlePlotMaxHistory(event);
        this.handleRBinaryConfigKeys(event);
        this.handleLspRestartKeys(event);
        this.handlePromptRestartKeys(event);
        this.handleNextSessionKeys(event);
    }

    // --- Hot: dynamic LSP enable/disable ---

    private handleLspEnabled(event: vscode.ConfigurationChangeEvent): void {
        if (!event.affectsConfiguration('krarkode.ark.lsp.enabled')) {
            return;
        }
        const enabled = util.config().get<boolean>('krarkode.ark.lsp.enabled') ?? true;
        const currentlyEnabled = this.deps.isLspEnabled();

        if (enabled && !currentlyEnabled) {
            getLogger().log('runtime', LogCategory.Config, 'info',
                'LSP enabled by configuration change');
            this.deps.enableLsp();
        } else if (!enabled && currentlyEnabled) {
            getLogger().log('runtime', LogCategory.Config, 'info',
                'LSP disabled by configuration change');
            this.deps.disableLsp();
        }
    }

    // --- Hot: R binary cache invalidation ---

    private handleRBinaryConfigKeys(event: vscode.ConfigurationChangeEvent): void {
        if (event.affectsConfiguration('krarkode.r.binaryPath') ||
            event.affectsConfiguration('krarkode.pixi.manifestPath')) {
            getLogger().debug('runtime', LogCategory.Config,
                'R binary config changed, invalidating cache');
            this.deps.invalidateRBinaryCache();
        }
    }

    // --- Hot: plot max history ---

    private handlePlotMaxHistory(event: vscode.ConfigurationChangeEvent): void {
        if (!event.affectsConfiguration('krarkode.plot.maxHistory')) {
            return;
        }
        const value = util.config().get<number>('krarkode.plot.maxHistory') ?? 50;
        getLogger().debug('runtime', LogCategory.Config,
            `[ConfigurationWatcher] plot.maxHistory updated to ${value}`);
        this.deps.setPlotMaxHistory(value);
    }

    // --- Auto-restart: debounced LSP restart ---

    private handleLspRestartKeys(event: vscode.ConfigurationChangeEvent): void {
        const affected = LSP_RESTART_KEYS.some((key) => event.affectsConfiguration(key));
        if (!affected) {
            return;
        }
        getLogger().debug('runtime', LogCategory.Config,
            'LSP config changed, scheduling debounced restart');
        this.scheduleLspRestart();
    }

    private scheduleLspRestart(): void {
        if (this.restartDebounceTimer) {
            clearTimeout(this.restartDebounceTimer);
        }
        this.restartDebounceTimer = setTimeout(() => {
            this.restartDebounceTimer = undefined;
            if (this.deps.isLspEnabled()) {
                getLogger().log('runtime', LogCategory.Config, 'info',
                    'Restarting LSP to apply configuration changes');
                this.deps.restartLsp();
            }
        }, RESTART_DEBOUNCE_MS);
    }

    // --- Prompt restart: show message with button ---

    private handlePromptRestartKeys(event: vscode.ConfigurationChangeEvent): void {
        const affected = PROMPT_RESTART_KEYS.some((key) => event.affectsConfiguration(key));
        if (!affected) {
            return;
        }
        getLogger().debug('runtime', LogCategory.Config,
            'Path configuration changed, prompting user');
        void vscode.window
            .showInformationMessage(
                'Path configuration changed. Restart the language server to use the new path.',
                'Restart Language Server',
            )
            .then((selection) => {
                if (selection === 'Restart Language Server') {
                    this.deps.restartLsp();
                }
            });
    }

    // --- Info: next session ---

    private handleNextSessionKeys(event: vscode.ConfigurationChangeEvent): void {
        const affected = NEXT_SESSION_KEYS.some((key) => event.affectsConfiguration(key));
        if (!affected) {
            return;
        }
        getLogger().debug('runtime', LogCategory.Config,
            'Session-scoped configuration changed');
        void vscode.window.showInformationMessage(
            'This setting will take effect on the next Ark session.',
        );
    }

    dispose(): void {
        if (this.restartDebounceTimer) {
            clearTimeout(this.restartDebounceTimer);
            this.restartDebounceTimer = undefined;
        }
        this.disposables.forEach((d) => d.dispose());
        this.disposables.length = 0;
    }
}
