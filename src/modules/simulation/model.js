// Pure city-economy model for the simulation module.
// No THREE, no DOM, no Math.random: everything random comes from the injected rng
// (an object with next(), int(a,b), chance(p) — ctx.rng.fork('simulation') in the app).
//
// The model reads a world-shaped object { lots: Map, buildings: Map, roads: { edges: Map } }
// (ARCHITECTURE.md §3) and never writes to it. It advances in whole game hours and returns
// the events the glue should emit ('sim:grow' requests and the 'sim:tick' payload).

export const ZONE_INFO = {
  // capacity range at level 1 → level 5, nominal stories (capacity scales with stories/nominal, clamped 0.5..2)
  'res-low':  { kind: 'res',    lo: 4,  hi: 12,  stories: 2 },
  'res-high': { kind: 'res',    lo: 40, hi: 200, stories: 10 },
  'com-low':  { kind: 'com',    lo: 6,  hi: 20,  stories: 2 },
  'com-high': { kind: 'com',    lo: 40, hi: 150, stories: 8 },
  'ind':      { kind: 'ind',    lo: 20, hi: 60,  stories: 1 },
  'office':   { kind: 'office', lo: 30, hi: 120, stories: 10 },
};
// Which RCI demand bar a zone kind draws from (office satisfies the industry bar, CS-style).
export const DEMAND_OF_KIND = { res: 'res', com: 'com', ind: 'ind', office: 'ind' };

export const TUNING = {
  taxRate: 0.10,            // default; 0..0.5
  startMoney: 50000,
  workforceShare: 0.6,      // residents of working age
  resTaxBase: 6,            // $/resident/day at 100 % tax  → $0.60 at 10 %
  jobTaxBase: 12,           // $/filled job/day at 100 % tax → $1.20 at 10 %
  roadUpkeep: 0.06,         // $/metre/day
  buildingUpkeep: 8,        // $/building/day × level
  baseUpkeep: 50,           // $/day (city hall)
  demandDamping: 0.10,      // per hour, fraction of the gap closed
  growThreshold: 0.25,      // demand above which vacant lots develop
  growPerHour: 4,           // × demand excess × (1 + 0.01 × buildings)
  growCapPerHour: 12,       // per kind
  levelUpBase: 0.0015,      // per building per hour, × demand × landvalue × happiness
  levelUpCapPerHour: 3,
  pendingHours: 48,         // hours a 'sim:grow' request stays reserved before it may be re-issued
  maxLevel: 5,
  historyCap: 24 * 30,      // hourly samples kept
};

export const COSTS = Object.freeze({
  road: Object.freeze({ alley: 6, local: 12, avenue: 24, highway: 48 }), // $ per metre
  zone: 10,       // $ per 8 m cell
  bulldoze: 25,   // $ per object
  terrain: 4,     // $ per cell touched
});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Capacity (residents or jobs) of a building of `zone` at `level` with `stories` floors. */
export function capacityFor(zone, level = 1, stories) {
  const z = ZONE_INFO[zone];
  if (!z) return 0;
  const t = clamp(((level | 0) - 1) / 4, 0, 1);
  const base = z.lo + (z.hi - z.lo) * t;
  const s = Number.isFinite(stories) && stories > 0 ? clamp(stories / z.stories, 0.5, 2) : 1;
  return Math.max(1, Math.round(base * s));
}

export function zoneKind(zone) { return ZONE_INFO[zone]?.kind ?? null; }

export class CityModel {
  constructor({ rng, taxRate = TUNING.taxRate, money = TUNING.startMoney, day = 1, hour = 0, historyCap = TUNING.historyCap } = {}) {
    if (!rng || typeof rng.next !== 'function') throw new Error('CityModel needs an rng');
    this.rng = rng;
    this.historyCap = historyCap;
    this.reset({ taxRate, money, day, hour });
  }

  reset({ taxRate = this.taxRate ?? TUNING.taxRate, money = TUNING.startMoney, day = 1, hour = 0 } = {}) {
    this.taxRate = clamp(fin(taxRate, TUNING.taxRate), 0, 0.5);
    this.money = fin(money, TUNING.startMoney);
    this.day = Math.max(1, day | 0);
    this.hour = clamp(fin(hour), 0, 23.999);
    this.hoursTotal = 0;
    this.population = 0;   // float internally; rounded in readouts
    this.jobs = 0;         // total job capacity
    this.workers = 0;      // filled jobs
    this.happiness = 0.6;
    this.demand = { res: 0.5, com: 0.2, ind: 0.25 };
    this.stats = {};
    this.congestion = 0;
    this.powerOk = true;
    this.waterOk = true;
    this.extraRoadMeters = 0; // synthetic roads (showcase) — world.roads is not written by this module
    this.dirty = true;
    this.city = null;
    this.pending = new Map();     // lotId → { t: hoursTotal, level } of the outstanding grow request
    this.history = { hour: [], pop: [], money: [], happiness: [] };
    this.dayLog = [];             // { day, population, money, workers } at each day wrap
    this._acc = 0;
    this._popDayAgo = 0;
    this._lastTick = null;
    return this;
  }

