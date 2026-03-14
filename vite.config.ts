import { builtinModules } from 'module';
import { defineConfig } from 'vite';

const external = ['vscode', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default defineConfig({
    build: {
        lib: {
            entry: 'src/extension.ts',
            formats: ['es'],
            fileName: 'extension',
        },
        outDir: 'dist',
        sourcemap: true,
        rolldownOptions: {
            external,
            platform: 'node',
            output: {
                entryFileNames: '[name].js',
            },
        },
    },
});
