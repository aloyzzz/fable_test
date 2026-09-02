# Skylines-3 — Architecture

A Cities: Skylines II–class city builder in **Three.js r185 + Vite 8**, plain ES modules, no framework, no TypeScript.
Target look: AAA. Photographic PBR, physically plausible sun/sky/shadows, atmospheric depth, a living city at night,
believable roads and traffic. Programmer art is a failing grade.

This document is the contract. Every module builder reads it before writing code. Only the **integrator** edits `src/core/`.

---

## 1. Folder layout

```
index.html                 Vite entry. Contains the canvas + the UI root <div id="ui">.
src/main.js                Boots core.App. Nothing else.
src/core/                  INTEGRATOR ONLY. Shared runtime + world data model.
  App.js                   Renderer, scene, camera, main loop, module loading, failure isolation.
  World.js                 Shared world data model (see §3).
  Events.js                Event bus (see §5).
  Rng.js                   Seeded RNG. The ONLY source of randomness allowed (see §7).
  Clock.js                 Game time: hour-of-day, day, speed, pause.
  CameraRig.js             RTS camera + named presets (see §9).
  ProcTex.js               Procedural CC0 texture library: noise, tileable patterns, normal/roughness maps.
  Stage.js                 Showcase stage helpers (fallback ground + light when a module is shown alone).
  Debug.js                 window.__city API used by the screenshot tool (see §10).
  Units.js                 Constants.
src/modules/<name>/index.js  One folder per subsystem, owned by exactly one builder agent.
  terrain/  environment/  roads/  zoning/  buildings/  props/  traffic/
  effects/  simulation/  tools/  ui/  audio/  demo/
tools/screenshot.mjs       Headless-Chrome verification tool (see §10).
tools/check-rng.mjs        Fails if Math.random is used anywhere in src/.
docs/STATUS.json           Persisted critic scores + open issues per module. Iterations resume from the weakest.
docs/CRITIC_RUBRIC.md      What the critic scores against (CS2 reference description).
docs/CORE_REQUESTS.md      Builders append core-change requests here; the integrator applies them between waves.
shots/                     Screenshot output (PNG + JSON). Gitignored except shots/keep/.
```

**Ownership rule:** a builder writes only inside `src/modules/<own>/`. Anything else is a request in
`docs/CORE_REQUESTS.md`. The integrator is the only agent that touches `src/core/`, `index.html`, `src/main.js`,
`tools/`, `package.json`.

---

## 2. Units, axes, conventions

| Thing | Convention |
|---|---|
| Length | metres. 1 unit = 1 m. |
| Up | +Y. Ground plane is XZ. |
| Map | 4096 m × 4096 m, centred on the origin (x,z ∈ [-2048, 2048]). Playable core: 2048 × 2048. |
| Grid cell | 8 m (roads snap to 8 m; lots are multiples of 8 m; CS2 uses 8 m cells). |
| Time | `clock.hour` ∈ [0,24) float. `clock.day` integer. `clock.speed` game-seconds per real second. |
| Colour | Linear workflow. `renderer.outputColorSpace = SRGBColorSpace`, ACES filmic tone mapping, exposure set by environment. Colour textures flagged `SRGBColorSpace`; data textures (normal/roughness/metal) linear. |
| Light units | Physically based: `renderer.useLegacyLights = false` semantics (r185 default). Sun ≈ 3–4 intensity for a DirectionalLight in Three's units with exposure ~0.6–1.0; lamps in candela-ish via PointLight power. Environment owns exposure. |
| Handedness | Three.js default right-handed. Forward is −Z for vehicles; heading angle measured from +X towards −Z (i.e. `atan2(-dz, dx)`). |
| IDs | Positive integers assigned by `world.nextId()`. Never reuse. |

---

## 3. Shared world data model (`src/core/World.js`)

Plain JS objects, no classes needed for data, so every module can read everything and write **only** what it owns.

