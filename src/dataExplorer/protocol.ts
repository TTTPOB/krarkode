import type { ColumnProfileResult } from './protocol.generated';

export * from './protocol.generated';

export {
    ColumnDisplayTypeElement as ColumnDisplayType,
    ColumnFilterTypeEnum as ColumnFilterType,
    ColumnProfileTypeEnum as ColumnProfileType,
    Condition as RowFilterCondition,
    ExportFormatElement as ExportFormat,
    Kind as TableSelectionKind,
    Method as ColumnHistogramParamsMethod,
    Op as FilterComparisonOp,
    RowFilterTypeEnum as RowFilterType,
    SortOrder as SearchSchemaSortOrder,
    TextSearchTypeEnum as TextSearchType,
} from './protocol.generated';

export type {
    ColumnFilterElement as ColumnFilter,
    ColumnFilterParamsObject as ColumnFilterParams,
    ColumnFilterTypeSupportStatusElement as ColumnFilterTypeSupportStatus,
    ColumnProfileSpecElement as ColumnProfileSpec,
    ColumnProfileTypeSupportStatusElement as ColumnProfileTypeSupportStatus,
    ColumnQuantileValueElement as ColumnQuantileValue,
    ColumnSortKeyElement as ColumnSortKey,
    CodeSyntaxNameResult as CodeSyntaxName,
    ConvertToCode as ConvertToCodeFeatures,
    DataSelectionCellIndicesObject as DataSelectionCellIndices,
    DataSelectionCellRangeObject as DataSelectionCellRange,
    DataSelectionIndicesObject as DataSelectionIndices,
    DataSelectionRangeObject as DataSelectionRange,
    DataSelectionSingleCellObject as DataSelectionSingleCell,
    DateStats as SummaryStatsDate,
    DatetimeStats as SummaryStatsDatetime,
    ExportDataSelection as ExportDataSelectionFeatures,
    FilterMatchDataTypesObject as FilterMatchDataTypes,
    FilterTextSearchObject as FilterTextSearch,
    GetColumnProfiles as GetColumnProfilesFeatures,
    NumberStats as SummaryStatsNumber,
    BooleanStats as SummaryStatsBoolean,
    OtherStats as SummaryStatsOther,
    RowFilterElement as RowFilter,
    RowFilterParamsObject as RowFilterParams,
    RowFilterTypeSupportStatusElement as RowFilterTypeSupportStatus,
    SearchSchema as SearchSchemaFeatures,
    SetColumnFilters as SetColumnFiltersFeatures,
    SetRowFilters as SetRowFiltersFeatures,
    SetSortColumns as SetSortColumnsFeatures,
    StringStats as SummaryStatsString,
    SummaryStats as ColumnSummaryStats,
    TableSelectionObject as TableSelection,
} from './protocol.generated';

export type ColumnValue = number | string;

export interface ReturnColumnProfilesParams {
    callback_id: string;
    profiles: ColumnProfileResult[];
    error_message?: string;
}
