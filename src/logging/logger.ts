import * as path from 'path';
import * as vscode from 'vscode';

export type LogChannelId = 'ark' | 'ark-kernel' | 'lsp' | 'sidecar';
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export type LogChannelSetting = 'none' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export type LogContext = {
    sessionName?: string;
    connectionFile?: string;
    pid?: number;
    port?: number;
};

type WriteOptions = {
    category?: string;
    level?: LogLevel;
    newLine?: boolean;
};

const CHANNELS: Record<LogChannelId, { name: string; configKey: string }> = {
    ark: { name: 'Krarkode', configKey: 'channels.ark' },
    'ark-kernel': { name: 'Krarkode Ark Kernel', configKey: 'channels.arkKernel' },
    lsp: { name: 'Krarkode LSP', configKey: 'channels.lsp' },
    sidecar: { name: 'Krarkode Sidecar', configKey: 'channels.sidecar' },
};

const DEFAULT_CHANNEL_SETTING: LogChannelSetting = 'error';
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
    trace: 5,
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const MESSAGE_LEVEL_RE = /^\[(Trace|Debug|Info|Warn|Error|LSP)\b/i;
const MESSAGE_LEVEL_PREFIX_RE = /^\[(Trace|Debug|Info|Warn|Error|LSP)\s*-\s*[^\]]+\]\s*/i;

export interface LogLevelParser {
    parse(message: string, fallback?: LogLevel): LogLevel;
}

export class RegexLogLevelParser implements LogLevelParser {
    constructor(private readonly pattern: RegExp) {}

    parse(message: string, fallback: LogLevel = 'info'): LogLevel {
        if (this.pattern.global) {
            this.pattern.lastIndex = 0;
        }
        const match = this.pattern.exec(message);
        return match ? parseLogLevelToken(match[1] ?? match[0], fallback) : fallback;
    }
}

export class DefaultLogLevelParser implements LogLevelParser {
    parse(message: string, fallback: LogLevel = 'info'): LogLevel {
        const match = MESSAGE_LEVEL_RE.exec(message) ?? MESSAGE_LEVEL_RE.exec(stripContextPrefix(message));
        return match ? parseLogLevelToken(match[1], fallback) : fallback;
    }
}

export const DEFAULT_LOG_LEVEL_PARSER = new DefaultLogLevelParser();

export function formatLogMessage(message: string, context: LogContext): string {
    const segments: string[] = [];
    if (context.sessionName) {
        segments.push(`session=${context.sessionName}`);
    }
    if (context.connectionFile) {
        segments.push(`conn=${path.basename(context.connectionFile)}`);
    }
    if (context.port) {
        segments.push(`port=${context.port}`);
    }
    if (context.pid) {
        segments.push(`pid=${context.pid}`);
    }
    if (segments.length === 0) {
        return message;
    }
    return `[${segments.join(' ')}] ${message}`;
}

function normalizeChannelSetting(value: unknown): LogChannelSetting {
    if (
        value === 'none' ||
        value === 'error' ||
        value === 'warn' ||
        value === 'info' ||
        value === 'debug' ||
        value === 'trace'
    ) {
        return value;
    }
    if (value === false) {
        return 'none';
    }
    return DEFAULT_CHANNEL_SETTING;
}

function getChannelSetting(channelId: LogChannelId): LogChannelSetting {
    const config = vscode.workspace.getConfiguration('krarkode.logging');
    return normalizeChannelSetting(config.get(CHANNELS[channelId].configKey));
}

export function getLogChannelSetting(channelId: LogChannelId): LogChannelSetting {
    return getChannelSetting(channelId);
}

function inferMessageLogLevel(message: string): LogLevel {
    return DEFAULT_LOG_LEVEL_PARSER.parse(message, 'info');
}

function parseLogLevelToken(token: string, fallback: LogLevel): LogLevel {
    switch (token.toLowerCase()) {
        case 'trace':
            return 'trace';
        case 'lsp':
            return 'trace';
        case 'debug':
            return 'debug';
        case 'warn':
            return 'warn';
        case 'error':
            return 'error';
        case 'info':
            return 'info';
        default:
            return fallback;
    }
}

function stripContextPrefix(message: string): string {
    return message.replace(/^\[[^\]]+\]\s*/, '');
}

function stripMessageLevelPrefix(message: string): string {
    return message.replace(MESSAGE_LEVEL_PREFIX_RE, '');
}

function isLevelAllowed(setting: LogChannelSetting, level: LogLevel): boolean {
    if (setting === 'none') {
        return false;
    }
    const minLevel: LogLevel =
        setting === 'trace'
            ? 'trace'
            : setting === 'debug'
              ? 'debug'
              : setting === 'info'
                ? 'info'
                : setting === 'warn'
                  ? 'warn'
                  : 'error';
    return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[minLevel];
}

function isDebugOverrideEnabled(): boolean {
    const value = process.env.KRARKODE_DEBUG;
    return value === '1' || value === 'true';
}

export function isDebugLoggingEnabled(channelId: LogChannelId = 'ark'): boolean {
    const setting = getChannelSetting(channelId);
    if (setting === 'none') {
        return false;
    }
    if (isLevelAllowed(setting, 'debug')) {
        return true;
    }
    return isDebugOverrideEnabled();
}

class LoggerOutputChannel implements vscode.OutputChannel {
    public readonly name: string;

