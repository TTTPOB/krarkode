/**
 * Feature support detection utilities for the Data Explorer.
 * Pure functions for checking backend feature availability.
 */

import type {
    BackendState,
    SetRowFiltersFeatures,
    SearchSchemaFeatures,
    SetColumnFiltersFeatures,
} from '../types';

/**
 * Check if row filtering is supported.
 */
export function isRowFilterSupported(rowFilterSupport?: SetRowFiltersFeatures): boolean {
    const supportStatus = rowFilterSupport?.support_status;
    if (!supportStatus) {
        return true;
    }
    return supportStatus === 'supported';
}

/**
 * Check if column filtering (search_schema) is supported.
 */
export function isColumnFilterSupported(columnFilterSupport?: SearchSchemaFeatures): boolean {
    const supportStatus = columnFilterSupport?.support_status;
    if (!supportStatus) {
        return true;
    }
    return supportStatus === 'supported';
}

/**
 * Check if set_column_filters is supported.
 */
export function isSetColumnFiltersSupported(setColumnFilterSupport?: SetColumnFiltersFeatures): boolean {
    const supportStatus = setColumnFilterSupport?.support_status;
    if (!supportStatus) {
        return true;
    }
    return supportStatus === 'supported';
}

/**
 * Check if row filter conditions (and/or) are supported.
 */
export function supportsRowFilterConditions(rowFilterSupport?: SetRowFiltersFeatures): boolean {
    const supportStatus = rowFilterSupport?.supports_conditions;
    if (!supportStatus) {
        return true;
    }
    return supportStatus === 'supported';
}

/**
 * Check if sorting is supported.
 */
export function isSortSupported(state: BackendState | null): boolean {
    const status = state?.supported_features?.set_sort_columns?.support_status;
    if (!status) {
        return true;
    }
    return status === 'supported';
}
