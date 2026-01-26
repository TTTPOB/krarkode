type ExportControllerOptions = {
    postMessage: (message: unknown) => void;
    getCodeSyntax: () => string;
    setCodePreview: (value: string) => void;
    setCodeSyntax: (value: string) => void;
};

export function useExportController(options: ExportControllerOptions) {
    const { postMessage, getCodeSyntax, setCodePreview, setCodeSyntax } = options;

    const handleExportResult = (data: string, format: string): void => {
        const blob = new Blob([data], { type: format === 'html' ? 'text/html' : 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `export.${format === 'csv' ? 'csv' : format === 'tsv' ? 'tsv' : 'html'}`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleConvertToCodeResult = (code: string): void => {
        setCodePreview(code || '(No code generated)');
    };

    const handleSuggestCodeSyntaxResult = (syntax: string): void => {
        setCodeSyntax(syntax);
    };

    const handleCodeConvert = (): void => {
        postMessage({ type: 'convertToCode', syntax: getCodeSyntax() });
    };

    const handleExport = (format: 'csv' | 'tsv' | 'html'): void => {
        postMessage({ type: 'exportData', format });
    };

    return {
        handleExportResult,
        handleConvertToCodeResult,
        handleSuggestCodeSyntaxResult,
        handleCodeConvert,
        handleExport,
    };
}
