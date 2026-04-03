import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { HelpEntry, createHelpEntry } from './helpEntry';
import { MAX_HISTORY_ENTRIES } from './helpIds';
import { getActiveSessionName, getSessionDir } from '../ark/sessionRegistry';
import { getLogger, LogCategory } from '../logging/logger';

export interface IKrarkodeHelpService {
    readonly helpEntries: HelpEntry[];
    readonly currentHelpEntry?: HelpEntry;
    readonly canGoBack: boolean;
    readonly canGoForward: boolean;

    showHelpTopic(topic: string): Promise<boolean>;
    showHelpContent(content: string, kind: string, focus: boolean): Promise<void>;
    loadUrl(url: string): Promise<void>;
    showWelcomePage(): void;
    goBack(): void;
    goForward(): void;
    goHome(): void;
    find(): void;
}

export interface HelpRpcRequest {
    id: string;
    method: string;
    params?: unknown;
}

export class HelpService implements IKrarkodeHelpService {
    private readonly helpEntriesStack: HelpEntry[] = [];
    private currentIndex = -1;
    private baseUrl?: string;
    private sessionName: string | undefined;
    private saveTimeout?: NodeJS.Timeout;

    private readonly _onDidChangeHelpEntry = new vscode.EventEmitter<void>();
    public readonly onDidChangeHelpEntry = this._onDidChangeHelpEntry.event;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly sendRpcRequest: (request: HelpRpcRequest) => void,
    ) {
        // Load persisted help state for the current session
        this.sessionName = getActiveSessionName();
        this.loadHelpState();
    }

    public get helpEntries(): HelpEntry[] {
        return this.helpEntriesStack;
    }

    public get currentHelpEntry(): HelpEntry | undefined {
        if (this.currentIndex >= 0 && this.currentIndex < this.helpEntriesStack.length) {
            return this.helpEntriesStack[this.currentIndex];
        }
        return undefined;
    }

    public get hasEntries(): boolean {
        return this.helpEntriesStack.length > 0;
    }

    public get canGoBack(): boolean {
        return this.currentIndex > 0;
    }

    public get canGoForward(): boolean {
        return this.currentIndex < this.helpEntriesStack.length - 1;
    }

    public async showHelpTopic(topic: string): Promise<boolean> {
        this.sendRpcRequest({
            id: `help-${crypto.randomUUID()}`,
            method: 'show_help_topic',
            params: { topic },
        });
        return true;
    }

    public async showHelpContent(content: string, kind: string, focus: boolean): Promise<void> {
        let title = 'Help';
        let processedContent = content;
        let processedKind = kind;

        if (kind === 'html') {
            const titleMatch = content.match(/<title>(.*?)<\/title>/i);
            if (titleMatch) {
                title = titleMatch[1];
            }
        } else if (kind === 'url') {
            try {
                // Capture base URL from the first help URL we see
                if (!this.baseUrl) {
                    const urlObj = new URL(content);
                    // R help URLs are typically http://127.0.0.1:port/library/...
                    // Base URL is http://127.0.0.1:port
                    this.baseUrl = `${urlObj.protocol}//${urlObj.host}`;
                }

                // Fetch the content instead of just using the URL
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10_000);
                const response = await fetch(content, { signal: controller.signal }).finally(() =>
                    clearTimeout(timeoutId),
                );
                if (response.ok) {
                    const html = await response.text();
                    processedKind = 'html';

                    // Extract title
                    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
                    if (titleMatch) {
                        title = titleMatch[1];
                    } else {
                        // Fallback title from URL
                        const url = new URL(content);
                        const segments = url.pathname.split('/');
                        const lastSegment = segments[segments.length - 1];
                        if (lastSegment) {
                            title = decodeURIComponent(lastSegment.replace(/\.html$/, ''));
                        }
                    }

                    // Process HTML to inject base URL and styles
                    processedContent = this.processHtml(html, content);
                } else {
                    title = 'Error';
                    processedContent = `<h1>Error loading help</h1><p>Failed to fetch ${content}: ${response.statusText}</p>`;
                    processedKind = 'html';
                }
            } catch (err) {
                title = 'Error';
                processedContent = `<h1>Error loading help</h1><p>Failed to fetch ${content}: ${String(err)}</p>`;
                processedKind = 'html';
            }
        }

        const entry = createHelpEntry('', title, processedContent, processedKind, 'help');

        this.pushHelpEntry(entry);

        if (focus) {
            vscode.commands.executeCommand('krarkode.help.open');
        }
    }

    private processHtml(html: string, originalUrl: string): string {
        // Base URL for relative links
        const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);
        const baseTag = `<base href="${baseUrl}">`;

        // CSS to match VS Code theme
        const themeStyle = `
            <style>
                /* Reset body styles that might conflict with flex layout */
                body {
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    margin: 0;
                    padding: 0;
                }
                /* Apply padding to the content container instead */
                .content {
                    padding: 20px;
                    line-height: 1.6;
                }
                img {
                    max-width: 100%;
                    height: auto;
                }
                a {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: none;
                }
                a:hover {
                    color: var(--vscode-textLink-activeForeground);
                    text-decoration: underline;
                }
                h1, h2, h3, h4, h5, h6 {
                    color: var(--vscode-editor-foreground);
                    font-weight: 600;
                    margin-top: 1.5em;
                    margin-bottom: 0.5em;
                }
                h1 {
                    font-size: 1.8em;
                    border-bottom: 1px solid var(--vscode-editorWidget-border);
                    padding-bottom: 0.3em;
                }
                pre, code {
                    font-family: var(--vscode-editor-font-family);
                    background-color: var(--vscode-textCodeBlock-background);
                    border-radius: 3px;
                }
                pre {
                    padding: 10px;
                    overflow: auto;
                }
                code {
                    padding: 2px 4px;
                }
                table {
                    border-collapse: collapse;
                    width: 100%;
                    margin: 1em 0;
                }
                th, td {
                    text-align: left;
                    padding: 8px;
                    border-bottom: 1px solid var(--vscode-editorWidget-border);
                }
                th {
                    font-weight: 600;
                }
            </style>
        `;

        // Script to intercept clicks and handle navigation
        // Note: Scripts injected via innerHTML do not execute.
        // We handle click interception in the main webview script instead.

        // Inject into head or body
        let processed = html;
        if (processed.includes('<head>')) {
            processed = processed.replace('<head>', `<head>${baseTag}${themeStyle}`);
        } else {
            processed = `<head>${baseTag}${themeStyle}</head>${processed}`;
        }

        return processed;
    }

    public async loadUrl(url: string): Promise<void> {
        await this.showHelpContent(url, 'url', false);
    }

    public async showWelcomePage(): Promise<void> {
        if (this.baseUrl) {
            // If we have a base URL, show the R Help Index
            await this.loadUrl(`${this.baseUrl}/doc/html/index.html`);
        } else {
            // Otherwise show the static welcome page
            const welcomeEntry = createHelpEntry('', 'R Help', undefined, 'html', 'welcome');
            this.pushHelpEntry(welcomeEntry);
        }
    }

    public goBack(): void {
        if (this.canGoBack) {
            this.currentIndex--;
            this._onDidChangeHelpEntry.fire();
        }
    }

    public goForward(): void {
        if (this.canGoForward) {
            this.currentIndex++;
            this._onDidChangeHelpEntry.fire();
        }
    }

    public goHome(): void {
        this.showWelcomePage();
    }

    public find(): void {
        // Placeholder - will be implemented with webview find widget
    }

    private pushHelpEntry(entry: HelpEntry): void {
        // Remove any entries after current index
        if (this.currentIndex < this.helpEntriesStack.length - 1) {
            this.helpEntriesStack.splice(this.currentIndex + 1);
        }

        this.helpEntriesStack.push(entry);

        // Limit history size
        if (this.helpEntriesStack.length > MAX_HISTORY_ENTRIES) {
            this.helpEntriesStack.shift();
        } else {
            this.currentIndex++;
        }

        this._onDidChangeHelpEntry.fire();
        this.scheduleSaveHelpState();
    }

    /**
     * Switch to a different session's help state.
     * Saves current session state, loads new session state.
     */
    public switchSession(newSessionName: string | undefined): void {
        if (newSessionName && newSessionName === this.sessionName) {
            return;
        }
        // Save current session
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = undefined;
        }
        this.saveHelpStateSync();

        // Clear in-memory state
        this.helpEntriesStack.length = 0;
        this.currentIndex = -1;
        this.baseUrl = undefined;

        // Load new session
        this.sessionName = newSessionName;
        if (newSessionName) {
            this.loadHelpState();
        }

        this._onDidChangeHelpEntry.fire();
    }

    // -- Help state persistence --

    private getHelpStatePath(): string | undefined {
        if (!this.sessionName) {
            return undefined;
        }
        return path.join(getSessionDir(this.sessionName), 'help-state.json');
    }

    private loadHelpState(): void {
        const statePath = this.getHelpStatePath();
        if (!statePath) {
            return;
        }
        try {
            if (!fs.existsSync(statePath)) {
                return;
            }
            const content = fs.readFileSync(statePath, 'utf8');
            const data = JSON.parse(content) as {
                title?: string;
                content?: string;
                kind?: string;
                scrollPosition?: number;
            };
            if (data.content) {
                const entry = createHelpEntry('', data.title, data.content, data.kind ?? 'html', 'help');
                entry.scrollPosition = data.scrollPosition ?? 0;
                this.helpEntriesStack.push(entry);
                this.currentIndex = 0;
                getLogger().log('ui', LogCategory.Help, 'debug',
                    `Restored help state for session "${this.sessionName}": "${data.title}"`,
                );
            }
        } catch (err) {
            getLogger().log('ui', LogCategory.Help, 'warn', `Failed to load help state: ${String(err)}`);
        }
    }

    private scheduleSaveHelpState(): void {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            this.saveTimeout = undefined;
            this.saveHelpStateSync();
        }, 500);
    }

    private saveHelpStateSync(): void {
        const statePath = this.getHelpStatePath();
        if (!statePath) {
            return;
        }
        try {
            const entry = this.currentHelpEntry;
            if (!entry || entry.entryType === 'welcome' || !entry.content) {
                // Remove stale state file if nothing to save
                if (fs.existsSync(statePath)) {
                    fs.unlinkSync(statePath);
                }
                return;
            }
            const data = {
                title: entry.title,
                content: entry.content,
                kind: entry.kind,
                scrollPosition: entry.scrollPosition,
            };
            fs.writeFileSync(statePath, JSON.stringify(data));
        } catch (err) {
            getLogger().log('ui', LogCategory.Help, 'warn', `Failed to save help state: ${String(err)}`);
        }
    }

    public dispose(): void {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = undefined;
            this.saveHelpStateSync();
        }
        this._onDidChangeHelpEntry.dispose();
    }
}
