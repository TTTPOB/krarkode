/**
 * Statistics store for the Data Explorer.
 * Manages statistics panel display state.
 * Svelte 5 runes class singleton.
 */

import type { StatsMessageState, StatsRow } from '../types';
import { DEFAULT_FREQUENCY_LIMIT, DEFAULT_HISTOGRAM_BINS } from '../types';

class StatsStore {
    messageText = $state('Select a column to view statistics.');
    messageState = $state<StatsMessageState>('empty');
    sectionsVisible = $state(false);
    controlsEnabled = $state(false);
    overviewRows = $state<StatsRow[]>([]);
    summaryRows = $state<StatsRow[]>([]);
    overviewEmptyMessage = $state('No overview data.');
    summaryEmptyMessage = $state('No summary statistics.');
    frequencyFootnote = $state('');
    histogramBins = $state(DEFAULT_HISTOGRAM_BINS);
    histogramMethod = $state('freedman_diaconis');
    frequencyLimit = $state(DEFAULT_FREQUENCY_LIMIT);
    histogramVisible = $state(false);
    frequencyVisible = $state(false);
}

export const statsStore = new StatsStore();
