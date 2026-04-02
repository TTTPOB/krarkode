<script lang="ts">
    let {
        open = false,
        codePreview = $bindable(''),
        codeSyntax = $bindable('pandas'),
        codeModalEl = $bindable<HTMLDivElement | undefined>(),
        onClose,
        onConvert,
        onCopy,
    }: {
        open?: boolean;
        codePreview?: string;
        codeSyntax?: string;
        codeModalEl?: HTMLDivElement | undefined;
        onClose?: () => void;
        onConvert?: (data: { syntax: string }) => void;
        onCopy?: () => void;
    } = $props();

    let modalContentEl: HTMLDivElement | undefined = $state();

    function handleCodeCopy(): void {
        if (codePreview) {
            navigator.clipboard.writeText(codePreview);
        }
        onCopy?.();
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose?.();
            return;
        }

        // Focus trap: cycle Tab within the modal
        if (event.key === 'Tab' && modalContentEl) {
            const focusable = modalContentEl.querySelectorAll<HTMLElement>(
                'button, select, input, textarea, [tabindex]:not([tabindex="-1"])',
            );
            if (focusable.length === 0) {
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    }

    $effect(() => {
        if (open) {
            // Focus the first interactive element when modal opens
            requestAnimationFrame(() => {
                const first = modalContentEl?.querySelector<HTMLElement>('select, button, input');
                first?.focus();
            });
        }
    });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal" id="code-modal" bind:this={codeModalEl} class:open={open} onkeydown={handleKeydown}>
    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="code-modal-title" bind:this={modalContentEl}>
        <div class="modal-header">
            <span id="code-modal-title">Convert to Code</span>
            <button class="close-btn" id="close-code" aria-label="Close code modal" onclick={() => onClose?.()}>&times;</button>
        </div>
        <div class="modal-body">
            <div class="code-section">
                <label for="code-syntax">Syntax</label>
                <select id="code-syntax" bind:value={codeSyntax}>
                    <option value="pandas">Python (pandas)</option>
                    <option value="polars">Python (polars)</option>
                    <option value="dplyr">R (dplyr)</option>
                    <option value="data.table">R (data.table)</option>
                </select>
            </div>
            <div class="code-actions">
                <button class="action" id="convert-code" onclick={() => onConvert?.({ syntax: codeSyntax })}>Convert</button>
                <button class="action secondary" id="copy-code" onclick={handleCodeCopy}>Copy to Clipboard</button>
            </div>
            <pre id="code-preview">{codePreview}</pre>
        </div>
    </div>
</div>

<style>
    .modal {
        display: none;
        position: fixed;
        z-index: 1000;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
    }

    .modal.open {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .modal-content {
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-editorWidget-border);
        border-radius: 6px;
        width: 80%;
        max-width: 700px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
    }

    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid var(--vscode-editorWidget-border);
        font-weight: 600;
    }

    .close-btn {
        background: none;
        border: none;
        font-size: 1.4em;
        cursor: pointer;
        color: var(--vscode-descriptionForeground);
        padding: 0;
        line-height: 1;
    }

    .close-btn:hover {
        color: var(--vscode-editor-foreground);
    }

    .modal-body {
        padding: 16px;
        overflow-y: auto;
    }

    .code-section {
        margin-bottom: 16px;
    }

    .code-section label {
        display: block;
        margin-bottom: 6px;
        font-weight: 500;
        font-size: 0.9em;
    }

    .code-section select {
        width: 100%;
        padding: 6px 8px;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        color: var(--vscode-dropdown-foreground);
        border-radius: 3px;
        box-sizing: border-box;
    }

    .code-actions {
        display: flex;
        gap: 8px;
        margin-top: 16px;
    }

    .action {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 4px 10px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 0.9em;
    }

    .action:hover {
        background: var(--vscode-button-hoverBackground);
    }

    .action.secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
    }

    .action.secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }

    #code-preview {
        margin-top: 16px;
        padding: 12px;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-editorWidget-border);
        border-radius: 3px;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.9em;
        white-space: pre-wrap;
        overflow-x: auto;
        max-height: 400px;
    }
</style>
