import { onMount } from 'svelte';
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

export function useVscodeMessages(handlers: VscodeMessageHandlers): void {
    const handleMessage = (event: MessageEvent): void => {
        const message = event.data as { type?: string; [key: string]: unknown };
        switch (message.type) {
            case 'init':
                if (isInitMessage(message)) {
                    handlers.onInit(message);
                } else {
                    handlers.onError('Invalid init message.');
                }
                break;
            case 'rows':
                if (isRowsMessage(message)) {
                    handlers.onRows(message);
                } else {
                    handlers.onError('Invalid rows message.');
                }
                break;
            case 'error':
                handlers.onError(typeof message.message === 'string' ? message.message : 'Unknown error');
                break;
            case 'searchSchemaResult':
                handlers.onSearchSchemaResult(message.matches as Array<number | string | Record<string, unknown>>);
                break;
            case 'exportResult':
                handlers.onExportResult(String(message.data ?? ''), String(message.format ?? ''));
                break;
            case 'columnProfilesResult':
                handlers.onColumnProfilesResult(
                    message.columnIndex as number,
                    message.profiles as ColumnProfileResult[],
                    message.errorMessage as string | undefined
                );
                break;
            case 'convertToCodeResult':
                handlers.onConvertToCodeResult(String(message.code ?? ''), String(message.syntax ?? ''));
                break;
            case 'suggestCodeSyntaxResult':
                handlers.onSuggestCodeSyntaxResult(String(message.syntax ?? ''));
                break;
            default:
                break;
        }
    };

    onMount(() => {
        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
        };
    });
}
