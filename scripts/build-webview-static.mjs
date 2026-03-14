import { copyFile, mkdir, readdir, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

async function ensureDir(pathname) {
    await mkdir(pathname, { recursive: true });
}

async function copyFileTo(src, dest) {
    await ensureDir(dirname(dest));
    await copyFile(src, dest);
}

async function copyDir(srcDir, destDir) {
    await ensureDir(destDir);
    const entries = await readdir(srcDir);
    await Promise.all(
        entries.map(async (entry) => {
            const srcPath = join(srcDir, entry);
            const destPath = join(destDir, entry);
            const stats = await stat(srcPath);
            if (stats.isDirectory()) {
                await copyDir(srcPath, destPath);
                return;
            }
            if (stats.isFile()) {
                await copyFileTo(srcPath, destPath);
            }
        }),
    );
}

async function buildStatic() {
    console.log('[webview-static] Copying static assets...');

    // CSS for plotViewer and variables is now bundled via Vite (imported in TS entry).
    await copyDir(join(projectRoot, 'src/html/help'), join(projectRoot, 'dist/html/help'));

    console.log('[webview-static] Static assets copied.');
}

buildStatic().catch((error) => {
    console.error('[webview-static] Failed to copy assets:', error);
    process.exit(1);
});
