// terrain module — heightfield, chunked mesh, splat material, water, editing API. See ARCHITECTURE.md §3–§5.
import * as THREE from 'three';
import { generateHeightfield } from './heightmap.js';
import { createTerrainMaterial } from './material.js';
import { TerrainMesh } from './mesh.js';
import { Water, REFLECT_LAYER } from './water.js';
import { makeHeightTexture } from './textures.js';

const S = {
  ctx: null, mesh: null, material: null, water: null, heightTex: null, bounds: null, skyScan: 0, disposed: false,
};

// ---------- helpers ----------
function toIndex(world, x, z) {
  const t = world.terrain, n = t.res, s = world.size;
  return [((x + s / 2) / s) * (n - 1), ((z + s / 2) / s) * (n - 1)];
}
function clampI(v, n) { return v < 0 ? 0 : v > n - 1 ? n - 1 : v; }
/** Iterate heightfield samples inside a world-space circle; fn(index, x, z, d, ix, iz). Returns sample bbox. */
function forDisk(world, cx, cz, radius, fn) {
  const t = world.terrain, n = t.res, step = world.size / (n - 1);
  const [fx, fz] = toIndex(world, cx, cz), r = radius / step;
  const ix0 = clampI(Math.floor(fx - r), n), ix1 = clampI(Math.ceil(fx + r), n), iz0 = clampI(Math.floor(fz - r), n), iz1 = clampI(Math.ceil(fz + r), n);
  for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
    const x = -world.size / 2 + ix * step, z = -world.size / 2 + iz * step;
    const d = Math.hypot(x - cx, z - cz);
    if (d <= radius) fn(iz * n + ix, x, z, d, ix, iz);
  }
  return { ix0, iz0, ix1, iz1 };
}
const falloff = (d, r) => { const t = Math.min(1, d / Math.max(r, 1e-3)); const u = 1 - t * t; return u * u; };
function idxToBbox(world, b) {
  const step = world.size / (world.terrain.res - 1), h = world.size / 2;
  return { x0: -h + b.ix0 * step, z0: -h + b.iz0 * step, x1: -h + b.ix1 * step, z1: -h + b.iz1 * step };
}
function commit(bboxIdx) {
  const world = S.ctx.world;
  const bb = idxToBbox(world, bboxIdx);
  api.refresh(bb);
  return bb;
}

