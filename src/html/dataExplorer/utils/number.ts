/**
 * Numeric helpers for Data Explorer.
 */

export function clampNumber(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(Math.max(Math.round(value), min), max);
}

/**
 * Format a numeric value to a given number of significant digits.
 * Non-finite or non-numeric values are returned as-is.
 */
export function formatSignificant(value: unknown, digits: number = 3): string {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
        return String(value);
    }
    // Integers that fit within significant digits don't need formatting
    if (Number.isInteger(num) && Math.abs(num) < Math.pow(10, digits)) {
        return String(num);
    }
    return num.toPrecision(digits);
}
