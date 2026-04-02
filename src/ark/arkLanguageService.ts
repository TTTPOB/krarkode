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
import * as tmuxUtil from './tmuxUtil';
import {
    formatLogMessage,
    getLogChannelSetting,
    getLogger,
    LogCategory,
    RegexLogLevelParser,
    type LogChannelId,
    type LogContext,
    type LogLevel,
} from '../logging/logger';
import { formatArkRustLog, formatSidecarRustLog, getArkLogLevel, mergeRustLogDirective } from './arkLogLevel';
import { parseSidecarJsonLog } from './sidecarLogParser';
import { SIDECAR_LOG_RELOAD_COMMAND } from './sidecarProtocol';

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
const DEFAULT_SIDECAR_TIMEOUT_MS = 15000;
const KERNEL_LOG_LEVEL_PARSER = new RegexLogLevelParser(/\b(TRACE|DEBUG|INFO|WARN|ERROR)\b/i);

export class ArkLanguageService implements vscode.Disposable {
    private client: LanguageClient | undefined;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly kernelOutputChannel: vscode.OutputChannel;
    private readonly runtimeOutputChannel: vscode.OutputChannel;
    private readonly disposables: vscode.Disposable[] = [];
    private arkProcess: util.DisposableProcess | undefined;
    private sidecarProcess: cp.ChildProcessWithoutNullStreams | undefined;
    private connectionDir: string | undefined;
    private connectionFile: string | undefined;
    private lspPort: number | undefined;
    private isIntentionallyRestarting: boolean = false;

