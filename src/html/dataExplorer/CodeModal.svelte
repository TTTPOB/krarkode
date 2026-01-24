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
