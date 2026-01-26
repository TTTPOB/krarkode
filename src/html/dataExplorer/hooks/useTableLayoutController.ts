import { tick } from 'svelte';
import { get, type Readable, type Writable } from 'svelte/store';
import type { ColumnSchema } from '../types';
import { clampNumber, computeColumnWindow } from '../utils';

type TableLayoutControllerOptions = {
    log: (message: string, payload?: unknown) => void;
    columnWidths: Writable<Map<number, number>>;
    minColumnWidth: number;
    columnWidthFallback: number;
    sidePanelMinWidth: number;
    sidePanelMaxWidth: number;
    virtualizationThreshold: number;
    getVisibleSchema: () => ColumnSchema[];
    getResolvedColumnWidths: () => number[];
    getTotalWidth: () => number;
    getColumnTemplate: () => string;
    getTableHeaderEl: () => HTMLDivElement | undefined;
    getTableBodyEl: () => HTMLDivElement | undefined;
    getBodyInnerEl: () => HTMLDivElement | undefined;
    getStatsPanelEl: () => HTMLDivElement | undefined;
    getDataTableComponent: () => { setIgnoreHeaderSortClick: (value: boolean) => void } | null;
    setTableViewportWidth: (value: number) => void;
    setHeaderScrollLeft: (value: number) => void;
    setRenderColumns: (columns: Array<{ column: ColumnSchema; schemaIndex: number }>) => void;
    setLeftSpacerWidth: (value: number) => void;
    setRightSpacerWidth: (value: number) => void;
    onSidePanelResize: () => void;
};

