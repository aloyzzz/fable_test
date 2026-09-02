import { App } from './core/App.js';
const canvas = document.getElementById('c');
const app = new App(canvas);
app.start().catch((e) => { console.error('[core] fatal start error', e); });
