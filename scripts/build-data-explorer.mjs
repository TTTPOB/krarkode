import esbuild from 'esbuild';
import svelte from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';

try {
    await esbuild.build({
        entryPoints: ['src/html/dataExplorer/main.ts'],
        bundle: true,
        outfile: 'dist/html/dataExplorer/dataExplorer.js',
        format: 'iife',
        minify: true,
        plugins: [
            svelte({
                preprocess: sveltePreprocess({
                    typescript: true,
                }),
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
