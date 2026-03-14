import { builtinModules } from 'module';
import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        lib: {
            entry: 'src/extension.ts',
            formats: ['es'],
            fileName: 'extension',
        },
        outDir: 'dist',
        sourcemap: true,
        rollupOptions: {
            external: ['vscode', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
            output: {
                entryFileNames: '[name].js',
            },
        },
    },
});