export function useTableLayoutController(options: TableLayoutControllerOptions) {
    const {
        log,
        columnWidths,
        minColumnWidth,
        columnWidthFallback,
        sidePanelMinWidth,
        sidePanelMaxWidth,
        virtualizationThreshold,
        getVisibleSchema,
        getResolvedColumnWidths,
        getTotalWidth,
        getColumnTemplate,
        getTableHeaderEl,
        getTableBodyEl,
        getBodyInnerEl,
        getStatsPanelEl,
        getDataTableComponent,
        setTableViewportWidth,
        setHeaderScrollLeft,
        setRenderColumns,
        setLeftSpacerWidth,
        setRightSpacerWidth,
        onSidePanelResize,
    } = options;

    let tableLayoutLogSequence = 0;
    let tableBodyResizeObserver: ResizeObserver | null = null;
    let lastColumnWindowKey = '';
    let lastTableViewportWidth = 0;
    let activeColumnResize: { columnIndex: number; startX: number; startWidth: number } | null = null;
    let sidePanelResizeState: { startX: number; startWidth: number; panelId?: string } | null = null;

    const logTableLayoutState = (stage: string): void => {
        const schema = getVisibleSchema();
        const rawWidths = schema.map((column) => get(columnWidths).get(column.column_index));
        const invalidWidths = rawWidths.filter(
            (value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0,
        );
        const resolvedWidths = getResolvedColumnWidths();
        log('Table layout state', {
            stage,
            sequence: (tableLayoutLogSequence += 1),
            schemaCount: schema.length,
            resolvedWidthCount: resolvedWidths.length,
            widthSample: resolvedWidths.slice(0, 6),
            totalWidth: getTotalWidth(),
            columnTemplate: getColumnTemplate(),
            invalidWidthCount: invalidWidths.length,
        });
    };

    const logTableLayoutDom = (stage: string): void => {
        const tableHeaderEl = getTableHeaderEl();
        const tableBodyEl = getTableBodyEl();
        if (!tableHeaderEl && !tableBodyEl) {
            log('Table layout DOM skipped', { stage, reason: 'missing table elements' });
            return;
        }
        const headerRow = tableHeaderEl?.querySelector<HTMLDivElement>('.header-row');
        const bodyRow = tableBodyEl?.querySelector<HTMLDivElement>('.table-row');
        const headerStyle = headerRow ? getComputedStyle(headerRow) : null;
        const bodyStyle = bodyRow ? getComputedStyle(bodyRow) : null;
        log('Table layout DOM', {
            stage,
            headerDisplay: headerStyle?.display,
            headerGridTemplate: headerStyle?.gridTemplateColumns,
            headerWidth: headerRow?.getBoundingClientRect().width,
            bodyDisplay: bodyStyle?.display,
            bodyGridTemplate: bodyStyle?.gridTemplateColumns,
            bodyWidth: bodyRow?.getBoundingClientRect().width,
            scrollWidth: tableBodyEl?.scrollWidth,
            clientWidth: tableBodyEl?.clientWidth,
        });
    };

    const scheduleTableLayoutDiagnostics = (stage: string): void => {
        void tick().then(() => {
            logTableLayoutState(stage);
            logTableLayoutDom(stage);
        });
    };

    const updateRenderColumns = (
        schema: ColumnSchema[],
        widths: number[],
        scrollLeft: number,
        viewportWidth: number,
    ): void => {
        const windowResult = computeColumnWindow({
            schema,
            widths,
            scrollLeft,
            viewportWidth,
            virtualizationThreshold,
        });

        setRenderColumns(windowResult.renderColumns);
        setLeftSpacerWidth(windowResult.leftSpacerWidth);
        setRightSpacerWidth(windowResult.rightSpacerWidth);

        if (windowResult.windowKey !== lastColumnWindowKey) {
            lastColumnWindowKey = windowResult.windowKey;
            log('Column window updated', {
                startIndex: windowResult.startIndex,
                endIndex: windowResult.endIndex,
                leftSpacerWidth: windowResult.leftSpacerWidth,
                rightSpacerWidth: windowResult.rightSpacerWidth,
                viewportWidth,
                scrollLeft,
            });
        }
    };

    const attachTableBodyObserver = (target: HTMLDivElement | undefined): void => {
        if (!target || tableBodyResizeObserver) {
            return;
        }
        tableBodyResizeObserver = new ResizeObserver(() => {
            const width = target?.clientWidth ?? 0;
            if (width !== lastTableViewportWidth) {
                lastTableViewportWidth = width;
                setTableViewportWidth(width);
                log('Table viewport resized', { width });
            }
        });
        tableBodyResizeObserver.observe(target);
        lastTableViewportWidth = target.clientWidth;
        setTableViewportWidth(target.clientWidth);
        log('Table viewport observer attached', { width: target.clientWidth });
    };

    const applyColumnLayout = (): void => {
        const bodyInnerEl = getBodyInnerEl();
        if (bodyInnerEl) {
            bodyInnerEl.style.width = `${getTotalWidth()}px`;
        }
    };

    const updateHeaderScroll = (scrollLeft: number): void => {
        setHeaderScrollLeft(scrollLeft);
    };

    const startColumnResize = (event: MouseEvent, columnIndex: number): void => {
        event.preventDefault();
        event.stopPropagation();
        const startWidth = get(columnWidths).get(columnIndex) ?? columnWidthFallback;
        activeColumnResize = {
            columnIndex,
            startX: event.clientX,
            startWidth,
        };
        document.body.classList.add('column-resizing');
        log('Column resize started', { columnIndex, startWidth });
    };

    const handleColumnResizeMove = (event: MouseEvent): void => {
        if (!activeColumnResize) {
            return;
        }
        const delta = event.clientX - activeColumnResize.startX;
        const nextWidth = Math.max(minColumnWidth, activeColumnResize.startWidth + delta);
        const currentWidth = get(columnWidths).get(activeColumnResize.columnIndex) ?? columnWidthFallback;
        if (currentWidth === nextWidth) {
            return;
        }
        columnWidths.update((widths) => {
            const next = new Map(widths);
            next.set(activeColumnResize?.columnIndex ?? 0, nextWidth);
            return next;
        });
        log('Column resize update', { columnIndex: activeColumnResize.columnIndex, width: nextWidth });
        applyColumnLayout();
    };

    const handleColumnResizeEnd = (): void => {
        if (!activeColumnResize) {
            return;
        }
        const columnIndex = activeColumnResize.columnIndex;
        const width = get(columnWidths).get(columnIndex) ?? columnWidthFallback;
        log('Column resize ended', { columnIndex, width });
        activeColumnResize = null;
        document.body.classList.remove('column-resizing');
        const dataTableComponent = getDataTableComponent();
        dataTableComponent?.setIgnoreHeaderSortClick(true);
        scheduleTableLayoutDiagnostics('column-resize-end');
        window.setTimeout(() => {
            dataTableComponent?.setIgnoreHeaderSortClick(false);
        }, 0);
    };

    const setSidePanelWidth = (width: number): void => {
        document.body.style.setProperty('--side-panel-width', `${width}px`);
        requestAnimationFrame(() => {
            onSidePanelResize();
        });
    };

    const startSidePanelResize = (event: MouseEvent, panelId?: string): void => {
        const panel = panelId ? document.getElementById(panelId) : null;
        const statsPanelEl = getStatsPanelEl();
        const startWidth =
            panel?.getBoundingClientRect().width ?? statsPanelEl?.getBoundingClientRect().width ?? sidePanelMinWidth;
        sidePanelResizeState = {
            startX: event.clientX,
            startWidth,
            panelId,
        };
        log('Side panel resize started', { panelId, startWidth });
        document.body.classList.add('panel-resizing');
        event.preventDefault();
    };

    const handleSidePanelResize = (event: MouseEvent): void => {
        if (!sidePanelResizeState) {
            return;
        }
        const delta = sidePanelResizeState.startX - event.clientX;
        const nextWidth = clampNumber(
            sidePanelResizeState.startWidth + delta,
            sidePanelMinWidth,
            sidePanelMaxWidth,
            sidePanelResizeState.startWidth,
        );
        setSidePanelWidth(nextWidth);
    };

    const finishSidePanelResize = (): void => {
        if (!sidePanelResizeState) {
            return;
        }
        const { panelId, startWidth } = sidePanelResizeState;
        const resolvedWidth = getStatsPanelEl()?.getBoundingClientRect().width;
        log('Side panel resize finished', { panelId, startWidth, resolvedWidth });
        sidePanelResizeState = null;
        document.body.classList.remove('panel-resizing');
    };

    const dispose = (): void => {
        if (tableBodyResizeObserver) {
            tableBodyResizeObserver.disconnect();
            tableBodyResizeObserver = null;
        }
    };

    return {
        scheduleTableLayoutDiagnostics,
        updateRenderColumns,
        attachTableBodyObserver,
        updateHeaderScroll,
        startColumnResize,
        handleColumnResizeMove,
        handleColumnResizeEnd,
        startSidePanelResize,
        handleSidePanelResize,
        finishSidePanelResize,
        dispose,
    };
}