// ---------- public API ----------
const api = {
  getHeight(x, z) { return S.ctx ? S.ctx.world.terrain.getHeight(x, z) : 0; },
  getNormal(x, z, out) { return S.ctx.world.terrain.getNormal(x, z, out); },
  getSlope(x, z) { const n = S.ctx.world.terrain.getNormal(x, z); return Math.acos(Math.max(-1, Math.min(1, n.y))); },
  isWater(x, z) { return S.ctx.world.terrain.isWater(x, z); },
  getWaterLevel() { return S.ctx.world.terrain.waterLevel; },
  getBounds() {
    const w = S.ctx.world, h = w.size / 2;
    return { x0: -h, z0: -h, x1: h, z1: h, res: w.terrain.res, cell: w.size / (w.terrain.res - 1), waterLevel: w.terrain.waterLevel, minHeight: S.bounds?.minH ?? 0, maxHeight: S.bounds?.maxH ?? 0 };
  },
  raise(x, z, radius, amount) {
    const world = S.ctx.world, H = world.terrain.heights;
    const b = forDisk(world, x, z, radius, (i, px, pz, d) => { H[i] += amount * falloff(d, radius); });
    return commit(b);
  },
  lower(x, z, radius, amount) { return api.raise(x, z, radius, -amount); },
  flatten(x, z, radius, targetHeight, strength = 1) {
    const world = S.ctx.world, H = world.terrain.heights;
    const target = targetHeight ?? world.terrain.getHeight(x, z);
    const b = forDisk(world, x, z, radius, (i, px, pz, d) => { const f = falloff(d, radius) * strength; H[i] += (target - H[i]) * Math.min(1, f * 1.6); });
    return commit(b);
  },
  smooth(x, z, radius, strength = 1) {
    const world = S.ctx.world, H = world.terrain.heights, n = world.terrain.res;
    const src = new Map();
    const b = forDisk(world, x, z, radius, (i, px, pz, d, ix, iz) => {
      let sum = 0, cnt = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const jx = ix + dx, jz = iz + dz; if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue; sum += H[jz * n + jx]; cnt++; }
      src.set(i, H[i] + (sum / cnt - H[i]) * Math.min(1, falloff(d, radius) * strength));
    });
    for (const [i, v] of src) H[i] = v;
    return commit(b);
  },
  /** Level the terrain under a road strip. points: [{x,y?,z}|Vector3]; if y is given it is the target profile. */
  flattenPolyline(points, width, feather = 10) {
    const world = S.ctx.world, t = world.terrain, H = t.heights, n = t.res, step = world.size / (n - 1);
    if (!points || points.length < 2) return null;
    const P = points.map((p) => ({ x: p.x, z: p.z, y: (p.y != null && Number.isFinite(p.y)) ? p.y : t.getHeight(p.x, p.z) }));
    // smooth the target profile along the polyline so the road never has sharp grade changes
    for (let pass = 0; pass < 2; pass++) for (let i = 1; i < P.length - 1; i++) P[i].y = (P[i - 1].y + 2 * P[i].y + P[i + 1].y) / 4;
    const half = width / 2 + feather;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of P) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const [fx0, fz0] = toIndex(world, minX - half, minZ - half), [fx1, fz1] = toIndex(world, maxX + half, maxZ + half);
    const ix0 = clampI(Math.floor(fx0), n), iz0 = clampI(Math.floor(fz0), n), ix1 = clampI(Math.ceil(fx1), n), iz1 = clampI(Math.ceil(fz1), n);
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = -world.size / 2 + ix * step, z = -world.size / 2 + iz * step;
      let best = Infinity, bestY = 0;
      for (let s = 0; s < P.length - 1; s++) {
        const a = P[s], b = P[s + 1], abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz;
        const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / l2)) : 0;
        const qx = a.x + abx * u, qz = a.z + abz * u, d = Math.hypot(x - qx, z - qz);
        if (d < best) { best = d; bestY = a.y + (b.y - a.y) * u; }
      }
      if (best > half) continue;
      const f = best <= width / 2 ? 1 : 1 - (best - width / 2) / feather;
      const ff = f * f * (3 - 2 * f);
      const i = iz * n + ix;
      H[i] += (bestY - H[i]) * ff;
    }
    return commit({ ix0, iz0, ix1, iz1 });
  },
  setWaterLevel(h) {
    const world = S.ctx.world;
    world.terrain.waterLevel = h;
    S.water?.setLevel(h);
    if (S.material) S.material.userData.uniforms.uWater.value = h;
    const b = api.getBounds();
    S.ctx.events.emit('terrain:changed', { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, water: true });
  },
  /** Rebuild chunks intersecting bbox {x0,z0,x1,z1} (metres) from world.terrain.heights and emit terrain:changed. */
  refresh(bbox) {
    const world = S.ctx.world, n = world.terrain.res;
    const bb = bbox ?? api.getBounds();
    const [fx0, fz0] = toIndex(world, Math.min(bb.x0, bb.x1), Math.min(bb.z0, bb.z1)), [fx1, fz1] = toIndex(world, Math.max(bb.x0, bb.x1), Math.max(bb.z0, bb.z1));
    // pad by one sample so normals at the edge of the edit are consistent
    const ix0 = clampI(Math.floor(fx0) - 1, n), iz0 = clampI(Math.floor(fz0) - 1, n), ix1 = clampI(Math.ceil(fx1) + 1, n), iz1 = clampI(Math.ceil(fz1) + 1, n);
    S.mesh?.refreshRange(ix0, iz0, ix1, iz1);
    if (S.heightTex) S.heightTex.needsUpdate = true;
    let minH = Infinity, maxH = -Infinity; const H = world.terrain.heights;
    for (let i = 0; i < H.length; i++) { if (H[i] < minH) minH = H[i]; if (H[i] > maxH) maxH = H[i]; }
    S.bounds = { minH, maxH };
    const out = { x0: bb.x0, z0: bb.z0, x1: bb.x1, z1: bb.z1 };
    S.ctx.events.emit('terrain:changed', out);
    return out;
  },
  /** Layer used for the water's planar reflection; environment can enable it on its sky objects. */
  REFLECT_LAYER,
};

