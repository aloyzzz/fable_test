import * as THREE from 'three';
import { createWorld } from './World.js';
import { Events } from './Events.js';
import { Clock } from './Clock.js';
import { Rng } from './Rng.js';
import { ProcTex } from './ProcTex.js';
import { CameraRig } from './CameraRig.js';
import { Stage } from './Stage.js';
import { installDebug } from './Debug.js';
import { CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR } from './Units.js';

const MODULE_ORDER = ['environment', 'terrain', 'roads', 'zoning', 'buildings', 'props', 'traffic', 'simulation', 'effects', 'tools', 'ui', 'audio', 'demo'];
// Each module is loaded with its own dynamic import so one broken file cannot break the app.
const LOADERS = {
  environment: () => import('../modules/environment/index.js'),
  terrain: () => import('../modules/terrain/index.js'),
  roads: () => import('../modules/roads/index.js'),
  zoning: () => import('../modules/zoning/index.js'),
  buildings: () => import('../modules/buildings/index.js'),
  props: () => import('../modules/props/index.js'),
  traffic: () => import('../modules/traffic/index.js'),
  simulation: () => import('../modules/simulation/index.js'),
  effects: () => import('../modules/effects/index.js'),
  tools: () => import('../modules/tools/index.js'),
  ui: () => import('../modules/ui/index.js'),
  audio: () => import('../modules/audio/index.js'),
  demo: () => import('../modules/demo/index.js'),
};

