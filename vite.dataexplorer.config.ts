import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import sveltePreprocess from 'svelte-preprocess';

export default defineConfig({
    plugins: [
        svelte({
            preprocess: sveltePreprocess({ typescript: { tsconfigFile: './tsconfig.webview.json' } }),
            compilerOptions: {
                css: 'injected',
            },
        }),
    ],
    build: {
        lib: {
            entry: 'src/html/dataExplorer/main.ts',
            formats: ['iife'],
            name: 'DataExplorer',
            fileName: () => 'dataExplorer.js',
        },
        outDir: 'dist/html/dataExplorer',
        emptyOutDir: true,
        sourcemap: false,
        minify: true,
    },
});
