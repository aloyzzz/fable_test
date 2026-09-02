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
