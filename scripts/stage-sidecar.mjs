#!/usr/bin/env node
// Builds the ark-sidecar from local source and stages it for VSIX packaging.
// Usage:
//   node scripts/stage-sidecar.mjs                  # auto-detect platform, release build
//   node scripts/stage-sidecar.mjs --target linux-x64
//   node scripts/stage-sidecar.mjs --debug          # debug build

import { execSync } from 'child_process';
import { copyFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

const EXE_NAME = 'vscode-r-ark-sidecar';

// Map VSIX targets to Rust target triples
const RUST_TARGET_MAP = {
    'linux-x64': 'x86_64-unknown-linux-musl',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
    'darwin-x64': 'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'win32-x64': 'x86_64-pc-windows-msvc',
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
    const isDebug = process.argv.includes('--debug');
    const profile = isDebug ? 'debug' : 'release';

    const rustTarget = RUST_TARGET_MAP[target];
    if (!rustTarget) {
        throw new Error(`Unknown target: ${target}. Valid: ${Object.keys(RUST_TARGET_MAP).join(', ')}`);
    }

    const exeName = os.platform() === 'win32' ? `${EXE_NAME}.exe` : EXE_NAME;

    console.log(`[stage-sidecar] target=${target}  rust_target=${rustTarget}  profile=${profile}`);

    // Build
    const cargoArgs = ['build', '--manifest-path', 'ark-sidecar/Cargo.toml', '--target', rustTarget];
    if (!isDebug) {
        cargoArgs.push('--release');
    }
    console.log(`[stage-sidecar] cargo ${cargoArgs.join(' ')}`);
    execSync(`cargo ${cargoArgs.join(' ')}`, { stdio: 'inherit' });

    // Stage binary
    const srcPath = path.join('ark-sidecar', 'target', rustTarget, profile, exeName);
    const destDir = path.join('sidecar', target);
    mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, exeName);

    console.log(`[stage-sidecar] Copying ${srcPath} → ${destPath}`);
    copyFileSync(srcPath, destPath);

    console.log(`[stage-sidecar] Staged at ${destDir}/`);
}

main();
