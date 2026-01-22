import * as vscode from 'vscode';
import * as util from '../util';
import * as sessionRegistry from './sessionRegistry';
import type { ArkSessionEntry } from './sessionRegistry';

/**
 * Get selected text or word under cursor.
 */
export function getWordOrSelection(): string | undefined {
    const textEditor = vscode.window.activeTextEditor;
    if (!textEditor) {
        return undefined;
    }
    const selection = textEditor.selection;
    if (!selection.isEmpty) {
        return textEditor.document.getText(selection);
    }
    const range = textEditor.document.getWordRangeAtPosition(selection.active);
    if (range) {
        return textEditor.document.getText(range);
    }
    return undefined;
}

/**
 * Information about a selection for execution.
 */
export interface SelectionInfo {
    selectedText: string;
    linesDownToMoveCursor: number;
}

/**
 * Get the current selection info for execution.
 * If there's an active selection, return that text.
 * Otherwise, return the current line and move cursor to next line.
 */
export function getSelection(): SelectionInfo | undefined {
    const textEditor = vscode.window.activeTextEditor;
    if (!textEditor) {
        return undefined;
    }
    const selection = textEditor.selection;
    if (!selection.isEmpty) {
        return {
            selectedText: textEditor.document.getText(selection),
            linesDownToMoveCursor: 0,
        };
    }
    // Get the current line
    const line = textEditor.document.lineAt(selection.active.line);
    return {
        selectedText: line.text,
        linesDownToMoveCursor: 1,
    };
}

/**
 * Surround text with function calls.
 */
export function surroundSelection(text: string, functionNames: string[]): string {
    let result = text;
    for (const fn of functionNames) {
        result = `${fn}(${result})`;
    }
    return result;
}

/**
 * Convert a string to an R string literal.
 */
export function toRStringLiteral(value: string, quote: string = '"'): string {
    const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(new RegExp(quote, 'g'), `\\${quote}`)
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
    return `${quote}${escaped}${quote}`;
}

/**
 * Save document if it has unsaved changes.
 */
export async function saveDocument(doc: vscode.TextDocument): Promise<boolean> {
    if (doc.isDirty) {
        return await doc.save();
    }
    return true;
}

/**
 * CodeExecutor handles running R code in Ark sessions.
 * It sends code to the active terminal where the Ark/Jupyter console is running.
 */
export class CodeExecutor implements vscode.Disposable {
    private readonly outputChannel = vscode.window.createOutputChannel('Ark Code Execution');

    constructor() {}

    dispose(): void {
        this.outputChannel.dispose();
    }

