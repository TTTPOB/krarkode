import { writable } from 'svelte/store';
import type { StatsMessageState, StatsRow } from '../types';
import { DEFAULT_FREQUENCY_LIMIT, DEFAULT_HISTOGRAM_BINS } from '../types';

export const statsMessageText = writable('Select a column to view statistics.');
export const statsMessageState = writable<StatsMessageState>('empty');
export const statsSectionsVisible = writable(false);
export const statsControlsEnabled = writable(false);
export const statsOverviewRows = writable<StatsRow[]>([]);
export const statsSummaryRows = writable<StatsRow[]>([]);
export const statsOverviewEmptyMessage = writable('No overview data.');
export const statsSummaryEmptyMessage = writable('No summary statistics.');
export const frequencyFootnote = writable('');
export const histogramBins = writable(DEFAULT_HISTOGRAM_BINS);
export const histogramMethod = writable('freedman_diaconis');
export const frequencyLimit = writable(DEFAULT_FREQUENCY_LIMIT);
export const histogramVisible = writable(false);
export const frequencyVisible = writable(false);
