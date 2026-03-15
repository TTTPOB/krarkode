/**
 * Bundle smoke test for data explorer.
 *
 * Builds dist/html/dataExplorer/dataExplorer.js then loads it in jsdom.
 * Asserts:
 *   1. No uncaught exceptions during execution
 *   2. The Svelte app mounts (#svelte-root gets child content)
 *   3. A `{ type: 'ready' }` message is posted to the VS Code API
 *
 * Run: node scripts/data-explorer-bundle-smoke.mjs
 * Or:  pnpm run test:dataexplorer:bundle-smoke
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const bundlePath = resolve('dist/html/dataExplorer/dataExplorer.js');

let bundleCode;
try {
    bundleCode = readFileSync(bundlePath, 'utf-8');
} catch {
    console.error(`[FAIL] Bundle not found at ${bundlePath}`);
    console.error('       Run "pnpm run build:dataexplorer" first.');
    process.exit(1);
}

// Track messages posted through the VS Code API
const postedMessages = [];

// Minimal HTML that mirrors what dataExplorerManager.ts creates
const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body>
  <div id="svelte-root"></div>
</body>
</html>`;

const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://vscode-webview.local/',
});

const { window } = dom;

// Stub acquireVsCodeApi (the VS Code webview API entry point)
window.acquireVsCodeApi = () => ({
    postMessage: (msg) => postedMessages.push(msg),
    getState: () => null,
    setState: () => {},
});

// Stub ResizeObserver (not available in jsdom)
window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
};

// Stub matchMedia (not available in jsdom)
window.matchMedia =
    window.matchMedia ||
    (() => ({
        matches: false,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    }));

// Collect uncaught errors
const errors = [];
window.addEventListener('error', (e) => errors.push(e.message || e));
window.addEventListener('unhandledrejection', (e) => errors.push(e.reason));

// Execute the bundle
try {
    window.eval(bundleCode);
} catch (err) {
    console.error('[FAIL] Bundle threw during execution:', err);
    process.exit(1);
}

// Give Svelte's onMount microtasks a tick to settle
await new Promise((resolve) => setTimeout(resolve, 50));

// --- Assertions ---

let failed = false;

// 1. No uncaught errors
if (errors.length > 0) {
    console.error('[FAIL] Uncaught errors during bundle execution:');
    for (const err of errors) {
        console.error('      ', err);
    }
    failed = true;
}

// 2. #svelte-root has child content (Svelte mounted something)
const root = window.document.getElementById('svelte-root');
if (!root || root.childElementCount === 0) {
    console.error('[FAIL] #svelte-root has no child elements — Svelte did not mount.');
    failed = true;
} else {
    console.log(`[PASS] #svelte-root has ${root.childElementCount} child element(s).`);
}

// 3. A { type: 'ready' } message was posted
const readyMsg = postedMessages.find((m) => m.type === 'ready');
if (!readyMsg) {
    console.error('[FAIL] No { type: "ready" } message posted.');
    console.error('       Messages posted:', JSON.stringify(postedMessages));
    failed = true;
} else {
    console.log('[PASS] { type: "ready" } message posted.');
}

if (failed) {
    process.exit(1);
}

console.log('[PASS] Data explorer bundle smoke test passed.');
dom.window.close();
