import * as vscode from 'vscode';

export type LogChannelId = 'ark' | 'ark-kernel' | 'lsp' | 'sidecar';
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export type LogChannelSetting = 'none' | 'error' | 'debug';

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

const MESSAGE_LEVEL_RE = /^\[(Trace|Debug|Info|Warn|Error)\b/i;

function normalizeChannelSetting(value: unknown): LogChannelSetting {
    if (value === 'none' || value === 'error' || value === 'debug') {
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
    const match = MESSAGE_LEVEL_RE.exec(message);
    if (!match) {
        return 'info';
    }
    switch (match[1].toLowerCase()) {
        case 'trace':
            return 'trace';
        case 'debug':
            return 'debug';
        case 'warn':
            return 'warn';
        case 'error':
            return 'error';
        default:
            return 'info';
    }
}

function isLevelAllowed(setting: LogChannelSetting, level: LogLevel): boolean {
    if (setting === 'none') {
        return false;
    }
    if (setting === 'debug') {
        return true;
    }
    return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK.warn;
}

export function isDebugLoggingEnabled(channelId: LogChannelId = 'ark'): boolean {
    const setting = getChannelSetting(channelId);
    if (setting === 'none') {
        return false;
    }
    if (setting === 'debug') {
        return true;
    }
    const value = process.env.KRARKODE_DEBUG;
    return value === '1' || value === 'true';
}

class LoggerOutputChannel implements vscode.OutputChannel {
    public readonly name: string;

    constructor(
        private readonly logger: LoggerService,
        private readonly channelId: LogChannelId,
        private readonly category?: string
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
        this.logger.replace(this.channelId, value, { category: this.category });
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
            })
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

    replace(channelId: LogChannelId, message: string, options: { category?: string } = {}): void {
        if (!this.isChannelEnabled(channelId) || !this.isLevelEnabled(channelId, 'info')) {
            return;
        }
        const channel = this.getOrCreateChannel(channelId);
        channel.replace(this.formatMessage(message, options.category, 'info'));
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
        if (level === 'debug') {
            if (!isDebugLoggingEnabled(channelId)) {
                return;
            }
        } else if (!this.isLevelEnabled(channelId, level)) {
            return;
        }
        if (!this.isChannelEnabled(channelId)) {
            return;
        }
        const output = this.getOrCreateChannel(channelId);
        this.writeToChannel(output, message, level, options.category, options.newLine);
    }

    getChannelName(channelId: LogChannelId): string {
        return CHANNELS[channelId].name;
    }

    private isChannelEnabled(channelId: LogChannelId): boolean {
        return getChannelSetting(channelId) !== 'none';
    }

    private isLevelEnabled(channelId: LogChannelId, level: LogLevel): boolean {
        return isLevelAllowed(getChannelSetting(channelId), level);
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

    private formatMessage(message: string, category?: string, level: LogLevel = 'info'): string {
        const segments: string[] = [];
        if (category) {
            segments.push(`[${category}]`);
        }
        if (level !== 'info') {
            segments.push(`[${level}]`);
        }
        if (segments.length === 0) {
            return message;
        }
        return `${segments.join('')} ${message}`;
    }

    private writeToChannel(
        output: vscode.LogOutputChannel,
        message: string,
        level: LogLevel,
        category: string | undefined,
        newLine: boolean | undefined
    ): void {
        const formatted = this.formatMessage(message, category, level);
        if (newLine === false && level === 'info') {
            output.append(formatted);
            return;
        }
        switch (level) {
            case 'trace':
                output.trace(formatted);
                break;
            case 'debug':
                output.debug(formatted);
                break;
            case 'warn':
                output.warn(formatted);
                break;
            case 'error':
                output.error(formatted);
                break;
            default:
                output.info(formatted);
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
