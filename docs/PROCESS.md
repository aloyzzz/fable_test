# Orchestration process (resume guide)

State lives in `docs/STATUS.json`. `node tools/status.mjs --show` prints scores and the weakest open module.
Each /loop iteration: read STATUS → pick the weakest non-passing module (or the game) → run builder round →
critic round → record → repeat.

## Roles
- **Builder** (one per module): edits only `src/modules/<name>/`. Screenshots its showcase, iterates, reports.
- **Integrator** (orchestrator): the only role that edits `src/core/`, `index.html`, `tools/`, `package.json`.
  Applies `docs/CORE_REQUESTS.md`, fixes seams between modules, commits and pushes.
- **Critic**: writes no code. Takes its own screenshots with `node tools/screenshot.mjs`, checks contract, errors,
  perf, scores 0–10 per `docs/CRITIC_RUBRIC.md`, returns a ranked issue list. Recorded with `tools/status.mjs`.
- **Whole-game critic**: same, on the demo city at the four presets and four times.
- **Blind judges**: see pairs labelled A/B and pick the better one with reasons.

## Known limitation — reference imagery
The egress proxy blocks every host except GitHub, and Cities: Skylines II screenshots are copyrighted, so no
real CS2 images exist in this repo. Critics and judges score against the written reference profile in
`docs/CRITIC_RUBRIC.md`. In the blind A/B, "the other" candidate is therefore not a CS2 image; the judge report
must state what it compared. This is reported, not hidden.

## Waves
1. terrain, environment, roads, simulation, ui, audio, effects
2. zoning, buildings, props, traffic, tools
3. demo city → whole-game critic → blind judges

## Commands
```
npm run dev                          # keep running; agents screenshot against it
node tools/screenshot.mjs --showcase=roads --time=14 --cam=showcase --out=shots/x
node tools/screenshot.mjs --all      # standard set into shots/all/
node tools/check-rng.mjs
node tools/status.mjs --module=roads --round=1 --score=7.4 --pass=false --errors=0 --drawCalls=88 --issues="1..|2.." --shots="a.png,b.png"
```