export default {
  name: 'terrain',
  wave: 1,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 40, triangles: 1_500_000 },

  async init(ctx) {
    S.ctx = ctx; S.disposed = false;
    const world = ctx.world, t = world.terrain;
    const rng = ctx.rng.fork('terrain');
    t.waterLevel = 0;
    const t0 = performance.now();
    const gen = generateHeightfield(t.heights, t.res, rng, t.waterLevel);
    S.bounds = { minH: gen.minH, maxH: gen.maxH };
    const t1 = performance.now();
    S.material = createTerrainMaterial(ctx, { waterLevel: t.waterLevel, snowLine: 218 });
    const t2 = performance.now();
    S.mesh = new TerrainMesh(world, S.material);
    S.mesh.proxy.layers.set(REFLECT_LAYER);
    ctx.scene.add(S.mesh.group);
    S.heightTex = makeHeightTexture(t.heights, t.res);
    S.water = new Water(ctx, S.heightTex, t.waterLevel);
    ctx.scene.add(S.water.mesh);
    ctx.log(`terrain: heightfield ${(t1 - t0).toFixed(0)} ms (h ${gen.minH.toFixed(1)}..${gen.maxH.toFixed(1)} m), textures ${(t2 - t1).toFixed(0)} ms, mesh ${(performance.now() - t2).toFixed(0)} ms`);
  },

  update(dt, ctx) {
    S.water?.update(dt);
    // every ~0.5 s: let sky-like objects from other modules show up in the water reflection
    S.skyScan += dt;
    if (S.skyScan > 0.5) {
      S.skyScan = 0;
      for (const o of ctx.scene.children) {
        if (o === S.mesh?.group || o === S.water?.mesh) continue;
        if (o.userData?.reflect || o.isSky || /sky|cloud|sun|moon|star/i.test(o.name || '')) o.layers.enable(REFLECT_LAYER);
      }
    }
  },

  async showcase(ctx) {
    // prove the editing API: a levelled plateau on the plain SW of the river, and a road strip levelled to the bank
    api.flatten(-150, -200, 90, 9.0);
    api.flattenPolyline([{ x: -80, z: -120 }, { x: -170, z: -260 }, { x: -300, z: -360 }], 14, 12);
    api.smooth(-150, -200, 130, 0.6);
    // fallback atmosphere when the environment module is a stub (it owns fog/sky in the real game)
    const env = ctx.modules.environment;
    if (!env || env.status !== 'ok' || env.def?.stub) {
      const bg = ctx.scene.background instanceof THREE.Color ? ctx.scene.background : new THREE.Color(0x8fb6e6);
      if (!ctx.scene.fog) ctx.scene.fog = new THREE.FogExp2(bg.clone(), 0.00028);
    }
    // default framing: across the river toward the bluff and the western mountains, grass in the foreground
    ctx.rig.lookAt(new THREE.Vector3(-70, 42, -230), new THREE.Vector3(-420, 8, -520));
  },

  dispose(ctx) {
    S.disposed = true;
    S.water?.dispose(); if (S.water) ctx.scene.remove(S.water.mesh);
    S.mesh?.dispose();
    S.material?.dispose(); S.heightTex?.dispose();
    S.water = null; S.mesh = null; S.material = null; S.heightTex = null;
  },
  api,
};
