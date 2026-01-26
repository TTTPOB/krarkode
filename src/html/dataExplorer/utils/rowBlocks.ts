/**
 * Row block range helpers for Data Explorer.
 */

export interface RowBlockRange {
    startBlock: number;
    endBlock: number;
}

export interface RowBlockRangeResult {
    ranges: RowBlockRange[];
    visibleRange: { startBlock: number; endBlock: number };
    prefetchRange: { startBlock: number; endBlock: number };
}

export function buildRowBlockRanges(options: {
    startIndex: number;
    endIndex: number;
    rowCount: number;
    blockSize: number;
    prefetchBlocks: number;
    loadedBlocks: Set<number>;
    loadingBlocks: Set<number>;
}): RowBlockRangeResult | null {
    const { startIndex, endIndex, rowCount, blockSize, prefetchBlocks, loadedBlocks, loadingBlocks } = options;

    if (rowCount <= 0 || blockSize <= 0) {
        return null;
    }

    const maxBlock = Math.max(Math.ceil(rowCount / blockSize) - 1, 0);
    const startBlock = Math.floor(startIndex / blockSize);
    const endBlock = Math.floor(endIndex / blockSize);
    const prefetchStart = Math.max(0, startBlock - prefetchBlocks);
    const prefetchEnd = Math.min(maxBlock, endBlock + prefetchBlocks);

    const ranges: RowBlockRange[] = [];
    let rangeStart: number | null = null;
    let rangeEnd: number | null = null;

    for (let block = prefetchStart; block <= prefetchEnd; block += 1) {
        if (loadedBlocks.has(block) || loadingBlocks.has(block)) {
            if (rangeStart !== null && rangeEnd !== null) {
                ranges.push({ startBlock: rangeStart, endBlock: rangeEnd });
                rangeStart = null;
                rangeEnd = null;
            }
            continue;
        }

        if (rangeStart === null) {
            rangeStart = block;
            rangeEnd = block;
            continue;
        }

        if (rangeEnd !== null && block === rangeEnd + 1) {
            rangeEnd = block;
        } else {
            ranges.push({ startBlock: rangeStart, endBlock: rangeEnd ?? block });
            rangeStart = block;
            rangeEnd = block;
        }
    }

    if (rangeStart !== null && rangeEnd !== null) {
        ranges.push({ startBlock: rangeStart, endBlock: rangeEnd });
    }

    return {
        ranges,
        visibleRange: { startBlock, endBlock },
        prefetchRange: { startBlock: prefetchStart, endBlock: prefetchEnd },
    };
}
