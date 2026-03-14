import type { ColumnProfileResult, InitMessage, RowsMessage } from '../types';

type VscodeMessageHandlers = {
    onInit: (message: InitMessage) => void;
    onRows: (message: RowsMessage) => void;
    onError: (message: string) => void;
    onSearchSchemaResult: (matches: Array<number | string | Record<string, unknown>>) => void;
    onExportResult: (data: string, format: string) => void;
    onColumnProfilesResult: (columnIndex: number, profiles: ColumnProfileResult[], errorMessage?: string) => void;
    onConvertToCodeResult: (code: string, syntax: string) => void;
    onSuggestCodeSyntaxResult: (syntax: string) => void;
};

const isInitMessage = (message: unknown): message is InitMessage => {
    if (!message || typeof message !== 'object') {
        return false;
    }
    const candidate = message as { state?: unknown; schema?: unknown };
    return typeof candidate.state === 'object'
        && candidate.state !== null
        && Array.isArray(candidate.schema);
};

const isRowsMessage = (message: unknown): message is RowsMessage => {
    if (!message || typeof message !== 'object') {
        return false;
    }
    const candidate = message as { startIndex?: unknown; endIndex?: unknown; columns?: unknown };
    return typeof candidate.startIndex === 'number'
        && typeof candidate.endIndex === 'number'
        && Array.isArray(candidate.columns);
};

type VscodeMessageOptions = VscodeMessageHandlers;

export function createMessageHandler(options: VscodeMessageOptions): {
    handler: (event: MessageEvent) => void;
    attach: () => void;
    detach: () => void;
} {
    const handler = (event: MessageEvent): void => {
        const message = event.data as { type?: string; [key: string]: unknown };
        switch (message.type) {
            case 'init':
                if (isInitMessage(message)) {
                    options.onInit(message);
                } else {
                    options.onError('Invalid init message.');
                }
                break;
            case 'rows':
                if (isRowsMessage(message)) {
                    options.onRows(message);
                } else {
                    options.onError('Invalid rows message.');
                }
                break;
            case 'error':
                options.onError(typeof message.message === 'string' ? message.message : 'Unknown error');
                break;
            case 'searchSchemaResult':
                options.onSearchSchemaResult(message.matches as Array<number | string | Record<string, unknown>>);
                break;
            case 'exportResult':
                options.onExportResult(String(message.data ?? ''), String(message.format ?? ''));
                break;
            case 'columnProfilesResult':
                options.onColumnProfilesResult(
                    message.columnIndex as number,
                    message.profiles as ColumnProfileResult[],
                    message.errorMessage as string | undefined
                );
                break;
            case 'convertToCodeResult':
                options.onConvertToCodeResult(String(message.code ?? ''), String(message.syntax ?? ''));
                break;
            case 'suggestCodeSyntaxResult':
                options.onSuggestCodeSyntaxResult(String(message.syntax ?? ''));
                break;
            default:
                break;
        }
    };

    const attach = (): void => {
        window.addEventListener('message', handler);
    };

    const detach = (): void => {
        window.removeEventListener('message', handler);
    };

    return { handler, attach, detach };
}
