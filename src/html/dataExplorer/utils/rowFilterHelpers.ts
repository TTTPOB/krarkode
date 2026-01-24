/**
 * Row filter helper utilities for the Data Explorer.
 * Pure functions for creating and building row filter parameters.
 */

import type {
    RowFilter,
    RowFilterType,
    RowFilterCondition,
    FilterComparisonOp,
    TextSearchType,
    ColumnSchema,
    RowFilterDraft,
    SetRowFiltersFeatures,
} from '../types';
import { ROW_FILTER_TYPE_LABELS } from '../types';

/**
 * Result type for buildRowFilterParams.
 */
export interface RowFilterParamsResult {
    valid: boolean;
    value?: Record<string, unknown>;
    errorMessage?: string;
}

/**
 * Create a new row filter draft from an existing filter or defaults.
 */
export function createRowFilterDraft(
    schema: ColumnSchema[],
    filter?: RowFilter,
    columnIndex?: number,
    supportedTypes?: RowFilterType[]
): RowFilterDraft {
    const fallbackColumnIndex = schema[0]?.column_index ?? 0;
    const selectedColumnIndex = filter?.column_schema.column_index ?? columnIndex ?? fallbackColumnIndex;
    const availableTypes = supportedTypes && supportedTypes.length > 0
        ? supportedTypes
        : (Object.keys(ROW_FILTER_TYPE_LABELS) as RowFilterType[]);
    const selectedType = filter?.filter_type ?? availableTypes[0] ?? 'compare';
    return {
        columnIndex: selectedColumnIndex,
        filterType: selectedType,
        compareOp: (filter?.params as { op?: string })?.op as FilterComparisonOp ?? '=',
        compareValue: (filter?.params as { value?: string })?.value ?? '',
        betweenLeft: (filter?.params as { left_value?: string })?.left_value ?? '',
        betweenRight: (filter?.params as { right_value?: string })?.right_value ?? '',
        searchType: (filter?.params as { search_type?: string })?.search_type as TextSearchType ?? 'contains',
        searchTerm: (filter?.params as { term?: string })?.term ?? '',
        searchCase: (filter?.params as { case_sensitive?: boolean })?.case_sensitive ?? false,
        setValues: ((filter?.params as { values?: string[] })?.values ?? []).join(', '),
        setInclusive: (filter?.params as { inclusive?: boolean })?.inclusive !== false,
        condition: filter?.condition ?? 'and',
    };
}

/**
 * Build row filter params from a draft.
 */
export function buildRowFilterParams(
    filterType: RowFilterType,
    draft: RowFilterDraft
): RowFilterParamsResult {
    switch (filterType) {
        case 'compare':
            if (!draft.compareValue.trim()) {
                return { valid: false, errorMessage: 'Enter a comparison value.' };
            }
            return {
                valid: true,
                value: {
                    op: draft.compareOp,
                    value: draft.compareValue.trim(),
                },
            };
        case 'between':
        case 'not_between':
            if (!draft.betweenLeft.trim() || !draft.betweenRight.trim()) {
                return { valid: false, errorMessage: 'Enter both range values.' };
            }
            return {
                valid: true,
                value: {
                    left_value: draft.betweenLeft.trim(),
                    right_value: draft.betweenRight.trim(),
                },
            };
        case 'search':
            if (!draft.searchTerm.trim()) {
                return { valid: false, errorMessage: 'Enter a search term.' };
            }
            return {
                valid: true,
                value: {
                    search_type: draft.searchType,
                    term: draft.searchTerm.trim(),
                    case_sensitive: draft.searchCase,
                },
            };
        case 'set_membership': {
            const values = draft.setValues
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean);
            if (!values.length) {
                return { valid: false, errorMessage: 'Enter one or more values.' };
            }
            return {
                valid: true,
                value: {
                    values,
                    inclusive: draft.setInclusive,
                },
            };
        }
        default:
            return { valid: true };
    }
}

/**
 * Create a unique row filter ID.
 */
export function createRowFilterId(): string {
    if ('randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `row-filter-${Date.now()}`;
}

/**
 * Get supported row filter types from feature support.
 */
export function getSupportedRowFilterTypes(rowFilterSupport?: SetRowFiltersFeatures): RowFilterType[] {
    const supported = rowFilterSupport?.supported_types
        ?.filter((entry) => entry.support_status === 'supported')
        .map((entry) => entry.row_filter_type);

    if (supported && supported.length > 0) {
        return supported;
    }

    return Object.keys(ROW_FILTER_TYPE_LABELS) as RowFilterType[];
}