  invalidate() { this.dirty = true; }
  setTaxRate(r) { this.taxRate = clamp(fin(r, TUNING.taxRate), 0, 0.5); return this.taxRate; }
  setCongestion(c) { this.congestion = clamp(fin(c), 0, 1); }

  /** Aggregate the world once (cached until invalidate()). */
  scan(world) {
    const lots = world?.lots instanceof Map ? world.lots : new Map();
    const buildings = world?.buildings instanceof Map ? world.buildings : new Map();
    const edges = world?.roads?.edges instanceof Map ? world.roads.edges : new Map();
    const c = {
      resCap: 0, jobCap: { com: 0, ind: 0, office: 0 }, buildings: 0, levelSum: 0,
      vacant: { res: [], com: [], ind: [] }, upgradable: [], lots: 0, zonedLots: 0,
      roadMeters: 0, roadCount: 0,
    };
    for (const b of buildings.values()) {
      if (!b) continue;
      const kind = zoneKind(b.zone);
      if (!kind) continue;
      const cap = capacityFor(b.zone, b.level, b.stories);
      if (kind === 'res') c.resCap += cap; else c.jobCap[kind] += cap;
      c.buildings++;
      c.levelSum += clamp(b.level | 0 || 1, 1, TUNING.maxLevel);
    }
    for (const lot of lots.values()) {
      if (!lot) continue;
      c.lots++;
      const kind = zoneKind(lot.zone);
      if (!kind) continue;
      c.zonedLots++;
      if (lot.buildingId == null || !buildings.has(lot.buildingId)) {
        c.vacant[DEMAND_OF_KIND[kind]].push(lot);
      } else {
        const b = buildings.get(lot.buildingId);
        if ((b.level | 0 || 1) < TUNING.maxLevel) c.upgradable.push({ lot, building: b, kind });
      }
    }
    // deterministic order regardless of Map insertion history
    const byId = (a, b) => (a.id | 0) - (b.id | 0);
    c.vacant.res.sort(byId); c.vacant.com.sort(byId); c.vacant.ind.sort(byId);
    c.upgradable.sort((a, b) => (a.lot.id | 0) - (b.lot.id | 0));
    for (const e of edges.values()) {
      if (!e) continue;
      let len = fin(e.length, 0);
      if (len <= 0 && world?.roads?.nodes) {
        const a = world.roads.nodes.get(e.a), b = world.roads.nodes.get(e.b);
        if (a?.pos && b?.pos) len = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      }
      c.roadMeters += len; c.roadCount++;
    }
    c.roadMeters += this.extraRoadMeters;
    // drop pending requests that have been fulfilled
    for (const lotId of [...this.pending.keys()]) {
      const lot = lots.get(lotId);
      const req = this.pending.get(lotId);
      const b = lot && lot.buildingId != null ? buildings.get(lot.buildingId) : null;
      if (!lot || (b && (b.level | 0 || 1) >= req.level)) this.pending.delete(lotId);
    }
    this.city = c;
    this.dirty = false;
    return c;
  }

  /** Accumulate elapsed game hours; run whole-hour ticks. Returns { events: [{type, payload}] }. */
  advance(world, hours, maxTicks = 48) {
    const events = [];
    this._acc += clamp(fin(hours), 0, 24 * 7);
    let n = 0;
    while (this._acc >= 1 && n < maxTicks) {
      this._acc -= 1; n++;
      const r = this.tickHour(world);
      for (const g of r.grow) events.push({ type: 'sim:grow', payload: g });
      events.push({ type: 'sim:tick', payload: r.tick });
    }
    if (n >= maxTicks) this._acc = 0; // never build up an unbounded backlog
    return { events, ticks: n };
  }

