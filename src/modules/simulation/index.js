// simulation module — deterministic city economy (population, jobs, money, happiness, RCI demand)
// and the growth engine that asks the buildings module to develop lots. See ARCHITECTURE.md §3 world.sim, §5, §6, §7.
//
// Pure model: ./model.js (no THREE/DOM). This file is the glue: clock integration, event wiring,
// world.sim mirroring, the public api, and the ?showcase=simulation dashboard.
//
// Events emitted:
//   'sim:tick' { day, hour, population, jobs, money, happiness, demand:{res,com,ind}, stats }  once per game hour
//   'sim:grow' { lotId, zone, level }   level 1 = develop a vacant lot; level n>1 = upgrade the existing building to n
// Events consumed: 'lots:changed', 'buildings:changed', 'roads:changed' (cache invalidation), 'ui:action' (see below).
import { CityModel, COSTS, capacityFor } from './model.js';
import { createHud } from './hud.js';
import { buildShowcaseCity, installBuildingStandIn, makeMapPainter } from './showcase.js';

const SHOWCASE_SPEED = 14400; // game-seconds per real second → one game day per 6 s

let ctx = null, model = null, rng = null;
let unsubs = [];
let last = { day: 1, hour: 0 };
let hud = null, showcaseAutorun = false, hudDirty = false;

function syncWorld() {
  if (!ctx || !model) return;
  const s = ctx.world.sim;
  s.population = Math.round(model.population);
  s.jobs = model.jobs;
  s.money = Math.round(model.money);
  s.happiness = model.happiness;
  s.demand.res = model.demand.res; s.demand.com = model.demand.com; s.demand.ind = model.demand.ind;
  s.stats = model.stats;
}

function readCongestion() {
  try {
    const t = ctx.modules.traffic;
    if (t && t.status === 'ok' && typeof t.api?.getCongestion === 'function') {
      const v = Number(t.api.getCongestion());
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    }
  } catch { /* degrade */ }
  return 0;
}

function stepHours(hours) {
  if (hours <= 0) return;
  model.setCongestion(readCongestion());
  const { events } = model.advance(ctx.world, hours);
  for (const ev of events) ctx.events.emit(ev.type, ev.payload);
  if (events.length) { syncWorld(); hudDirty = true; }
}

function resetModel() {
  model.reset({ taxRate: model.taxRate, day: ctx.clock.day, hour: ctx.clock.hour });
  last = { day: ctx.clock.day, hour: ctx.clock.hour };
  syncWorld(); hudDirty = true;
}

const api = {
  costs: COSTS,
  capacityFor,
  getStats: () => (model ? { ...model.stats } : {}),
  getDemand: () => (model ? { ...model.demand } : { res: 0, com: 0, ind: 0 }),
  getState: () => (model ? model.snapshot() : null),
  getHistory: () => (model ? model.history : null),
  getTaxRate: () => (model ? model.taxRate : 0.1),
  setTaxRate: (r) => { if (!model) return 0.1; const v = model.setTaxRate(Number(r)); syncWorld(); hudDirty = true; return v; },
  setSpeed: (s) => { if (ctx && Number.isFinite(Number(s))) ctx.clock.setSpeed(Number(s)); },
  pause: () => { if (ctx) ctx.clock.paused = true; },
  resume: () => { if (ctx) ctx.clock.paused = false; },
  isPaused: () => !!ctx?.clock.paused,
  reset: () => { if (model) resetModel(); },
  addMoney: (n) => { if (!model) return 0; const v = model.addMoney(Number(n)); syncWorld(); hudDirty = true; return v; },
  canAfford: (n) => !!model && model.canAfford(Number(n)),
  spend: (n) => { if (!model) return false; const ok = model.spend(Number(n)); if (ok) { syncWorld(); hudDirty = true; } return ok; },
  invalidate: () => model?.invalidate(),
  getModel: () => model,
};