export class App {
  constructor(canvas) {
    this.THREE = THREE;
    this.canvas = canvas;
    this.params = new URLSearchParams(location.search);
    this.ready = false;
    this.fps = 0; this.frameMs = 0;
    this._fpsAcc = 0; this._fpsN = 0; this._lastT = performance.now();
    this.modules = {};
    this._renderFn = null; this._renderFails = 0;
    this.loopEnabled = true;   // screenshot tool sets false and drives frames via step()

    const seed = Number(this.params.get('seed') || 1337) | 0;
    this.quality = this.params.get('quality') === 'low' ? 'low' : 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality === 'high', powerPreference: 'high-performance', logarithmicDepthBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87a9d6);
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR);
    this.world = createWorld(seed);
    this.events = new Events();
    this.clock = new Clock(this.events);
    this.rng = new Rng(seed, 'world');
    this.tex = new ProcTex(this.renderer);
    this.rig = new CameraRig(this.camera, canvas, this.world, this.events);
    this.stage = new Stage(this.scene, this.tex);

    const showcaseName = this.params.get('showcase');
    this.ctx = {
      app: this, scene: this.scene, renderer: this.renderer, camera: this.camera,
      world: this.world, events: this.events, clock: this.clock, rng: this.rng, tex: this.tex, rig: this.rig, stage: this.stage,
      modules: this.modules, mode: showcaseName ? 'showcase' : 'game', showcaseName: showcaseName || null,
      params: this.params, quality: this.quality,
      registerRender: (fn) => { this._renderFn = fn; this._renderFails = 0; },
      log: (...a) => console.log('[city]', ...a),
    };
    installDebug(this);
    window.addEventListener('resize', () => this._resize());
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.error('WebGL context lost'); this._showOverlay('WebGL context lost — attempting restore…'); });
    canvas.addEventListener('webglcontextrestored', () => { this._hideOverlay(); });
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.events.emit('resize', { width: w, height: h });
  }
  _showOverlay(msg) { let el = document.getElementById('core-overlay'); if (!el) { el = document.createElement('div'); el.id = 'core-overlay'; el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000a;color:#fff;font:16px system-ui;z-index:9999'; document.body.appendChild(el); } el.textContent = msg; }
  _hideOverlay() { document.getElementById('core-overlay')?.remove(); }

  async start() {
    const t0 = performance.now();
    const showcase = this.ctx.showcaseName;
    if (this.params.has('time')) this.clock.setHour(Number(this.params.get('time')));
    if (this.params.has('speed')) this.clock.setSpeed(Number(this.params.get('speed')));
    if (this.params.get('paused') === '1') this.clock.paused = true;

    let names;
    if (showcase) {
      if (!LOADERS[showcase]) { console.error(`unknown showcase '${showcase}'`); names = []; }
      else {
        // load the module first to read its showcaseDeps
        const mod = await this._load(showcase);
        const deps = mod?.def?.showcaseDeps ?? ['environment'];
        names = [...new Set([...deps.filter((d) => d !== showcase), showcase])];
      }
    } else names = this.params.get('only') ? this.params.get('only').split(',') : MODULE_ORDER.slice();

    for (const name of names) await this._load(name);
    // dependency-sorted init
    const inited = new Set();
    const initOne = async (name) => {
      const m = this.modules[name];
      if (!m || inited.has(name)) return; inited.add(name);
      if (m.status !== 'loaded') return;
      for (const d of m.def.deps || []) await initOne(d);
      try {
        await m.def.init?.(this.ctx);
        m.status = 'ok';
      } catch (e) {
        m.status = 'failed'; m.error = e; console.error(`[core] module '${name}' init failed:`, e);
      }
      this.events.emit('module:status', { name, status: m.status, error: m.error });
    };
    for (const name of names) await initOne(name);

    if (showcase && this.modules[showcase]?.status === 'ok') {
      const live = (n) => this.modules[n] && this.modules[n].status === 'ok' && !this.modules[n].def.stub;
      if (!live('environment')) { this.stage.light(); }
      if (!live('terrain')) { this.stage.ground(); }
      this.rig.setPreset('showcase');
      try { await this.modules[showcase].def.showcase?.(this.ctx); } catch (e) { this.modules[showcase].status = 'failed'; this.modules[showcase].error = e; console.error(`[core] showcase '${showcase}' failed:`, e); }
    }
    if (this.params.has('cam')) {
      const c = this.params.get('cam');
      if (!this.rig.setPreset(c)) { const m = c.match(/^([-\d.]+),([-\d.]+),([-\d.]+):([-\d.]+),([-\d.]+),([-\d.]+)$/); if (m) this.rig.lookAt(new THREE.Vector3(+m[1], +m[2], +m[3]), new THREE.Vector3(+m[4], +m[5], +m[6])); }
    }
    if (this.params.has('weather')) this.modules.environment?.api?.setWeather?.(this.params.get('weather'));
    this._resize();
    this._lastT = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    // ready after a few frames so first-frame compiles have happened
    await new Promise((r) => setTimeout(r, 50));
    this.frame(1 / 60, true); this.frame(1 / 60, true);
    this.ready = true;
    console.log(`[core] ready in ${(performance.now() - t0).toFixed(0)} ms; modules:`, Object.fromEntries(Object.entries(this.modules).map(([k, v]) => [k, v.status])));
  }

  async _load(name) {
    if (this.modules[name]) return this.modules[name];
    const rec = { name, status: 'missing', def: null, error: null, api: {}, failCount: 0, updateDisabled: false };
    this.modules[name] = rec;
    try {
      const mod = await LOADERS[name]();
      const def = mod.default;
      if (!def || typeof def !== 'object') throw new Error('module has no default export');
      rec.def = def; rec.api = def.api || {}; rec.status = 'loaded';
    } catch (e) { rec.status = 'missing'; rec.error = e; console.error(`[core] module '${name}' failed to load:`, e); }
    return rec;
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    if (!this.loopEnabled) { this._lastT = now; return; }
    let dt = (now - this._lastT) / 1000; this._lastT = now;
    if (dt > 0.1) dt = 0.1;
    this.frame(dt, false);
  }

  frame(dt, sync) {
    const t0 = performance.now();
    this.clock.tick(dt);
    this.rig.update(dt);
    for (const name in this.modules) {
      const m = this.modules[name];
      if (m.status !== 'ok' || m.updateDisabled || !m.def.update) continue;
      try { m.def.update(dt, this.ctx); m.failCount = 0; }
      catch (e) { m.failCount++; console.error(`[core] module '${name}' update threw (${m.failCount}/3):`, e); if (m.failCount >= 3) { m.updateDisabled = true; console.error(`[core] module '${name}' update disabled`); } }
    }
    this.render(dt);
    const ms = performance.now() - t0;
    this.frameMs = ms;
    if (!sync) { this._fpsAcc += dt; this._fpsN++; if (this._fpsAcc >= 0.5) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; } }
  }

  render(dt) {
    if (this._renderFn) {
      try { this._renderFn(this.renderer, this.scene, this.camera, dt); this._renderFails = 0; return; }
      catch (e) { this._renderFails++; console.error(`[core] custom render failed (${this._renderFails}/3):`, e); if (this._renderFails >= 3) { this._renderFn = null; console.error('[core] custom render disabled, falling back to renderer.render'); } }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
