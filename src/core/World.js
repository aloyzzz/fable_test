import * as THREE from 'three';
import { MAP_SIZE, CELL } from './Units.js';

export function createWorld(seed = 1337) {
  let idCounter = 1;
  const res = 513;
  const heights = new Float32Array(res * res);
  const world = {
    seed, size: MAP_SIZE, cell: CELL,
    nextId() { return idCounter++; },

    terrain: {
      res, heights, waterLevel: 0,
      getHeight(x, z) {
        const t = world.terrain;
        const n = t.res, s = world.size;
        const fx = ((x + s / 2) / s) * (n - 1);
        const fz = ((z + s / 2) / s) * (n - 1);
        const x0 = Math.max(0, Math.min(n - 2, Math.floor(fx)));
        const z0 = Math.max(0, Math.min(n - 2, Math.floor(fz)));
        const tx = Math.max(0, Math.min(1, fx - x0)), tz = Math.max(0, Math.min(1, fz - z0));
        const h = t.heights;
        const h00 = h[z0 * n + x0], h10 = h[z0 * n + x0 + 1], h01 = h[(z0 + 1) * n + x0], h11 = h[(z0 + 1) * n + x0 + 1];
        return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
      },
      getNormal(x, z, out = new THREE.Vector3()) {
        const e = world.size / (world.terrain.res - 1);
        const hl = world.terrain.getHeight(x - e, z), hr = world.terrain.getHeight(x + e, z);
        const hd = world.terrain.getHeight(x, z - e), hu = world.terrain.getHeight(x, z + e);
        return out.set(hl - hr, 2 * e, hd - hu).normalize();
      },
      isWater(x, z) { return world.terrain.getHeight(x, z) < world.terrain.waterLevel; },
    },

    roads: {
      nodes: new Map(), edges: new Map(),
      getEdge(id) { return world.roads.edges.get(id); },
      getNode(id) { return world.roads.nodes.get(id); },
      nearest(x, z, maxDist = 50) {
        let best = null;
        const p = new THREE.Vector3(x, 0, z), a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Vector3();
        for (const e of world.roads.edges.values()) {
          const pts = e.points;
          if (!pts || pts.length < 2) continue;
          for (let i = 0; i < pts.length - 1; i++) {
            a.set(pts[i].x, 0, pts[i].z); b.set(pts[i + 1].x, 0, pts[i + 1].z);
            const ab = b.clone().sub(a), len2 = ab.lengthSq();
            let t = len2 > 0 ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / len2)) : 0;
            q.copy(a).addScaledVector(ab, t);
            const d = q.distanceTo(p);
            if (d < maxDist && (!best || d < best.dist)) best = { edge: e, t: (i + t) / (pts.length - 1), point: q.clone(), dist: d };
          }
        }
        return best;
      },
    },

    lots: new Map(),
    buildings: new Map(),
    vehicles: [],
    citizens: [],

    sim: { population: 0, jobs: 0, money: 50000, happiness: 0.5, demand: { res: 0.5, com: 0.5, ind: 0.5 }, stats: {} },
    weather: { kind: 'clear', cloudCover: 0.2, wetness: 0, wind: new THREE.Vector2(1, 0.3), fogDensity: 0.0004 },
    camera: { position: new THREE.Vector3(), target: new THREE.Vector3() },
  };
  return world;
}
