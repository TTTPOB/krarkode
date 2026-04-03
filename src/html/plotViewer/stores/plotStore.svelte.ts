import type { PlotInfo, UpdateStateMessage } from '../types';

class PlotStore {
    plots = $state<PlotInfo[]>([]);
    currentIndex = $state(-1);
    zoom = $state(100);
    fullWindow = $state(false);
    layout = $state<'multirow' | 'scroll' | 'hidden'>('multirow');
    hasPrevious = $state(false);
    hasNext = $state(false);
    handlerDragging = $state(false);
    largePlotHeight = $state<string | null>(null);

    activePlot = $derived(
        this.currentIndex >= 0 && this.currentIndex < this.plots.length
            ? this.plots[this.currentIndex]
            : undefined,
    );

    navText = $derived(
        this.plots.length > 0 ? `${this.currentIndex + 1} / ${this.plots.length}` : '0 / 0',
    );

    zoomText = $derived(`${this.zoom}%`);

    addPlot(id: string, base64Data: string, mimeType: string, isActive: boolean): void {
        // Guard against duplicates (e.g. messages arriving before 'ready' handshake)
        const existing = this.plots.findIndex((p) => p.id === id);
        if (existing >= 0) {
            this.plots[existing].base64Data = base64Data;
            this.plots[existing].mimeType = mimeType;
            if (isActive) {
                this.currentIndex = existing;
            }
            return;
        }
        this.plots.push({ id, base64Data, mimeType });
        if (isActive) {
            this.currentIndex = this.plots.length - 1;
        }
    }

    updatePlot(id: string, base64Data: string, mimeType: string): void {
        const plot = this.plots.find((p) => p.id === id);
        if (plot) {
            plot.base64Data = base64Data;
            plot.mimeType = mimeType;
        }
    }

    focusPlot(id: string): void {
        if (!id) {
            this.currentIndex = -1;
            return;
        }
        const index = this.plots.findIndex((p) => p.id === id);
        if (index >= 0) {
            this.currentIndex = index;
        }
    }

    hidePlot(id: string): void {
        const index = this.plots.findIndex((p) => p.id === id);
        if (index < 0) {
            return;
        }
        this.plots.splice(index, 1);
        if (this.currentIndex >= this.plots.length) {
            this.currentIndex = this.plots.length - 1;
        } else if (index < this.currentIndex) {
            this.currentIndex--;
        }
    }

    setZoom(zoom: number): void {
        this.zoom = zoom;
    }

    setLayout(layout: string): void {
        if (layout === 'multirow' || layout === 'scroll' || layout === 'hidden') {
            this.layout = layout;
        }
    }

    toggleFullWindow(useFullWindow: boolean): void {
        this.fullWindow = useFullWindow;
    }

    updateState(msg: UpdateStateMessage): void {
        this.currentIndex = msg.currentIndex;
        this.zoom = msg.zoom;
        this.hasPrevious = msg.hasPrevious;
        this.hasNext = msg.hasNext;
        this.fullWindow = msg.fullWindow;
        this.setLayout(msg.layout);
    }
}

export const plotStore = new PlotStore();
