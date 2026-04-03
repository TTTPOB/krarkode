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
            entry: 'src/html/variables/main.ts',
            formats: ['iife'],
            name: 'Variables',
            fileName: () => 'variables.js',
        },
        outDir: 'dist/html/variables',
        emptyOutDir: true,
        sourcemap: false,
        rollupOptions: {
            output: {
                assetFileNames: 'variables[extname]',
            },
        },
    },
});
