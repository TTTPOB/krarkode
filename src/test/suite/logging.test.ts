import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { DefaultLogLevelParser, formatLogMessage, LoggerService, RegexLogLevelParser } from '../../logging/logger';

type LogCalls = {
    trace: string[];
    debug: string[];
    info: string[];
    warn: string[];
    error: string[];
    append: string[];
    appendLine: string[];
    replace: string[];
};

function createStubChannel(name = 'Stub'): { channel: vscode.LogOutputChannel; calls: LogCalls } {
    const calls: LogCalls = {
        trace: [],
        debug: [],
        info: [],
        warn: [],
        error: [],
        append: [],
        appendLine: [],
        replace: [],
    };
    const channel = {
        name,
        trace: (value: string) => calls.trace.push(value),
        debug: (value: string) => calls.debug.push(value),
        info: (value: string) => calls.info.push(value),
        warn: (value: string) => calls.warn.push(value),
        error: (value: string) => calls.error.push(value),
        append: (value: string) => calls.append.push(value),
        appendLine: (value: string) => calls.appendLine.push(value),
        clear: () => undefined,
        show: () => undefined,
        hide: () => undefined,
        replace: (value: string) => calls.replace.push(value),
        dispose: () => undefined,
    } as unknown as vscode.LogOutputChannel;
    return { channel, calls };
}

function stubOutputChannel(): { calls: LogCalls; restore: () => void } {
    const original = vscode.window.createOutputChannel;
    const stub = createStubChannel();
    (vscode.window as unknown as { createOutputChannel: typeof original }).createOutputChannel = () => stub.channel;
    return {
        calls: stub.calls,
        restore: () => {
            (vscode.window as unknown as { createOutputChannel: typeof original }).createOutputChannel = original;
        },
    };
}

suite('Logging', () => {
    test('formatLogMessage includes context fields in order', () => {
        const message = formatLogMessage('hello', {
            sessionName: 'alpha',
            connectionFile: path.join('/tmp', 'connection.json'),
            port: 4311,
            pid: 9001,
        });
        assert.strictEqual(message, '[session=alpha conn=connection.json port=4311 pid=9001] hello');
    });

    test('formatLogMessage returns original message without context', () => {
        assert.strictEqual(formatLogMessage('hello', {}), 'hello');
    });

    test('DefaultLogLevelParser detects level tokens and context prefixes', () => {
        const parser = new DefaultLogLevelParser();
        assert.strictEqual(parser.parse('[Warn] Be careful', 'info'), 'warn');
        assert.strictEqual(parser.parse('[LSP] Trace wire', 'info'), 'trace');
        assert.strictEqual(parser.parse('[session=alpha] [Error] Boom', 'info'), 'error');
        assert.strictEqual(parser.parse('Plain message', 'info'), 'info');
    });

    test('RegexLogLevelParser honors capture and resets global patterns', () => {
        const parser = new RegexLogLevelParser(/level=(trace|debug|info|warn|error)/gi);
        assert.strictEqual(parser.parse('level=debug', 'info'), 'debug');
        assert.strictEqual(parser.parse('level=trace', 'info'), 'trace');
    });

    test('LoggerService filters output below channel level', async () => {
        const config = vscode.workspace.getConfiguration('krarkode.logging');
        const previousSetting = config.get('channels.ark');
        const { calls, restore } = stubOutputChannel();
        const logger = new LoggerService();
        try {
            await config.update('channels.ark', 'warn', vscode.ConfigurationTarget.Global);
            logger.write('ark', 'info message', { level: 'info', newLine: true });
            assert.strictEqual(calls.info.length, 0);
            logger.write('ark', 'warn message', { level: 'warn', newLine: true });
            assert.strictEqual(calls.warn.length, 1);
        } finally {
            await config.update('channels.ark', previousSetting ?? undefined, vscode.ConfigurationTarget.Global);
            restore();
            logger.dispose();
        }
    });
});
