<script lang="ts">
    import { createEventDispatcher } from 'svelte';

    type ColumnSchema = {
        column_index: number;
        column_name: string;
        column_label?: string;
    };

    export let schema: ColumnSchema[] = [];
    export let value = '';
    export let getColumnLabel: (column: ColumnSchema) => string =
        (column) => column.column_label ?? column.column_name;

    const dispatch = createEventDispatcher<{ change: void }>();

    function handleChange(): void {
        dispatch('change');
    }
</script>

<div class="stats-section">
    <label for="stats-column">Select Column</label>
    <select id="stats-column" bind:value={value} on:change={handleChange}>
        <option value="">Choose column...</option>
        {#each schema as column}
            <option value={column.column_index}>{getColumnLabel(column)}</option>
        {/each}
    </select>
</div>
