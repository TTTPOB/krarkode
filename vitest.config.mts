import { mergeConfig, defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import sveltePreprocess from 'svelte-preprocess';
import rootConfig from './vite.config';

export default mergeConfig(
    rootConfig,
    defineConfig({
        plugins: [
            svelte({
                hot: !process.env.VITEST,
                preprocess: sveltePreprocess({ typescript: { tsconfigFile: './tsconfig.webview.json' } }),
            }),
            svelteTesting(),
        ],
        test: {
            environment: 'jsdom',
            globals: true,
            include: ['src/html/**/__tests__/**/*.test.ts'],
            setupFiles: ['./src/html/__tests__/setup.ts'],
        },
    }),
);