```js
world = {
  seed: 1337,
  size: 4096,                     // metres
  cell: 8,                        // metres
  nextId(): number,

  terrain: {                      // written by: terrain
    res: 513,                     // heightfield resolution (res × res samples)
    heights: Float32Array,        // row-major, z-major then x; metres
    waterLevel: 0,                // metres
    getHeight(x, z): number,      // bilinear, metres. World coords.
    getNormal(x, z, out?): Vector3,
    isWater(x, z): boolean,
  },

  roads: {                        // written by: roads (through its API only)
    nodes: Map<id, { id, pos: Vector3, edges: id[] }>,
    edges: Map<id, { id, a: id, b: id, type: 'local'|'avenue'|'highway'|'alley',
                     width: number, lanes: number, oneWay: boolean,
                     length: number, points: Vector3[] /* polyline incl. ends, terrain-conformed */,
                     laneCenters: Vector3[][] /* per lane, direction a→b for lanes < lanes/2 ... see roads API */ }>,
    getEdge(id), getNode(id),
    nearest(x, z, maxDist): { edge, t, point, dist } | null,
  },

  lots: Map<id, {                 // written by: zoning
    id, edgeId, side: -1|1, zone: 'none'|'res-low'|'res-high'|'com-low'|'com-high'|'ind'|'office',
    center: Vector3, size: { w, d }, rotation: number /* yaw radians, +X of the lot faces the road */,
    corners: Vector3[4], level: 1|2|3|4|5, buildingId: id|null, demand: number
  }>,

  buildings: Map<id, {            // written by: buildings
    id, lotId, zone, level, height, footprint: Vector3[], seed, stories, style
  }>,

  vehicles: [],                   // written by: traffic. { id, edgeId, lane, t, speed, kind, lights }
  citizens: [],                   // written by: traffic (pedestrians) — optional

  sim: {                          // written by: simulation
    population: 0, jobs: 0, money: 50000, happiness: 0.5,
    demand: { res: 0.5, com: 0.5, ind: 0.5 },      // 0..1
    stats: {}                     // free-form per-module readouts for UI
  },

  weather: {                      // written by: environment
    kind: 'clear'|'overcast'|'rain'|'fog', cloudCover: 0..1, wetness: 0..1, wind: Vector2, fogDensity
  },

  camera: { position: Vector3, target: Vector3 },   // mirrored by CameraRig each frame (read-only for modules)
}
```

Anything else a module needs to persist lives in its own module state, not on `world`.

---

## 4. Module contract (`src/modules/<name>/index.js`)

```js
export default {
  name: 'terrain',
  wave: 1,                          // informational
  deps: [],                         // modules that must be initialised before this one (main mode)
  showcaseDeps: ['environment'],    // modules also loaded in ?showcase=<name> (default: ['environment'])
  budget: { drawCalls: 60, triangles: 1_500_000 },   // this module's share of the perf budget

  async init(ctx) {},               // build persistent scene objects, subscribe to events. MUST be try-safe.
  update(dt, ctx) {},               // per frame, dt in seconds (clamped ≤ 0.1). Keep cheap.
  async showcase(ctx) {},           // stage a representative scene of THIS module for the critic. Called after init.
  dispose(ctx) {},                  // remove from scene, unsubscribe.
  api: {},                          // public API, exposed to others as ctx.modules.<name>.api
};
```

`ctx` (same object for every module):

```js
ctx = {
  app, scene, renderer, camera,     // Three objects. camera is a PerspectiveCamera (fov 45, near 1, far 6000).
  world, events, clock,             // §3, §5, §6
  rng,                              // ctx.rng.fork('<module>') — deterministic per-module stream. §7
  tex,                              // ProcTex instance (procedural textures, cached by key)
  rig,                              // CameraRig: setPreset(name), lookAt(pos, target), presets
  stage,                            // Stage helpers (showcase only)
  modules,                          // { [name]: { api, status } } – status ∈ 'ok'|'failed'|'missing'
  mode: 'game'|'showcase',
  showcaseName: string|null,
  params: URLSearchParams,          // ?time=… ?cam=… ?seed=… ?showcase=… ?weather=… ?quality=low|high
  quality: 'low'|'high',
  registerRender(fn),               // effects only: fn(renderer, scene, camera, dt) replaces the default render call
  log(...args),                     // prefixed console.log (never throw)
};
```

Rules:
- `init` may throw; the core catches it, marks the module `failed`, and continues. **One broken module never
  takes the game down.** `update` is wrapped too; three consecutive exceptions disable the module's update.
