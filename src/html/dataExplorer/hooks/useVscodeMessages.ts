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

export function useVscodeMessages(handlers: VscodeMessageHandlers): void {
    const handleMessage = (event: MessageEvent): void => {
        const message = event.data as { type?: string; [key: string]: unknown };
        switch (message.type) {
            case 'init':
                handlers.onInit(message as InitMessage);
                break;
            case 'rows':
                handlers.onRows(message as RowsMessage);
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
