import { describe, test, expect, beforeEach } from 'vitest';
import { plotStore } from '../stores';

beforeEach(() => {
    // Reset store to clean state
    plotStore.plots.length = 0;
    plotStore.currentIndex = -1;
    plotStore.zoom = 100;
    plotStore.fullWindow = false;
    plotStore.layout = 'multirow';
    plotStore.hasPrevious = false;
    plotStore.hasNext = false;
    plotStore.handlerDragging = false;
    plotStore.largePlotHeight = null;
});

describe('plotStore', () => {
    describe('addPlot', () => {
        test('adds a new plot to the array', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', false);

            expect(plotStore.plots).toHaveLength(1);
            expect(plotStore.plots[0]).toEqual({
                id: 'p1',
                base64Data: 'AAAA',
                mimeType: 'image/png',
            });
        });

        test('sets currentIndex when isActive is true', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', false);
            plotStore.addPlot('p2', 'BBBB', 'image/png', true);

            expect(plotStore.currentIndex).toBe(1);
        });

        test('does not change currentIndex when isActive is false', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);
            plotStore.addPlot('p2', 'BBBB', 'image/png', false);

            expect(plotStore.currentIndex).toBe(0);
        });

        test('deduplicates by id - updates existing plot data', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);
            plotStore.addPlot('p1', 'BBBB', 'image/svg+xml', false);

            expect(plotStore.plots).toHaveLength(1);
            expect(plotStore.plots[0].base64Data).toBe('BBBB');
            expect(plotStore.plots[0].mimeType).toBe('image/svg+xml');
        });

        test('deduplicates by id - updates currentIndex when isActive', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);
            plotStore.addPlot('p2', 'BBBB', 'image/png', true);
            // re-add p1 as active
            plotStore.addPlot('p1', 'CCCC', 'image/png', true);

            expect(plotStore.plots).toHaveLength(2);
            expect(plotStore.currentIndex).toBe(0);
        });

        test('deduplicates by id - preserves currentIndex when not active', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);
            plotStore.addPlot('p2', 'BBBB', 'image/png', true);
            // re-add p1 without active
            plotStore.addPlot('p1', 'CCCC', 'image/png', false);

            expect(plotStore.currentIndex).toBe(1);
        });
    });

    describe('updatePlot', () => {
        test('updates data for an existing plot', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);
            plotStore.updatePlot('p1', 'BBBB', 'image/svg+xml');

            expect(plotStore.plots[0].base64Data).toBe('BBBB');
            expect(plotStore.plots[0].mimeType).toBe('image/svg+xml');
        });

        test('does nothing for a non-existent plot', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);
            plotStore.updatePlot('p999', 'BBBB', 'image/png');

            expect(plotStore.plots).toHaveLength(1);
            expect(plotStore.plots[0].base64Data).toBe('AAAA');
        });
    });

    describe('focusPlot', () => {
        test('sets currentIndex to the matching plot', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);
            plotStore.addPlot('p2', 'BBBB', 'image/png', false);

            plotStore.focusPlot('p2');

            expect(plotStore.currentIndex).toBe(1);
        });

        test('resets currentIndex to -1 for empty id', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);

            plotStore.focusPlot('');

            expect(plotStore.currentIndex).toBe(-1);
        });

        test('does nothing for a non-existent id', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);

            plotStore.focusPlot('p999');

            expect(plotStore.currentIndex).toBe(0);
        });
    });

    describe('hidePlot', () => {
        test('removes a plot from the array', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);
            plotStore.addPlot('p2', 'BBBB', 'image/png', false);

            plotStore.hidePlot('p1');

            expect(plotStore.plots).toHaveLength(1);
            expect(plotStore.plots[0].id).toBe('p2');
        });

        test('adjusts currentIndex when removing a plot before it', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', false);
            plotStore.addPlot('p2', 'BBBB', 'image/png', false);
            plotStore.addPlot('p3', 'CCCC', 'image/png', true);

            plotStore.hidePlot('p1');

            // was 2, should now be 1
            expect(plotStore.currentIndex).toBe(1);
        });

        test('clamps currentIndex when removing last plot that was active', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', false);
            plotStore.addPlot('p2', 'BBBB', 'image/png', true);

            plotStore.hidePlot('p2');

            expect(plotStore.currentIndex).toBe(0);
        });

        test('sets currentIndex to -1 when all plots removed', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);

            plotStore.hidePlot('p1');

            expect(plotStore.currentIndex).toBe(-1);
        });

        test('does nothing for a non-existent id', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);

            plotStore.hidePlot('p999');

            expect(plotStore.plots).toHaveLength(1);
        });

        test('does not adjust currentIndex when removing plot after it', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);
            plotStore.addPlot('p2', 'BBBB', 'image/png', false);

            plotStore.hidePlot('p2');

            expect(plotStore.currentIndex).toBe(0);
        });
    });

    describe('setZoom', () => {
        test('sets zoom value', () => {
            plotStore.setZoom(200);

            expect(plotStore.zoom).toBe(200);
        });
    });

    describe('setLayout', () => {
        test('sets valid layout values', () => {
            plotStore.setLayout('scroll');
            expect(plotStore.layout).toBe('scroll');

            plotStore.setLayout('hidden');
            expect(plotStore.layout).toBe('hidden');

            plotStore.setLayout('multirow');
            expect(plotStore.layout).toBe('multirow');
        });

        test('ignores invalid layout values', () => {
            plotStore.setLayout('invalid');
            expect(plotStore.layout).toBe('multirow');
        });
    });

    describe('toggleFullWindow', () => {
        test('sets fullWindow state', () => {
            plotStore.toggleFullWindow(true);
            expect(plotStore.fullWindow).toBe(true);

            plotStore.toggleFullWindow(false);
            expect(plotStore.fullWindow).toBe(false);
        });
    });

    describe('updateState', () => {
        test('updates all state fields from message', () => {
            plotStore.updateState({
                message: 'updateState',
                currentIndex: 2,
                totalPlots: 5,
                zoom: 150,
                hasPrevious: true,
                hasNext: true,
                fullWindow: true,
                layout: 'scroll',
            });

            expect(plotStore.currentIndex).toBe(2);
            expect(plotStore.zoom).toBe(150);
            expect(plotStore.hasPrevious).toBe(true);
            expect(plotStore.hasNext).toBe(true);
            expect(plotStore.fullWindow).toBe(true);
            expect(plotStore.layout).toBe('scroll');
        });

        test('ignores invalid layout in updateState', () => {
            plotStore.updateState({
                message: 'updateState',
                currentIndex: 0,
                totalPlots: 1,
                zoom: 100,
                hasPrevious: false,
                hasNext: false,
                fullWindow: false,
                layout: 'invalid',
            });

            expect(plotStore.layout).toBe('multirow');
        });
    });

    describe('derived values', () => {
        test('activePlot returns current plot when valid index', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);

            expect(plotStore.activePlot).toEqual({
                id: 'p1',
                base64Data: 'AAAA',
                mimeType: 'image/png',
            });
        });

        test('activePlot returns undefined when no plots', () => {
            expect(plotStore.activePlot).toBeUndefined();
        });

        test('activePlot returns undefined when index is -1', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', false);
            plotStore.currentIndex = -1;

            expect(plotStore.activePlot).toBeUndefined();
        });

        test('navText shows correct format with plots', () => {
            plotStore.addPlot('p1', 'AAAA', 'image/png', true);
            plotStore.addPlot('p2', 'BBBB', 'image/png', false);

            expect(plotStore.navText).toBe('1 / 2');
        });

        test('navText shows 0 / 0 when empty', () => {
            expect(plotStore.navText).toBe('0 / 0');
        });

        test('zoomText shows percentage', () => {
            plotStore.zoom = 150;
            expect(plotStore.zoomText).toBe('150%');
        });
    });

    describe('pre-ready message leak scenario', () => {
        test('duplicate addPlot calls do not create extra entries', () => {
            // Simulate: plot A added, creates panel
            plotStore.addPlot('pA', 'AAAA', 'image/png', true);

            // Simulate: plot B leaks before ready
            plotStore.addPlot('pB', 'BBBB', 'image/png', true);

            // Simulate: ready handler re-sends all plots
            plotStore.addPlot('pA', 'AAAA', 'image/png', false);
            plotStore.addPlot('pB', 'BBBB', 'image/png', true);

            // Should still have exactly 2 plots
            expect(plotStore.plots).toHaveLength(2);
            expect(plotStore.plots[0].id).toBe('pA');
            expect(plotStore.plots[1].id).toBe('pB');
            expect(plotStore.currentIndex).toBe(1);
        });

        test('index stays consistent after duplicate adds', () => {
            // Extension has [A, B, C], currentIndex=2
            plotStore.addPlot('pA', 'AAAA', 'image/png', false);
            plotStore.addPlot('pB', 'BBBB', 'image/png', false);
            plotStore.addPlot('pC', 'CCCC', 'image/png', true);

            // Duplicate send from ready handler
            plotStore.addPlot('pA', 'AAAA', 'image/png', false);
            plotStore.addPlot('pB', 'BBBB', 'image/png', false);
            plotStore.addPlot('pC', 'CCCC', 'image/png', true);

            expect(plotStore.plots).toHaveLength(3);
            expect(plotStore.currentIndex).toBe(2);
            expect(plotStore.activePlot?.id).toBe('pC');
        });
    });
});
