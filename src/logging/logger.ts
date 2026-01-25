import * as vscode from 'vscode';

export type LogChannelId = 'ark' | 'lsp' | 'sidecar';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type WriteOptions = {
    category?: string;
    level?: LogLevel;
    newLine?: boolean;
};

const CHANNELS: Record<LogChannelId, { name: string; configKey: string }> = {
    ark: { name: 'Ark', configKey: 'channels.ark' },
    lsp: { name: 'Ark LSP', configKey: 'channels.lsp' },
    sidecar: { name: 'Ark Sidecar', configKey: 'channels.sidecar' },
};

export function isDebugLoggingEnabled(): boolean {
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
    private readonly channels = new Map<LogChannelId, vscode.OutputChannel>();
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
        if (!this.isChannelEnabled(channelId)) {
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
        const level = options.level ?? 'info';
        if (level === 'debug' && !isDebugLoggingEnabled()) {
            return;
        }
        if (!this.isChannelEnabled(channelId)) {
            return;
        }
        const output = this.getOrCreateChannel(channelId);
        const formatted = this.formatMessage(message, options.category, level);
        if (options.newLine === false) {
            output.append(formatted);
        } else {
            output.appendLine(formatted);
        }
    }

    getChannelName(channelId: LogChannelId): string {
        return CHANNELS[channelId].name;
    }

    private isChannelEnabled(channelId: LogChannelId): boolean {
        const config = vscode.workspace.getConfiguration('krarkode.logging');
        return config.get<boolean>(CHANNELS[channelId].configKey) ?? true;
    }

    private getOrCreateChannel(channelId: LogChannelId): vscode.OutputChannel {
        const existing = this.channels.get(channelId);
        if (existing) {
            return existing;
        }
        const channel = vscode.window.createOutputChannel(CHANNELS[channelId].name);
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
