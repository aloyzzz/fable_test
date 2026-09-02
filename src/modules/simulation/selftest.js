// Headless unit test for the pure simulation model. No three.js, no DOM.
//   node src/modules/simulation/selftest.js
// Builds a synthetic city, plays the role of the buildings module (answers 'sim:grow'
// by creating world.buildings entries), runs 365 game days and asserts sane behaviour.
import { CityModel, capacityFor, ZONE_INFO, COSTS } from './model.js';
import { Rng } from '../../core/Rng.js';

let failures = 0, checks = 0;
function assert(cond, msg) { checks++; if (!cond) { failures++; console.log('  FAIL ' + msg); } else console.log('  ok   ' + msg); }

const ZONE_MIX = ['res-low', 'res-low', 'res-low', 'res-low', 'res-high', 'com-low', 'com-low', 'com-high', 'ind', 'ind', 'office'];

function makeWorld(seed, lotCount = 300) {
  const rng = new Rng(seed, 'selftest-world');
  let id = 1;
  const world = {
    seed, nextId: () => id++,
    lots: new Map(), buildings: new Map(),
    roads: { nodes: new Map(), edges: new Map() },
  };
  // 12 road edges of 400 m
  for (let i = 0; i < 12; i++) { const eid = world.nextId(); world.roads.edges.set(eid, { id: eid, a: 0, b: 0, type: i < 2 ? 'avenue' : 'local', length: 400 }); }
  for (let i = 0; i < lotCount; i++) {
    const lid = world.nextId();
    world.lots.set(lid, { id: lid, edgeId: 1, side: 1, zone: rng.pick(ZONE_MIX), center: { x: i * 16, y: 0, z: 0 }, size: { w: 16, d: 24 }, rotation: 0, corners: [], level: 1, buildingId: null, demand: rng.next() });
  }
  return world;
}

// Stand-in for the buildings module.
function applyGrow(world, g, rng) {
  const lot = world.lots.get(g.lotId);
  if (!lot) return;
  if (lot.buildingId != null && world.buildings.has(lot.buildingId)) {
    const b = world.buildings.get(lot.buildingId);
    b.level = g.level; b.stories = Math.max(1, Math.round(ZONE_INFO[b.zone].stories * (0.6 + 0.15 * g.level)));
    lot.level = g.level;
  } else {
    const bid = world.nextId();
    world.buildings.set(bid, { id: bid, lotId: lot.id, zone: g.zone, level: g.level, height: 8, footprint: [], seed: rng.int(0, 1e9), stories: Math.max(1, Math.round(ZONE_INFO[g.zone].stories * (0.6 + 0.15 * g.level))), style: 'a' });
    lot.buildingId = bid; lot.level = g.level;
  }
}

function run(seed, days = 365, opts = {}) {
  const world = opts.world || makeWorld(seed, opts.lots ?? 300);
  const model = new CityModel({ rng: new Rng(seed, 'world').fork('simulation') });
  const bRng = new Rng(seed, 'buildings');
  const trace = [];
  let growEvents = 0, levelUps = 0, tickEvents = 0;
  for (let dday = 0; dday < days; dday++) {
    for (let h = 0; h < 24; h++) {
      const { events } = model.advance(world, 1);
      for (const ev of events) {
        if (ev.type === 'sim:grow') {
          growEvents++; if (ev.payload.level > 1) levelUps++;
          if (!opts.noBuildings) { applyGrow(world, ev.payload, bRng); model.invalidate(); }
        } else if (ev.type === 'sim:tick') {
          tickEvents++;
          const t = ev.payload;
          for (const k of ['population', 'jobs', 'money', 'happiness']) if (!Number.isFinite(t[k])) throw new Error(`NaN in ${k} at day ${t.day}`);
          for (const k of ['res', 'com', 'ind']) if (!(t.demand[k] >= 0 && t.demand[k] <= 1)) throw new Error(`demand.${k} out of range: ${t.demand[k]}`);
          if (!(t.happiness >= 0 && t.happiness <= 1)) throw new Error('happiness out of range');
          if (t.population > t.stats.resCapacity + 0.5) throw new Error('population exceeds residential capacity');
        }
      }
    }
    const s = model.snapshot();
    trace.push([s.day, s.population, s.jobs, s.money, +s.happiness.toFixed(4), +s.demand.res.toFixed(4), +s.demand.com.toFixed(4), +s.demand.ind.toFixed(4), world.buildings.size]);
  }
  return { model, world, trace, growEvents, levelUps, tickEvents };
}

console.log('simulation selftest');
console.log('-- capacity table');
assert(capacityFor('res-low', 1, 2) === 4 && capacityFor('res-low', 5, 2) === 12, 'res-low 4..12');
assert(capacityFor('res-high', 1, 10) === 40 && capacityFor('res-high', 5, 10) === 200, 'res-high 40..200');
assert(capacityFor('com-low', 1) === 6 && capacityFor('com-high', 5) === 150, 'com 6..150');
assert(capacityFor('ind', 1) === 20 && capacityFor('office', 5, 10) === 120, 'ind 20, office 120');
assert(capacityFor('office', 1, 20) === 60 && capacityFor('office', 1, 1) === 15, 'stories scale clamped 0.5..2');
assert(capacityFor('none') === 0 && capacityFor('bogus', 3) === 0, 'unknown zones have 0 capacity');