- Modules are loaded with dynamic `import()` so a syntax error in one file is isolated the same way.
- Modules never import from another module's folder. Cross-module use goes through `ctx.modules.<name>.api`
  and must tolerate `status !== 'ok'` (degrade, don't crash).
- Modules never reach into `world` fields they don't own except to read.
- Every visual module ships a **showcase**: `http://localhost:5173/?showcase=<name>` must show a representative
  scene of that module and nothing else (plus `showcaseDeps`). The critic scores the showcase and the integrated game.

Load order in game mode (dependency-sorted): environment → terrain → roads → zoning → buildings → props →
traffic → simulation → effects → tools → ui → audio → demo.

---

## 5. Events (`ctx.events`)

`events.on(name, fn) → unsubscribe`, `events.off(name, fn)`, `events.emit(name, payload)`. Handlers are wrapped in
try/catch (a throwing listener is logged and skipped). Payloads are plain objects.

| Event | Emitter | Payload |
|---|---|---|
| `terrain:changed` | terrain | `{ x0, z0, x1, z1 }` metres bbox of edited area |
| `roads:changed` | roads | `{ added: id[], removed: id[], nodes: id[] }` |
| `lots:changed` | zoning | `{ added: id[], removed: id[], updated: id[] }` |
| `buildings:changed` | buildings | `{ added: id[], removed: id[] }` |
| `time:changed` | clock | `{ hour, day, speed }` (every frame the hour changes by > 1/60) |
| `weather:changed` | environment | `world.weather` |
| `sim:tick` | simulation | `{ day, population, money, demand }` once per game-hour |
| `tool:changed` | tools | `{ tool: 'none'|'road'|'zone'|'bulldoze'|'terrain', option }` |
| `tool:preview` | tools | `{ tool, points }` while dragging |
| `camera:changed` | core | `{ position, target }` (throttled, ≤ 10/s) |
| `module:status` | core | `{ name, status, error? }` |
| `ui:action` | ui | `{ action, value }` generic UI → tool/sim requests |

---

## 6. Clock (`ctx.clock`)

`hour` (float 0–24), `day` (int), `speed` (default 60: one game-minute per real second, i.e. a day ≈ 24 min),
`paused`, `setHour(h)`, `sunDirection(out)` (unit vector *towards* the sun, computed by environment and written
back to `clock.sun`), `dayFraction`. Screenshot tool sets `?time=HH.H`.

---

## 7. Determinism

- `Math.random` is **forbidden** in `src/`. `tools/check-rng.mjs` fails the build if found.
- `ctx.rng.fork('name')` returns an independent sfc32 stream seeded from `world.seed` + name. API:
  `next()` [0,1), `range(a,b)`, `int(a,b)` inclusive, `pick(arr)`, `chance(p)`, `gaussian(mean, sd)`, `fork(name)`.
- The same seed + same input sequence must produce the same city. Do not derive randomness from time or frame count.
- Procedural textures are keyed and cached (`ctx.tex.get(key, generatorFn)`), so they're deterministic too.

---

## 8. Performance budget (1080p, GPU class: GTX 1660 / M1)

| Budget | Value |
|---|---|
| Frame | ≥ 50 fps (≤ 20 ms). |
| Draw calls | ≤ 1500 total for the demo city at the `overview` preset. |
| Triangles | ≤ 6 M on screen. |
| Shadow | One CSM (3 cascades, 2048²) owned by environment; modules just set `castShadow/receiveShadow`. |
| Textures | Procedural, ≤ 2048², generated once, cached. Total GPU texture memory ≤ 512 MB. |
| Lights | Sun (directional) + hemisphere/IBL + ≤ 8 real PointLights near the camera; everything else is emissive/bloom. |

Per-module draw-call share: terrain 40, environment 20, roads 120, zoning 10, buildings 500, props 150, traffic 80,
effects 30 (passes), tools 10, ui 0, audio 0, demo 0. Reserve 480.

**Instancing is the default.** Repeated objects (trees, lamps, vehicles, windows) are `InstancedMesh` or merged
geometry with per-instance attributes. LOD for buildings and props beyond 600 m. Frustum culling on.

The headless screenshot tool runs on SwiftShader (software), so its fps number is a *relative* signal only.
Draw calls and triangles from `renderer.info` are the hard numbers the critic checks.

---

## 9. Camera presets (`ctx.rig.setPreset(name)`)

| Preset | Position (m) | Target | Use |
|---|---|---|---|
| `overview` | (900, 650, 900) | (0, 0, 0) | Whole demo city, 45° tilt. Default. |
| `district` | (260, 160, 260) | (0, 0, 0) | Neighbourhood, buildings readable. |
| `street` | (60, 14, 60) | (0, 3, 0) | Street level, materials readable. |
| `skyline` | (700, 60, 1200) | (0, 80, 0) | Low angle, sky + silhouettes. |
| `top` | (0, 1100, 1) | (0, 0, 0) | Map view. |
| `showcase` | (140, 70, 140) | (0, 5, 0) | Default for module showcases. |
| `showcase-close` | (40, 12, 40) | (0, 3, 0) | Material close-up. |

Modules may define their own showcase camera by calling `ctx.rig.lookAt(position, target)` inside `showcase()`;
the screenshot tool's `--cam` overrides it. In game mode the rig is an RTS camera: drag-pan, wheel zoom,
Q/E rotate, WASD, edge scroll off.

---

## 10. Verification loop — `tools/screenshot.mjs`

```
node tools/screenshot.mjs [--showcase=<module>] [--cam=<preset>|x,y,z:tx,ty,tz] [--time=14.0]
                          [--weather=clear] [--seed=1337] [--quality=high] [--w=1920 --h=1080]
                          [--out=shots/name] [--frames=90] [--url=http://localhost:5173]
```

1. Launches headless Chromium (`/opt/pw-browsers/chromium`, SwiftShader).
2. Loads the URL with the params. Waits for `window.__city.ready === true` (timeout 90 s).
3. Sets camera/time, waits `--frames` frames for shadows/temporal effects to settle.
4. Measures fps over the last 60 frames, reads `renderer.info` (draw calls, triangles, textures, programs),
   collects every console error/warning and uncaught exception and module statuses.
5. Writes `<out>.png` and `<out>.json`. Exit code 1 if any uncaught exception or module `failed`.

`window.__city` (from `src/core/Debug.js`): `ready`, `setCamera(presetOrObj)`, `setTime(h)`, `setWeather(k)`,
`stats()` → `{ fps, drawCalls, triangles, textures, geometries, programs, errors, warnings, modules }`, `world`,
`ctx`, `step(n)` render n frames synchronously.

**Rule for every agent:** nothing is "done" until it has been screenshotted with this tool and the PNG has been
opened and looked at. Report the real numbers from the JSON.

`npm run shot:all` produces the standard set: every showcase at 09:00 / 14:00 / 19:30 / 23:00, plus the game at
each preset at those times.

---

## 11. Asset policy

CC0 only. In this environment Poly Haven and ambientCG are unreachable (egress proxy), so **every texture and
model is procedural**, generated at load through `ctx.tex` (ProcTex) or geometry code. Procedural output is
CC0 by construction. No copyrighted references are embedded. If the proxy is ever opened, Poly Haven/ambientCG
downloads are allowed, dropped in `public/assets/<source>/<name>/` with a `LICENSE.txt` per asset.

Quality bar for procedural materials: multi-octave noise, real albedo variation, roughness maps, normal maps
derived from height, macro variation (a second low-frequency noise that breaks tiling), dirt/wear gradients.
Flat colours are not materials.

---

## 12. Failure isolation summary

- Dynamic import per module; import failure ⇒ status `missing`, game continues.
- `init` exception ⇒ status `failed`, module's objects removed, game continues.
- `update` exceptions ⇒ logged; after 3 in a row the module's update is disabled.
- Event handlers wrapped.
- `registerRender` (effects) failure ⇒ fall back to `renderer.render(scene, camera)` for that frame and after 3 failures permanently.
- UI is DOM, outside the WebGL canvas; a UI failure never affects rendering.
- WebGL context loss ⇒ overlay message, attempt restore.

---

## 13. Quality process

1. Builder implements the module + showcase, screenshots at ≥ 3 times of day and 2 zoom levels, and iterates until
   they believe it is ≥ 8.5.
2. Critic (writes no code) takes its own screenshots, checks the API contract, console errors, draw calls, and scores
   0–10 against `docs/CRITIC_RUBRIC.md`. Pass = ≥ 8.5 with zero errors. Otherwise the builder gets a ranked list.
3. Up to 4 rounds per module per wave. Scores + open issues are persisted to `docs/STATUS.json`.
4. Integrator applies `docs/CORE_REQUESTS.md` between waves and fixes seams.
5. Final gate: whole-game critic + blind A/B judges.
