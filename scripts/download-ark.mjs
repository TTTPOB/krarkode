#!/usr/bin/env node
// Downloads ark binary from GitHub release and stages it for VSIX packaging.
// Usage:
//   node scripts/download-ark.mjs                  # auto-detect platform
//   node scripts/download-ark.mjs --target linux-x64

import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

const ARK_VERSION = '0.1.242';
const REPO = 'posit-dev/ark';

// Map VSIX target names to ark release asset suffixes.
// macOS ships a universal binary; both x64 and arm64 VSIXes use the same asset.
const ASSET_SUFFIX_MAP = {
    'linux-x64': 'linux-x64',
    'linux-arm64': 'linux-arm64',
    'darwin-x64': 'darwin-universal',
    'darwin-arm64': 'darwin-universal',
    'win32-x64': 'windows-x64',
};

function detectTarget() {
    const platform = os.platform();
    const arch = os.arch();

    if (platform === 'linux' && arch === 'x64') return 'linux-x64';
    if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
    if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
    if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
    if (platform === 'win32' && arch === 'x64') return 'win32-x64';

    throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

function main() {
    const targetIdx = process.argv.indexOf('--target');
    const target = targetIdx !== -1 ? process.argv[targetIdx + 1] : detectTarget();
    const suffix = ASSET_SUFFIX_MAP[target];
    if (!suffix) {
        throw new Error(`Unknown target: ${target}. Valid: ${Object.keys(ASSET_SUFFIX_MAP).join(', ')}`);
    }

    const assetName = `ark-${ARK_VERSION}-${suffix}.zip`;
    const destDir = path.resolve('ark', target);

    console.log(`[download-ark] version=${ARK_VERSION}  target=${target}  asset=${assetName}`);

    // Prepare staging directory
    mkdirSync(destDir, { recursive: true });

    // Download via gh CLI
    const tmpDir = path.join(os.tmpdir(), `ark-download-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
        execSync(
            `gh release download ${ARK_VERSION} --repo ${REPO} --pattern "${assetName}" --dir "${tmpDir}"`,
            { stdio: 'inherit' },
        );

        // Extract
        const zipPath = path.join(tmpDir, assetName);
        if (os.platform() === 'win32') {
            execSync(
                `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
                { stdio: 'inherit' },
            );
        } else {
            execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
        }

        // Ensure executable on Unix
        if (os.platform() !== 'win32') {
            execSync(`chmod +x "${path.join(destDir, 'ark')}"`, { stdio: 'inherit' });
        }

        console.log(`[download-ark] Staged at ${destDir}/`);
    } finally {
        // Clean up temp download
        rmSync(tmpDir, { recursive: true, force: true });
    }
}

main();
