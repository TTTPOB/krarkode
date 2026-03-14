import { type ColumnDef, type Table, createTable, getCoreRowModel } from '@tanstack/table-core';
import { dataStore } from '../stores';
import type { BackendState, ColumnSchema } from '../types';
import { isColumnNamed } from '../utils';

type TableSetupOptions = {
    log: (message: string, payload?: unknown) => void;
    getRowLabel: (rowIndex: number) => string;
    getCellValue: (rowIndex: number, columnIndex: number) => string;
    getColumnLabel: (column: ColumnSchema) => string;
};

export class TableSetupController {
    private readonly log: (message: string, payload?: unknown) => void;
    private readonly getRowLabel: (rowIndex: number) => string;
    private readonly getCellValue: (rowIndex: number, columnIndex: number) => string;
    private readonly getColumnLabel: (column: ColumnSchema) => string;
    private tableInstance: Table<{ index: number }> | null = null;

    constructor(options: TableSetupOptions) {
        this.log = options.log;
        this.getRowLabel = options.getRowLabel;
        this.getCellValue = options.getCellValue;
        this.getColumnLabel = options.getColumnLabel;
    }

    private getBackendState(): BackendState | null {
        return dataStore.backendState;
    }

    private getVisibleSchema(): ColumnSchema[] {
        return dataStore.visibleSchema;
    }

    private getFullSchema(): ColumnSchema[] {
        return dataStore.fullSchema;
    }

    private buildColumnDefs(): ColumnDef<{ index: number }>[] {
        const columns: ColumnDef<{ index: number }>[] = [];
        const backendState = this.getBackendState();

        columns.push({
            id: 'row-label',
            header: backendState?.has_row_labels ? '#' : 'Row',
            accessorFn: (row) => this.getRowLabel(row.index),
        });

        const schema = this.getVisibleSchema();
        for (let i = 0; i < schema.length; i++) {
            const column = schema[i];
            const schemaIndex = i;
            columns.push({
                id: `col-${column.column_index}`,
                header: this.getColumnLabel(column),
                accessorFn: (row) => this.getCellValue(row.index, schemaIndex),
            });
        }

        return columns;
    }

    setupTable(): void {
        const backendState = this.getBackendState();
        if (!backendState) {
            return;
        }

        const rowCount = backendState.table_shape.num_rows;
        const rowData = Array.from({ length: rowCount }, (_, index) => ({ index }));
        const columns = this.buildColumnDefs();

        if (!this.tableInstance) {
            this.tableInstance = createTable<{ index: number }>({
                data: rowData,
                columns,
                getCoreRowModel: getCoreRowModel(),
                state: {},
                onStateChange: () => undefined,
                renderFallbackValue: '',
            });
        } else {
            this.tableInstance.setOptions((prev) => ({
                ...prev,
                data: rowData,
                columns,
            }));
        }

        this.log('Table setup complete', { rowCount, columnCount: columns.length });
    }

    buildTableMetaText(): string {
        const backendState = this.getBackendState();
        if (!backendState) {
            return '';
        }
        const { num_rows } = backendState.table_shape;
        const num_columns = this.getVisibleSchema().length;
        const { num_rows: rawRows, num_columns: rawColumns } = backendState.table_unfiltered_shape;
        const filteredText =
            num_rows !== rawRows || num_columns !== rawColumns ? ` (${rawRows}x${rawColumns} raw)` : '';
        const unnamedCount = this.getFullSchema().filter((column) => !isColumnNamed(column)).length;
        const unnamedText = unnamedCount
            ? ` - ${unnamedCount === this.getFullSchema().length ? 'No column names' : `${unnamedCount} unnamed columns`}`
            : '';
        return `${num_rows}x${num_columns}${filteredText}${unnamedText}`;
    }
}