    constructor(
        private readonly logger: LoggerService,
        private readonly channelId: LogChannelId,
        private readonly category?: string,
    ) {
        this.name = logger.getChannelName(channelId);
    }

    append(value: string): void {
        this.logger.write(this.channelId, value, { category: this.category, newLine: false });
    }

    appendLine(value: string): void {
        this.logger.write(this.channelId, value, { category: this.category, newLine: true });
    }

    clear(): void {
        this.logger.clear(this.channelId);
    }

    show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
        this.logger.show(this.channelId, columnOrPreserveFocus, preserveFocus);
    }

    hide(): void {
        this.logger.hide(this.channelId);
    }

    replace(value: string): void {
        this.logger.replace(this.channelId, value);
    }

    dispose(): void {
        this.logger.release(this.channelId);
    }
}

export class LoggerService implements vscode.Disposable {
    private readonly channels = new Map<LogChannelId, vscode.LogOutputChannel>();
    private readonly disposables: vscode.Disposable[] = [];

    constructor() {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('krarkode.logging.channels')) {
                    this.syncChannels();
                }
            }),
        );
    }

    createChannel(channelId: LogChannelId, category?: string): vscode.OutputChannel {
        return new LoggerOutputChannel(this, channelId, category);
    }

    log(channelId: LogChannelId, category: string, level: LogLevel, message: string): void {
        this.write(channelId, message, { category, level, newLine: true });
    }

    debug(channelId: LogChannelId, category: string, message: string): void {
        this.log(channelId, category, 'debug', message);
    }

    show(channelId: LogChannelId, columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
        if (!this.isChannelEnabled(channelId)) {
            return;
        }
        const channel = this.getOrCreateChannel(channelId);
        if (typeof columnOrPreserveFocus === 'number') {
            channel.show(columnOrPreserveFocus, preserveFocus);
        } else {
            channel.show(columnOrPreserveFocus);
        }
    }

    hide(channelId: LogChannelId): void {
        const channel = this.channels.get(channelId);
        channel?.hide();
    }

    clear(channelId: LogChannelId): void {
        const channel = this.channels.get(channelId);
        channel?.clear();
    }

    replace(channelId: LogChannelId, message: string): void {
        if (!this.isChannelEnabled(channelId) || !this.isLevelEnabled(channelId, 'info')) {
            return;
        }
        const channel = this.getOrCreateChannel(channelId);
        const cleanedMessage = stripMessageLevelPrefix(message);
        channel.replace(cleanedMessage);
    }

    release(_channelId: LogChannelId): void {
        // Shared channels are owned by the logger service.
    }

    dispose(): void {
        for (const channel of this.channels.values()) {
            channel.dispose();
        }
        this.channels.clear();
        this.disposables.forEach((disposable) => disposable.dispose());
        this.disposables.length = 0;
    }

    write(channelId: LogChannelId, message: string, options: WriteOptions): void {
        const level = options.level ?? inferMessageLogLevel(message);
        const cleanedMessage = stripMessageLevelPrefix(message);
        if (!this.isLevelEnabled(channelId, level)) {
            return;
        }
        if (!this.isChannelEnabled(channelId)) {
            return;
        }
        const output = this.getOrCreateChannel(channelId);
        this.writeToChannel(output, cleanedMessage, level, options.newLine);
    }

    getChannelName(channelId: LogChannelId): string {
        return CHANNELS[channelId].name;
    }

    private isChannelEnabled(channelId: LogChannelId): boolean {
        return getChannelSetting(channelId) !== 'none';
    }

    private isLevelEnabled(channelId: LogChannelId, level: LogLevel): boolean {
        const setting = getChannelSetting(channelId);
        if (level === 'debug' || level === 'trace') {
            return isLevelAllowed(setting, level) || isDebugOverrideEnabled();
        }
        return isLevelAllowed(setting, level);
    }

    private getOrCreateChannel(channelId: LogChannelId): vscode.LogOutputChannel {
        const existing = this.channels.get(channelId);
        if (existing) {
            return existing;
        }
        const channel = vscode.window.createOutputChannel(CHANNELS[channelId].name, { log: true });
        this.channels.set(channelId, channel);
        this.debug('ark', 'logging', `Created output channel ${CHANNELS[channelId].name}.`);
        return channel;
    }

    private writeToChannel(
        output: vscode.LogOutputChannel,
        message: string,
        level: LogLevel,
        newLine: boolean | undefined,
    ): void {
        if (newLine === false && level === 'info') {
            output.append(message);
            return;
        }
        switch (level) {
            case 'trace':
                output.trace(message);
                break;
            case 'debug':
                output.debug(message);
                break;
            case 'warn':
                output.warn(message);
                break;
            case 'error':
                output.error(message);
                break;
            default:
                output.info(message);
                break;
        }
    }

    private syncChannels(): void {
        for (const [channelId, channel] of this.channels) {
            if (!this.isChannelEnabled(channelId)) {
                channel.dispose();
                this.channels.delete(channelId);
            }
        }
        this.debug('ark', 'logging', 'Logging channel settings refreshed.');
    }
}

let loggerInstance: LoggerService | undefined;

export function getLogger(): LoggerService {
    if (!loggerInstance) {
        loggerInstance = new LoggerService();
    }
    return loggerInstance;
}
