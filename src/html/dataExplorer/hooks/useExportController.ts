import { uiStore } from '../stores';

type ExportControllerOptions = {
    postMessage: (message: unknown) => void;
};

export class ExportController {
    private readonly postMessage: (message: unknown) => void;

    constructor(options: ExportControllerOptions) {
        this.postMessage = options.postMessage;
    }

    handleExportResult(data: string, format: string): void {
        const blob = new Blob([data], { type: format === 'html' ? 'text/html' : 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `export.${format === 'csv' ? 'csv' : format === 'tsv' ? 'tsv' : 'html'}`;
        a.click();
        URL.revokeObjectURL(url);
    }

    handleConvertToCodeResult(code: string): void {
        uiStore.codePreview = code || '(No code generated)';
    }

    handleSuggestCodeSyntaxResult(syntax: string): void {
        uiStore.codeSyntax = syntax;
    }

    handleCodeConvert(): void {
        this.postMessage({ type: 'convertToCode', syntax: uiStore.codeSyntax });
    }

    handleExport(format: 'csv' | 'tsv' | 'html'): void {
        this.postMessage({ type: 'exportData', format });
    }
}
