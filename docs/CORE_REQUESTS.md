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
