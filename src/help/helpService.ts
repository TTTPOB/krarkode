import * as vscode from 'vscode';
import { HelpEntry, createHelpEntry } from './helpEntry';
import { MAX_HISTORY_ENTRIES } from './helpIds';

export interface IHelpEntry {
    sourceUrl: string;
    title?: string;
}

export interface IKrarkodeHelpService {
    readonly helpEntries: IHelpEntry[];
    readonly currentHelpEntry?: IHelpEntry;
    readonly canGoBack: boolean;
    readonly canGoForward: boolean;
    
    showHelpTopic(topic: string): Promise<boolean>;
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
        private readonly webviewService: vscode.WebviewViewProvider,
        private readonly extensionUri: vscode.Uri
    ) {}

    public get helpEntries(): IHelpEntry[] {
        return this.helpEntriesStack;
    }

    public get currentHelpEntry(): IHelpEntry | undefined {
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
        // Placeholder - will be implemented with help client
        vscode.window.showInformationMessage(`Help topic: ${topic}`);
        return false;
    }

    public showWelcomePage(): void {
        // Placeholder - will be implemented with welcome page
        const welcomeEntry = createHelpEntry(
            '',
            'Welcome to Krarkode Help',
            this.extensionUri,
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
