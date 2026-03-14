import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import sveltePreprocess from 'svelte-preprocess';

export default defineConfig({
    plugins: [
        svelte({
            hot: !process.env.VITEST,
            preprocess: sveltePreprocess(),
        }),
    ],
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['src/html/**/__tests__/**/*.test.ts'],
        setupFiles: ['./src/html/__tests__/setup.ts'],
    },
});
