import * as cp from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import * as vscode from 'vscode';
import {
    CloseAction,
    DocumentFilter,
    ErrorAction,
    LanguageClient,
    LanguageClientOptions,
    RevealOutputChannelOn,
    StreamInfo,
    Trace,
} from 'vscode-languageclient/node';
import { getExtensionContext } from '../context';
import * as util from '../util';
import * as sessionRegistry from './sessionRegistry';
import { getLogChannelSetting, getLogger, type LogChannelId } from '../logging/logger';
import { formatArkRustLog, formatSidecarLogLevel, getArkLogLevel } from './arkLogLevel';

interface ConnectionInfo {
    shell_port: number;
    iopub_port: number;
    stdin_port: number;
    control_port: number;
    hb_port: number;
    ip: string;
    key: string;
    transport: string;
    signature_scheme: string;
}

interface SidecarMessage {
    event?: string;
    port?: number;
    message?: string;
}

const DEFAULT_IP_ADDRESS = '127.0.0.1';
const DEFAULT_SIGNATURE_SCHEME = 'hmac-sha256';
const DEFAULT_SESSION_MODE = 'notebook';
const DEFAULT_SIDECAR_TIMEOUT_MS = 15000;
const SIDECAR_LOG_RELOAD_COMMAND = 'reload_log_level';

export class ArkLanguageService implements vscode.Disposable {
    private client: LanguageClient | undefined;
    private readonly config: vscode.WorkspaceConfiguration;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly kernelOutputChannel: vscode.OutputChannel;
    private readonly disposables: vscode.Disposable[] = [];
    private arkProcess: util.DisposableProcess | undefined;
    private sidecarProcess: cp.ChildProcessWithoutNullStreams | undefined;
    private connectionDir: string | undefined;
    private connectionFile: string | undefined;
    private isIntentionallyRestarting: boolean = false;

