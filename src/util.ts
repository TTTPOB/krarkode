import { homedir, tmpdir } from 'os';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { getExtensionContext } from './context';
import { getLogger } from './logging/logger';

export interface SpawnResult {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
}

export function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration();
}

export { isDebugLoggingEnabled } from './logging/logger';

export function logDebug(message: string): void {
    getLogger().debug('ark', 'core', message);
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

function getRfromEnvPath(platform: string): string {
    let splitChar = ':';
    let fileExtension = '';

    if (platform === 'win32') {
        splitChar = ';';
        fileExtension = '.exe';
    }

    const osPaths: string[] = process.env.PATH ? process.env.PATH.split(splitChar) : [];
    for (const osPath of osPaths) {
        const osRPath: string = path.join(osPath, 'R' + fileExtension);
        if (fs.existsSync(osRPath)) {
            return osRPath;
        }
    }
    return '';
}

async function getRpathFromSystem(): Promise<string> {
    let rpath = '';
    const platform: string = process.platform;

    rpath ||= getRfromEnvPath(platform);

    if (!rpath && platform === 'win32') {
        try {
            const regKey = require('winreg');
            const key = new regKey({
                hive: regKey.HKLM,
                key: '\\Software\\R-Core\\R',
            });
            const item = await new Promise((resolve, reject) =>
                key.get('InstallPath', (err: Error | null, result: { value: string }) => {
                    if (err === null) {
                        resolve(result);
                    } else {
                        reject(err);
                    }
                })
            );
            rpath = path.join((item as { value: string }).value, 'bin', 'R.exe');
        } catch (e) {
            rpath = '';
        }
    }

    return rpath;
}

export async function getRBinaryPath(quote = false): Promise<string | undefined> {
    let rpath: string | undefined = '';

    const config = vscode.workspace.getConfiguration('krarkode.r');

    rpath = config.get<string>('rBinaryPath');
    rpath &&= substituteVariables(rpath);

    rpath ||= await getRpathFromSystem();

    rpath ||= undefined;

    if (!rpath) {
        void vscode.window.showErrorMessage(`Cannot find R to use for Ark kernel. Change setting krarkode.r.rBinaryPath to R path.`);
    } else if (quote && /^[^'"].* .*[^'"]$/.exec(rpath)) {
        rpath = `"${rpath}"`;
    } else if (!quote) {
        rpath = rpath.replace(/^"(.*)"$/, '$1');
        rpath = rpath.replace(/^'(.*)'$/, '$1');
    } else if (process.platform === 'win32' && /^'.* .*'$/.exec(rpath)) {
        rpath = rpath.replace(/^'(.*)'$/, '"$1"');
    }

    return rpath;
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

function getSidecarTarget(): string | undefined {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'win32' && arch === 'x64') {
        return 'win32-x64';
    }
    if (platform === 'linux' && arch === 'x64') {
        return 'linux-x64';
    }
    if (platform === 'linux' && arch === 'arm64') {
        return 'linux-arm64';
    }
    if (platform === 'darwin' && arch === 'x64') {
        return 'darwin-x64';
    }
    if (platform === 'darwin' && arch === 'arm64') {
        return 'darwin-arm64';
    }

    return undefined;
}

export function resolveSidecarPath(): string {
    const config = vscode.workspace.getConfiguration('krarkode.ark');
    const configured = config.get<string>('sidecarPath')?.trim();
    if (configured) {
        logDebug(`Using configured sidecar path: ${configured}`);
        return configured;
    }

    const exeName = process.platform === 'win32' ? 'vscode-r-ark-sidecar.exe' : 'vscode-r-ark-sidecar';
    const context = getExtensionContext();

    const packagedTarget = getSidecarTarget();
    if (packagedTarget) {
        const packagedPath = context.asAbsolutePath(path.join('sidecar', packagedTarget, exeName));
        logDebug(`Checking packaged sidecar path: ${packagedPath}`);
        if (fs.existsSync(packagedPath)) {
            logDebug(`Using packaged sidecar path: ${packagedPath}`);
            return packagedPath;
        }
    } else {
        logDebug(`Unsupported sidecar platform: ${process.platform}-${process.arch}`);
    }

    const releasePath = context.asAbsolutePath(path.join('ark-sidecar', 'target', 'release', exeName));
    logDebug(`Checking release sidecar path: ${releasePath}`);
    if (fs.existsSync(releasePath)) {
        logDebug(`Using release sidecar path: ${releasePath}`);
        return releasePath;
    }

    const debugPath = context.asAbsolutePath(path.join('ark-sidecar', 'target', 'debug', exeName));
    logDebug(`Checking debug sidecar path: ${debugPath}`);
    if (fs.existsSync(debugPath)) {
        logDebug(`Using debug sidecar path: ${debugPath}`);
        return debugPath;
    }

    logDebug(`Falling back to sidecar name: ${exeName}`);
    return exeName;
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

/**
 * Get the temporary directory for the extension.
 * Creates it if it doesn't exist.
 */
export function getTempDir(): string {
    const extDir = getExtensionContext().globalStorageUri.fsPath;
    const tempDir = path.join(extDir, 'tmp');
    fs.mkdirSync(tempDir, { recursive: true });
    return tempDir;
}

/**
 * Create temporary directory. Will avoid name clashes. Caller must delete directory after use.
 *
 * @param root Parent folder.
 * @param hidden If set to true, directory will be prefixed with a '.' (ignored on windows).
 * @returns Path to the temporary directory.
 */
export function createTempDir(root: string, hidden?: boolean): string {
    const hidePrefix = (!hidden || process.platform === 'win32') ? '' : '.';
    let tempDir: string;
    while (fs.existsSync(tempDir = path.join(root, `${hidePrefix}___temp_${randomBytes(8).toString('hex')}`))) { /* Name clash */ }
    fs.mkdirSync(tempDir, { recursive: true });
    return tempDir;
}

export function getNonce(): string {
    return randomBytes(16).toString('hex');
}

/**
 * DisposableProcess type - a child process that can be disposed.
 */
export type DisposableProcess = cp.ChildProcessWithoutNullStreams & vscode.Disposable;

/**
 * Spawn a process that can be disposed.
 * 
 * @param command The command to run.
 * @param args Arguments for the command.
 * @param options Spawn options.
 * @param onDisposed Optional callback when the process is disposed.
 * @returns A DisposableProcess.
 */
export function spawn(
    command: string,
    args?: ReadonlyArray<string>,
    options?: cp.CommonOptions,
    onDisposed?: () => unknown
): DisposableProcess {
    const proc = cp.spawn(command, args, options) as DisposableProcess;
    logDebug(proc.pid ? `Process ${proc.pid} spawned` : 'Process failed to spawn');
    
    let running = true;
    const exitHandler = () => {
        running = false;
        logDebug(`Process ${proc.pid || ''} exited`);
    };
    proc.on('exit', exitHandler);
    proc.on('error', exitHandler);
    
    proc.dispose = () => {
        if (running) {
            logDebug(`Process ${proc.pid || ''} terminating`);
            if (process.platform === 'win32') {
                if (proc.pid !== undefined) {
                    cp.spawnSync('taskkill', ['/pid', proc.pid.toString(), '/f', '/t']);
                }
            } else {
                proc.kill('SIGKILL');
            }
        }
        if (onDisposed) {
            onDisposed();
        }
    };
    
    return proc;
}
