import esbuild from 'esbuild';
import svelte from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// Parse CLI arguments
const args = process.argv.slice(2);
const isWatch = args.includes('--watch') || args.includes('-w');
const isAnalyze = args.includes('--analyze');
const isDev = args.includes('--dev') || isWatch;

// Build configuration
const buildOptions = {
    entryPoints: [join(projectRoot, 'src/html/dataExplorer/main.ts')],
    bundle: true,
    outfile: join(projectRoot, 'dist/html/dataExplorer/dataExplorer.js'),
    format: 'iife',
    minify: !isDev,
    sourcemap: isDev ? 'inline' : false,
    metafile: isAnalyze,
    logLevel: 'info',
    plugins: [
        svelte({
            preprocess: sveltePreprocess({
                typescript: true,
            }),
            compilerOptions: {
                css: 'injected',
                dev: isDev,
            },
        }),
    ],
};

async function build() {
    console.log(`[data-explorer] Building in ${isDev ? 'development' : 'production'} mode...`);
    
    if (isWatch) {
        console.log('[data-explorer] Watch mode enabled, watching for changes...');
        
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        
        console.log('[data-explorer] Initial build complete. Watching for changes...');
        
        // Keep the process alive
        process.on('SIGINT', async () => {
            console.log('\n[data-explorer] Stopping watch mode...');
            await ctx.dispose();
            process.exit(0);
        });
    } else {
        const result = await esbuild.build(buildOptions);
        
        console.log('[data-explorer] Build complete.');
        
        // Analyze bundle if requested
        if (isAnalyze && result.metafile) {
            const analysisPath = join(projectRoot, 'dist/html/dataExplorer/bundle-analysis.json');
            writeFileSync(analysisPath, JSON.stringify(result.metafile, null, 2));
            console.log(`[data-explorer] Bundle analysis written to: ${analysisPath}`);
            
            // Print summary
            const text = await esbuild.analyzeMetafile(result.metafile, { verbose: false });
            console.log('\n[data-explorer] Bundle analysis:\n');
            console.log(text);
        }
    }
}

build().catch((error) => {
    console.error('[data-explorer] Build failed:', error);
    process.exit(1);
});