export default {
  name: 'simulation',
  wave: 1,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 0, triangles: 0 },

  async init(c) {
    ctx = c;
    rng = ctx.rng.fork('simulation');
    model = new CityModel({ rng: rng.fork('model'), day: ctx.clock.day, hour: ctx.clock.hour });
    last = { day: ctx.clock.day, hour: ctx.clock.hour };
    showcaseAutorun = false; hud = null; hudDirty = false;
    const inval = () => model.invalidate();
    unsubs = [
      ctx.events.on('lots:changed', inval),
      ctx.events.on('buildings:changed', inval),
      ctx.events.on('roads:changed', inval),
      ctx.events.on('ui:action', (a) => {
        if (!a || typeof a.action !== 'string') return;
        switch (a.action) {
          case 'sim:tax': case 'sim:setTaxRate': api.setTaxRate(a.value); break;
          case 'sim:speed': case 'sim:setSpeed': api.setSpeed(a.value); break;
          case 'sim:pause': api.pause(); break;
          case 'sim:resume': api.resume(); break;
          case 'sim:reset': api.reset(); break;
          default: break;
        }
      }),
    ];
    syncWorld();
    ctx.log('simulation: model ready (tax 10%, $' + model.money.toLocaleString('en-US') + ')');
  },

  update(dt, c) {
    if (!model) return;
    const clock = c.clock;
    let hours;
    if (showcaseAutorun && clock.paused) {
      // showcase runs on its own clock while the app clock is frozen (screenshot tool pauses it)
      hours = (dt * clock.speed) / 3600;
    } else {
      hours = (clock.day - last.day) * 24 + (clock.hour - last.hour);
      if (!(hours > 0) || hours > 6) hours = 0; // paused, or a setHour() jump — not elapsed time
    }
    last.day = clock.day; last.hour = clock.hour;
    stepHours(hours);
    if (hud && hudDirty) { hudDirty = false; hud.update(model, { speed: clock.speed, paused: clock.paused, autorun: showcaseAutorun }); }
  },

  async showcase(c) {
    const world = c.world;
    const sRng = rng.fork('showcase');
    const layout = buildShowcaseCity(world, sRng);
    model.extraRoadMeters = layout.roadMeters;
    model.invalidate();
    c.events.emit('lots:changed', { added: layout.lots.map((l) => l.id), removed: [], updated: [] });
    const root = document.getElementById('ui') || document.body;
    hud = createHud(root, { city: 'Fable Heights', mapPainter: makeMapPainter(world, layout) });
    const when = () => `D${model.day} ${String(Math.floor(model.hour)).padStart(2, '0')}h`;
    unsubs.push(installBuildingStandIn(c, sRng.fork('buildings'), (text) => hud?.pushFeed(text, when())));
    c.clock.setSpeed(SHOWCASE_SPEED);
    showcaseAutorun = true;
    // ?simhours=N pre-runs N game hours before the first frame (verification/critic aid: the
    // headless screenshot tool cannot step hundreds of frames on SwiftShader).
    const warm = Math.min(24 * 365, Math.max(0, Number(c.params.get('simhours')) || 0));
    for (let left = warm; left > 0; left -= 24) stepHours(Math.min(24, left));
    if (warm) c.log(`simulation showcase: warmed up ${warm} game hours`);
    c.rig.lookAt(new c.app.THREE.Vector3(260, 190, 300), new c.app.THREE.Vector3(0, 0, 0));
    hud.pushFeed(`${layout.lots.length} lots zoned · growth engine armed`, when());
    hud.update(model, { speed: c.clock.speed, paused: c.clock.paused, autorun: true });
    c.log(`simulation showcase: ${layout.lots.length} lots, speed ×${SHOWCASE_SPEED}`);
  },

  dispose() {
    for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
    unsubs = [];
    hud?.dispose(); hud = null;
    showcaseAutorun = false;
    model = null; ctx = null; rng = null;
  },

  api,
};
