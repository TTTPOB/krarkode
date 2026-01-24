import App from './App.svelte';
import './dataExplorer';

const target = document.getElementById('svelte-root') ?? document.body;
console.log('[dataExplorer] Svelte bootstrap loaded');
const app = new App({ target });

export default app;
