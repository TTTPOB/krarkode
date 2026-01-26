/**
 * Table layout helpers for Data Explorer.
 */

import type { ColumnSchema } from '../types';
import { COLUMN_WIDTH, MIN_COLUMN_WIDTH, ROW_LABEL_WIDTH } from '../types';

export interface RenderColumn {
    column: ColumnSchema;
    schemaIndex: number;
}

export interface ColumnWindowResult {
    renderColumns: RenderColumn[];
    leftSpacerWidth: number;
    rightSpacerWidth: number;
    startIndex: number;
    endIndex: number;
    windowKey: string;
}

export function resolveColumnWidth(width: number | undefined): number {
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
        return COLUMN_WIDTH;
    }
    return Math.max(MIN_COLUMN_WIDTH, Math.round(width));
}

export function buildColumnOffsets(widths: number[]): number[] {
    const offsets: number[] = [];
    let running = 0;
    for (const width of widths) {
        offsets.push(running);
        running += width;
    }
    return offsets;
}

export function findColumnStartIndex(offsets: number[], widths: number[], leftEdge: number): number {
    let low = 0;
    let high = Math.max(0, widths.length - 1);
    let result = 0;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const end = offsets[mid] + widths[mid];
        if (end >= leftEdge) {
            result = mid;
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }
    return result;
}

export function findColumnEndIndex(offsets: number[], widths: number[], rightEdge: number): number {
    let low = 0;
    let high = Math.max(0, widths.length - 1);
    let result = high;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const start = offsets[mid];
        if (start <= rightEdge) {
            result = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return result;
}

export function computeColumnWindow(options: {
    schema: ColumnSchema[];
    widths: number[];
    scrollLeft: number;
    viewportWidth: number;
    virtualizationThreshold: number;
    rowLabelWidth?: number;
    overscanRatio?: number;
}): ColumnWindowResult {
    const {
        schema,
        widths,
        scrollLeft,
        viewportWidth,
        virtualizationThreshold,
        rowLabelWidth = ROW_LABEL_WIDTH,
        overscanRatio = 0.5,
    } = options;
    const columnCount = schema.length;

    if (columnCount === 0) {
        return {
            renderColumns: [],
            leftSpacerWidth: 0,
            rightSpacerWidth: 0,
            startIndex: 0,
            endIndex: -1,
            windowKey: 'empty',
        };
    }

    if (columnCount < virtualizationThreshold || viewportWidth <= 0) {
        const renderColumns = schema.map((column, index) => ({ column, schemaIndex: index }));
        return {
            renderColumns,
            leftSpacerWidth: 0,
            rightSpacerWidth: 0,
            startIndex: 0,
            endIndex: columnCount - 1,
            windowKey: `0-${columnCount - 1}-0-0`,
        };
    }

    const offsets = buildColumnOffsets(widths);
    const totalColumnsWidth = offsets.length > 0 ? offsets[offsets.length - 1] + widths[widths.length - 1] : 0;
    const overscanPx = Math.max(rowLabelWidth, Math.floor(viewportWidth * overscanRatio));
    const labelOverlap = Math.max(0, rowLabelWidth - scrollLeft);
    const columnViewportWidth = Math.max(0, viewportWidth - labelOverlap);
    const columnScrollLeft = Math.max(0, scrollLeft - rowLabelWidth);
    const leftEdge = Math.max(0, columnScrollLeft - overscanPx);
    const rightEdge = columnScrollLeft + columnViewportWidth + overscanPx;

    const startIndex = findColumnStartIndex(offsets, widths, leftEdge);
    const endIndex = findColumnEndIndex(offsets, widths, rightEdge);

    const renderColumns = schema
        .slice(startIndex, endIndex + 1)
        .map((column, index) => ({ column, schemaIndex: startIndex + index }));

    const leftSpacerWidth = offsets[startIndex] ?? 0;
    const endOffset = (offsets[endIndex] ?? 0) + (widths[endIndex] ?? 0);
    const rightSpacerWidth = Math.max(0, totalColumnsWidth - endOffset);

    return {
        renderColumns,
        leftSpacerWidth,
        rightSpacerWidth,
        startIndex,
        endIndex,
        windowKey: `${startIndex}-${endIndex}-${leftSpacerWidth}-${rightSpacerWidth}`,
    };
}
