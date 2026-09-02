// roads module — graph + procedural road geometry. Owned by the roads builder. See ARCHITECTURE.md §3/§4/§5.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoadGraph, SURFACE_LIFT } from './graph.js';
import { RoadBuilder, CATEGORIES } from './builder.js';
import { createMaterials, applyWetness } from './materials.js';
import { layoutOf, laneOffsets, rowHalf, CURB_W } from './layout.js';
import { buildShowcase } from './showcase.js';

const TAU = Math.PI * 2;
const S = {
  ctx: null, graph: null, builder: null, mats: null, group: null, meshes: {}, rng: null,
  islands: new Map(), dirty: false, unsub: [], lastRebuildMs: 0,
};

function terrainHeight(x, z) { return S.ctx.world.terrain.getHeight(x, z); }

function conformEdge(e) {
  for (const p of e.points) p.y = terrainHeight(p.x, p.z) + SURFACE_LIFT;
  e.laneCenters = S.graph.computeLaneCenters(e);
}

function onGraphChanged(payload) {
  const t0 = performance.now();
  const { world } = S.ctx;
  const terrain = S.ctx.modules.terrain;
  // terrain flattening for new edges, then re-conform
  if (terrain?.status === 'ok' && typeof terrain.api?.flattenPolyline === 'function') {
    for (const id of payload.added) { const e = world.roads.edges.get(id); if (e) { try { terrain.api.flattenPolyline(e.points, e.width); } catch (err) { S.ctx.log('roads: flattenPolyline failed', err); } } }
  }
  const affectedNodes = new Set(payload.nodes);
  for (const id of payload.added) { const e = world.roads.edges.get(id); if (e) { affectedNodes.add(e.a); affectedNodes.add(e.b); } }
  const edgesToBuild = new Set(payload.added);
  const goneNodes = [];
  for (const nid of affectedNodes) {
    const n = world.roads.nodes.get(nid);
    if (!n) { goneNodes.push(nid); continue; }
    for (const eid of n.edges) edgesToBuild.add(eid);
  }
  S.builder.drop(payload.removed, goneNodes);
  for (const eid of edgesToBuild) { const e = world.roads.edges.get(eid); if (e) { conformEdge(e); S.builder.samplers.delete(eid); } }
  for (const nid of affectedNodes) {
    const n = world.roads.nodes.get(nid); if (!n) continue;
    n.pos.y = terrainHeight(n.pos.x, n.pos.z) + SURFACE_LIFT;
    for (const eid of n.edges) { const e = world.roads.edges.get(eid); if (e) { (e.a === nid ? e.points[0] : e.points[e.points.length - 1]).y = n.pos.y; } }
  }
  for (const nid of affectedNodes) { const n = world.roads.nodes.get(nid); if (n) S.builder.nodeInfo.set(nid, S.builder.computeNode(n)); }
  // edges adjacent to affected nodes need their trims re-applied
  for (const eid of edgesToBuild) { const e = world.roads.edges.get(eid); if (!e) continue; S.builder.disposeSet(S.builder.edgeGeo.get(eid)); S.builder.edgeGeo.set(eid, S.builder.buildEdge(e)); }
  for (const nid of affectedNodes) { const n = world.roads.nodes.get(nid); if (!n) continue; S.builder.disposeSet(S.builder.nodeGeo.get(nid)); S.builder.nodeGeo.set(nid, S.builder.buildNode(n, S.builder.nodeInfo.get(nid))); }
  remerge();
  S.lastRebuildMs = performance.now() - t0;
  S.ctx.events.emit('roads:changed', payload);
}

function remerge() {
  const lists = {}; for (const k of CATEGORIES) lists[k] = [];
  const collect = (set) => { if (!set) return; for (const k of CATEGORIES) if (set[k]) lists[k].push(set[k]); };
  for (const set of S.builder.edgeGeo.values()) collect(set);
  for (const set of S.builder.nodeGeo.values()) collect(set);
  for (const isl of S.islands.values()) collect(isl.geo);
  for (const k of CATEGORIES) {
    const mesh = S.meshes[k];
    if (mesh.geometry) { mesh.geometry.dispose(); mesh.geometry = new THREE.BufferGeometry(); }
    mesh.visible = lists[k].length > 0;
    if (!lists[k].length) continue;
    const merged = mergeGeometries(lists[k], false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    mesh.geometry = merged;
  }
}

function makeMeshes(ctx) {
  S.group = new THREE.Group(); S.group.name = 'roads';
  const matFor = { asphalt: S.mats.asphalt, curb: S.mats.curb, paving: S.mats.paving, paint: S.mats.paint, grass: S.mats.grass };
  for (const k of CATEGORIES) {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), matFor[k]);
    m.name = 'roads/' + k; m.receiveShadow = true; m.castShadow = (k === 'curb'); m.frustumCulled = true; m.visible = false;
    m.renderOrder = k === 'paint' ? 1 : 0;
    S.meshes[k] = m; S.group.add(m);
  }
  ctx.scene.add(S.group);
}

