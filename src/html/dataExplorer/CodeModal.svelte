<script lang="ts">
    import { createEventDispatcher } from 'svelte';

    export let open = false;
    export let codePreview = '';
    export let codeSyntax = 'pandas';

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

<div class="modal" id="code-modal" class:open={open}>
    <div class="modal-content">
        <div class="modal-header">
            <span>Convert to Code</span>
            <button class="close-btn" id="close-code" on:click={() => dispatch('close')}>&times;</button>
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
