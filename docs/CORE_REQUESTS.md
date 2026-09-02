# Core change requests

Builders: append a request here instead of editing `src/core/`, `index.html`, `src/main.js`, `tools/`, `package.json`.
The integrator applies them between waves and marks them. Keep each request minimal and justified.

Format:
```
## [open] <module> — <short title>
What: ...
Why: ...
Proposed change (file + snippet): ...
```

## [applied] effects — screenshot tool: generic query passthrough
What: add `--extra=k=v&k2=v2` to `tools/screenshot.mjs` (merged into the URL params before `paused=1`).
Why: the effects module reads `?fx=off` to disable post-processing so on/off baselines can be compared with the same tool; today only a fixed set of params is forwarded.
Proposed change (tools/screenshot.mjs, buildUrl): `if (o.extra) for (const kv of String(o.extra).split('&')) { const [k, v] = kv.split('='); p.set(k, v ?? ''); }` and pass `extra: args.extra` in the single-job branch.

## [open] simulation — screenshot tool: drain the GPU between stepped frames
What: `--frames=600` runs fail with `page.screenshot: Timeout` on this box for every showcase, including pure stubs
(`--showcase=ui`), so it is not module-specific. Part of it was contention (the new 2-slot lock helps), but `step(n)`
also queues n synchronous WebGL frames with no GPU drain, so on SwiftShader the capture waits for the whole backlog.
Why: time-based modules (simulation, traffic, effects) are asked to show evolution via `--frames`; stepping hundreds of
1080p software-GL frames is the wrong lever. The simulation showcase honours `?simhours=N` (pre-runs N game hours before
the first frame), reachable now via the applied `--extra=simhours=48`, so this request is low priority.
Proposed change (tools/screenshot.mjs, settle step): `for (let i = 0; i < n; i += 30) { c.step(Math.min(30, n - i)); c.app.renderer.getContext().finish(); }`

## [open] terrain — PCFSoftShadowMap deprecation warning
What: `src/core/App.js` sets `renderer.shadowMap.type = THREE.PCFSoftShadowMap`, which logs
`THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.` on every load (r185).
Why: the rubric requires zero warnings; every module's screenshot JSON carries this one.
Proposed change (src/core/App.js): `this.renderer.shadowMap.type = THREE.PCFShadowMap;` (identical output on r185).

## [open] terrain — reflection layer for sky objects
What: the water's planar reflection renders only objects on layer 5 (`ctx.modules.terrain.api.REFLECT_LAYER`) so it
costs ~2 draw calls instead of a second scene pass. Terrain currently detects sky-like top-level objects by name
(/sky|cloud|sun|moon|star/i), `userData.reflect` or `isSky` and enables layer 5 on them.
Why: robust contract instead of name sniffing.
Proposed change: document in ARCHITECTURE.md §4 that environment calls `obj.layers.enable(5)` on its sky dome /
clouds / sun disc (or sets `obj.userData.reflect = true`), and that any module may do the same for objects it wants
mirrored in water.

## [open] environment — PCFSoftShadowMap is deprecated in r185 (emits a console warning)
What: `src/core/App.js` sets `renderer.shadowMap.type = THREE.PCFSoftShadowMap`; three r185 logs
"THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead." on the first render.
Why: the critic requires zero warnings. The environment module currently works around it by switching the type to
`THREE.PCFShadowMap` in its init (before the first render); a game without environment would still warn.
Proposed change (src/core/App.js): `this.renderer.shadowMap.type = THREE.PCFShadowMap;`

## [open] environment — shadow-map render policy hook (optional)
What: environment sets `renderer.shadowMap.autoUpdate = false` while `clock.paused` and re-renders the shadow map
only when camera/time/weather/scene-change events fire (plus every 10th frame). Modules that animate casters while the
clock is paused should call `ctx.modules.environment.api.invalidateShadows()`.
Why: the 4096² shadow pass dominated headless (SwiftShader) frame time during the screenshot tool's 61 settle frames.
Proposed change: none required in core; documenting so the integrator knows. A `scene:changed` event would be cleaner.

## [open] effects — screenshot tool: block Vite's HMR client during capture
What: in `tools/screenshot.mjs` `shoot()`, before `page.goto`, serve a stub for the HMR client (an abort logs a console error): `await page.route('**/@vite/client', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'export const createHotContext = () => ({ accept() {}, dispose() {}, prune() {}, on() {}, off() {}, send() {}, invalidate() {} }); export const injectQuery = (u) => u; export function updateStyle() {} export function removeStyle() {}' }));`.
Why: with several builders saving files, Vite full-reloads every open page; captures then die with "Execution context was destroyed … navigation" / `page.screenshot` timeouts. Measured: with the client blocked a 720p effects capture completes in ~70 s; without it the same capture failed 4× in a row. Nothing in `src/` needs the HMR client.

## [open] audio — expose per-module stats in Debug.stats() / screenshot JSON
What: `Debug.stats()` (and therefore `tools/screenshot.mjs` JSON) should include `stats.custom[name] = def.api.getStats?.()` for every module that implements `api.getStats()` (wrapped in try/catch, output JSON-safe and truncated).
Why: non-visual modules (audio) can only prove they are running through a DOM panel in the screenshot. Audio already exposes `api.getAnalysis()` (per-layer RMS/dB, event counters, context state, cpu ms); surfacing it in the JSON lets the critic assert "levels > 0 / context running" numerically instead of reading pixels.
Proposed change (src/core/Debug.js, inside `stats()`):
```js
custom: Object.fromEntries(Object.entries(app.modules).flatMap(([k, v]) => { try { const s = v.api?.getStats?.(); return s ? [[k, JSON.parse(JSON.stringify(s).slice(0, 4000))]] : []; } catch { return []; } })),
```
(audio will alias `api.getStats = () => compact(getAnalysis())`.)
