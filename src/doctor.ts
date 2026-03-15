import * as fs from 'fs';
import * as vscode from 'vscode';
import { getLogger } from './logging/logger';
import * as util from './util';

interface CheckResult {
    label: string;
    ok: boolean;
    detail: string;
}

/**
 * Run the Krarkode Doctor environment check.
 * Validates that all required executables and settings are correctly configured.
 */
export async function runDoctor(): Promise<void> {
    const results: CheckResult[] = [];
    const config = vscode.workspace.getConfiguration('krarkode');

    // 1. R binary
    const rPath = await util.getRBinaryPath();
    if (rPath && fs.existsSync(rPath)) {
        const version = await getVersion(rPath, ['--version']);
        results.push({ label: 'R', ok: true, detail: `${rPath} (${version})` });
    } else {
        results.push({
            label: 'R',
            ok: false,
            detail: rPath
                ? `Not found at: ${rPath}`
                : 'Not configured. Set krarkode.r.binaryPath or ensure R is in PATH.',
        });
    }

    // 2. Ark executable
    const arkPath = util.resolveArkPath();
    const arkResolved = await resolveExecutable(arkPath);
    if (arkResolved) {
        const version = await getVersion(arkResolved, ['--version']);
        results.push({ label: 'Ark', ok: true, detail: `${arkResolved} (${version})` });
    } else {
        results.push({
            label: 'Ark',
            ok: false,
            detail: `Not found: ${arkPath}. Install Ark or set krarkode.ark.path.`,
        });
    }

    // 3. Sidecar executable
    try {
        const sidecarPath = util.resolveSidecarPath();
        if (fs.existsSync(sidecarPath)) {
            results.push({ label: 'Sidecar', ok: true, detail: sidecarPath });
        } else {
            results.push({ label: 'Sidecar', ok: false, detail: `Not found at: ${sidecarPath}` });
        }
    } catch {
        results.push({ label: 'Sidecar', ok: false, detail: 'Failed to resolve sidecar path.' });
    }

    // 4. tmux (only if console driver is tmux)
    const consoleDriver = (config.get<string>('ark.console.driver') || 'tmux').trim();
    if (consoleDriver === 'tmux') {
        const tmuxPath = (config.get<string>('ark.tmux.path') || '').trim() || 'tmux';
        const tmuxResolved = await resolveExecutable(tmuxPath);
        if (tmuxResolved) {
            const version = await getVersion(tmuxResolved, ['-V']);
            results.push({ label: 'tmux', ok: true, detail: `${tmuxResolved} (${version})` });
        } else {
            results.push({
                label: 'tmux',
                ok: false,
                detail: `Not found: ${tmuxPath}. Install tmux or set krarkode.ark.tmux.path.`,
            });
        }
    } else {
        results.push({ label: 'tmux', ok: true, detail: `Skipped (console driver: ${consoleDriver})` });
    }

    // 5. Key settings summary
    const sessionMode = config.get<string>('ark.sessionMode') || 'console';
    const lspEnabled = config.get<boolean>('ark.lsp.enabled') ?? true;
    const bracketedPaste = config.get<boolean>('bracketedPaste') ?? true;

    // Format output
    const output = getLogger().createChannel('doctor');
    output.clear();
    output.appendLine('=== Krarkode Doctor ===');
    output.appendLine('');

    let allOk = true;
    for (const r of results) {
        const icon = r.ok ? '[OK]' : '[FAIL]';
        if (!r.ok) {
            allOk = false;
        }
        output.appendLine(`${icon} ${r.label}: ${r.detail}`);
    }

    output.appendLine('');
    output.appendLine('--- Settings ---');
    output.appendLine(`Session mode: ${sessionMode}`);
    output.appendLine(`Console driver: ${consoleDriver}`);
    output.appendLine(`LSP enabled: ${lspEnabled}`);
    output.appendLine(`Bracketed paste: ${bracketedPaste}`);
    output.appendLine(`Platform: ${process.platform}-${process.arch}`);

    output.appendLine('');
    if (allOk) {
        output.appendLine('All checks passed.');
    } else {
        output.appendLine('Some checks failed. See above for details.');
    }

    output.show(true);

    if (!allOk) {
        void vscode.window.showWarningMessage(
            'Krarkode Doctor: some checks failed. See the output channel for details.',
        );
    } else {
        void vscode.window.showInformationMessage('Krarkode Doctor: all checks passed.');
    }
}

async function resolveExecutable(name: string): Promise<string | undefined> {
    // If it's an absolute path, check directly
    if (name.includes('/') || name.includes('\\')) {
        return fs.existsSync(name) ? name : undefined;
    }
    const result = await util.spawnAsync('which', [name]);
    if (result.status === 0 && result.stdout.trim()) {
        return result.stdout.trim().split('\n')[0];
    }
    return undefined;
}

async function getVersion(execPath: string, args: string[]): Promise<string> {
    try {
        const result = await util.spawnAsync(execPath, args);
        const output = (result.stdout || result.stderr || '').trim();
        // Extract first line, often contains the version
        const firstLine = output.split('\n')[0] || '';
        // Try to extract version number pattern
        const match = firstLine.match(/\d+\.\d+[\w.-]*/);
        return match ? match[0] : firstLine.slice(0, 80);
    } catch {
        return 'unknown';
    }
}
