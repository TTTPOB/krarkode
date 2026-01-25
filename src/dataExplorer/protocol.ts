export interface TableShape {
    num_rows: number;
    num_columns: number;
}

export interface BackendState {
    display_name: string;
    table_shape: TableShape;
    table_unfiltered_shape: TableShape;
    has_row_labels: boolean;
    column_filters?: ColumnFilter[];
    row_filters?: RowFilter[];
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
    type_display: ColumnDisplayType;
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

export interface SearchSchemaFeatures {
    support_status?: SupportStatus;
    supported_types?: ColumnFilterTypeSupportStatus[];
}

export interface SetColumnFiltersFeatures {
    support_status?: SupportStatus;
    supported_types?: ColumnFilterTypeSupportStatus[];
}

export interface SetRowFiltersFeatures {
    support_status?: SupportStatus;
    supports_conditions?: SupportStatus;
    supported_types?: RowFilterTypeSupportStatus[];
}

export interface GetColumnProfilesFeatures {
    support_status?: SupportStatus;
    supported_types?: ColumnProfileTypeSupportStatus[];
}

export interface ExportDataSelectionFeatures {
    support_status?: SupportStatus;
    supported_formats?: ExportFormat[];
}

export interface ConvertToCodeFeatures {
    support_status?: SupportStatus;
    code_syntaxes?: CodeSyntaxName[];
}

export interface SupportedFeatures {
    search_schema?: SearchSchemaFeatures;
    set_column_filters?: SetColumnFiltersFeatures;
    set_row_filters?: SetRowFiltersFeatures;
    get_column_profiles?: GetColumnProfilesFeatures;
    set_sort_columns?: SetSortColumnsFeatures;
    export_data_selection?: ExportDataSelectionFeatures;
    convert_to_code?: ConvertToCodeFeatures;
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

export enum SearchSchemaSortOrder {
    Original = 'original',
    AscendingName = 'ascending_name',
    DescendingName = 'descending_name',
    AscendingType = 'ascending_type',
    DescendingType = 'descending_type'
}

export enum ColumnDisplayType {
    Boolean = 'boolean',
    String = 'string',
    Date = 'date',
    Datetime = 'datetime',
    Time = 'time',
    Interval = 'interval',
    Object = 'object',
    Array = 'array',
    Struct = 'struct',
    Unknown = 'unknown',
    Floating = 'floating',
    Integer = 'integer',
    Decimal = 'decimal'
}

export enum RowFilterCondition {
    And = 'and',
    Or = 'or'
}

export enum RowFilterType {
    Between = 'between',
    Compare = 'compare',
    IsEmpty = 'is_empty',
    IsFalse = 'is_false',
    IsNull = 'is_null',
    IsTrue = 'is_true',
    NotBetween = 'not_between',
    NotEmpty = 'not_empty',
    NotNull = 'not_null',
    Search = 'search',
    SetMembership = 'set_membership'
}

export enum FilterComparisonOp {
    Eq = '=',
    NotEq = '!=',
    Lt = '<',
    LtEq = '<=',
    Gt = '>',
    GtEq = '>='
}

export enum TextSearchType {
    Contains = 'contains',
    NotContains = 'not_contains',
    StartsWith = 'starts_with',
    EndsWith = 'ends_with',
    RegexMatch = 'regex_match'
}

export enum ColumnFilterType {
    TextSearch = 'text_search',
    MatchDataTypes = 'match_data_types'
}

export enum ColumnProfileType {
    NullCount = 'null_count',
    SummaryStats = 'summary_stats',
    SmallFrequencyTable = 'small_frequency_table',
    LargeFrequencyTable = 'large_frequency_table',
    SmallHistogram = 'small_histogram',
    LargeHistogram = 'large_histogram'
}

export enum ColumnHistogramParamsMethod {
    Sturges = 'sturges',
    FreedmanDiaconis = 'freedman_diaconis',
    Scott = 'scott',
    Fixed = 'fixed'
}

export enum TableSelectionKind {
    SingleCell = 'single_cell',
    CellRange = 'cell_range',
    ColumnRange = 'column_range',
    RowRange = 'row_range',
    ColumnIndices = 'column_indices',
    RowIndices = 'row_indices',
    CellIndices = 'cell_indices'
}

export enum ExportFormat {
    Csv = 'csv',
    Tsv = 'tsv',
    Html = 'html'
}

export interface FilterBetween {
    left_value: string;
    right_value: string;
}

export interface FilterComparison {
    op: FilterComparisonOp;
    value: string;
}

export interface FilterSetMembership {
    values: string[];
    inclusive: boolean;
}

export interface FilterTextSearch {
    search_type: TextSearchType;
    term: string;
    case_sensitive: boolean;
}

export interface FilterMatchDataTypes {
    display_types: ColumnDisplayType[];
}

export interface RowFilter {
    filter_id: string;
    filter_type: RowFilterType;
    column_schema: ColumnSchema;
    condition: RowFilterCondition;
    is_valid?: boolean;
    error_message?: string;
    params?: RowFilterParams;
}

export type RowFilterParams = FilterBetween | FilterComparison | FilterTextSearch | FilterSetMembership;

export type ColumnFilterParams = FilterTextSearch | FilterMatchDataTypes;

export interface ColumnFilter {
    filter_type: ColumnFilterType;
    params: ColumnFilterParams;
}

export interface RowFilterTypeSupportStatus {
    row_filter_type: RowFilterType;
    support_status: SupportStatus;
}

export interface ColumnFilterTypeSupportStatus {
    column_filter_type: ColumnFilterType;
    support_status: SupportStatus;
}

export interface ColumnProfileRequest {
    column_index: number;
    profiles: ColumnProfileSpec[];
}

export interface ColumnProfileSpec {
    profile_type: ColumnProfileType;
    params?: ColumnProfileParams;
}

export interface ColumnProfileTypeSupportStatus {
    profile_type: ColumnProfileType;
    support_status: SupportStatus;
}

export interface ColumnHistogramParams {
    method: ColumnHistogramParamsMethod;
    num_bins: number;
    quantiles?: number[];
}

export interface ColumnFrequencyTableParams {
    limit: number;
}

export type ColumnProfileParams = ColumnHistogramParams | ColumnFrequencyTableParams;

export interface ColumnSummaryStats {
    type_display: ColumnDisplayType;
    number_stats?: SummaryStatsNumber;
    string_stats?: SummaryStatsString;
    boolean_stats?: SummaryStatsBoolean;
    date_stats?: SummaryStatsDate;
    datetime_stats?: SummaryStatsDatetime;
    other_stats?: SummaryStatsOther;
}

export interface SummaryStatsNumber {
    min_value?: string;
    max_value?: string;
    mean?: string;
    median?: string;
    stdev?: string;
}

export interface SummaryStatsBoolean {
    true_count: number;
    false_count: number;
}

export interface SummaryStatsOther {
    num_unique?: number;
}

export interface SummaryStatsString {
    num_empty: number;
    num_unique: number;
}

export interface SummaryStatsDate {
    num_unique?: number;
    min_date?: string;
    mean_date?: string;
    median_date?: string;
    max_date?: string;
}

export interface SummaryStatsDatetime {
    num_unique?: number;
    min_date?: string;
    mean_date?: string;
    median_date?: string;
    max_date?: string;
    timezone?: string;
}

export interface ColumnHistogram {
    bin_edges: string[];
    bin_counts: number[];
    quantiles: ColumnQuantileValue[];
}

export interface ColumnFrequencyTable {
    values: ColumnValue[];
    counts: number[];
    other_count?: number;
}

export interface ColumnQuantileValue {
    q: number;
    value: string;
    exact: boolean;
}

export interface ColumnProfileResult {
    null_count?: number;
    summary_stats?: ColumnSummaryStats;
    small_histogram?: ColumnHistogram;
    large_histogram?: ColumnHistogram;
    small_frequency_table?: ColumnFrequencyTable;
    large_frequency_table?: ColumnFrequencyTable;
}

export interface SearchSchemaResult {
    matches: number[];
}

export interface ExportedData {
    data: string;
    format: ExportFormat;
}

export interface ConvertedCode {
    converted_code: string[];
}

export interface CodeSyntaxName {
    code_syntax_name: string;
}

export interface FilterResult {
    selected_num_rows: number;
    had_errors?: boolean;
}

export interface SetDatasetImportOptionsResult {
    error_message?: string;
}

export interface DataSelectionSingleCell {
    row_index: number;
    column_index: number;
}

export interface DataSelectionCellRange {
    first_row_index: number;
    last_row_index: number;
    first_column_index: number;
    last_column_index: number;
}

export interface DataSelectionCellIndices {
    row_indices: number[];
    column_indices: number[];
}

export type Selection = DataSelectionSingleCell | DataSelectionCellRange | DataSelectionCellIndices | DataSelectionRange | DataSelectionIndices;

export interface TableSelection {
    kind: TableSelectionKind;
    selection: Selection;
}

export interface DatasetImportOptions {
    has_header_row?: boolean;
}

export interface OpenDatasetParams {
    uri: string;
}

export interface OpenDatasetResult {
    error_message?: string;
}

export interface SearchSchemaParams {
    filters: ColumnFilter[];
    sort_order: SearchSchemaSortOrder;
}

export interface ExportDataSelectionParams {
    selection: TableSelection;
    format: ExportFormat;
}

export interface ConvertToCodeParams {
    column_filters: ColumnFilter[];
    row_filters: RowFilter[];
    sort_keys: ColumnSortKey[];
    code_syntax_name: CodeSyntaxName;
}

export interface SetColumnFiltersParams {
    filters: ColumnFilter[];
}

export interface SetRowFiltersParams {
    filters: RowFilter[];
}

export interface GetColumnProfilesParams {
    callback_id: string;
    profiles: ColumnProfileRequest[];
    format_options: FormatOptions;
}

export interface SetDatasetImportOptionsParams {
    options: DatasetImportOptions;
}

export interface ReturnColumnProfilesParams {
    callback_id: string;
    profiles: ColumnProfileResult[];
    error_message?: string;
}
