import * as THREE from 'three';
export const PRESETS = {
  'overview':       { position: [900, 650, 900], target: [0, 0, 0] },
  'district':       { position: [260, 160, 260], target: [0, 0, 0] },
  'street':         { position: [60, 14, 60], target: [0, 3, 0] },
  'skyline':        { position: [700, 60, 1200], target: [0, 80, 0] },
  'top':            { position: [0, 1100, 1], target: [0, 0, 0] },
  'showcase':       { position: [140, 70, 140], target: [0, 5, 0] },
  'showcase-close': { position: [40, 12, 40], target: [0, 3, 0] },
};
export class CameraRig {
  constructor(camera, dom, world, events) {
    this.camera = camera; this.dom = dom; this.world = world; this.events = events;
    this.target = new THREE.Vector3(0, 0, 0);
    this.distance = 800; this.yaw = Math.PI / 4; this.pitch = 0.6;
    this.minDist = 8; this.maxDist = 3000;
    this.enabled = true; this._drag = null; this._keys = new Set();
    this._lastEmit = 0;
    this._bind();
    this.setPreset('overview');
  }
  get presets() { return PRESETS; }
  setPreset(name) {
    const p = PRESETS[name]; if (!p) return false;
    this.lookAt(new THREE.Vector3(...p.position), new THREE.Vector3(...p.target)); return true;
  }
  lookAt(position, target) {
    this.target.copy(target);
    const d = new THREE.Vector3().subVectors(position, target);
    this.distance = d.length();
    this.yaw = Math.atan2(d.x, d.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, d.y / this.distance)));
    this._apply(true);
  }
  _apply(force = false) {
    const cp = Math.cos(this.pitch);
    this.camera.position.set(this.target.x + Math.sin(this.yaw) * cp * this.distance, this.target.y + Math.sin(this.pitch) * this.distance, this.target.z + Math.cos(this.yaw) * cp * this.distance);
    // keep the camera above terrain
    const h = this.world.terrain.getHeight(this.camera.position.x, this.camera.position.z);
    if (this.camera.position.y < h + 3) this.camera.position.y = h + 3;
    this.camera.lookAt(this.target);
    this.world.camera.position.copy(this.camera.position); this.world.camera.target.copy(this.target);
    const now = performance.now();
    if (force || now - this._lastEmit > 100) { this._lastEmit = now; this.events.emit('camera:changed', { position: this.camera.position.clone(), target: this.target.clone() }); }
  }
  update(dt) {
    if (!this.enabled) return;
    const k = this._keys; let moved = false;
    const sp = this.distance * 0.8 * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (k.has('KeyW') || k.has('ArrowUp')) { this.target.addScaledVector(fwd, sp); moved = true; }
    if (k.has('KeyS') || k.has('ArrowDown')) { this.target.addScaledVector(fwd, -sp); moved = true; }
    if (k.has('KeyA') || k.has('ArrowLeft')) { this.target.addScaledVector(right, -sp); moved = true; }
    if (k.has('KeyD') || k.has('ArrowRight')) { this.target.addScaledVector(right, sp); moved = true; }
    if (k.has('KeyQ')) { this.yaw += dt * 1.2; moved = true; }
    if (k.has('KeyE')) { this.yaw -= dt * 1.2; moved = true; }
    if (moved) { this.target.y = this.world.terrain.getHeight(this.target.x, this.target.z); this._apply(); }
  }
  _bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointerdown', (e) => { if (!this.enabled) return; if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) { this._drag = { x: e.clientX, y: e.clientY, mode: e.button === 2 ? 'orbit' : 'pan' }; d.setPointerCapture(e.pointerId); } });
    d.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y; this._drag.x = e.clientX; this._drag.y = e.clientY;
      if (this._drag.mode === 'orbit') { this.yaw -= dx * 0.005; this.pitch = Math.max(0.08, Math.min(1.5, this.pitch + dy * 0.005)); }
      else { const s = this.distance * 0.0015; const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); this.target.addScaledVector(right, -dx * s).addScaledVector(fwd, dy * s); this.target.y = this.world.terrain.getHeight(this.target.x, this.target.z); }
      this._apply();
    });
    d.addEventListener('pointerup', () => { this._drag = null; });
    d.addEventListener('wheel', (e) => { if (!this.enabled) return; e.preventDefault(); this.distance = Math.max(this.minDist, Math.min(this.maxDist, this.distance * (1 + Math.sign(e.deltaY) * 0.12))); this._apply(); }, { passive: false });
    window.addEventListener('keydown', (e) => { if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; this._keys.add(e.code); });
    window.addEventListener('keyup', (e) => this._keys.delete(e.code));
  }
}
