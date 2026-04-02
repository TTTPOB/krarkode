import serializerR from '../../resources/scripts/json-serializer.R?raw';

function indentLines(lines: readonly string[], prefix = '  '): string[] {
    return lines.map((line) => (line.length > 0 ? `${prefix}${line}` : line));
}

export function rStringLiteral(value: string): string {
    for (let dashCount = 0; dashCount < 32; dashCount += 1) {
        const delimiter = '-'.repeat(dashCount);
        const closing = `)${delimiter}"`;
        if (!value.includes(closing)) {
            return `r"${delimiter}(${value})${delimiter}"`;
        }
    }
    throw new Error('Unable to build a safe raw R string literal');
}

let _cachedSerializerLines: string[] | undefined;

export function buildArkAnnounceSerializerLines(): string[] {
    if (!_cachedSerializerLines) {
        // Strip file-level comment lines and leading/trailing blank lines
        _cachedSerializerLines = serializerR
            .split('\n')
            .filter((line) => !line.startsWith('#'))
            .filter((line, i, arr) => {
                if (line.trim() === '') {
                    const hasPrev = arr.slice(0, i).some((l) => !l.startsWith('#') && l.trim() !== '');
                    const hasNext = arr.slice(i + 1).some((l) => !l.startsWith('#') && l.trim() !== '');
                    return hasPrev && hasNext;
                }
                return true;
            });
    }
    return _cachedSerializerLines;
}

function buildAnnouncePayloadLines(sessionNameExpression: string, connectionFileExpression: string): string[] {
    return [
        `.krarkode_payload <- .krarkode_json_object(list(`,
        `  sessionName = ${sessionNameExpression},`,
        `  connectionFilePath = ${connectionFileExpression},`,
        `  pid = Sys.getpid(),`,
        `  startedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")`,
        `))`,
        `writeLines(.krarkode_payload, .krarkode_announce_path)`,
    ];
}

export function buildArkStartupScript(sessionName: string, announceFile: string): string {
    return [
        `Sys.setenv(TERM_PROGRAM = "vscode")`,
        `local({`,
        ...indentLines([
            `.krarkode_announce_path <- ${rStringLiteral(announceFile)}`,
            `.krarkode_session_name <- ${rStringLiteral(sessionName)}`,
            `.krarkode_connection_file <- Sys.getenv("ARK_CONNECTION_FILE")`,
            ``,
            ...buildArkAnnounceSerializerLines(),
            ``,
            ...buildAnnouncePayloadLines(`.krarkode_session_name`, `.krarkode_connection_file`),
        ]),
        `})`,
    ].join('\n');
}

export function buildArkAttachScript(scriptPath: string, announceFile: string): string {
    return [
        `local({`,
        ...indentLines([
            `.krarkode_announce_path <- ${rStringLiteral(announceFile)}`,
            `.krarkode_script_path <- ${rStringLiteral(scriptPath)}`,
            `.krarkode_connection_file <- Sys.getenv("ARK_CONNECTION_FILE")`,
            `.krarkode_session_name <- basename(dirname(.krarkode_connection_file))`,
            ``,
            ...buildArkAnnounceSerializerLines(),
            ``,
            ...buildAnnouncePayloadLines(`.krarkode_session_name`, `.krarkode_connection_file`),
            `if (file.exists(.krarkode_script_path)) file.remove(.krarkode_script_path)`,
        ]),
        `})`,
    ].join('\n');
}
