import * as assert from 'assert';
import * as vscode from 'vscode';
import { formatArkRustLog, formatSidecarRustLog, getArkLogLevel, mergeRustLogDirective } from '../../ark/arkLogLevel';
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

    test('getArkLogLevel reads configuration with fallback', () => {
        const config = {
            get: () => 'trace',
        } as unknown as vscode.WorkspaceConfiguration;
        assert.strictEqual(getArkLogLevel(config), 'trace');
        const invalidConfig = {
            get: () => 'invalid',
        } as unknown as vscode.WorkspaceConfiguration;
        assert.strictEqual(getArkLogLevel(invalidConfig), 'inherit');
    });

    test('mergeRustLogDirective appends when no existing RUST_LOG', () => {
        assert.strictEqual(mergeRustLogDirective(undefined, 'ark', 'debug'), 'ark=debug');
        assert.strictEqual(mergeRustLogDirective('', 'ark', 'debug'), 'ark=debug');
    });

    test('mergeRustLogDirective appends to existing directives', () => {
        assert.strictEqual(mergeRustLogDirective('warn', 'ark', 'debug'), 'warn,ark=debug');
        assert.strictEqual(
            mergeRustLogDirective('warn,tower_lsp=info', 'ark', 'debug'),
            'warn,tower_lsp=info,ark=debug',
        );
    });

    test('mergeRustLogDirective replaces existing target directive', () => {
        assert.strictEqual(mergeRustLogDirective('warn,ark=info', 'ark', 'debug'), 'warn,ark=debug');
        assert.strictEqual(mergeRustLogDirective('ark=trace,tower=info', 'ark', 'debug'), 'tower=info,ark=debug');
        assert.strictEqual(mergeRustLogDirective('ark=warn', 'ark', 'debug'), 'ark=debug');
    });

    test('mergeRustLogDirective works for sidecar target', () => {
        assert.strictEqual(
            mergeRustLogDirective('info', 'vscode_r_ark_sidecar', 'debug'),
            'info,vscode_r_ark_sidecar=debug',
        );
    });
});
