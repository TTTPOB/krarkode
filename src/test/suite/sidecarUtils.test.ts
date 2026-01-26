import * as assert from 'assert';
import * as vscode from 'vscode';
import { formatArkRustLog, formatSidecarRustLog, getArkLogLevel } from '../../ark/arkLogLevel';
import { parseSidecarJsonLog } from '../../ark/sidecarLogParser';

suite('Sidecar/session utils', () => {
    test('parseSidecarJsonLog returns parsed level and message', () => {
        const parsed = parseSidecarJsonLog(JSON.stringify({ level: 'ERROR', fields: { message: 'boom', code: 12 } }));
        assert.ok(parsed);
        assert.strictEqual(parsed?.level, 'error');
        assert.strictEqual(parsed?.message, 'boom code=12');
    });

    test('parseSidecarJsonLog handles invalid input safely', () => {
        assert.strictEqual(parseSidecarJsonLog('not-json'), undefined);
        assert.strictEqual(parseSidecarJsonLog(JSON.stringify('nope')), undefined);
        const parsed = parseSidecarJsonLog(JSON.stringify({ fields: { status: 'idle' } }));
        assert.strictEqual(parsed?.message, 'status=idle');
    });

    test('formatArkRustLog respects inherit and explicit levels', () => {
        assert.strictEqual(formatArkRustLog('inherit'), undefined);
        assert.strictEqual(formatArkRustLog('info'), 'ark=info');
        assert.strictEqual(formatSidecarRustLog('debug'), 'vscode_r_ark_sidecar=debug');
    });

    test('getArkLogLevel reads configuration with fallback', async () => {
        const config = vscode.workspace.getConfiguration('krarkode.ark');
        const previous = config.get('logLevel');
        try {
            await config.update('logLevel', 'trace', vscode.ConfigurationTarget.Global);
            assert.strictEqual(getArkLogLevel(config), 'trace');
            await config.update('logLevel', 'invalid', vscode.ConfigurationTarget.Global);
            assert.strictEqual(getArkLogLevel(config), 'inherit');
        } finally {
            await config.update('logLevel', previous ?? undefined, vscode.ConfigurationTarget.Global);
        }
    });
});