    constructor() {
        this.outputChannel = getLogger().createChannel('lsp');
        this.kernelOutputChannel = getLogger().createChannel('ark-kernel');
        this.client = undefined;
        this.config = vscode.workspace.getConfiguration('krarkode.ark');
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('krarkode.logging.channels.lsp')) {
                    this.updateLspTrace();
                }
                if (event.affectsConfiguration('krarkode.ark.logLevel')) {
                    this.reloadSidecarLogLevel();
                }
            })
        );
        void this.startLanguageService();
    }

    public async restartWithSessionPaths(_rPath?: string, _libPaths?: string[]): Promise<void> {
        await this.restart();
    }

    public async restart(): Promise<void> {
        this.outputChannel.appendLine('Restarting Ark LSP...');
        this.isIntentionallyRestarting = true;
        await this.stopLanguageService();
        this.client = undefined;
        this.isIntentionallyRestarting = false;
        await this.startLanguageService();
        this.outputChannel.appendLine('Ark LSP restarted.');
    }

    dispose(): void {
        void this.stopLanguageService();
        this.outputChannel.dispose();
        this.kernelOutputChannel.dispose();
        this.disposables.forEach((disposable) => disposable.dispose());
        this.disposables.length = 0;
    }

    private async startLanguageService(): Promise<void> {
        const documentSelector: DocumentFilter[] = [
            { language: 'r' },
            { language: 'rmd' },
        ];
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : os.homedir();

        try {
            await this.startArkKernel(cwd);
            const port = await this.openArkLspComm();
            this.client = await this.createClient(port, documentSelector, workspaceFolder);
            this.updateLspTrace();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            this.outputChannel.appendLine(`Ark LSP failed to start: ${message}`);
            void vscode.window.showErrorMessage(`Ark LSP failed to start: ${message}`);
            this.outputChannel.show();
            await this.stopLanguageService();
        }
    }

    private async startArkKernel(cwd: string): Promise<void> {
        if (this.arkProcess) {
            return;
        }

        // Try to reuse existing session from registry
        const activeSession = sessionRegistry.getActiveSession();
        if (activeSession && fs.existsSync(activeSession.connectionFilePath)) {
            const alive = await this.checkConnectionFile(activeSession.connectionFilePath);
            if (alive) {
                this.connectionFile = activeSession.connectionFilePath;
                this.outputChannel.appendLine(`Using Ark session connection file ${activeSession.connectionFilePath}`);
                return;
            }

            this.outputChannel.appendLine(`Ark session connection file is stale: ${activeSession.connectionFilePath}`);
            sessionRegistry.setActiveSessionName(undefined);
        }

        // Create new connection file and start Ark kernel
        const connectionFile = await this.createConnectionFile();
        this.connectionFile = connectionFile;

        const arkPath = (this.config.get<string>('path') || '').trim() || 'ark';
        const sessionMode = (this.config.get<string>('sessionMode') || DEFAULT_SESSION_MODE).trim();
        const env = Object.assign({}, process.env, {
            ARK_CONNECTION_FILE: connectionFile,
        });
        const arkLogLevel = getArkLogLevel(this.config);
        const rustLog = formatArkRustLog(arkLogLevel);
        if (rustLog) {
            env.RUST_LOG = rustLog;
            this.outputChannel.appendLine(`Ark backend log level set to ${arkLogLevel}.`);
        }
        const rHome = await this.resolveRHome();
        if (rHome) {
            env.R_HOME = rHome;
            this.outputChannel.appendLine(`Resolved R_HOME for Ark: ${rHome}`);
        }

        this.outputChannel.appendLine(`Starting Ark kernel with connection file ${connectionFile}`);
        this.arkProcess = util.spawn(arkPath, ['--connection_file', connectionFile, '--session-mode', sessionMode], { cwd, env });
        this.arkProcess.stdout?.on('data', (chunk: Buffer) => {
            this.kernelOutputChannel.appendLine(chunk.toString().trim());
        });
        this.arkProcess.stderr?.on('data', (chunk: Buffer) => {
            this.kernelOutputChannel.appendLine(chunk.toString().trim());
        });
        this.arkProcess.on('exit', (code, signal) => {
            this.kernelOutputChannel.appendLine(`Ark kernel exited ${signal ? `from signal ${signal}` : `with exit code ${code ?? 'null'}`}`);
        });
    }

    private async resolveRHome(): Promise<string | undefined> {
        const rPath = await util.getRBinaryPath();
        if (!rPath) {
            return undefined;
        }

        const result = await util.spawnAsync(rPath, ['RHOME'], { env: process.env });
        const lines = (result.stdout || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        if (lines.length > 0) {
            return lines[lines.length - 1];
        }

        return path.resolve(path.dirname(rPath), '..');
    }

    private async openArkLspComm(): Promise<number> {
        if (!this.connectionFile) {
            throw new Error('Missing Ark connection file.');
        }

        const ipAddress = (this.config.get<string>('ipAddress') || DEFAULT_IP_ADDRESS).trim();
        const timeoutMs = this.config.get<number>('lspTimeoutMs') ?? DEFAULT_SIDECAR_TIMEOUT_MS;
        const sidecarPath = util.resolveSidecarPath();
        const args = ['--connection-file', this.connectionFile, '--ip-address', ipAddress, '--timeout-ms', String(timeoutMs)];

        this.outputChannel.appendLine(`Starting Ark sidecar: ${sidecarPath}`);
        const sidecar = cp.spawn(sidecarPath, args, { stdio: ['pipe', 'pipe', 'pipe'], env: this.buildSidecarEnv() });
        this.sidecarProcess = sidecar;
        sidecar.stderr?.on('data', (chunk: Buffer) => {
            this.outputChannel.appendLine(`[sidecar] ${chunk.toString().trim()}`);
        });

        return await this.waitForSidecarPort(sidecar, timeoutMs);
    }

    private async checkConnectionFile(connectionFile: string): Promise<boolean> {
        const sidecarPath = util.resolveSidecarPath();
        const timeoutMs = this.config.get<number>('lspTimeoutMs') ?? DEFAULT_SIDECAR_TIMEOUT_MS;
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

    private async createConnectionFile(): Promise<string> {
        const tempRoot = util.getTempDir();
        const connectionDir = util.createTempDir(tempRoot, true);
        this.connectionDir = connectionDir;
        const connectionFile = path.join(connectionDir, 'ark-connection.json');
        const ipAddress = (this.config.get<string>('ipAddress') || DEFAULT_IP_ADDRESS).trim();
        const ports = await this.allocatePorts(ipAddress, 5);

        const connectionInfo: ConnectionInfo = {
            shell_port: ports[0],
            iopub_port: ports[1],
            stdin_port: ports[2],
            control_port: ports[3],
            hb_port: ports[4],
            ip: ipAddress,
            key: '',
            transport: 'tcp',
            signature_scheme: DEFAULT_SIGNATURE_SCHEME,
        };

        fs.writeFileSync(connectionFile, JSON.stringify(connectionInfo, null, 2));
        return connectionFile;
    }

    private async allocatePorts(host: string, count: number): Promise<number[]> {
        const ports: number[] = [];
        for (let i = 0; i < count; i += 1) {
            ports.push(await this.getAvailablePort(host));
        }
        return ports;
    }

    private async getAvailablePort(host: string): Promise<number> {
        return await new Promise((resolve, reject) => {
            const server = net.createServer();
            server.once('error', (err) => {
                reject(err);
            });
            server.listen(0, host, () => {
                const address = server.address();
                if (!address || typeof address === 'string') {
                    server.close(() => reject(new Error('Failed to allocate port.')));
                    return;
                }
                const port = address.port;
                server.close(() => resolve(port));
            });
        });
    }


    private async createClient(
        port: number,
        selector: DocumentFilter[],
        workspaceFolder: vscode.WorkspaceFolder | undefined
    ): Promise<LanguageClient> {
        const ipAddress = (this.config.get<string>('ipAddress') || DEFAULT_IP_ADDRESS).trim();

        const tcpServerOptions = () => new Promise<StreamInfo>((resolve, reject) => {
            const socket = net.connect({ host: ipAddress, port }, () => {
                resolve({ reader: socket, writer: socket });
            });
            socket.on('error', (e: Error) => {
                reject(e);
            });
        });

        const clientOptions: LanguageClientOptions = {
            documentSelector: selector,
            workspaceFolder: workspaceFolder,
            outputChannel: this.outputChannel,
            traceOutputChannel: this.outputChannel,
            synchronize: {
                configurationSection: 'krarkode.ark.lsp',
                fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{R,r}'),
            },
            revealOutputChannelOn: RevealOutputChannelOn.Never,
            errorHandler: {
                error: () => {
                    if (this.isIntentionallyRestarting) {
                        return { action: ErrorAction.Continue };
                    }
                    return {
                        action: ErrorAction.Continue,
                        message: 'Ark Language Server encountered an error. Check the output channel for details.'
                    };
                },
                closed: () => {
                    if (this.isIntentionallyRestarting) {
                        return { action: CloseAction.DoNotRestart };
                    }
                    return {
                        action: CloseAction.DoNotRestart,
                        message: 'Ark Language Server connection closed unexpectedly. Please check the output channel or try restarting the session.'
                    };
                },
            },
        };

        const client = new LanguageClient('ark', 'Ark Language Server', tcpServerOptions, clientOptions);
        await client.start();
        return client;
    }

    private updateLspTrace(): void {
        if (!this.client) {
            return;
        }
        const setting = getLogChannelSetting('lsp');
        const traceLevel = setting === 'debug' ? Trace.Verbose : Trace.Off;
        void this.client.setTrace(traceLevel);
        if (traceLevel === Trace.Verbose) {
            getLogger().debug('lsp', 'logging', 'Ark LSP trace logging enabled.');
        }
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

        if (this.arkProcess) {
            this.arkProcess.dispose();
            this.arkProcess = undefined;
        }

        if (this.connectionDir) {
            try {
                fs.rmSync(this.connectionDir, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors.
            }
            this.connectionDir = undefined;
        }
        this.connectionFile = undefined;

        await Promise.allSettled(promises);
    }

    private buildSidecarEnv(): NodeJS.ProcessEnv {
        const env = { ...process.env };
        const logLevel = getArkLogLevel(this.config);
        const sidecarLogLevel = formatSidecarLogLevel(logLevel);
        if (sidecarLogLevel) {
            env.ARK_SIDECAR_LOG = sidecarLogLevel;
            env.RUST_LOG = sidecarLogLevel;
            getLogger().debug('lsp', 'logging', `LSP sidecar log level set to ${sidecarLogLevel}.`);
        }
        return env;
    }

    private reloadSidecarLogLevel(): void {
        if (!this.sidecarProcess || this.sidecarProcess.killed) {
            return;
        }
        const message = { command: SIDECAR_LOG_RELOAD_COMMAND };
        try {
            this.sidecarProcess.stdin.write(JSON.stringify(message) + '\n');
            getLogger().debug('lsp', 'logging', 'Sent log reload command to LSP sidecar.');
        } catch (error) {
            this.outputChannel.appendLine(`Failed to reload LSP sidecar log level: ${error}`);
        }
    }
}
