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

## [open] simulation — screenshot tool cannot settle more than ~100 frames on SwiftShader
What: `node tools/screenshot.mjs --frames=600` (and any run stepping more than ~150 frames) fails with
`page.screenshot: Timeout 30000ms exceeded`, for every showcase including pure stubs (`--showcase=ui`).
Why: `window.__city.step(n)` queues n synchronous WebGL frames; on SwiftShader at 1920×1080 (MSAA + 2048² PCF
shadow pass) each frame costs ~0.7–1 s in the GPU process, so `step(540)` leaves minutes of backlog and the
compositor cannot produce the capture frame inside Playwright's 30 s timeout. Measured: `step(30)` + `gl.finish()`
= 20 s on `--showcase=ui`. Time-based modules (simulation, traffic, effects) cannot show evolution through `--frames`.
Proposed change (tools/screenshot.mjs): (1) pass `--screenshotTimeout` (default 120000) into `page.screenshot({ timeout })`;
(2) step in chunks and drain the GPU between chunks: `for (let i = 0; i < frames; i += 30) { c.step(30); c.app.renderer.getContext().finish(); }`;
(3) optionally accept `--extra=key=value,...` that is appended verbatim to the URL so modules can read verification
params via `ctx.params` (simulation already honours `?simhours=N` as a pre-run; today it is only reachable through
`--url="http://localhost:5173/?showcase=simulation&simhours=48&x="`).
