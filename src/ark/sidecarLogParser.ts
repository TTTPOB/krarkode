import type { LogLevel } from '../logging/logger';

export type ParsedSidecarLog = {
    level: LogLevel;
    message: string;
};

type RecordValue = Record<string, unknown>;

export function parseSidecarJsonLog(line: string): ParsedSidecarLog | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        return undefined;
    }

    if (!isRecord(parsed)) {
        return undefined;
    }

    const level = parseLogLevel(parsed.level) ?? 'info';
    const fields = isRecord(parsed.fields) ? parsed.fields : undefined;
    const message = extractMessage(parsed, fields, line);
    return { level, message };
}

function extractMessage(parsed: RecordValue, fields: RecordValue | undefined, fallback: string): string {
    const baseMessage =
        typeof fields?.message === 'string' ? fields.message : typeof parsed.message === 'string' ? parsed.message : '';
    const suffix = fields ? formatFieldSuffix(fields) : '';
    if (baseMessage && suffix) {
        return `${baseMessage} ${suffix}`;
    }
    if (baseMessage) {
        return baseMessage;
    }
    if (suffix) {
        return suffix;
    }
    return fallback;
}

function formatFieldSuffix(fields: RecordValue): string {
    const entries = Object.entries(fields).filter(([key]) => key !== 'message');
    if (entries.length === 0) {
        return '';
    }
    return entries.map(([key, value]) => `${key}=${formatFieldValue(value)}`).join(' ');
}

function formatFieldValue(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return JSON.stringify(value);
}

function parseLogLevel(value: unknown): LogLevel | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.toLowerCase();
    if (
        normalized === 'trace' ||
        normalized === 'debug' ||
        normalized === 'info' ||
        normalized === 'warn' ||
        normalized === 'error'
    ) {
        return normalized as LogLevel;
    }
    return undefined;
}

function isRecord(value: unknown): value is RecordValue {
    return typeof value === 'object' && value !== null;
}
