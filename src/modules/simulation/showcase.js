// Showcase support for the simulation module: a synthetic 200-lot city written into world.lots,
// a stand-in for the buildings module (creates world.buildings entries when 'sim:grow' fires —
// ONLY in showcase mode, where the real buildings module is not loaded) and a minimap painter.
import * as THREE from 'three';
import { ZONE_INFO } from './model.js';
import { ZONE_COLORS, ZONE_LABELS } from './hud.js';

const STREETS = 5, PER_SIDE = 20, LOT_W = 16, LOT_D = 24, STREET_GAP = 80, STREET_W = 16;
const STREET_MIX = [
  [['res-low', 0.85], ['com-low', 0.15]],
  [['res-low', 0.6], ['res-high', 0.25], ['com-low', 0.15]],
  [['com-high', 0.35], ['res-high', 0.35], ['office', 0.3]],
  [['office', 0.4], ['com-low', 0.3], ['res-high', 0.3]],
  [['ind', 0.8], ['com-low', 0.2]],
];
function pickZone(rng, mix) { let r = rng.next(); for (const [z, p] of mix) { r -= p; if (r <= 0) return z; } return mix[mix.length - 1][0]; }

/** Writes lots into world.lots; returns the layout used by the minimap. */
export function buildShowcaseCity(world, rng) {
  const layout = { lots: [], streets: [], bounds: { x0: -180, x1: 180, z0: -190, z1: 190 } };
  const x0 = -(PER_SIDE * LOT_W) / 2;
  for (let s = 0; s < STREETS; s++) {
    const z = -((STREETS - 1) * STREET_GAP) / 2 + s * STREET_GAP;
    layout.streets.push({ x0, x1: -x0, z, w: STREET_W });
    for (let i = 0; i < PER_SIDE; i++) {
      for (const side of [-1, 1]) {
        const id = world.nextId();
        const cx = x0 + i * LOT_W + LOT_W / 2, cz = z + side * (STREET_W / 2 + LOT_D / 2);
        const zone = pickZone(rng, STREET_MIX[s]);
        const landValue = Math.min(1, 0.3 + 0.4 * (1 - Math.abs(s - 2) / 2) + rng.next() * 0.3);
        const hw = LOT_W / 2, hd = LOT_D / 2;
        const lot = {
          id, edgeId: 0, side, zone,
          center: new THREE.Vector3(cx, 0, cz), size: { w: LOT_W, d: LOT_D }, rotation: side < 0 ? Math.PI / 2 : -Math.PI / 2,
          corners: [new THREE.Vector3(cx - hw, 0, cz - hd), new THREE.Vector3(cx + hw, 0, cz - hd), new THREE.Vector3(cx + hw, 0, cz + hd), new THREE.Vector3(cx - hw, 0, cz + hd)],
          level: 1, buildingId: null, demand: landValue,
        };
        world.lots.set(id, lot);
        layout.lots.push(lot);
      }
    }
  }
  // two cross streets + the five main streets, for road upkeep (world.roads is not ours to write)
  layout.roadMeters = STREETS * (PER_SIDE * LOT_W) + 2 * ((STREETS - 1) * STREET_GAP + 2 * LOT_D);
  return layout;
}

/** Stand-in for the buildings module (showcase only). Returns an unsubscribe function. */
export function installBuildingStandIn(ctx, rng, onEvent) {
  const world = ctx.world;
  return ctx.events.on('sim:grow', (g) => {
    const lot = world.lots.get(g.lotId);
    if (!lot) return;
    const info = ZONE_INFO[g.zone] || ZONE_INFO[lot.zone];
    if (!info) return;
    const level = Math.max(1, Math.min(5, g.level | 0));
    const stories = Math.max(1, Math.round(info.stories * (0.6 + 0.15 * level) * (0.8 + rng.next() * 0.4)));
    const height = stories * (info.kind === 'ind' ? 6 : 3.4);
    const existing = lot.buildingId != null ? world.buildings.get(lot.buildingId) : null;
    if (existing) {
      existing.level = level; existing.stories = stories; existing.height = height;
      lot.level = level;
      ctx.events.emit('buildings:changed', { added: [], removed: [] });
      onEvent?.(`Lot ${lot.id} · ${ZONE_LABELS[existing.zone]} upgraded to level ${level}`);
    } else {
      const id = world.nextId();
      world.buildings.set(id, {
        id, lotId: lot.id, zone: g.zone || lot.zone, level, height,
        footprint: lot.corners.map((c) => c.clone()), seed: rng.int(0, 0x7fffffff), stories, style: rng.pick(['a', 'b', 'c']),
      });
      lot.buildingId = id; lot.level = level;
      ctx.events.emit('buildings:changed', { added: [id], removed: [] });
      onEvent?.(`Lot ${lot.id} · new ${ZONE_LABELS[g.zone || lot.zone]} building`);
    }
  });
}

