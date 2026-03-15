#!/usr/bin/env node
// Unified packaging script: download ark, build sidecar, build extension, package VSIX.
// Usage:
//   node scripts/package-full.mjs                  # auto-detect platform
//   node scripts/package-full.mjs --target linux-x64

import { execSync } from 'child_process';
import os from 'os';

const VALID_TARGETS = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'];

function detectTarget() {
    const platform = os.platform();
    const arch = os.arch();

    if (platform === 'linux' && arch === 'x64') return 'linux-x64';
    if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
    if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
    if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';

    throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

function run(cmd) {
    console.log(`\n> ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
}

function main() {
    const targetIdx = process.argv.indexOf('--target');
    const target = targetIdx !== -1 ? process.argv[targetIdx + 1] : detectTarget();

    if (!VALID_TARGETS.includes(target)) {
        throw new Error(`Unknown target: ${target}. Valid: ${VALID_TARGETS.join(', ')}`);
    }

    console.log(`[package-full] Packaging for target: ${target}`);

    // 1. Download Ark binary
    run(`node scripts/download-ark.mjs --target ${target}`);

    // 2. Build & stage sidecar
    run(`node scripts/stage-sidecar.mjs --target ${target}`);

    // 3. Package VSIX (vsce triggers vscode:prepublish → pnpm run build automatically)
    run(`pnpm exec vsce package --no-dependencies --target ${target} --out krarkode-${target}.vsix`);

    console.log(`\n[package-full] Done: krarkode-${target}.vsix`);
}

main();
