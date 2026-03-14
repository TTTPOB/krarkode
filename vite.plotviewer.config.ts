import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        lib: {
            entry: 'src/html/plotViewer/index.ts',
            formats: ['iife'],
            name: 'PlotViewer',
            fileName: () => 'index.js',
        },
        outDir: 'dist/html/plotViewer',
        emptyOutDir: true,
        sourcemap: false,
        rollupOptions: {
            output: {
                assetFileNames: 'style[extname]',
            },
        },
    },
});
