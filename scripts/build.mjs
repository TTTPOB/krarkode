import { spawn } from 'child_process';
import esbuild from 'esbuild';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const args = process.argv.slice(2);
const isWatch = args.includes('--watch') || args.includes('-w');
const isDev = args.includes('--dev') || args.includes('-d') || isWatch;
const isAnalyze = args.includes('--analyze');

const buildLabel = '[build]';
const log = (message) => {
    console.log(`${buildLabel} ${message}`);
};

const runCommand = (command, commandArgs, label) =>
    new Promise((resolve, reject) => {
        log(`${label}...`);
        const child = spawn(command, commandArgs, { stdio: 'inherit' });
        child.on('error', (error) => reject(error));
        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`${label} failed with exit code ${code}`));
        });
    });

const startCommand = (command, commandArgs, label) => {
    log(`${label} (watch)`);
    const child = spawn(command, commandArgs, { stdio: 'inherit' });
    return child;
};

const generateTypes = async () => {
    await runCommand(
        'node',
        [join(projectRoot, 'scripts/generate-data-explorer-types.mjs')],
        'Generating data explorer types',
    );
    await runCommand(
        'node',
        [join(projectRoot, 'scripts/generate-sidecar-event-types.mjs')],
        'Generating sidecar event types',
    );
};

const buildPlotViewer = async () => {
    await runCommand('pnpm', ['exec', 'tsc', '-p', join('src/html/plotViewer/tsconfig.json')], 'Building plot viewer');
};

const buildDataExplorer = async () => {
    const dataExplorerArgs = [join(projectRoot, 'scripts/build-data-explorer.mjs')];
    if (isDev) {
        dataExplorerArgs.push('--dev');
    }
    if (isAnalyze && !isWatch) {
        dataExplorerArgs.push('--analyze');
    }
    await runCommand('node', dataExplorerArgs, 'Building data explorer');
};

const buildWebviewStatic = async () => {
    await runCommand('node', [join(projectRoot, 'scripts/build-webview-static.mjs')], 'Copying webview static assets');
};

const buildVariables = async () => {
    log('Building variables webview...');
    await esbuild.build({
        entryPoints: [join(projectRoot, 'src/html/variables/variables.ts')],
        bundle: true,
        outfile: join(projectRoot, 'dist/html/variables/variables.js'),
        format: 'iife',
        sourcemap: isDev ? 'inline' : false,
    });
};

const buildExtension = async () => {
    log('Building extension bundle...');
    await esbuild.build({
        entryPoints: [join(projectRoot, 'src/extension.ts')],
        bundle: true,
        outfile: join(projectRoot, 'dist/extension.js'),
        external: ['vscode'],
        platform: 'node',
        sourcemap: true,
    });
};

const startWatchers = async () => {
    const childProcesses = [];
    const contexts = [];

    const dataExplorerArgs = [join(projectRoot, 'scripts/build-data-explorer.mjs'), '--watch'];
    childProcesses.push(startCommand('node', dataExplorerArgs, 'Data explorer build'));

    childProcesses.push(
        startCommand(
            'pnpm',
            ['exec', 'tsc', '-p', join('src/html/plotViewer/tsconfig.json'), '--watch', '--preserveWatchOutput'],
            'Plot viewer build',
        ),
    );

    const variablesContext = await esbuild.context({
        entryPoints: [join(projectRoot, 'src/html/variables/variables.ts')],
        bundle: true,
        outfile: join(projectRoot, 'dist/html/variables/variables.js'),
        format: 'iife',
        sourcemap: 'inline',
    });
    await variablesContext.watch();
    contexts.push({ name: 'variables', ctx: variablesContext });
    log('Variables webview build (watch)');

    const extensionContext = await esbuild.context({
        entryPoints: [join(projectRoot, 'src/extension.ts')],
        bundle: true,
        outfile: join(projectRoot, 'dist/extension.js'),
        external: ['vscode'],
        platform: 'node',
        sourcemap: true,
    });
    await extensionContext.watch();
    contexts.push({ name: 'extension', ctx: extensionContext });
    log('Extension build (watch)');

    const handleExit = async (signal) => {
        log(`Stopping watchers (${signal})...`);
        await Promise.all(contexts.map(async ({ ctx }) => ctx.dispose()));
        childProcesses.forEach((child) => child.kill('SIGINT'));
        process.exit(0);
    };

    process.on('SIGINT', () => handleExit('SIGINT'));
    process.on('SIGTERM', () => handleExit('SIGTERM'));

    childProcesses.forEach((child) => {
        child.on('exit', (code) => {
            if (typeof code === 'number' && code !== 0) {
                log(`Watcher exited with code ${code}`);
                process.exit(code);
            }
        });
    });
};

const runBuild = async () => {
    log(`Starting build (${isWatch ? 'watch' : 'single'})...`);
    await generateTypes();
    await buildWebviewStatic();

    if (isWatch) {
        await startWatchers();
        return;
    }

    await buildPlotViewer();
    await buildVariables();
    await buildDataExplorer();
    await buildExtension();
    log('Build complete.');
};

runBuild().catch((error) => {
    console.error('[build] Failed:', error);
    process.exit(1);
});
