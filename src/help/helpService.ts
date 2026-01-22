import * as vscode from 'vscode';
import { HelpEntry, createHelpEntry } from './helpEntry';
import { MAX_HISTORY_ENTRIES } from './helpIds';

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

export class HelpService implements IKrarkodeHelpService {
    private readonly helpEntriesStack: HelpEntry[] = [];
    private currentIndex = -1;
    
    private readonly _onDidChangeHelpEntry = new vscode.EventEmitter<void>();
    public readonly onDidChangeHelpEntry = this._onDidChangeHelpEntry.event;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly sendRpcRequest: (method: string, params: unknown) => void
    ) {}

    public get helpEntries(): HelpEntry[] {
        return this.helpEntriesStack;
    }

    public get currentHelpEntry(): HelpEntry | undefined {
        if (this.currentIndex >= 0 && this.currentIndex < this.helpEntriesStack.length) {
            return this.helpEntriesStack[this.currentIndex];
        }
        return undefined;
    }

    public get canGoBack(): boolean {
        return this.currentIndex > 0;
    }

    public get canGoForward(): boolean {
        return this.currentIndex < this.helpEntriesStack.length - 1;
    }

    public async showHelpTopic(topic: string): Promise<boolean> {
        this.sendRpcRequest('show_help_topic', { topic });
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
                // Fetch the content instead of just using the URL
                const response = await fetch(content);
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
        
        const entry = createHelpEntry(
            '',
            title,
            processedContent,
            processedKind,
            'help'
        );
        
        this.pushHelpEntry(entry);
        
        if (focus) {
            vscode.commands.executeCommand('krarkode.help.focus');
        }
    }

    private processHtml(html: string, originalUrl: string): string {
        // Base URL for relative links
        const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);
        const baseTag = `<base href="${baseUrl}">`;
        
        // CSS to match VS Code theme
        const themeStyle = `
            <style>
                body {
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    line-height: 1.6;
                    padding: 20px;
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

    public showWelcomePage(): void {
        const welcomeEntry = createHelpEntry(
            '',
            'Welcome to Krarkode Help',
            undefined,
            'html',
            'welcome'
        );
        this.pushHelpEntry(welcomeEntry);
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
    }

    public dispose(): void {
        this._onDidChangeHelpEntry.dispose();
    }
}
