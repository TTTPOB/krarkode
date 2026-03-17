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
            entry: 'src/html/dataExplorer/main.ts',
            formats: ['iife'],
            name: 'DataExplorer',
            fileName: () => 'dataExplorer.js',
        },
        outDir: 'dist/html/dataExplorer',
        sourcemap: false,
        minify: true,
        rollupOptions: {
            output: {
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name?.endsWith('.css')) {
                        return 'dataExplorer.css';
                    }
                    return 'assets/[name]-[hash][extname]';
                },
            },
        },
    },
});
