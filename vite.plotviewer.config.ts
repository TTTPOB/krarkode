import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import sveltePreprocess from 'svelte-preprocess';

export default defineConfig({
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
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
            entry: 'src/html/plotViewer/main.ts',
            formats: ['iife'],
            name: 'PlotViewer',
            fileName: () => 'plotViewer.js',
        },
        outDir: 'dist/html/plotViewer',
        emptyOutDir: true,
        sourcemap: false,
        rollupOptions: {
            output: {
                assetFileNames: 'plotViewer[extname]',
            },
        },
    },
});