    /**
     * Register code execution commands.
     */
    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('krarkode.runSelection', () => this.runSelection()),
            vscode.commands.registerCommand('krarkode.runSelectionRetainCursor', () => this.runSelectionRetainCursor()),
            vscode.commands.registerCommand('krarkode.runSource', () => this.runSource(false)),
            vscode.commands.registerCommand('krarkode.runSourceWithEcho', () => this.runSource(true)),
            vscode.commands.registerCommand('krarkode.runFromLineToEnd', () => this.runFromLineToEnd()),
            vscode.commands.registerCommand('krarkode.runFromBeginningToLine', () => this.runFromBeginningToLine()),
            vscode.commands.registerCommand('krarkode.nrow', () => this.runSelectionOrWord(['nrow'])),
            vscode.commands.registerCommand('krarkode.length', () => this.runSelectionOrWord(['length'])),
            vscode.commands.registerCommand('krarkode.head', () => this.runSelectionOrWord(['head'])),
            vscode.commands.registerCommand('krarkode.thead', () => this.runSelectionOrWord(['t', 'head'])),
            vscode.commands.registerCommand('krarkode.names', () => this.runSelectionOrWord(['names'])),
            vscode.commands.registerCommand('krarkode.view', () => this.runSelectionOrWord(['View'])),
            vscode.commands.registerCommand('krarkode.runCommand', (command: string) => this.runCommand(command)),
            vscode.commands.registerCommand('krarkode.runCommandWithSelectionOrWord', (command: string) => this.runCommandWithSelectionOrWord(command)),
            vscode.commands.registerCommand('krarkode.runCommandWithEditorPath', (command: string) => this.runCommandWithEditorPath(command)),
        );
    }

    /**
     * Run selected text or current line, then move cursor to next line.
     */
    public async runSelection(): Promise<void> {
        await this.runSelectionInArk(true);
    }

    /**
     * Run selected text or current line, keep cursor position.
     */
    public async runSelectionRetainCursor(): Promise<void> {
        await this.runSelectionInArk(false);
    }

    /**
     * Run selected text wrapped with function calls.
     */
    public async runSelectionOrWord(functionNames: string[]): Promise<void> {
        const text = getWordOrSelection();
        if (!text) {
            return;
        }
        const wrappedText = surroundSelection(text, functionNames);
        await this.runTextInArk(wrappedText);
    }

    /**
     * Source the active file.
     */
    public async runSource(echo: boolean): Promise<void> {
        const wad = vscode.window.activeTextEditor?.document;
        if (!wad) {
            return;
        }
        const isSaved = await saveDocument(wad);
        if (!isSaved) {
            return;
        }
        const rPath = toRStringLiteral(wad.fileName, '"');
        let encodingParam = util.config().get<string>('krarkode.source.encoding');
        if (encodingParam === undefined) {
            encodingParam = 'UTF-8';
        }
        const params = [`${rPath}`, `encoding = "${encodingParam}"`];
        const echoParam = util.config().get<boolean>('krarkode.source.echo');
        if (echoParam || echo) {
            params.push('echo = TRUE');
        }
        await this.runTextInArk(`source(${params.join(', ')})`);
    }

    /**
     * Run from the beginning of the file to the current line.
     */
    public async runFromBeginningToLine(): Promise<void> {
        const textEditor = vscode.window.activeTextEditor;
        if (!textEditor) {
            return;
        }
        const endLine = textEditor.selection.end.line;
        const charactersOnLine = textEditor.document.lineAt(endLine).text.length;
        const endPos = new vscode.Position(endLine, charactersOnLine);
        const range = new vscode.Range(new vscode.Position(0, 0), endPos);
        const text = textEditor.document.getText(range);
        if (text === undefined) {
            return;
        }
        await this.runTextInArk(text);
    }

    /**
     * Run from the current line to the end of the file.
     */
    public async runFromLineToEnd(): Promise<void> {
        const textEditor = vscode.window.activeTextEditor;
        if (!textEditor) {
            return;
        }
        const startLine = textEditor.selection.start.line;
        const startPos = new vscode.Position(startLine, 0);
        const endLine = textEditor.document.lineCount;
        const range = new vscode.Range(startPos, new vscode.Position(endLine, 0));
        const text = textEditor.document.getText(range);
        await this.runTextInArk(text);
    }

    /**
     * Run custom command replacing $$ with selection/word.
     */
    public async runCommandWithSelectionOrWord(rCommand: string): Promise<void> {
        const text = getWordOrSelection();
        if (!text) {
            return;
        }
        const call = rCommand.replace(/\$\$/g, text);
        await this.runTextInArk(call);
    }

    /**
     * Run custom command replacing $$ with active file path.
     */
    public async runCommandWithEditorPath(rCommand: string): Promise<void> {
        const textEditor = vscode.window.activeTextEditor;
        if (!textEditor) {
            return;
        }
        const wad: vscode.TextDocument = textEditor.document;
        const isSaved = await saveDocument(wad);
        if (isSaved) {
            const rPath = toRStringLiteral(wad.fileName, '');
            const call = rCommand.replace(/\$\$/g, rPath);
            await this.runTextInArk(call);
        }
    }

    /**
     * Run arbitrary R command.
     */
    public async runCommand(rCommand: string): Promise<void> {
        await this.runTextInArk(rCommand);
    }

    /**
     * Run selection with cursor movement handling.
     */
    private async runSelectionInArk(moveCursor: boolean): Promise<void> {
        const selectionInfo = getSelection();
        if (!selectionInfo) {
            return;
        }
        if (moveCursor && selectionInfo.linesDownToMoveCursor > 0) {
            const textEditor = vscode.window.activeTextEditor;
            if (!textEditor) {
                return;
            }
            const lineCount = textEditor.document.lineCount;
            if (selectionInfo.linesDownToMoveCursor + textEditor.selection.end.line === lineCount) {
                const endPos = new vscode.Position(lineCount, textEditor.document.lineAt(lineCount - 1).text.length);
                await textEditor.edit(e => e.insert(endPos, '\n'));
            }
            await vscode.commands.executeCommand('cursorMove', { to: 'down', value: selectionInfo.linesDownToMoveCursor });
            await vscode.commands.executeCommand('cursorMove', { to: 'wrappedLineFirstNonWhitespaceCharacter' });
        }
        await this.runTextInArk(selectionInfo.selectedText);
    }

    /**
     * Run text in the Ark session via the active terminal.
     */
    private async runTextInArk(text: string, execute: boolean = true): Promise<void> {
        const entry = await this.pickSessionForExecution();
        if (!entry) {
            return;
        }

        const terminal = this.getActiveTerminal();
        if (!terminal) {
            void vscode.window.showWarningMessage('未找到可用的终端，请先打开一个 Jupyter console。');
            return;
        }
        terminal.sendText(text, execute);

        sessionRegistry.updateSessionAttachment(entry.name, new Date().toISOString());
        sessionRegistry.setActiveSessionName(entry.name);
    }

    /**
     * Get active terminal.
     */
    private getActiveTerminal(): vscode.Terminal | undefined {
        return vscode.window.activeTerminal;
    }

    /**
     * Pick a session for code execution.
     */
    private async pickSessionForExecution(): Promise<ArkSessionEntry | undefined> {
        const registry = sessionRegistry.loadRegistry();
        if (registry.length === 0) {
            const choice = await vscode.window.showInformationMessage(
                'No Ark sessions found. Create one now?',
                'Create',
                'Cancel'
            );
            if (choice === 'Create') {
                await vscode.commands.executeCommand('krarkode.createArkSession');
            }
            return undefined;
        }

        const activeName = sessionRegistry.getActiveSessionName();
        if (activeName) {
            const entry = registry.find((item) => item.name === activeName);
            if (entry) {
                return entry;
            }
        }

        if (registry.length === 1) {
            return registry[0];
        }

        const selected = await vscode.window.showQuickPick(
            registry.map((entry) => ({
                label: entry.name,
                description: entry.tmuxSessionName ?? entry.mode,
            })),
            { placeHolder: 'Select Ark session to run code' }
        );
        if (!selected) {
            return undefined;
        }
        return registry.find((entry) => entry.name === selected.label);
    }
}
