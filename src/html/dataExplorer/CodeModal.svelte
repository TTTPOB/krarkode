<script lang="ts">
    import { createEventDispatcher } from 'svelte';

    export let open = false;
    export let codePreview = '';
    export let codeSyntax = 'pandas';

    // Expose modal element for click-outside detection
    export let codeModalEl: HTMLDivElement | undefined = undefined;

    const dispatch = createEventDispatcher<{
        close: void;
        convert: { syntax: string };
        copy: void;
    }>();

    function handleCodeCopy(): void {
        if (codePreview) {
            navigator.clipboard.writeText(codePreview);
        }
        dispatch('copy');
    }
</script>

<div class="modal" id="code-modal" bind:this={codeModalEl} class:open={open}>
    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="code-modal-title">
        <div class="modal-header">
            <span id="code-modal-title">Convert to Code</span>
            <button class="close-btn" id="close-code" aria-label="Close code modal" on:click={() => dispatch('close')}>&times;</button>
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
                <button class="action" id="convert-code" on:click={() => dispatch('convert', { syntax: codeSyntax })}>Convert</button>
                <button class="action secondary" id="copy-code" on:click={handleCodeCopy}>Copy to Clipboard</button>
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