/** Minimap painter: g2d, w, h → paints streets, lots (zone colour) and buildings (brightness by level). */
export function makeMapPainter(world, layout) {
  return (g, w, h) => {
    const b = layout.bounds;
    const sx = w / (b.x1 - b.x0), sz = h / (b.z1 - b.z0);
    const X = (x) => (x - b.x0) * sx, Z = (z) => (z - b.z0) * sz;
    g.fillStyle = '#0a0f18'; g.fillRect(0, 0, w, h);
    // faint ground grid
    g.strokeStyle = 'rgba(255,255,255,.035)'; g.lineWidth = 1;
    for (let x = b.x0; x <= b.x1; x += 32) { g.beginPath(); g.moveTo(X(x) + .5, 0); g.lineTo(X(x) + .5, h); g.stroke(); }
    for (let z = b.z0; z <= b.z1; z += 32) { g.beginPath(); g.moveTo(0, Z(z) + .5); g.lineTo(w, Z(z) + .5); g.stroke(); }
    // streets
    g.fillStyle = '#2b3446';
    for (const s of layout.streets) g.fillRect(X(s.x0 - 12), Z(s.z - s.w / 2), (s.x1 - s.x0 + 24) * sx, s.w * sz);
    const cx0 = layout.streets[0].x0 - 12, cx1 = layout.streets[0].x1 + 12;
    const zTop = layout.streets[0].z - STREET_GAP / 2 - 6, zBot = layout.streets[STREETS - 1].z + STREET_GAP / 2 + 6;
    g.fillRect(X(cx0 - 8), Z(zTop), 8 * sx, (zBot - zTop) * sz);
    g.fillRect(X(cx1), Z(zTop), 8 * sx, (zBot - zTop) * sz);
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.setLineDash([3, 3]);
    for (const s of layout.streets) { g.beginPath(); g.moveTo(X(s.x0), Z(s.z) + .5); g.lineTo(X(s.x1), Z(s.z) + .5); g.stroke(); }
    g.setLineDash([]);
    // lots
    for (const lot of layout.lots) {
      const col = ZONE_COLORS[lot.zone] || '#666';
      const x = X(lot.center.x - lot.size.w / 2) + 1, z = Z(lot.center.z - lot.size.d / 2) + 1;
      const lw = lot.size.w * sx - 2, ld = lot.size.d * sz - 2;
      const bld = lot.buildingId != null ? world.buildings.get(lot.buildingId) : null;
      if (bld) {
        const lvl = Math.max(1, Math.min(5, bld.level | 0));
        g.globalAlpha = 0.45 + 0.13 * lvl;
        g.fillStyle = col; g.fillRect(x, z, lw, ld);
        g.globalAlpha = 1;
        if (lvl >= 3) { g.fillStyle = 'rgba(255,255,255,' + (0.15 + 0.12 * (lvl - 3)) + ')'; g.fillRect(x + 1, z + 1, Math.max(1, lw - 2), Math.max(1, ld * 0.35)); }
      } else {
        g.globalAlpha = 0.16; g.fillStyle = col; g.fillRect(x, z, lw, ld);
        g.globalAlpha = 0.45; g.strokeStyle = col; g.lineWidth = 1; g.strokeRect(x + .5, z + .5, lw - 1, ld - 1);
        g.globalAlpha = 1;
      }
    }
  };
}
