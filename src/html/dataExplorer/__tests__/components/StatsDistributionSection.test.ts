import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import StatsDistributionSection from '../../stats/StatsDistributionSection.svelte';

describe('StatsDistributionSection', () => {
    test('does not render the histogram method dropdown', () => {
        const { container } = render(StatsDistributionSection, {
            props: {
                histogramVisible: true,
                histogramBins: 20,
                statsControlsEnabled: true,
            },
        });

        expect(container.querySelector('#histogram-method')).toBeNull();
    });

    test('reports slider and input bin changes', async () => {
        const onBinsInput = vi.fn();
        const { container } = render(StatsDistributionSection, {
            props: {
                histogramVisible: true,
                histogramBins: 20,
                statsControlsEnabled: true,
                onBinsInput,
            },
        });

        const slider = container.querySelector('#histogram-bins') as HTMLInputElement;
        slider.value = '32';
        await fireEvent.input(slider);

        const numberInput = container.querySelector('#histogram-bins-input') as HTMLInputElement;
        numberInput.value = '48';
        await fireEvent.input(numberInput);

        expect(onBinsInput).toHaveBeenNthCalledWith(1, { source: 'slider', value: 32 });
        expect(onBinsInput).toHaveBeenNthCalledWith(2, { source: 'input', value: 48 });
    });
});
