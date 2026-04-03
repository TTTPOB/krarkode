<script lang="ts">
    let { message, detail }: { message: string | undefined; detail: string | undefined } = $props();
</script>

{#if message}
    <div class="error-banner">
        <div class="error-title">{message}</div>
        {#if detail}
            <div class="error-detail">{detail}</div>
        {/if}
    </div>
{/if}

<style>
    .error-banner {
        padding: 6px 8px;
        border-bottom: 1px solid var(--vscode-inputValidation-errorBorder);
        background-color: var(--vscode-inputValidation-errorBackground);
        color: var(--vscode-inputValidation-errorForeground);
        font-size: 0.9em;
    }

    .error-detail {
        margin-top: 2px;
        font-size: 0.85em;
        opacity: 0.8;
    }
</style>
