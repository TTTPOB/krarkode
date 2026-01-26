/**
 * Stats helpers for Data Explorer.
 */

import type { ColumnProfileResult } from '../types';
import { clampNumber } from './number';

export interface ColumnProfileRequest {
    histogramBinsValue: number;
    frequencyLimitValue: number;
    histogramProfile: 'large_histogram' | 'small_histogram';
    frequencyProfile: 'large_frequency_table' | 'small_frequency_table';
    profileTypes: string[];
    histogramParams: {
        method: string;
        num_bins: number;
        quantiles: number[];
    };
    frequencyParams: {
        limit: number;
    };
}

export function buildColumnProfileRequest(options: {
    histogramBins: number;
    histogramMethod: string;
    frequencyLimit: number;
    histogramBinsMin: number;
    histogramBinsMax: number;
    histogramBinsDefault: number;
    frequencyLimitMin: number;
    frequencyLimitMax: number;
    frequencyLimitDefault: number;
    smallHistogramMaxBins: number;
    smallFrequencyMaxLimit: number;
}): ColumnProfileRequest {
    const {
        histogramBins,
        histogramMethod,
        frequencyLimit,
        histogramBinsMin,
        histogramBinsMax,
        histogramBinsDefault,
        frequencyLimitMin,
        frequencyLimitMax,
        frequencyLimitDefault,
        smallHistogramMaxBins,
        smallFrequencyMaxLimit,
    } = options;

    const histogramBinsValue = clampNumber(histogramBins, histogramBinsMin, histogramBinsMax, histogramBinsDefault);
    const frequencyLimitValue = clampNumber(
        frequencyLimit,
        frequencyLimitMin,
        frequencyLimitMax,
        frequencyLimitDefault,
    );
    const histogramProfile = histogramBinsValue > smallHistogramMaxBins ? 'large_histogram' : 'small_histogram';
    const frequencyProfile =
        frequencyLimitValue > smallFrequencyMaxLimit ? 'large_frequency_table' : 'small_frequency_table';
    const profileTypes = ['null_count', 'summary_stats', histogramProfile, frequencyProfile];
    const histogramParams = {
        method: histogramMethod,
        num_bins: histogramBinsValue,
        quantiles: [0.25, 0.5, 0.75],
    };
    const frequencyParams = {
        limit: frequencyLimitValue,
    };

    return {
        histogramBinsValue,
        frequencyLimitValue,
        histogramProfile,
        frequencyProfile,
        profileTypes,
        histogramParams,
        frequencyParams,
    };
}

export function mergeColumnProfiles(profiles: ColumnProfileResult[]): ColumnProfileResult {
    const combined: ColumnProfileResult = {};
    for (const profile of profiles) {
        if (profile.null_count !== undefined) {
            combined.null_count = profile.null_count;
        }
        if (profile.summary_stats) {
            combined.summary_stats = profile.summary_stats;
        }
        if (profile.small_histogram) {
            combined.small_histogram = profile.small_histogram;
        }
        if (profile.large_histogram) {
            combined.large_histogram = profile.large_histogram;
        }
        if (profile.small_frequency_table) {
            combined.small_frequency_table = profile.small_frequency_table;
        }
        if (profile.large_frequency_table) {
            combined.large_frequency_table = profile.large_frequency_table;
        }
    }
    return combined;
}
