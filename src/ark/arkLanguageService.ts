import * as cp from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as readline from 'readline';
import * as vscode from 'vscode';
import {
    CloseAction,
    ErrorAction,
    LanguageClient,
    LanguageClientOptions,
    RevealOutputChannelOn,
    StreamInfo,
} from 'vscode-languageclient/node';
import { getExtensionContext } from '../context';
import * as util from '../util';
import * as sessionRegistry from './sessionRegistry';
import type { ArkSessionEntry } from './sessionRegistry';

interface SidecarMessage {
    event?: string;
    port?: number;
    message?: string;
}

const DEFAULT_IP_ADDRESS = '127.0.0.1';
const DEFAULT_SIDECAR_TIMEOUT_MS = 15000;

export class ArkLanguageService implements vscode.Disposable {
    private client: LanguageClient | undefined;
    private sidecarProcess: cp.ChildProcessWithoutNullStreams | undefined;
    private connectionFile: string | undefined;
    private readonly outputChannel = vscode.window.createOutputChannel('Ark LSP');
    private activeSessionName: string | undefined;

    async startFromSession(entry: ArkSessionEntry | undefined): Promise<void> {
        this.activeSessionName = entry?.name;
        await this.restart(entry);
    }

    async restart(entry?: ArkSessionEntry): Promise<void> {
        await this.stopLanguageService();
        if (!entry) {
            return;
        }
        await this.startLanguageService(entry);
    }

    async restartActiveSession(): Promise<void> {
        if (this.activeSessionName) {
            await this.restart(sessionRegistry.findSession(this.activeSessionName));
            return;
        }
        await this.restart(sessionRegistry.getActiveSession());
    }

    dispose(): void {
        void this.stopLanguageService();
        this.outputChannel.dispose();
    }

    private async startLanguageService(entry: ArkSessionEntry): Promise<void> {
        const connectionFile = entry.connectionFilePath;
        if (!fs.existsSync(connectionFile)) {
            void vscode.window.showErrorMessage(`Ark connection file not found: ${connectionFile}`);
            return;
        }
        const alive = await this.checkConnectionFile(connectionFile);
        if (!alive) {
            void vscode.window.showWarningMessage('Ark connection file is not responding. Please restart the Ark session.');
            return;
        }

        this.connectionFile = connectionFile;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const selector = [{ language: 'r' }, { language: 'rmd' }];

        try {
            const port = await this.openArkLspComm(connectionFile);
            this.client = await this.createClient(port, selector, workspaceFolder);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            this.outputChannel.appendLine(`Ark LSP failed to start: ${message}`);
            void vscode.window.showErrorMessage(`Ark LSP failed to start: ${message}`);
            this.outputChannel.show();
            await this.stopLanguageService();
        }
    }

