import App from './App.svelte';
import { getVsCodeApi } from './types';

const target = document.getElementById('svelte-root') ?? document.body;
const debugEnabled = (window as { __krarkodeDebug?: boolean }).__krarkodeDebug === true;
if (debugEnabled) {
    const vscode = getVsCodeApi();
    vscode.postMessage({ type: 'log', message: 'Svelte bootstrap loaded' });
}
const app = new App({ target });

export default app;
