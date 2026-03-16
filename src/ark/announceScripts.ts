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

export function buildArkAnnounceSerializerLines(): string[] {
    return [
        `.krarkode_escape_json_string <- function(value) {`,
        `  if (!is.character(value) || length(value) != 1L || is.na(value)) {`,
        `    stop("Expected a non-NA character scalar")`,
        `  }`,
        `  codes <- utf8ToInt(enc2utf8(value))`,
        `  escaped <- vapply(codes, function(code) {`,
        `    if (code == 34L) return(intToUtf8(c(92L, 34L)))`,
        `    if (code == 92L) return(intToUtf8(c(92L, 92L)))`,
        `    if (code == 8L) return(intToUtf8(c(92L, 98L)))`,
        `    if (code == 12L) return(intToUtf8(c(92L, 102L)))`,
        `    if (code == 10L) return(intToUtf8(c(92L, 110L)))`,
        `    if (code == 13L) return(intToUtf8(c(92L, 114L)))`,
        `    if (code == 9L) return(intToUtf8(c(92L, 116L)))`,
        `    if (code < 32L) return(paste0(intToUtf8(92L), "u", sprintf("%04X", code)))`,
        `    intToUtf8(code)`,
        `  }, character(1))`,
        `  paste0('"', paste0(escaped, collapse = ""), '"')`,
        `}`,
        ``,
        `.krarkode_json_scalar <- function(value) {`,
        `  if (is.null(value)) return("null")`,
        `  if (is.factor(value)) stop("Factors are not supported")`,
        `  if (inherits(value, "Date") || inherits(value, "POSIXt")) {`,
        `    stop("Date-like values are not supported")`,
        `  }`,
        `  if (is.list(value)) stop("Nested objects and arrays are not supported")`,
        `  if (length(value) != 1L) stop("Expected a scalar value")`,
        `  if (is.na(value)) stop("NA values are not supported")`,
        `  if (is.character(value)) return(.krarkode_escape_json_string(value))`,
        `  if (is.integer(value)) return(as.character(value))`,
        `  if (is.numeric(value)) {`,
        `    if (!is.finite(value)) stop("Non-finite numbers are not supported")`,
        `    return(format(value, scientific = FALSE, trim = TRUE, digits = 15))`,
        `  }`,
        `  if (is.logical(value)) return(if (value) "true" else "false")`,
        `  stop(sprintf("Unsupported value type: %s", paste(class(value), collapse = "/")))`,
        `}`,
        ``,
        `.krarkode_json_object <- function(value) {`,
        `  if (!is.list(value)) stop("Expected a named list object")`,
        `  keys <- names(value)`,
        `  if (is.null(keys) || anyNA(keys) || any(keys == "")) {`,
        `    stop("Expected a named list object")`,
        `  }`,
        `  if (any(vapply(value, is.list, logical(1)))) {`,
        `    stop("Nested objects and arrays are not supported")`,
        `  }`,
        `  fields <- vapply(seq_along(value), function(index) {`,
        `    paste0(`,
        `      .krarkode_escape_json_string(keys[[index]]),`,
        `      ":",`,
        `      .krarkode_json_scalar(value[[index]])`,
        `    )`,
        `  }, character(1))`,
        `  paste0("{", paste0(fields, collapse = ","), "}")`,
        `}`,
    ];
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