    private async openArkLspComm(connectionFile: string): Promise<number> {
        const ipAddress = (util.config().get<string>('ark.ipAddress') || DEFAULT_IP_ADDRESS).trim() || DEFAULT_IP_ADDRESS;
        const timeoutMs = util.config().get<number>('ark.lspTimeoutMs') ?? DEFAULT_SIDECAR_TIMEOUT_MS;
        const sidecarPath = this.resolveSidecarPath();
        const args = ['--connection-file', connectionFile, '--ip-address', ipAddress, '--timeout-ms', String(timeoutMs)];

        this.outputChannel.appendLine(`Starting Ark sidecar: ${sidecarPath}`);
        const sidecar = cp.spawn(sidecarPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        this.sidecarProcess = sidecar;
        sidecar.stderr?.on('data', (chunk: Buffer) => {
            this.outputChannel.appendLine(`[sidecar] ${chunk.toString().trim()}`);
        });

        return await this.waitForSidecarPort(sidecar, timeoutMs);
    }

    private async checkConnectionFile(connectionFile: string): Promise<boolean> {
        const sidecarPath = this.resolveSidecarPath();
        const timeoutMs = util.config().get<number>('ark.lspTimeoutMs') ?? DEFAULT_SIDECAR_TIMEOUT_MS;
        const args = ['--check', '--connection-file', connectionFile, '--timeout-ms', String(timeoutMs)];
        const result = await util.spawnAsync(sidecarPath, args, { env: process.env });
        if (result.error || result.status !== 0) {
            const message = result.stderr || result.stdout || result.error?.message || 'Unknown error';
            this.outputChannel.appendLine(`Ark connection check failed: ${message}`);
            return false;
        }
        return true;
    }

    private async waitForSidecarPort(proc: cp.ChildProcessWithoutNullStreams, timeoutMs: number): Promise<number> {
        return await new Promise((resolve, reject) => {
            let resolved = false;
            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    reject(new Error('Timed out waiting for Ark LSP port.'));
                }
            }, timeoutMs);

            const rl = readline.createInterface({ input: proc.stdout });
            const cleanup = () => {
                clearTimeout(timer);
                rl.close();
            };
            rl.on('line', (line) => {
                if (!line.trim()) {
                    return;
                }
                let msg: SidecarMessage | undefined;
                try {
                    msg = JSON.parse(line) as SidecarMessage;
                } catch {
                    this.outputChannel.appendLine(`[sidecar] ${line}`);
                    return;
                }

                if (msg?.event === 'lsp_port' && typeof msg.port === 'number') {
                    resolved = true;
                    cleanup();
                    resolve(msg.port);
                    return;
                }

                if (msg?.event === 'error') {
                    resolved = true;
                    cleanup();
                    reject(new Error(msg.message || 'Ark sidecar error'));
                }
            });

            proc.on('exit', (code) => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    reject(new Error(`Ark sidecar exited with code ${code ?? 'null'}`));
                }
            });

            proc.on('error', (err) => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    reject(err);
                }
            });
        });
    }

    private resolveSidecarPath(): string {
        const configured = (util.config().get<string>('ark.sidecarPath') || '').trim();
        if (configured) {
            return configured;
        }

        const exeName = process.platform === 'win32' ? 'vscode-r-ark-sidecar.exe' : 'vscode-r-ark-sidecar';
        const releasePath = getExtensionContext().asAbsolutePath(path.join('ark-sidecar', 'target', 'release', exeName));
        if (fs.existsSync(releasePath)) {
            return releasePath;
        }

        const debugPath = getExtensionContext().asAbsolutePath(path.join('ark-sidecar', 'target', 'debug', exeName));
        if (fs.existsSync(debugPath)) {
            return debugPath;
        }

        return exeName;
    }

    private async createClient(
        port: number,
        selector: vscode.DocumentFilter[],
        workspaceFolder: vscode.WorkspaceFolder | undefined
    ): Promise<LanguageClient> {
        const ipAddress = (util.config().get<string>('ark.ipAddress') || DEFAULT_IP_ADDRESS).trim() || DEFAULT_IP_ADDRESS;
        const tcpServerOptions = () => new Promise<StreamInfo>((resolve, reject) => {
            const socket = net.connect({ host: ipAddress, port }, () => {
                resolve({ reader: socket, writer: socket });
            });
            socket.on('error', (err: Error) => {
                reject(err);
            });
        });

        const clientOptions: LanguageClientOptions = {
            documentSelector: selector,
            workspaceFolder,
            outputChannel: this.outputChannel,
            synchronize: {
                configurationSection: 'ark.lsp',
                fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{R,r}'),
            },
            revealOutputChannelOn: RevealOutputChannelOn.Never,
            errorHandler: {
                error: () => ({ action: ErrorAction.Continue }),
                closed: () => ({ action: CloseAction.DoNotRestart }),
            },
        };

        const client = new LanguageClient('ark', 'Ark Language Server', tcpServerOptions, clientOptions);
        await client.start();
        return client;
    }

    private async stopLanguageService(): Promise<void> {
        const promises: Promise<void>[] = [];
        if (this.client) {
            promises.push(this.client.stop());
            this.client = undefined;
        }

        if (this.sidecarProcess && !this.sidecarProcess.killed) {
            this.sidecarProcess.kill('SIGKILL');
        }
        this.sidecarProcess = undefined;
        this.connectionFile = undefined;

        await Promise.allSettled(promises);
    }
}
