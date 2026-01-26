/**
 * Shared type definitions for the Data Explorer webview.
 */

export interface TableShape {
    num_rows: number;
    num_columns: number;
}

export interface BackendState {
    display_name: string;
    table_shape: TableShape;
    table_unfiltered_shape: TableShape;
    has_row_labels: boolean;
    sort_keys?: ColumnSortKey[];
    supported_features?: SupportedFeatures;
    column_filters?: ColumnFilter[];
    row_filters?: RowFilter[];
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

export interface ColumnFilter {
    filter_type: 'text_search' | 'match_data_types';
    params: {
        search_type?: string;
        term?: string;
        case_sensitive?: boolean;
        display_types?: string[];
    };
}

export type RowFilterType =
    | 'between'
    | 'compare'
    | 'is_empty'
    | 'is_false'
    | 'is_null'
    | 'is_true'
    | 'not_between'
    | 'not_empty'
    | 'not_null'
    | 'search'
    | 'set_membership';

export type RowFilterCondition = 'and' | 'or';

export type FilterComparisonOp = '=' | '!=' | '<' | '<=' | '>' | '>=';

export type TextSearchType = 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'regex_match';

export interface CompareRowFilterParams {
    op: FilterComparisonOp;
    value: string;
}

export interface BetweenRowFilterParams {
    left_value: string;
    right_value: string;
}

export interface SearchRowFilterParams {
    search_type: TextSearchType;
    term: string;
    case_sensitive?: boolean;
}

export interface SetMembershipRowFilterParams {
    values: string[];
    inclusive?: boolean;
}

export type RowFilterParams =
    | CompareRowFilterParams
    | BetweenRowFilterParams
    | SearchRowFilterParams
    | SetMembershipRowFilterParams;

export interface RowFilter {
    filter_id: string;
    filter_type: RowFilterType;
    column_schema: ColumnSchema;
    condition: RowFilterCondition;
    params?: RowFilterParams;
}

export interface ColumnSummaryStats {
    type_display: string;
    number_stats?: {
        min_value?: string;
        max_value?: string;
        mean?: string;
        median?: string;
        stdev?: string;
    };
    string_stats?: {
        num_empty?: number;
        num_unique?: number;
    };
    boolean_stats?: {
        true_count?: number;
        false_count?: number;
    };
    date_stats?: {
        num_unique?: number;
        min_date?: string;
        mean_date?: string;
        median_date?: string;
        max_date?: string;
    };
    datetime_stats?: {
        num_unique?: number;
        min_date?: string;
        mean_date?: string;
        median_date?: string;
        max_date?: string;
        timezone?: string;
    };
    other_stats?: {
        num_unique?: number;
    };
}

export interface ColumnQuantileValue {
    q: number;
    value: string;
    exact: boolean;
}

export interface ColumnHistogram {
    bin_edges: string[];
    bin_counts: number[];
    quantiles?: ColumnQuantileValue[];
}

export interface ColumnFrequencyTable {
    values: ColumnValue[];
    counts: number[];
    other_count?: number;
}

export interface ColumnProfileResult {
    null_count?: number;
    summary_stats?: ColumnSummaryStats;
    small_histogram?: ColumnHistogram;
    large_histogram?: ColumnHistogram;
    small_frequency_table?: ColumnFrequencyTable;
    large_frequency_table?: ColumnFrequencyTable;
}

export interface SetSortColumnsFeatures {
    support_status?: SupportStatus;
}

export interface SearchSchemaFeatures {
    support_status?: SupportStatus;
}

export interface SetColumnFiltersFeatures {
    support_status?: SupportStatus;
}

export interface RowFilterTypeSupportStatus {
    row_filter_type: RowFilterType;
    support_status: SupportStatus;
}

export interface SetRowFiltersFeatures {
    support_status?: SupportStatus;
    supports_conditions?: SupportStatus;
    supported_types?: RowFilterTypeSupportStatus[];
}

export interface SupportedFeatures {
    search_schema?: SearchSchemaFeatures;
    set_column_filters?: SetColumnFiltersFeatures;
    set_row_filters?: SetRowFiltersFeatures;
    set_sort_columns?: SetSortColumnsFeatures;
    [key: string]: unknown;
}

export type ColumnValue = string | number;

export interface RowsMessage {
    startIndex: number;
    endIndex: number;
    columns: ColumnValue[][];
    rowLabels?: string[];
}

export interface InitMessage {
    state: BackendState;
    schema: ColumnSchema[];
}

export type SortDirection = 'asc' | 'desc';

export interface SortState {
    columnIndex: number;
    direction: SortDirection;
}

export type StatsMessageState = 'loading' | 'empty' | 'error';

export type StatsRow = {
    label: string;
    value: string;
};

export type RowFilterDraft = {
    columnIndex: number;
    filterType: RowFilterType;
    compareOp: FilterComparisonOp;
    compareValue: string;
    betweenLeft: string;
    betweenRight: string;
    searchType: TextSearchType;
    searchTerm: string;
    searchCase: boolean;
    setValues: string;
    setInclusive: boolean;
    condition: RowFilterCondition;
};

// Constants
export const ROW_HEIGHT = 26;
export const ROW_BLOCK_SIZE = 200;
export const ROW_PREFETCH_BLOCKS = 1;
export const ROW_REQUEST_DEBOUNCE_MS = 60;
export const COLUMN_WIDTH = 160;
export const MIN_COLUMN_WIDTH = 80;
export const ROW_LABEL_WIDTH = 72;
export const UNNAMED_COLUMN_PREFIX = 'Unnamed';
export const DEFAULT_HISTOGRAM_BINS = 20;
export const DEFAULT_FREQUENCY_LIMIT = 10;
export const HISTOGRAM_BINS_MIN = 5;
export const HISTOGRAM_BINS_MAX = 200;
export const FREQUENCY_LIMIT_MIN = 5;
export const FREQUENCY_LIMIT_MAX = 50;
export const SMALL_HISTOGRAM_MAX_BINS = 80;
export const SMALL_FREQUENCY_MAX_LIMIT = 12;
export const STATS_REFRESH_DEBOUNCE_MS = 300;
export const SIDE_PANEL_MIN_WIDTH = 280;
export const SIDE_PANEL_MAX_WIDTH = 600;

export const ROW_FILTER_TYPE_LABELS: Record<RowFilterType, string> = {
    between: 'Between',
    compare: 'Compare',
    is_empty: 'Is empty',
    is_false: 'Is false',
    is_null: 'Is null',
    is_true: 'Is true',
    not_between: 'Not between',
    not_empty: 'Not empty',
    not_null: 'Not null',
    search: 'Search',
    set_membership: 'Set membership',
};

export const ROW_FILTER_SECTION_MAP: Record<RowFilterType, 'compare' | 'between' | 'search' | 'set' | 'none'> = {
    between: 'between',
    compare: 'compare',
    is_empty: 'none',
    is_false: 'none',
    is_null: 'none',
    is_true: 'none',
    not_between: 'between',
    not_empty: 'none',
    not_null: 'none',
    search: 'search',
    set_membership: 'set',
};

// VS Code API helper
declare const acquireVsCodeApi: () => {
    postMessage: (message: unknown) => void;
};

let vsCodeApi: ReturnType<typeof acquireVsCodeApi> | null = null;

export function getVsCodeApi(): ReturnType<typeof acquireVsCodeApi> {
    if (!vsCodeApi) {
        vsCodeApi = acquireVsCodeApi();
    }
    return vsCodeApi;
}
