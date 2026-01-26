import { type ColumnDef, type Table, createTable, getCoreRowModel } from '@tanstack/table-core';
import type { BackendState, ColumnSchema } from '../types';
import { isColumnNamed } from '../utils';

type TableSetupOptions = {
    log: (message: string, payload?: unknown) => void;
    getBackendState: () => BackendState | null;
    getVisibleSchema: () => ColumnSchema[];
    getFullSchema: () => ColumnSchema[];
    getRowLabel: (rowIndex: number) => string;
    getCellValue: (rowIndex: number, columnIndex: number) => string;
    getColumnLabel: (column: ColumnSchema) => string;
};

export function useTableSetupController(options: TableSetupOptions) {
    const { log, getBackendState, getVisibleSchema, getFullSchema, getRowLabel, getCellValue, getColumnLabel } =
        options;

    interface RowData {
        index: number;
    }

    let tableInstance: Table<RowData> | null = null;

    const buildColumnDefs = (): ColumnDef<RowData>[] => {
        const columns: ColumnDef<RowData>[] = [];
        const backendState = getBackendState();

        columns.push({
            id: 'row-label',
            header: backendState?.has_row_labels ? '#' : 'Row',
            accessorFn: (row) => getRowLabel(row.index),
        });

        const schema = getVisibleSchema();
        for (let i = 0; i < schema.length; i++) {
            const column = schema[i];
            const schemaIndex = i;
            columns.push({
                id: `col-${column.column_index}`,
                header: getColumnLabel(column),
                accessorFn: (row) => getCellValue(row.index, schemaIndex),
            });
        }

        return columns;
    };

    const setupTable = (): void => {
        const backendState = getBackendState();
        if (!backendState) {
            return;
        }

        const rowCount = backendState.table_shape.num_rows;
        const rowData: RowData[] = Array.from({ length: rowCount }, (_, index) => ({ index }));
        const columns = buildColumnDefs();

        if (!tableInstance) {
            tableInstance = createTable<RowData>({
                data: rowData,
                columns,
                getCoreRowModel: getCoreRowModel(),
                state: {},
                onStateChange: () => undefined,
                renderFallbackValue: '',
            });
        } else {
            tableInstance.setOptions((prev) => ({
                ...prev,
                data: rowData,
                columns,
            }));
        }

        log('Table setup complete', { rowCount, columnCount: columns.length });
    };

    const buildTableMetaText = (): string => {
        const backendState = getBackendState();
        if (!backendState) {
            return '';
        }
        const { num_rows } = backendState.table_shape;
        const num_columns = getVisibleSchema().length;
        const { num_rows: rawRows, num_columns: rawColumns } = backendState.table_unfiltered_shape;
        const filteredText =
            num_rows !== rawRows || num_columns !== rawColumns ? ` (${rawRows}x${rawColumns} raw)` : '';
        const unnamedCount = getFullSchema().filter((column) => !isColumnNamed(column)).length;
        const unnamedText = unnamedCount
            ? ` - ${unnamedCount === getFullSchema().length ? 'No column names' : `${unnamedCount} unnamed columns`}`
            : '';
        return `${num_rows}x${num_columns}${filteredText}${unnamedText}`;
    };

    return {
        setupTable,
        buildTableMetaText,
    };
}
