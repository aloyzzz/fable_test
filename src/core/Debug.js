// window.__city — used by tools/screenshot.mjs and for manual poking in devtools.
export function installDebug(app) {
  const errors = [], warnings = [];
  const origErr = console.error.bind(console), origWarn = console.warn.bind(console);
  const fmt = (args) => args.map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'object' ? safeJson(a) : String(a))).join(' ');
  console.error = (...a) => { errors.push(fmt(a).slice(0, 2000)); origErr(...a); };
  console.warn = (...a) => { warnings.push(fmt(a).slice(0, 500)); origWarn(...a); };
  window.addEventListener('error', (e) => errors.push('uncaught: ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')));
  window.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + (e.reason?.stack || e.reason?.message || String(e.reason))));
  const api = {
    get ready() { return app.ready; },
    app, get ctx() { return app.ctx; }, get world() { return app.world; },
    setCamera(p) {
      if (typeof p === 'string') return app.rig.setPreset(p);
      if (p && p.position && p.target) { app.rig.lookAt(new app.THREE.Vector3(...p.position), new app.THREE.Vector3(...p.target)); return true; }
      return false;
    },
    setTime(h) { app.clock.setHour(Number(h)); },
    setWeather(k) { app.modules.environment?.api?.setWeather?.(k); },
    setSpeed(s) { app.clock.setSpeed(Number(s)); },
    pause(v = true) { app.clock.paused = v; },
    step(n = 1) { for (let i = 0; i < n; i++) app.frame(1 / 60, true); },
    stats() {
      const info = app.renderer.info;
      return {
        fps: app.fps, frameMs: app.frameMs, drawCalls: info.render.calls, triangles: info.render.triangles, points: info.render.points, lines: info.render.lines,
        textures: info.memory.textures, geometries: info.memory.geometries, programs: info.programs?.length ?? 0,
        errors: errors.slice(), warnings: warnings.slice(),
        modules: Object.fromEntries(Object.entries(app.modules).map(([k, v]) => [k, { status: v.status, error: v.error ? String(v.error.message || v.error) : undefined, updateDisabled: v.updateDisabled || false }])),
        hour: app.clock.hour, weather: app.world.weather.kind, mode: app.ctx.mode, showcase: app.ctx.showcaseName, seed: app.world.seed,
        camera: { position: app.camera.position.toArray().map((v) => +v.toFixed(1)), target: app.rig.target.toArray().map((v) => +v.toFixed(1)) },
      };
    },
    errors, warnings,
  };
  window.__city = api;
  return api;
}
function safeJson(o) { try { return JSON.stringify(o).slice(0, 500); } catch { return String(o); } }
