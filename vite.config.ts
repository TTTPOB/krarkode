import { builtinModules } from 'module';
import { defineConfig } from 'vite';

const external = ['vscode', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default defineConfig({
    resolve: {
        // Prevent Vite from resolving the "browser" field in package.json,
        // which causes vscode-languageclient to use browser (WebSocket) code
        // instead of Node.js (net.Socket) code at runtime.
        mainFields: ['module', 'jsnext:main', 'jsnext', 'main'],
    },
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
