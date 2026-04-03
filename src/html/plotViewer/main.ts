import App from './App.svelte';
import { mount } from 'svelte';

const target = document.getElementById('svelte-root') ?? document.body;
mount(App, { target });
