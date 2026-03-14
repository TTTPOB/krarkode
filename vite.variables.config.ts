import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        lib: {
            entry: 'src/html/variables/variables.ts',
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
