export interface TableShape {
    num_rows: number;
    num_columns: number;
}

export interface BackendState {
    display_name: string;
    table_shape: TableShape;
    table_unfiltered_shape: TableShape;
    has_row_labels: boolean;
    column_filters?: unknown[];
    row_filters?: unknown[];
    sort_keys?: ColumnSortKey[];
    supported_features?: SupportedFeatures;
    connected?: boolean;
    error_message?: string;
}

export interface ColumnSchema {
    column_name: string;
    column_label?: string;
    column_index: number;
    type_name: string;
    type_display: string;
    description?: string;
}

export type SupportStatus = 'supported' | 'unsupported';

export interface ColumnSortKey {
    column_index: number;
    ascending: boolean;
}

export interface SetSortColumnsFeatures {
    support_status?: SupportStatus;
}

export interface SupportedFeatures {
    set_sort_columns?: SetSortColumnsFeatures;
    [key: string]: unknown;
}

export interface TableSchema {
    columns: ColumnSchema[];
}

export type ColumnValue = string | number;

export interface TableData {
    columns: Array<Array<ColumnValue>>;
}

export interface TableRowLabels {
    row_labels: Array<Array<string>>;
}

export interface FormatOptions {
    large_num_digits: number;
    small_num_digits: number;
    max_integral_digits: number;
    max_value_length: number;
    thousands_sep?: string | null;
}

export interface DataSelectionRange {
    first_index: number;
    last_index: number;
}

export interface DataSelectionIndices {
    indices: number[];
}

export type ArraySelection = DataSelectionRange | DataSelectionIndices;

export interface ColumnSelection {
    column_index: number;
    spec: ArraySelection;
}