function nodeIdOf(ref) { return typeof ref === 'number' ? ref : ref?.id; }

const api = {
  // ---- graph mutation
  addRoad(from, to, type = 'local', opts = {}) { return S.graph.addRoad(from, to, type, opts); },
  removeEdge(id) { return S.graph.removeEdge(id); },
  removeNode(id) { return S.graph.removeNode(id); },
  clear() { S.graph.clear(); for (const isl of S.islands.values()) S.builder.disposeSet(isl.geo); S.islands.clear(); remerge(); },
  beginBatch() { S.graph.beginBatch(); },
  endBatch() { S.graph.endBatch(); },
  /** Roundabout: one-way ring of `type` around (cx,cz); crossing roads are cut and joined to the ring. Returns { ring: edge ids, island }. */
  addRoundabout(cx, cz, r = 30, type = 'local') {
    const g = S.graph; g.beginBatch();
    const ringEdges = [];
    try {
      const n = 8, R = r / Math.cos(Math.PI / n);
      for (let k = 0; k < n; k++) {
        const a0 = -TAU * k / n, a1 = -TAU * (k + 1) / n, am = (a0 + a1) / 2;        // decreasing angle = counter-clockwise from above
        const res = g.addRoad({ x: cx + Math.cos(a0) * r, z: cz + Math.sin(a0) * r }, { x: cx + Math.cos(a1) * r, z: cz + Math.sin(a1) * r }, type,
          { via: { x: cx + Math.cos(am) * R, z: cz + Math.sin(am) * R }, oneWay: true, snap: false });
        ringEdges.push(...res.edges);
      }
      // remove everything strictly inside the ring
      for (const e of [...g.edges.values()]) {
        const mid = e.points[Math.floor(e.points.length / 2)];
        const da = Math.hypot(g.nodes.get(e.a).pos.x - cx, g.nodes.get(e.a).pos.z - cz), db = Math.hypot(g.nodes.get(e.b).pos.x - cx, g.nodes.get(e.b).pos.z - cz), dm = Math.hypot(mid.x - cx, mid.z - cz);
        if (da < r - 1 || db < r - 1 || (dm < r - 3 && !ringEdges.includes(e.id))) g.removeEdge(e.id);
      }
      for (const nd of [...g.nodes.values()]) if (Math.hypot(nd.pos.x - cx, nd.pos.z - cz) < r - 1) g.removeNode(nd.id);
      const A = layoutOf(type).asphalt;
      const y = terrainHeight(cx, cz) + SURFACE_LIFT;
      const id = S.ctx.world.nextId();
      S.islands.set(id, { id, cx, cz, r: r - A - 0.4, geo: S.builder.buildIsland(cx, cz, r - A - 0.4, y) });
    } finally { g.endBatch(); }
    remerge();
    return { ring: ringEdges };
  },

  // ---- queries
  getEdge(id) { return S.ctx.world.roads.getEdge(id); },
  getNode(id) { return S.ctx.world.roads.getNode(id); },
  nearest(x, z, maxDist = 50) { return S.ctx.world.roads.nearest(x, z, maxDist); },
  nodesNear(x, z, r) { return S.graph.nodesNear(x, z, r); },
  edgesNear(x, z, r) { return S.graph.edgesNear(x, z, r); },
  /** Lanes 0..n-1 left→right looking a→b. dirs[i] = +1 (a→b, right half) | -1 (b→a, left half); one-way: all +1. */
  getLaneInfo(edgeId) {
    const e = S.ctx.world.roads.edges.get(edgeId); if (!e) return null;
    const L = layoutOf(e.type), offs = laneOffsets(e.type, e.oneWay);
    return { count: offs.length, width: L.laneW, dirs: offs.map((o) => o.dir), offsets: offs.map((o) => o.offset), speed: e.speed, oneWay: e.oneWay };
  },
  /** Polyline (Vector3[]) along the lane centre, ordered in the lane's driving direction. */
  getLanePath(edgeId, laneIndex) {
    const e = S.ctx.world.roads.edges.get(edgeId); if (!e) return null;
    const lane = e.laneCenters[laneIndex]; return lane ? lane.map((p) => p.clone()) : null;
  },
  /** Sidewalk centreline on side (+1 right of a→b, -1 left), a→b order. null for roads without sidewalks. */
  getSidewalkPath(edgeId, side = 1) {
    const e = S.ctx.world.roads.edges.get(edgeId); if (!e) return null;
    const L = layoutOf(e.type); if (L.sidewalk <= 0) return null;
    const sp = S.builder.sampler(e), o = side * (L.asphalt + CURB_W + (L.sidewalk - CURB_W) / 2);
    return sp.samples(0, sp.length).map((q) => new THREE.Vector3(q.x + q.nx * o, q.y + 0.15, q.z + q.nz * o));
  },
  /** Lot frontage line for zoning: offset = distance from the centreline to the right-of-way edge on `side`. */
  getEdgeFrontage(edgeId, side = 1) {
    const e = S.ctx.world.roads.edges.get(edgeId); if (!e) return null;
    const sp = S.builder.sampler(e), o = side * rowHalf(e.type);
    const a = sp.at(0, {}), b = sp.at(sp.length, {});
    return { offset: rowHalf(e.type), side, from: new THREE.Vector3(a.x + a.nx * o, a.y, a.z + a.nz * o), to: new THREE.Vector3(b.x + b.nx * o, b.y, b.z + b.nz * o), sidewalk: layoutOf(e.type).sidewalk, asphaltHalf: layoutOf(e.type).asphalt };
  },
  /** Per-end trim (metres from the node to where the edge's ribbon starts) — useful for props placement. */
  getEdgeTrims(edgeId) {
    const e = S.ctx.world.roads.edges.get(edgeId); if (!e) return null;
    return { a: S.builder.nodeInfo.get(e.a)?.trims.get(edgeId) || 0, b: S.builder.nodeInfo.get(e.b)?.trims.get(edgeId) || 0 };
  },
  getNodeInfo(nodeId) { const i = S.builder.nodeInfo.get(nodeId); return i ? { kind: i.kind, degree: i.degree, junction: i.junction, polygon: i.polygon?.map((p) => p.clone()) || null } : null; },
  route(fromNodeId, toNodeId) { return S.graph.route(nodeIdOf(fromNodeId), nodeIdOf(toNodeId)); },
  routeXZ(ax, az, bx, bz) { return S.graph.routeXZ(ax, az, bx, bz); },
  layoutOf,
  stats() {
    const tris = {}; let total = 0;
    for (const k of CATEGORIES) { const n = (S.meshes[k]?.geometry?.index?.count || 0) / 3; tris[k] = n; total += n; }
    return { edges: S.ctx.world.roads.edges.size, nodes: S.ctx.world.roads.nodes.size, lastRebuildMs: +S.lastRebuildMs.toFixed(1), triangles: total, trianglesByCategory: tris, meshes: CATEGORIES.length };
  },
  rebuildAll() {
    const g = S.graph; const ids = [...g.edges.keys()], nids = [...g.nodes.keys()];
    S.builder.drop(ids, nids);
    onGraphChanged({ added: ids, removed: [], nodes: nids });
  },
};

