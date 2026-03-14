<script lang="ts">
    import type { ColumnSchema } from '../types';

    let {
        schema = [],
        value = $bindable(''),
        getColumnLabel = (column: ColumnSchema) => column.column_label ?? column.column_name,
        onChange,
    }: {
        schema?: ColumnSchema[];
        value?: string;
        getColumnLabel?: (column: ColumnSchema) => string;
        onChange?: () => void;
    } = $props();
</script>

<div class="stats-section">
    <label for="stats-column">Select Column</label>
    <select id="stats-column" bind:value={value} onchange={() => onChange?.()}>
        <option value="">Choose column...</option>
        {#each schema as column}
            <option value={String(column.column_index)}>{getColumnLabel(column)}</option>
        {/each}
    </select>
</div>
