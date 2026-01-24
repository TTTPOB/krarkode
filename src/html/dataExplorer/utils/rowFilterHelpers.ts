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
    RowFilterParams,
} from '../types';
import { ROW_FILTER_TYPE_LABELS } from '../types';

/**
 * Result type for buildRowFilterParams.
 */
export interface RowFilterParamsResult {
    valid: boolean;
    value?: RowFilterParams;
    errorMessage?: string;
}

/**
 * Create a new row filter draft from an existing filter or defaults.
 */
export function createRowFilterDraft(
    schema: ColumnSchema[] = [],
    filter?: RowFilter,
    columnIndex?: number,
    supportedTypes?: RowFilterType[]
): RowFilterDraft {
    const params = filter?.params;
    const fallbackColumnIndex = schema[0]?.column_index ?? 0;
    const selectedColumnIndex = filter?.column_schema.column_index ?? columnIndex ?? fallbackColumnIndex;
    const availableTypes = supportedTypes && supportedTypes.length > 0
        ? supportedTypes
        : (Object.keys(ROW_FILTER_TYPE_LABELS) as RowFilterType[]);
    const selectedType = filter?.filter_type ?? availableTypes[0] ?? 'compare';
    return {
        columnIndex: selectedColumnIndex,
        filterType: selectedType,
        compareOp: params && 'op' in params ? params.op : '=',
        compareValue: params && 'value' in params ? params.value : '',
        betweenLeft: params && 'left_value' in params ? params.left_value : '',
        betweenRight: params && 'right_value' in params ? params.right_value : '',
        searchType: params && 'search_type' in params ? params.search_type : 'contains',
        searchTerm: params && 'term' in params ? params.term : '',
        searchCase: params && 'case_sensitive' in params ? params.case_sensitive ?? false : false,
        setValues: params && 'values' in params ? params.values.join(', ') : '',
        setInclusive: params && 'inclusive' in params ? params.inclusive !== false : true,
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
