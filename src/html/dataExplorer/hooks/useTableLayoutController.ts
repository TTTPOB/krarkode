import { tick } from 'svelte';
import { dataStore } from '../stores';
import type { ColumnSchema } from '../types';
import { clampNumber, computeColumnWindow } from '../utils';

type TableLayoutControllerOptions = {
    log: (message: string, payload?: unknown) => void;
    minColumnWidth: number;
    columnWidthFallback: number;
    sidePanelMinWidth: number;
    sidePanelMaxWidth: number;
    virtualizationThreshold: number;
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

export class TableLayoutController {
    private readonly log: (message: string, payload?: unknown) => void;
    private readonly minColumnWidth: number;
    private readonly columnWidthFallback: number;
    private readonly sidePanelMinWidth: number;
    private readonly sidePanelMaxWidth: number;
    private readonly virtualizationThreshold: number;
    private readonly getTableHeaderEl: () => HTMLDivElement | undefined;
    private readonly getTableBodyEl: () => HTMLDivElement | undefined;
    private readonly getBodyInnerEl: () => HTMLDivElement | undefined;
    private readonly getStatsPanelEl: () => HTMLDivElement | undefined;
    private readonly getDataTableComponent: () => { setIgnoreHeaderSortClick: (value: boolean) => void } | null;
    private readonly setTableViewportWidth: (value: number) => void;
    private readonly setHeaderScrollLeft: (value: number) => void;
    private readonly setRenderColumns: (columns: Array<{ column: ColumnSchema; schemaIndex: number }>) => void;
    private readonly setLeftSpacerWidth: (value: number) => void;
    private readonly setRightSpacerWidth: (value: number) => void;
    private readonly onSidePanelResize: () => void;

    private tableLayoutLogSequence = 0;
    private tableBodyResizeObserver: ResizeObserver | null = null;
    private lastColumnWindowKey = '';
    private lastTableViewportWidth = 0;
    private activeColumnResize: { columnIndex: number; startX: number; startWidth: number } | null = null;
    private sidePanelResizeState: { startX: number; startWidth: number; panelId?: string } | null = null;

    constructor(options: TableLayoutControllerOptions) {
        this.log = options.log;
        this.minColumnWidth = options.minColumnWidth;
        this.columnWidthFallback = options.columnWidthFallback;
        this.sidePanelMinWidth = options.sidePanelMinWidth;
        this.sidePanelMaxWidth = options.sidePanelMaxWidth;
        this.virtualizationThreshold = options.virtualizationThreshold;
        this.getTableHeaderEl = options.getTableHeaderEl;
        this.getTableBodyEl = options.getTableBodyEl;
        this.getBodyInnerEl = options.getBodyInnerEl;
        this.getStatsPanelEl = options.getStatsPanelEl;
        this.getDataTableComponent = options.getDataTableComponent;
        this.setTableViewportWidth = options.setTableViewportWidth;
        this.setHeaderScrollLeft = options.setHeaderScrollLeft;
        this.setRenderColumns = options.setRenderColumns;
        this.setLeftSpacerWidth = options.setLeftSpacerWidth;
        this.setRightSpacerWidth = options.setRightSpacerWidth;
        this.onSidePanelResize = options.onSidePanelResize;
    }

    private getVisibleSchema(): ColumnSchema[] {
        return dataStore.visibleSchema;
    }

    private getResolvedColumnWidths(): number[] {
        return dataStore.resolvedColumnWidths;
    }

    private getTotalWidth(): number {
        return dataStore.resolvedColumnWidths.reduce((sum, w) => sum + w, 0);
    }

    private getColumnTemplate(): string {
        return dataStore.resolvedColumnWidths.map((w) => `${w}px`).join(' ');
    }

    private logTableLayoutState(stage: string): void {
        const schema = this.getVisibleSchema();
        const rawWidths = schema.map((column) => dataStore.columnWidths.get(column.column_index));
        const invalidWidths = rawWidths.filter(
            (value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0,
        );
        const resolvedWidths = this.getResolvedColumnWidths();
        this.log('Table layout state', {
            stage,
            sequence: (this.tableLayoutLogSequence += 1),
            schemaCount: schema.length,
            resolvedWidthCount: resolvedWidths.length,
            widthSample: resolvedWidths.slice(0, 6),
            totalWidth: this.getTotalWidth(),
            columnTemplate: this.getColumnTemplate(),
            invalidWidthCount: invalidWidths.length,
        });
    }

    private logTableLayoutDom(stage: string): void {
        const tableHeaderEl = this.getTableHeaderEl();
        const tableBodyEl = this.getTableBodyEl();
        if (!tableHeaderEl && !tableBodyEl) {
            this.log('Table layout DOM skipped', { stage, reason: 'missing table elements' });
            return;
        }
        const headerRow = tableHeaderEl?.querySelector<HTMLDivElement>('.header-row');
        const bodyRow = tableBodyEl?.querySelector<HTMLDivElement>('.table-row');
        const headerStyle = headerRow ? getComputedStyle(headerRow) : null;
        const bodyStyle = bodyRow ? getComputedStyle(bodyRow) : null;
        this.log('Table layout DOM', {
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
    }

    scheduleTableLayoutDiagnostics(stage: string): void {
        void tick().then(() => {
            this.logTableLayoutState(stage);
            this.logTableLayoutDom(stage);
        });
    }

    updateRenderColumns(
        schema: ColumnSchema[],
        widths: number[],
        scrollLeft: number,
        viewportWidth: number,
    ): void {
        const windowResult = computeColumnWindow({
            schema,
            widths,
            scrollLeft,
            viewportWidth,
            virtualizationThreshold: this.virtualizationThreshold,
        });

        this.setRenderColumns(windowResult.renderColumns);
        this.setLeftSpacerWidth(windowResult.leftSpacerWidth);
        this.setRightSpacerWidth(windowResult.rightSpacerWidth);

        if (windowResult.windowKey !== this.lastColumnWindowKey) {
            this.lastColumnWindowKey = windowResult.windowKey;
            this.log('Column window updated', {
                startIndex: windowResult.startIndex,
                endIndex: windowResult.endIndex,
                leftSpacerWidth: windowResult.leftSpacerWidth,
                rightSpacerWidth: windowResult.rightSpacerWidth,
                viewportWidth,
                scrollLeft,
            });
        }
    }

    attachTableBodyObserver(target: HTMLDivElement | undefined): void {
        if (!target || this.tableBodyResizeObserver) {
            return;
        }
        this.tableBodyResizeObserver = new ResizeObserver(() => {
            const width = target?.clientWidth ?? 0;
            if (width !== this.lastTableViewportWidth) {
                this.lastTableViewportWidth = width;
                this.setTableViewportWidth(width);
                this.log('Table viewport resized', { width });
            }
        });
        this.tableBodyResizeObserver.observe(target);
        this.lastTableViewportWidth = target.clientWidth;
        this.setTableViewportWidth(target.clientWidth);
        this.log('Table viewport observer attached', { width: target.clientWidth });
    }

    private applyColumnLayout(): void {
        const bodyInnerEl = this.getBodyInnerEl();
        if (bodyInnerEl) {
            bodyInnerEl.style.width = `${this.getTotalWidth()}px`;
        }
    }

    updateHeaderScroll(scrollLeft: number): void {
        this.setHeaderScrollLeft(scrollLeft);
    }

    startColumnResize(event: MouseEvent, columnIndex: number): void {
        event.preventDefault();
        event.stopPropagation();
        const startWidth = dataStore.columnWidths.get(columnIndex) ?? this.columnWidthFallback;
        this.activeColumnResize = {
            columnIndex,
            startX: event.clientX,
            startWidth,
        };
        document.body.classList.add('column-resizing');
        this.log('Column resize started', { columnIndex, startWidth });
    }

    handleColumnResizeMove(event: MouseEvent): void {
        if (!this.activeColumnResize) {
            return;
        }
        const delta = event.clientX - this.activeColumnResize.startX;
        const nextWidth = Math.max(this.minColumnWidth, this.activeColumnResize.startWidth + delta);
        const currentWidth = dataStore.columnWidths.get(this.activeColumnResize.columnIndex) ?? this.columnWidthFallback;
        if (currentWidth === nextWidth) {
            return;
        }
        const nextWidths = new Map(dataStore.columnWidths);
        nextWidths.set(this.activeColumnResize.columnIndex, nextWidth);
        dataStore.columnWidths = nextWidths;
        this.log('Column resize update', { columnIndex: this.activeColumnResize.columnIndex, width: nextWidth });
        this.applyColumnLayout();
    }

    handleColumnResizeEnd(): void {
        if (!this.activeColumnResize) {
            return;
        }
        const columnIndex = this.activeColumnResize.columnIndex;
        const width = dataStore.columnWidths.get(columnIndex) ?? this.columnWidthFallback;
        this.log('Column resize ended', { columnIndex, width });
        this.activeColumnResize = null;
        document.body.classList.remove('column-resizing');
        const dataTableComponent = this.getDataTableComponent();
        dataTableComponent?.setIgnoreHeaderSortClick(true);
        this.scheduleTableLayoutDiagnostics('column-resize-end');
        window.setTimeout(() => {
            dataTableComponent?.setIgnoreHeaderSortClick(false);
        }, 0);
    }

    private setSidePanelWidth(width: number): void {
        document.body.style.setProperty('--side-panel-width', `${width}px`);
        requestAnimationFrame(() => {
            this.onSidePanelResize();
        });
    }

    startSidePanelResize(event: MouseEvent, panelId?: string): void {
        const panel = panelId ? document.getElementById(panelId) : null;
        const statsPanelEl = this.getStatsPanelEl();
        const startWidth =
            panel?.getBoundingClientRect().width ?? statsPanelEl?.getBoundingClientRect().width ?? this.sidePanelMinWidth;
        this.sidePanelResizeState = {
            startX: event.clientX,
            startWidth,
            panelId,
        };
        this.log('Side panel resize started', { panelId, startWidth });
        document.body.classList.add('panel-resizing');
        event.preventDefault();
    }

    handleSidePanelResize(event: MouseEvent): void {
        if (!this.sidePanelResizeState) {
            return;
        }
        const delta = this.sidePanelResizeState.startX - event.clientX;
        const nextWidth = clampNumber(
            this.sidePanelResizeState.startWidth + delta,
            this.sidePanelMinWidth,
            this.sidePanelMaxWidth,
            this.sidePanelResizeState.startWidth,
        );
        this.setSidePanelWidth(nextWidth);
    }

    finishSidePanelResize(): void {
        if (!this.sidePanelResizeState) {
            return;
        }
        const { panelId, startWidth } = this.sidePanelResizeState;
        const resolvedWidth = this.getStatsPanelEl()?.getBoundingClientRect().width;
        this.log('Side panel resize finished', { panelId, startWidth, resolvedWidth });
        this.sidePanelResizeState = null;
        document.body.classList.remove('panel-resizing');
    }

    dispose(): void {
        if (this.tableBodyResizeObserver) {
            this.tableBodyResizeObserver.disconnect();
            this.tableBodyResizeObserver = null;
        }
    }
}
