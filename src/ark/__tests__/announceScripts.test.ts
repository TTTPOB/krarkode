import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import {
    buildArkAnnounceSerializerLines,
    buildArkAttachScript,
    buildArkStartupScript,
    rStringLiteral,
} from '../announceScripts';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

function expectPayloadFieldOrder(script: string): void {
    const sessionNameIndex = script.indexOf(`sessionName =`);
    const connectionFileIndex = script.indexOf(`connectionFilePath =`);
    const pidIndex = script.indexOf(`pid =`);
    const startedAtIndex = script.indexOf(`startedAt =`);

    expect(sessionNameIndex).toBeGreaterThan(-1);
    expect(connectionFileIndex).toBeGreaterThan(sessionNameIndex);
    expect(pidIndex).toBeGreaterThan(connectionFileIndex);
    expect(startedAtIndex).toBeGreaterThan(pidIndex);
}

async function runRScript(code: string): Promise<string> {
    const { stdout } = await execFileAsync('pixi', ['run', '--', 'Rscript', '-e', code], {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
}

describe('announceScripts', () => {
    test('buildArkStartupScript uses the shared serializer without jsonlite', () => {
        const script = buildArkStartupScript('demo-session', '/tmp/announce.json');

        expect(script).toContain(`Sys.setenv(TERM_PROGRAM = "vscode")`);
        expect(script).toContain(`.krarkode_escape_json_string <- function(value)`);
        expect(script).toContain(`.krarkode_json_scalar <- function(value)`);
        expect(script).toContain(`.krarkode_json_object <- function(value)`);
        expect(script).not.toContain(`jsonlite`);
        expectPayloadFieldOrder(script);
    });

    test('buildArkAttachScript keeps cleanup and field order stable', () => {
        const script = buildArkAttachScript('/tmp/announce.R', '/tmp/announce.json');

        expect(script).toContain(`.krarkode_script_path <- r"(/tmp/announce.R)"`);
        expect(script).toContain(`if (file.exists(.krarkode_script_path)) file.remove(.krarkode_script_path)`);
        expect(script).not.toContain(`jsonlite`);
        expectPayloadFieldOrder(script);
    });

    test('serializer round-trips supported values through pixi Rscript', { timeout: 30000 }, async () => {
        const sessionName = `session-"quoted"\nline-\u4F1A\u8BDD`;
        const connectionFilePath = `/tmp/escaped\\segment/"quoted"\nnext`;
        const startedAt = `2026-03-16T12:34:56Z`;
        const code = [
            ...buildArkAnnounceSerializerLines(),
            `cat(.krarkode_json_object(list(`,
            `  sessionName = ${rStringLiteral(sessionName)},`,
            `  connectionFilePath = ${rStringLiteral(connectionFilePath)},`,
            `  pid = 4242L,`,
            `  startedAt = ${rStringLiteral(startedAt)},`,
            `  active = TRUE,`,
            `  note = NULL`,
            `)))`,
        ].join('\n');

        const stdout = await runRScript(code);
        const parsed = JSON.parse(stdout) as Record<string, unknown>;

        expect(parsed).toEqual({
            sessionName,
            connectionFilePath,
            pid: 4242,
            startedAt,
            active: true,
            note: null,
        });
    });
});