    constructor() {
        this.outputChannel = getLogger().createChannel('lsp', LogCategory.Session);
        this.kernelOutputChannel = getLogger().createChannel('ark-kernel', LogCategory.Stdout);
        this.runtimeOutputChannel = getLogger().createChannel('runtime', LogCategory.Session);
        this.client = undefined;
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('krarkode.logging.lsp')) {
                    this.updateLspTrace();
                }
                if (event.affectsConfiguration('krarkode.ark.logLevel')) {
                    this.reloadSidecarLogLevel();
                }
            }),
        );
        void this.startLanguageService();
    }

    /**
     * Get the underlying LanguageClient instance for sending custom requests.
     * Returns undefined if the client is not started.
     */
    public getClient(): LanguageClient | undefined {
        return this.client;
    }

    /**
     * Suppress the "closed unexpectedly" warning for the next connection close.
     * Call this before intentionally killing the kernel so the error handler
     * knows the disconnection is expected.
     */
    public suppressCloseWarning(): void {
        this.isIntentionallyRestarting = true;
    }

    public async restartWithSessionPaths(_rPath?: string, _libPaths?: string[]): Promise<void> {
        await this.restart();
    }

    public async restart(): Promise<void> {
        this.outputChannel.appendLine(this.formatLogMessage('Restarting Ark LSP...', 'lsp'));
        this.isIntentionallyRestarting = true;
        await this.stopLanguageService();
        this.client = undefined;
        this.isIntentionallyRestarting = false;
        await this.startLanguageService();
        this.outputChannel.appendLine(this.formatLogMessage('Ark LSP restarted.', 'lsp'));
    }

    dispose(): void {
        this.isIntentionallyRestarting = true;
        void this.stopLanguageService();
        this.outputChannel.dispose();
        this.kernelOutputChannel.dispose();
        this.disposables.forEach((disposable) => disposable.dispose());
        this.disposables.length = 0;
    }

    private async startLanguageService(): Promise<void> {
        const documentSelector: DocumentFilter[] = [{ language: 'r' }, { language: 'rmd' }];
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : os.homedir();

        try {
            await this.startArkKernel(cwd);
            const port = await this.openArkLspComm();
            this.lspPort = port;
            this.client = await this.createClient(port, documentSelector, workspaceFolder);
            this.updateLspTrace();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            getLogger().log(
                'lsp',
                LogCategory.Logging,
                'error',
                this.formatLogMessage(`Ark LSP failed to start: ${message}`, 'lsp'),
            );
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
        const activeSession = await sessionRegistry.getActiveSessionValidated();
        if (activeSession && fs.existsSync(activeSession.connectionFilePath)) {
            const alive = await this.checkConnectionFile(activeSession.connectionFilePath);
            if (alive) {
                this.connectionFile = activeSession.connectionFilePath;
                this.runtimeOutputChannel.appendLine(
                    this.formatLogMessage(
                        `Using Ark session connection file ${activeSession.connectionFilePath}`,
                        'session',
                    ),
                );
                return;
            }

            getLogger().log(
                'runtime',
                LogCategory.Session,
                'warn',
                this.formatLogMessage(
                    `Ark session connection file is stale: ${activeSession.connectionFilePath}`,
                    'session',
                ),
            );
            sessionRegistry.setActiveSessionName(undefined);
        }

        // Create new connection file and start Ark kernel
        const connectionFile = await this.createConnectionFile();
        this.connectionFile = connectionFile;

        const arkPath = util.resolveArkPath();
        const env = Object.assign({}, process.env, {
            ARK_CONNECTION_FILE: connectionFile,
        });
        const arkLogLevel = getArkLogLevel();
        const rustLog = formatArkRustLog(arkLogLevel);
        if (rustLog) {
            env.RUST_LOG = mergeRustLogDirective(env.RUST_LOG, 'ark', arkLogLevel);
            this.runtimeOutputChannel.appendLine(this.formatLogMessage(`Ark backend log level set to ${arkLogLevel}.`, 'session'));
        }
        const rHome = await this.resolveRHome();
        if (rHome) {
            env.R_HOME = rHome;
            this.runtimeOutputChannel.appendLine(this.formatLogMessage(`Resolved R_HOME for Ark: ${rHome}`, 'session'));
        }

        this.runtimeOutputChannel.appendLine(
            this.formatLogMessage(`Starting Ark kernel with connection file ${connectionFile}`, 'session'),
        );
        this.arkProcess = util.spawn(arkPath, ['--connection_file', connectionFile, '--session-mode', 'console'], {
            cwd,
            env,
        });
        this.arkProcess.stdout?.on('data', (chunk: Buffer) => {
            this.logKernelOutput('stdout', chunk);
        });
        this.arkProcess.stderr?.on('data', (chunk: Buffer) => {
            this.logKernelOutput('stderr', chunk);
        });
        this.arkProcess.on('exit', (code, signal) => {
            this.kernelOutputChannel.appendLine(
                this.formatLogMessage(
                    `Ark kernel exited ${signal ? `from signal ${signal}` : `with exit code ${code ?? 'null'}`}`,
                    'kernel',
                ),
            );
        });
    }

    private async resolveRHome(): Promise<string | undefined> {
        // Prefer session-specific R binary if available
        const activeSession = await sessionRegistry.getActiveSessionValidated();
        const rPath = activeSession?.rBinaryPath ?? await util.getRBinaryPath();
        if (!rPath) {
            return undefined;
        }

        this.runtimeOutputChannel.appendLine(
            this.formatLogMessage(`Resolving R_HOME from: ${rPath} (source: ${activeSession?.rBinaryPath ? 'session' : 'global'})`, 'session'),
        );

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

        const sidecarConfig = vscode.workspace.getConfiguration('krarkode.ark.sidecar');
        const lspConfig = vscode.workspace.getConfiguration('krarkode.ark.lsp');
        const ipAddress = (sidecarConfig.get<string>('ipAddress') || DEFAULT_IP_ADDRESS).trim();
        const timeoutMs = lspConfig.get<number>('timeoutMs') ?? DEFAULT_SIDECAR_TIMEOUT_MS;
        const sidecarPath = util.resolveSidecarPath();
        const args = [
            'lsp',
            '--connection-file',
            this.connectionFile,
            '--ip-address',
            ipAddress,
            '--timeout-ms',
            String(timeoutMs),
        ];

        getLogger().log('sidecar', LogCategory.Comm, 'info', this.formatLogMessage(`Starting Ark sidecar: ${sidecarPath}`, 'sidecar'));
        const sidecar = cp.spawn(sidecarPath, args, { stdio: ['pipe', 'pipe', 'pipe'], env: this.buildSidecarEnv() });
        this.sidecarProcess = sidecar;
        sidecar.stderr?.on('data', (chunk: Buffer) => {
            const lines = chunk
                .toString()
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0);
            for (const line of lines) {
                const parsed = parseSidecarJsonLog(line);
                if (!parsed) {
                    getLogger().debug(
                        'sidecar',
                        LogCategory.Logging,
                        this.formatLogMessage(`Failed to parse sidecar JSON log: ${line}`, 'sidecar'),
                    );
                    getLogger().log('sidecar', LogCategory.Stderr, 'info', this.formatLogMessage(line, 'sidecar'));
                    continue;
                }
                getLogger().log(
                    'sidecar',
                    LogCategory.Stderr,
                    parsed.level,
                    this.formatLogMessage(parsed.message, 'sidecar'),
                );
            }
        });

        return await this.waitForSidecarPort(sidecar, timeoutMs);
    }

    private async checkConnectionFile(connectionFile: string): Promise<boolean> {
        const sidecarPath = util.resolveSidecarPath();
        const timeoutMs = vscode.workspace.getConfiguration('krarkode.ark.lsp').get<number>('timeoutMs') ?? DEFAULT_SIDECAR_TIMEOUT_MS;
        const args = ['check', '--connection-file', connectionFile, '--timeout-ms', String(timeoutMs)];
        const result = await util.spawnAsync(sidecarPath, args, { env: process.env });
        if (result.error || result.status !== 0) {
            const message = result.stderr || result.stdout || result.error?.message || 'Unknown error';
            getLogger().log(
                'lsp',
                LogCategory.Logging,
                'warn',
                this.formatLogMessage(`Ark connection check failed: ${message}`, 'lsp'),
            );
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
                    this.outputChannel.appendLine(this.formatLogMessage(line, 'sidecar'));
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
        const ipAddress = (vscode.workspace.getConfiguration('krarkode.ark.sidecar').get<string>('ipAddress') || DEFAULT_IP_ADDRESS).trim();
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
        workspaceFolder: vscode.WorkspaceFolder | undefined,
    ): Promise<LanguageClient> {
        const ipAddress = (vscode.workspace.getConfiguration('krarkode.ark.sidecar').get<string>('ipAddress') || DEFAULT_IP_ADDRESS).trim();

        const tcpServerOptions = () =>
            new Promise<StreamInfo>((resolve, reject) => {
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
                        // Suppress the default notification during intentional restarts.
                        return { action: ErrorAction.Continue, handled: true };
                    }
                    return {
                        action: ErrorAction.Continue,
                        message: 'Ark Language Server encountered an error. Check the output channel for details.',
                    };
                },
                closed: async () => {
                    if (this.isIntentionallyRestarting) {
                        // Suppress the default notification during intentional restarts.
                        return { action: CloseAction.DoNotRestart, handled: true };
                    }

                    // Check if the kernel's tmux window is gone (e.g. user ran q()).
                    // If so, this is a normal shutdown, not an unexpected crash.
                    const sessionGone = await this.isSessionTmuxGone();
                    if (sessionGone) {
                        this.outputChannel.appendLine(
                            this.formatLogMessage('LSP connection closed; tmux window gone — treating as normal shutdown.', 'lsp'),
                        );
                        return { action: CloseAction.DoNotRestart, handled: true };
                    }

                    return {
                        action: CloseAction.DoNotRestart,
                        message:
                            'Ark Language Server connection closed unexpectedly. Please check the output channel or try restarting the session.',
                    };
                },
            },
        };

        const client = new LanguageClient('ark', 'Ark Language Server', tcpServerOptions, clientOptions);
        await client.start();
        return client;
    }

    /**
     * Check whether the active session's tmux window has disappeared.
     * Used by the LSP error handler to distinguish expected shutdowns
     * (e.g. q()) from unexpected crashes.
     */
    private async isSessionTmuxGone(): Promise<boolean> {
        const activeSession = sessionRegistry.getActiveSession();
        if (!activeSession || activeSession.mode !== 'tmux') {
            return false;
        }
        if (!activeSession.tmuxSessionName || !activeSession.tmuxWindowName) {
            return false;
        }
        const windows = await tmuxUtil.listTmuxWindows(activeSession.tmuxSessionName);
        return !windows.includes(activeSession.tmuxWindowName);
    }

    private updateLspTrace(): void {
        if (!this.client) {
            return;
        }
        const setting = getLogChannelSetting('lsp');
        const traceLevel = (setting === 'debug' || setting === 'trace') ? Trace.Verbose : Trace.Off;
        void this.client.setTrace(traceLevel);
        getLogger().debug(
            'lsp',
            LogCategory.Logging,
            this.formatLogMessage(`LSP trace resolved: setting="${setting}" → ${traceLevel === Trace.Verbose ? 'Verbose' : 'Off'}`, 'lsp'),
        );
        if (traceLevel === Trace.Verbose) {
            getLogger().debug(
                'lsp',
                LogCategory.Logging,
                this.formatLogMessage('Ark LSP trace logging enabled.', 'lsp'),
            );
        }
    }

    private async stopLanguageService(): Promise<void> {
        // Stop the LSP client first and wait for the shutdown handshake to
        // complete before killing the sidecar.  Previously the sidecar was
        // SIGKILL-ed while client.stop() was still in flight, which severed
        // the TCP connection and caused ECONNRESET / "Connection to server
        // got closed" notifications from vscode-languageclient.
        if (this.client) {
            try {
                await this.client.stop();
            } catch (err) {
                getLogger().log('lsp', LogCategory.Session, 'warn',
                    this.formatLogMessage(`LSP client stop failed (may already be stopped): ${err}`, 'lsp'));
            }
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
            } catch (err) {
                getLogger().log('lsp', LogCategory.Session, 'warn',
                    this.formatLogMessage(`Failed to clean up connection dir ${this.connectionDir}: ${err}`, 'lsp'));
            }
            this.connectionDir = undefined;
        }
        this.connectionFile = undefined;
        this.lspPort = undefined;
    }

    private getLogContext(source: 'lsp' | 'kernel' | 'sidecar' | 'session'): LogContext {
        return {
            sessionName: sessionRegistry.getActiveSessionName(),
            connectionFile: this.connectionFile,
            port: source === 'lsp' ? this.lspPort : undefined,
            pid:
                source === 'kernel' || source === 'session'
                    ? this.arkProcess?.pid
                    : source === 'sidecar'
                      ? this.sidecarProcess?.pid
                      : undefined,
        };
    }

    private formatLogMessage(message: string, source: 'lsp' | 'kernel' | 'sidecar' | 'session'): string {
        return formatLogMessage(message, this.getLogContext(source));
    }

    private logKernelOutput(source: 'stdout' | 'stderr', chunk: Buffer): void {
        const lines = chunk
            .toString()
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        const fallback: LogLevel = source === 'stderr' ? 'warn' : 'info';
        const category = source === 'stderr' ? LogCategory.Stderr : LogCategory.Stdout;
        for (const line of lines) {
            const level = this.parseKernelLogLevel(line, fallback);
            getLogger().log('ark-kernel', category, level, this.formatLogMessage(line, 'kernel'));
        }
    }

    private parseKernelLogLevel(message: string, fallback: LogLevel): LogLevel {
        return KERNEL_LOG_LEVEL_PARSER.parse(message, fallback);
    }

    private buildSidecarEnv(): NodeJS.ProcessEnv {
        const env = { ...process.env };
        const logLevel = getArkLogLevel();
        const sidecarRustLog = formatSidecarRustLog(logLevel);
        if (sidecarRustLog) {
            env.RUST_LOG = mergeRustLogDirective(env.RUST_LOG, 'vscode_r_ark_sidecar', logLevel);
            getLogger().debug(
                'sidecar',
                LogCategory.Logging,
                this.formatLogMessage(`LSP sidecar log level set to ${sidecarRustLog} (RUST_LOG=${env.RUST_LOG}).`, 'sidecar'),
            );
        }
        return env;
    }

    private reloadSidecarLogLevel(): void {
        if (!this.sidecarProcess || this.sidecarProcess.killed) {
            return;
        }
        const logLevel = getArkLogLevel();
        const message = { command: SIDECAR_LOG_RELOAD_COMMAND, log_level: logLevel };
        try {
            this.sidecarProcess.stdin.write(JSON.stringify(message) + '\n');
            getLogger().debug(
                'sidecar',
                LogCategory.Logging,
                this.formatLogMessage(`Sent log reload command to LSP sidecar (level: ${logLevel}).`, 'sidecar'),
            );
        } catch (error) {
            getLogger().log(
                'sidecar',
                LogCategory.Logging,
                'warn',
                this.formatLogMessage(`Failed to reload LSP sidecar log level: ${error}`, 'sidecar'),
            );
        }
    }
}