export default {
  name: 'roads',
  wave: 1,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 120, triangles: 1_500_000 },

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('roads');
    S.mats = createMaterials(ctx);
    S.graph = new RoadGraph(ctx.world, terrainHeight);
    S.builder = new RoadBuilder(S.graph);
    makeMeshes(ctx);
    S.graph.onChanged = onGraphChanged;
    S.unsub.push(ctx.events.on('terrain:changed', (b) => {
      if (!b) return;
      const ids = [];
      for (const e of ctx.world.roads.edges.values()) if (e.points.some((p) => p.x >= b.x0 - 20 && p.x <= b.x1 + 20 && p.z >= b.z0 - 20 && p.z <= b.z1 + 20)) ids.push(e.id);
      if (!ids.length) return;
      const nodes = new Set(); for (const id of ids) { const e = ctx.world.roads.edges.get(id); nodes.add(e.a); nodes.add(e.b); }
      onGraphChanged({ added: [], removed: [], nodes: [...nodes] });
    }));
    ctx.log('roads: init ok');
  },
  update(dt, ctx) { applyWetness(S.mats, ctx.world.weather?.wetness || 0); },
  async showcase(ctx) { buildShowcase(ctx, api); },
  dispose(ctx) {
    for (const u of S.unsub) u(); S.unsub = [];
    if (S.group) ctx.scene.remove(S.group);
    for (const k in S.meshes) S.meshes[k].geometry?.dispose();
    S.builder?.drop([...S.builder.edgeGeo.keys()], [...S.builder.nodeGeo.keys()]);
  },
  api,
};