  /** One game hour. Pure with respect to `world` (read-only). */
  tickHour(world) {
    if (this.dirty || !this.city) this.scan(world);
    const T = TUNING, c = this.city, rng = this.rng;

    // ---- labour market
    this.jobs = c.jobCap.com + c.jobCap.ind + c.jobCap.office;
    const workforce = this.population * T.workforceShare;
    this.workers = Math.min(workforce, this.jobs);
    const unemployment = workforce > 1 ? clamp(1 - this.workers / workforce, 0, 1) : 0;
    const jobRatio = this.jobs / Math.max(1, workforce);          // >1: more jobs than workers

    // ---- happiness (eased)
    const services = (this.powerOk ? 0.05 : -0.2) + (this.waterOk ? 0.05 : -0.2);
    const happyTarget = clamp(
      0.5 + 0.25 * (1 - unemployment) - 0.35 * unemployment
      - (this.taxRate - 0.10) * 2.5 + services - 0.30 * this.congestion
      + 0.05 * clamp(jobRatio - 1, 0, 1) - (this.money < 0 ? 0.10 : 0), 0.02, 0.98);
    this.happiness += (happyTarget - this.happiness) * 0.04;

    // ---- population flow
    const occupancy = clamp(0.3 + 0.5 * this.happiness + 0.3 * clamp(jobRatio, 0, 1) - 0.3 * unemployment, 0.2, 1);
    const target = c.resCap * occupancy;
    if (target > this.population) {
      const rate = 0.03 * (0.4 + 0.6 * this.happiness) * clamp(0.3 + jobRatio, 0.3, 1.2);
      this.population += (target - this.population) * rate;
    } else {
      const rate = 0.005 + 0.02 * (1 - this.happiness);
      this.population += (target - this.population) * rate;
    }
    this.population = clamp(fin(this.population), 0, c.resCap);
    if (this.population < 0.5 && c.resCap === 0) this.population = 0;

    // ---- RCI demand (raw → damped)
    const vacancy = c.resCap > 0 ? clamp((c.resCap - this.population) / c.resCap, 0, 1) : 0;
    const resRaw = clamp(0.35 + 0.5 * clamp(1 - this.population / 150, 0, 1)
      + 0.35 * clamp((jobRatio - 0.8) / 0.6, -1, 1)
      + 0.6 * (this.happiness - 0.5) + 0.15 * (1 - 2 * vacancy), 0, 1);
    const desiredCom = 0.35 * workforce, desiredInd = 0.65 * workforce;
    const comGap = (desiredCom - c.jobCap.com) / Math.max(30, desiredCom);
    const indGap = (desiredInd - c.jobCap.ind - c.jobCap.office) / Math.max(30, desiredInd);
    const size = clamp(this.population / 3000, 0, 1);          // bigger cities want more commerce/industry
    const comRaw = clamp(0.2 + 0.55 * comGap + 0.15 * size + 0.1 * (this.happiness - 0.5), 0, 1);
    const indRaw = clamp(0.15 + 0.55 * indGap + 0.2 * clamp(comGap, 0, 1) + 0.1 * size, 0, 1);
    const d = this.demand, k = T.demandDamping;
    d.res = clamp(d.res + (resRaw - d.res) * k, 0, 1);
    d.com = clamp(d.com + (comRaw - d.com) * k, 0, 1);
    d.ind = clamp(d.ind + (indRaw - d.ind) * k, 0, 1);

    // ---- treasury (accrued hourly, quoted per day)
    const taxIncome = this.population * T.resTaxBase * this.taxRate + this.workers * T.jobTaxBase * this.taxRate;
    const upkeep = T.baseUpkeep + c.roadMeters * T.roadUpkeep + c.levelSum * T.buildingUpkeep;
    this.money = fin(this.money + (taxIncome - upkeep) / 24, this.money);

    // ---- growth engine
    const grow = [];
    for (const kind of ['res', 'com', 'ind']) {
      const excess = d[kind] - T.growThreshold;
      const vacant = c.vacant[kind].filter((l) => !this.pending.has(l.id));
      if (excess <= 0 || vacant.length === 0) continue;
      const want = (excess / (1 - T.growThreshold)) * T.growPerHour * (1 + 0.01 * c.buildings);
      let n = Math.floor(want) + (rng.chance(want - Math.floor(want)) ? 1 : 0);
      n = Math.min(n, T.growCapPerHour, vacant.length);
      // weighted pick by lot land value (lot.demand 0..1) without replacement
      const pool = vacant.slice();
      for (let i = 0; i < n; i++) {
        let total = 0;
        for (const l of pool) total += 0.35 + clamp(fin(l.demand, 0.5), 0, 1);
        let r = rng.next() * total, idx = pool.length - 1;
        for (let j = 0; j < pool.length; j++) { r -= 0.35 + clamp(fin(pool[j].demand, 0.5), 0, 1); if (r <= 0) { idx = j; break; } }
        const lot = pool.splice(idx, 1)[0];
        this.pending.set(lot.id, { t: this.hoursTotal, level: 1 });
        grow.push({ lotId: lot.id, zone: lot.zone, level: 1 });
      }
    }
    // level-ups: demand + land value + happiness, rarer at higher levels
    let ups = 0;
    for (const u of c.upgradable) {
      if (ups >= T.levelUpCapPerHour) break;
      if (this.pending.has(u.lot.id)) continue;
      const lvl = clamp(u.building.level | 0 || 1, 1, T.maxLevel);
      const p = T.levelUpBase * d[DEMAND_OF_KIND[u.kind]] * (0.5 + clamp(fin(u.lot.demand, 0.5), 0, 1)) * this.happiness * (1 - (lvl - 1) / T.maxLevel);
      if (rng.chance(p)) {
        this.pending.set(u.lot.id, { t: this.hoursTotal, level: lvl + 1 });
        grow.push({ lotId: u.lot.id, zone: u.building.zone, level: lvl + 1 });
        ups++;
      }
    }
    // expire stale requests (module on the other side may be missing)
    for (const [lotId, req] of this.pending) if (this.hoursTotal - req.t > T.pendingHours) this.pending.delete(lotId);
    if (grow.length) this.dirty = true; // buildings will (hopefully) change; re-scan next hour anyway

    // ---- clock
    this.hoursTotal++;
    this.hour += 1;
    if (this.hour >= 24) {
      this.hour -= 24; this.day++;
      this.dayLog.push({ day: this.day, population: Math.round(this.population), money: Math.round(this.money), workers: Math.round(this.workers) });
      if (this.dayLog.length > 400) this.dayLog.shift();
    }
    const h = this.history;
    h.hour.push(this.hoursTotal); h.pop.push(this.population); h.money.push(this.money); h.happiness.push(this.happiness);
    if (h.hour.length > this.historyCap) { h.hour.shift(); h.pop.shift(); h.money.shift(); h.happiness.shift(); }
    const idx24 = Math.max(0, h.pop.length - 25);
    const growthRate = h.pop.length > 1 ? (this.population - h.pop[idx24]) * (24 / Math.min(24, h.pop.length - 1)) : 0;

    // ---- readouts
    const stats = this.stats;
    stats.day = this.day; stats.hour = this.hour; stats.hoursTotal = this.hoursTotal;
    stats.households = Math.round(this.population / 2.4);
    stats.workforce = Math.round(workforce);
    stats.workers = Math.round(this.workers);
    stats.unemployment = +unemployment.toFixed(3);
    stats.jobRatio = +jobRatio.toFixed(3);
    stats.taxIncome = Math.round(taxIncome);
    stats.upkeep = Math.round(upkeep);
    stats.netIncome = Math.round(taxIncome - upkeep);
    stats.growthRate = +growthRate.toFixed(1);
    stats.avgLevel = c.buildings ? +(c.levelSum / c.buildings).toFixed(2) : 0;
    stats.powerOk = this.powerOk; stats.waterOk = this.waterOk;
    stats.traffic = +this.congestion.toFixed(3);
    stats.taxRate = this.taxRate;
    stats.resCapacity = c.resCap;
    stats.jobCapacity = { com: c.jobCap.com, ind: c.jobCap.ind, office: c.jobCap.office };
    stats.buildings = c.buildings; stats.lots = c.lots; stats.zonedLots = c.zonedLots;
    stats.vacantLots = c.vacant.res.length + c.vacant.com.length + c.vacant.ind.length;
    stats.roadMeters = Math.round(c.roadMeters); stats.roadCount = c.roadCount;
    stats.occupancy = c.resCap ? +(this.population / c.resCap).toFixed(3) : 0;
    stats.pendingGrowth = this.pending.size;

    const tick = {
      day: this.day, hour: this.hour,
      population: Math.round(this.population), jobs: this.jobs, money: Math.round(this.money),
      happiness: +this.happiness.toFixed(3),
      demand: { res: +d.res.toFixed(3), com: +d.com.toFixed(3), ind: +d.ind.toFixed(3) },
      stats,
    };
    this._lastTick = tick;
    return { grow, tick };
  }

  /** Plain snapshot for world.sim mirroring / UI. */
  snapshot() {
    return {
      population: Math.round(this.population), jobs: this.jobs, money: Math.round(this.money),
      happiness: this.happiness, demand: { ...this.demand }, stats: { ...this.stats },
      day: this.day, hour: this.hour,
    };
  }

  canAfford(n) { return Number.isFinite(n) && n <= this.money; }
  spend(n) { if (!Number.isFinite(n) || n < 0 || n > this.money) return false; this.money -= n; return true; }
  addMoney(n) { this.money = fin(this.money + fin(n), this.money); return this.money; }
}
