/**
 * Numeric helpers for Data Explorer.
 */

export function clampNumber(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(Math.max(Math.round(value), min), max);
}
