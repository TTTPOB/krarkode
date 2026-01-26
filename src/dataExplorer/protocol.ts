import type { ColumnProfileResult } from './protocol.generated';

export * from './protocol.generated';

export type {
    ColumnDisplayTypeElement as ColumnDisplayType,
    ColumnFilterParamsObject as ColumnFilterParams,
    ColumnFilterTypeEnum as ColumnFilterType,
    ColumnProfileSpecElement as ColumnProfileSpec,
    ColumnProfileTypeEnum as ColumnProfileType,
    ColumnQuantileValueElement as ColumnQuantileValue,
    ColumnSortKeyElement as ColumnSortKey,
    CodeSyntaxNameResult as CodeSyntaxName,
    Condition as RowFilterCondition,
    DataSelectionCellIndicesObject as DataSelectionCellIndices,
    DataSelectionCellRangeObject as DataSelectionCellRange,
    DataSelectionIndicesObject as DataSelectionIndices,
    DataSelectionRangeObject as DataSelectionRange,
    DataSelectionSingleCellObject as DataSelectionSingleCell,
    DateStats as SummaryStatsDate,
    DatetimeStats as SummaryStatsDatetime,
    ExportFormatElement as ExportFormat,
    FilterMatchDataTypesObject as FilterMatchDataTypes,
    FilterTextSearchObject as FilterTextSearch,
    Kind as TableSelectionKind,
    Method as ColumnHistogramParamsMethod,
    NumberStats as SummaryStatsNumber,
    BooleanStats as SummaryStatsBoolean,
    OtherStats as SummaryStatsOther,
    Op as FilterComparisonOp,
    RowFilterParamsObject as RowFilterParams,
    RowFilterTypeEnum as RowFilterType,
    SortOrder as SearchSchemaSortOrder,
    StringStats as SummaryStatsString,
    SummaryStats as ColumnSummaryStats,
    TextSearchTypeEnum as TextSearchType,
} from './protocol.generated';

export type ColumnValue = number | string;

export interface ReturnColumnProfilesParams {
    callback_id: string;
    profiles: ColumnProfileResult[];
    error_message?: string;
}
