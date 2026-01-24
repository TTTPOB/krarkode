import esbuild from 'esbuild';
import svelte from 'esbuild-svelte';

try {
    await esbuild.build({
        entryPoints: ['src/html/dataExplorer/main.ts'],
        bundle: true,
        outfile: 'dist/html/dataExplorer/dataExplorer.js',
        format: 'iife',
        minify: true,
        plugins: [
            svelte({
                compilerOptions: {
                    css: 'injected',
                },
            }),
        ],
    });
} catch (error) {
    console.error('Failed to build data explorer webview.', error);
    process.exit(1);
}
