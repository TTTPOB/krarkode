import { homedir } from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cp from 'child_process';

export interface SpawnResult {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
}

export function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration();
}

function substituteVariable(str: string, key: string, getValue: () => string | undefined) {
    if (str.includes(key)) {
        const value = getValue();
        if (value) {
            return str.replaceAll(key, value);
        }
    }
    return str;
}

export function substituteVariables(str: string): string {
    let result = str;
    if (str.includes('${')) {
        result = substituteVariable(result, '${userHome}', () => homedir());
        result = substituteVariable(result, '${workspaceFolder}', () => getCurrentWorkspaceFolder()?.uri.fsPath);
        result = substituteVariable(result, '${fileWorkspaceFolder}', () => getActiveFileWorkspaceFolder()?.uri.fsPath);
        result = substituteVariable(result, '${fileDirname}', () => {
            const activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
            if (activeFilePath) {
                return path.dirname(activeFilePath);
            }
        });
    }
    return result;
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function spawnAsync(command: string, args: string[], options: cp.SpawnOptions = {}): Promise<SpawnResult> {
    return new Promise((resolve) => {
        const child = cp.spawn(command, args, { ...options, stdio: 'pipe' });
        let stdout = '';
        let stderr = '';

        if (child.stdout) {
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
        }

        child.on('error', (error) => {
            resolve({ status: null, stdout, stderr, error });
        });

        child.on('close', (code) => {
            resolve({ status: code, stdout, stderr });
        });
    });
}

function getCurrentWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return undefined;
    }
    return workspaceFolders[0];
}

function getActiveFileWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (!activeDocument) {
        return undefined;
    }
    return vscode.workspace.getWorkspaceFolder(activeDocument.uri);
}