console.log('-- 365 days, 300 lots, seed 1337');
const t0 = Date.now();
const A = run(1337);
const ms = Date.now() - t0;
const last = A.trace[A.trace.length - 1], d30 = A.trace[29], d90 = A.trace[89];
console.log(`   ${A.tickEvents} ticks in ${ms} ms (${(ms / A.tickEvents * 1000).toFixed(1)} µs/tick); grow events ${A.growEvents} (level-ups ${A.levelUps})`);
console.log('   day  pop  jobs  money  happy  R/C/I  buildings');
for (const i of [0, 4, 9, 29, 89, 179, 364]) { const r = A.trace[i]; console.log(`   ${String(r[0]).padStart(3)} ${String(r[1]).padStart(5)} ${String(r[2]).padStart(5)} ${String(r[3]).padStart(8)}  ${r[4].toFixed(2)}  ${r[5].toFixed(2)}/${r[6].toFixed(2)}/${r[7].toFixed(2)}  ${r[8]}`); }
assert(A.tickEvents === 365 * 24, 'exactly one sim:tick per game hour');
assert(last[1] > 500, `population grows when demand is met (day 365 pop = ${last[1]})`);
assert(d30[1] > 0 && d90[1] > d30[1], `population keeps rising early (d30 ${d30[1]} → d90 ${d90[1]})`);
assert(last[8] > 200, `growth engine developed most lots (${last[8]} / 300 buildings)`);
assert(A.levelUps > 0, `some buildings levelled up (${A.levelUps})`);
assert(Number.isFinite(last[3]), 'money is finite');
assert(last[3] > A.trace[0][3], `money increased over the year (${A.trace[0][3]} → ${last[3]})`);
assert(A.model.stats.unemployment < 0.35, `unemployment settles (${A.model.stats.unemployment})`);
assert(last[4] > 0.5, `citizens are reasonably happy at the end (${last[4]})`);
assert(A.model.stats.occupancy > 0.5, `housing occupancy > 50 % (${A.model.stats.occupancy})`);
assert(A.model.stats.powerOk === true && A.model.stats.waterOk === true && A.model.stats.traffic === 0, 'service stubs report ok / no traffic');
assert([...A.world.buildings.values()].every((b) => b.level >= 1 && b.level <= 5), 'levels stay within 1..5');

console.log('-- determinism');
const B = run(1337);
assert(JSON.stringify(A.trace) === JSON.stringify(B.trace), 'same seed → identical 365-day trace');
const C = run(42);
assert(JSON.stringify(A.trace) !== JSON.stringify(C.trace), 'different seed → different trace');

console.log('-- degenerate inputs');
const E = run(7, 30, { lots: 0 });
assert(E.trace[29][1] === 0 && E.growEvents === 0, 'no lots → no population, no growth');
assert(E.trace[29][3] < 50000 && Number.isFinite(E.trace[29][3]), 'empty city still pays road/base upkeep, stays finite');
const N = run(7, 60, { noBuildings: true });
assert(N.trace[59][1] === 0 && Number.isFinite(N.trace[59][3]), 'buildings module absent → grow requests expire, no NaN');
assert(N.growEvents > 0 && N.growEvents < 60 * 24 * 12, `grow requests are rate-limited when never fulfilled (${N.growEvents})`);

console.log('-- treasury api');
const m = new CityModel({ rng: new Rng(1, 'x'), money: 1000 });
assert(m.canAfford(999) && !m.canAfford(1001), 'canAfford');
assert(m.spend(600) === true && m.spend(600) === false && m.money === 400, 'spend deducts and refuses overdraft');
assert(!m.spend(NaN) && !m.spend(-5) && m.money === 400, 'spend rejects NaN / negative');
m.addMoney(NaN); assert(m.money === 400, 'addMoney ignores NaN');
assert(m.setTaxRate(0.9) === 0.5 && m.setTaxRate(-1) === 0, 'tax rate clamps to 0..0.5');
assert(COSTS.road.local > 0 && COSTS.zone > 0 && COSTS.bulldoze > 0 && COSTS.terrain > 0, 'costs table populated');

console.log('-- tax rate response');
const hi = run(1337, 120); hi.model.setTaxRate(0.30);
const lo = run(1337, 120); lo.model.setTaxRate(0.02);
for (let h = 0; h < 24 * 30; h++) { for (const R of [hi, lo]) { for (const ev of R.model.advance(R.world, 1).events) if (ev.type === 'sim:grow') { applyGrow(R.world, ev.payload, new Rng(1, 'b')); R.model.invalidate(); } } }
assert(hi.model.happiness < lo.model.happiness, `high taxes lower happiness (${hi.model.happiness.toFixed(2)} vs ${lo.model.happiness.toFixed(2)})`);
assert(hi.model.stats.taxIncome > lo.model.stats.taxIncome, 'high taxes raise income');

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
