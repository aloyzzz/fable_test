// Road graph: nodes + edges living in world.roads, with snapping, splitting, curves and routing.
// All mutation goes through RoadGraph; geometry is rebuilt by index.js from the 'changed' callbacks.
import * as THREE from 'three';
import { ROAD_TYPES, CELL } from '../../core/Units.js';
import { LAYOUTS, laneOffsets } from './layout.js';

export const SURFACE_LIFT = 0.15;      // road surface above terrain (m)
export const SNAP_DIST = 6;            // snap endpoints to nodes/edges within this
export const SEG_LEN = 8;              // max polyline segment length (m)
export const MIN_EDGE = 4;             // never create edges shorter than this

const _v = new THREE.Vector3();

function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1x = bx - ax, r1z = bz - az, r2x = dx - cx, r2z = dz - cz;
  const den = r1x * r2z - r1z * r2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * r2z - (cz - az) * r2x) / den;
  const u = ((cx - ax) * r1z - (cz - az) * r1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: ax + r1x * t, z: az + r1z * t };
}

export class RoadGraph {
  constructor(world, terrainHeight) {
    this.world = world;
    this.roads = world.roads;
    this.height = terrainHeight;         // (x,z) → terrain height
    this._batch = 0;
    this._pending = { added: new Set(), removed: new Set(), nodes: new Set() };
    this.onChanged = null;               // (payload) => void
  }

  // ---------- helpers ----------
  get nodes() { return this.roads.nodes; }
  get edges() { return this.roads.edges; }
  surfaceY(x, z) { return this.height(x, z) + SURFACE_LIFT; }

  _touch(kind, id) { this._pending[kind].add(id); }
  beginBatch() { this._batch++; }
  endBatch() { this._batch = Math.max(0, this._batch - 1); if (this._batch === 0) this._flush(); }
  _flush() {
    if (this._batch > 0) return;
    const p = this._pending;
    if (!p.added.size && !p.removed.size && !p.nodes.size) return;
    const added = [...p.added].filter((id) => this.edges.has(id));
    const removed = [...p.removed];
    const nodes = [...p.nodes];
    this._pending = { added: new Set(), removed: new Set(), nodes: new Set() };
    this.onChanged?.({ added, removed, nodes });
  }

  _newNode(x, z) {
    const id = this.world.nextId();
    const n = { id, pos: new THREE.Vector3(x, this.surfaceY(x, z), z), edges: [] };
    this.nodes.set(id, n);
    this._touch('nodes', id);
    return n;
  }
  _newEdge(a, b, type, points, opts = {}) {
    const def = ROAD_TYPES[type] || ROAD_TYPES.local;
    const id = this.world.nextId();
    const pts = points.map((p) => p.clone());
    // pin ends to node positions
    const na = this.nodes.get(a), nb = this.nodes.get(b);
    pts[0].copy(na.pos); pts[pts.length - 1].copy(nb.pos);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    const e = { id, a, b, type, width: def.width, lanes: def.lanes, oneWay: !!opts.oneWay, length, points: pts, laneCenters: [], speed: def.speed };
    e.laneCenters = this.computeLaneCenters(e);
    this.edges.set(id, e);
    na.edges.push(id); nb.edges.push(id);
    this._touch('added', id); this._touch('nodes', a); this._touch('nodes', b);
    return e;
  }
  _deleteEdge(id) {
    const e = this.edges.get(id); if (!e) return;
    for (const nid of [e.a, e.b]) { const n = this.nodes.get(nid); if (n) { n.edges = n.edges.filter((x) => x !== id); this._touch('nodes', nid); } }
    this.edges.delete(id);
    this._pending.added.delete(id);
    this._touch('removed', id);
  }
  _deleteNodeIfEmpty(id) {
    const n = this.nodes.get(id);
    if (n && n.edges.length === 0) { this.nodes.delete(id); this._touch('nodes', id); }
  }

  computeLaneCenters(e) {
    const offs = laneOffsets(e.type, e.oneWay);
    const pts = e.points, n = pts.length;
    const out = [];
    for (let li = 0; li < offs.length; li++) {
      const { offset, dir } = offs[li];
      const lane = [];
      for (let i = 0; i < n; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)];
        let dx = p1.x - p0.x, dz = p1.z - p0.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        lane.push(new THREE.Vector3(pts[i].x - dz * offset, pts[i].y, pts[i].z + dx * offset));
      }
      if (dir < 0) lane.reverse();
      out.push(lane);
    }
    return out;
  }

  // ---------- polyline construction ----------
  buildPolyline(ax, az, bx, bz, via) {
    const pts = [];
    if (via) {
      // quadratic bezier, sampled ≤ SEG_LEN
      const approx = Math.hypot(via.x - ax, via.z - az) + Math.hypot(bx - via.x, bz - via.z);
      const n = Math.max(2, Math.ceil(approx / SEG_LEN));
      for (let i = 0; i <= n; i++) {
        const t = i / n, mt = 1 - t;
        const x = mt * mt * ax + 2 * mt * t * via.x + t * t * bx;
        const z = mt * mt * az + 2 * mt * t * via.z + t * t * bz;
        pts.push(new THREE.Vector3(x, 0, z));
      }
    } else {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / SEG_LEN));
      for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector3(ax + (bx - ax) * t, 0, az + (bz - az) * t)); }
    }
    for (const p of pts) p.y = this.surfaceY(p.x, p.z);
    return pts;
  }
  /** Resample a polyline so no segment exceeds SEG_LEN (keeps the original vertices). */
  densify(points) {
    const out = [points[0].clone()];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.ceil(len / SEG_LEN));
      for (let k = 1; k <= n; k++) { const t = k / n; const p = new THREE.Vector3(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t); p.y = this.surfaceY(p.x, p.z); out.push(p); }
    }
    return out;
  }
  static cumLengths(pts) {
    const c = [0];
    for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    return c;
  }
  /** Sub-polyline between arc lengths s0..s1 (inclusive; new end vertices are interpolated). */
  static slice(pts, cum, s0, s1) {
    const at = (s) => {
      let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
      const l = cum[i] - cum[i - 1] || 1; const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / l));
      return new THREE.Vector3().lerpVectors(pts[i - 1], pts[i], t);
    };
    const out = [at(s0)];
    for (let i = 0; i < pts.length; i++) if (cum[i] > s0 + 0.5 && cum[i] < s1 - 0.5) out.push(pts[i].clone());
    out.push(at(s1));
    return out;
  }

  // ---------- queries ----------
  nodesNear(x, z, r) {
    const out = [];
    for (const n of this.nodes.values()) { const d = Math.hypot(n.pos.x - x, n.pos.z - z); if (d <= r) out.push({ node: n, dist: d }); }
    return out.sort((p, q) => p.dist - q.dist).map((o) => o.node);
  }
  edgesNear(x, z, r) {
    const out = [];
    for (const e of this.edges.values()) {
      const pts = e.points; let best = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1].x, az = pts[i - 1].z, bx = pts[i].x - ax, bz = pts[i].z - az;
        const l2 = bx * bx + bz * bz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / l2));
        const d = Math.hypot(ax + bx * t - x, az + bz * t - z); if (d < best) best = d;
      }
      if (best <= r) out.push({ edge: e, dist: best });
    }
    return out.sort((p, q) => p.dist - q.dist).map((o) => o.edge);
  }

  // ---------- mutation ----------
  /** Resolve an endpoint spec (node id | {x,z}) into a node id, snapping to grid / nodes / edges. */
  resolveEndpoint(spec, snap = true) {
    if (typeof spec === 'number') { if (this.nodes.has(spec)) return spec; throw new Error(`roads: unknown node ${spec}`); }
    let x = spec.x, z = spec.z;
    if (snap) { x = Math.round(x / CELL) * CELL; z = Math.round(z / CELL) * CELL; }
    const near = this.nodesNear(x, z, SNAP_DIST);
    if (near.length) return near[0].id;
    const hit = this.roads.nearest(x, z, SNAP_DIST);
    if (hit) return this.splitEdgeAt(hit.edge.id, hit.t, hit.point.x, hit.point.z).id;
    return this._newNode(x, z).id;
  }

  /** Split an edge at parameter t (0..1 along the polyline param used by nearest) → the new (or existing) node. */
  splitEdgeAt(edgeId, t, px, pz) {
    const e = this.edges.get(edgeId);
    const cum = RoadGraph.cumLengths(e.points);
    const L = cum[cum.length - 1];
    // convert nearest()'s parameter (segment index fraction) to arc length
    const segs = e.points.length - 1; const fi = t * segs; const i = Math.min(segs - 1, Math.floor(fi));
    const s = cum[i] + (fi - i) * (cum[i + 1] - cum[i]);
    return this.splitEdgeAtLength(e, s, px, pz);
  }
  splitEdgeAtLength(e, s, px, pz) {
    const cum = RoadGraph.cumLengths(e.points);
    const L = cum[cum.length - 1];
    if (s < SNAP_DIST) return this.nodes.get(e.a);
    if (L - s < SNAP_DIST) return this.nodes.get(e.b);
    const node = this._newNode(px, pz);
    const p1 = RoadGraph.slice(e.points, cum, 0, s), p2 = RoadGraph.slice(e.points, cum, s, L);
    const a = e.a, b = e.b, type = e.type, oneWay = e.oneWay;
    this._deleteEdge(e.id);
    this._newEdge(a, node.id, type, p1, { oneWay });
    this._newEdge(node.id, b, type, p2, { oneWay });
    return node;
  }

  addRoad(from, to, type = 'local', opts = {}) {
    if (!ROAD_TYPES[type]) type = 'local';
    this.beginBatch();
    const result = { edges: [], nodes: [] };
    try {
      const aId = this.resolveEndpoint(from, opts.snap !== false);
      const bId = this.resolveEndpoint(to, opts.snap !== false);
      if (aId === bId) return result;
      const na = this.nodes.get(aId), nb = this.nodes.get(bId);
      const via = opts.via ? { x: opts.via.x, z: opts.via.z } : null;
      const pts = opts.points ? this.densify(opts.points.map((p) => new THREE.Vector3(p.x, 0, p.z))) : this.buildPolyline(na.pos.x, na.pos.z, nb.pos.x, nb.pos.z, via);
      pts[0].set(na.pos.x, na.pos.y, na.pos.z); pts[pts.length - 1].set(nb.pos.x, nb.pos.y, nb.pos.z);
      const cum = RoadGraph.cumLengths(pts); const L = cum[cum.length - 1];
      if (L < MIN_EDGE) return result;

      // find crossings with existing edges
      const events = [{ s: 0, node: aId }, { s: L, node: bId }];
      const existing = [...this.edges.values()];
      for (const e of existing) {
        if (!this.edges.has(e.id)) continue;
        const ep = e.points; const ecum = RoadGraph.cumLengths(ep);
        const hits = [];
        for (let i = 1; i < pts.length; i++) for (let j = 1; j < ep.length; j++) {
          const h = segIntersect(pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z, ep[j - 1].x, ep[j - 1].z, ep[j].x, ep[j].z);
          if (!h) continue;
          const s = cum[i - 1] + h.t * (cum[i] - cum[i - 1]);
          const es = ecum[j - 1] + h.u * (ecum[j] - ecum[j - 1]);
          if (s < SNAP_DIST || L - s < SNAP_DIST) continue;                      // handled by endpoint snapping
          if (hits.some((q) => Math.abs(q.es - es) < 1)) continue;             // shared vertex counted twice
          hits.push({ s, es, x: h.x, z: h.z });
        }
        // split from the far end so arc lengths stay valid: do one split at a time, re-fetching the edge
        hits.sort((p, q) => q.es - p.es);
        let cur = e;
        for (const h of hits) {
          if (!this.edges.has(cur.id)) break;
          const node = this.splitEdgeAtLength(cur, h.es, h.x, h.z);
          events.push({ s: h.s, node: node.id });
          // after the split, the part [0..es] is the newest edge with a === cur.a
          const first = [...this.edges.values()].find((x) => x.a === cur.a && x.b === node.id);
          if (!first) break; cur = first;
        }
      }
      events.sort((p, q) => p.s - q.s);
      // dedupe events referring to the same node or too close together
      const ev = [];
      for (const it of events) {
        const last = ev[ev.length - 1];
        if (last && (last.node === it.node || it.s - last.s < MIN_EDGE)) { if (it.node === bId) ev[ev.length - 1] = it; continue; }
        ev.push(it);
      }
      for (let i = 1; i < ev.length; i++) {
        const A = ev[i - 1], B = ev[i];
        if (A.node === B.node) continue;
        // don't duplicate an existing direct edge between the two nodes
        const nA = this.nodes.get(A.node);
        if (nA.edges.some((eid) => { const e = this.edges.get(eid); return e && ((e.a === A.node && e.b === B.node) || (e.b === A.node && e.a === B.node)) && e.length < 2 * (B.s - A.s); })) continue;
        const sub = RoadGraph.slice(pts, cum, A.s, B.s);
        const e = this._newEdge(A.node, B.node, type, sub, { oneWay: !!opts.oneWay });
        result.edges.push(e.id);
        if (!result.nodes.includes(A.node)) result.nodes.push(A.node);
        if (!result.nodes.includes(B.node)) result.nodes.push(B.node);
      }
    } finally { this.endBatch(); }
    return result;
  }

  removeEdge(id) {
    const e = this.edges.get(id); if (!e) return false;
    this.beginBatch();
    this._deleteEdge(id);
    this._deleteNodeIfEmpty(e.a); this._deleteNodeIfEmpty(e.b);
    this.endBatch();
    return true;
  }

  removeNode(id) {
    const n = this.nodes.get(id); if (!n) return false;
    this.beginBatch();
    try {
      if (n.edges.length === 2) {
        const e1 = this.edges.get(n.edges[0]), e2 = this.edges.get(n.edges[1]);
        if (e1 && e2 && e1.type === e2.type && e1.oneWay === e2.oneWay) {
          // merge through: orient both so they flow a→n→b
          let p1 = e1.points.map((p) => p.clone()), p2 = e2.points.map((p) => p.clone());
          let a = e1.a, b = e2.b;
          if (e1.b !== id) { if (e1.oneWay) { /* can't flip a one-way; fall through to plain removal */ a = null; } else { p1.reverse(); a = e1.b; } }
          if (e2.a !== id) { if (e2.oneWay) a = null; else { p2.reverse(); b = e2.a; } }
          if (a != null && a !== b) {
            const pts = [...p1, ...p2.slice(1)];
            this._deleteEdge(e1.id); this._deleteEdge(e2.id);
            this.nodes.delete(id); this._touch('nodes', id);
            this._newEdge(a, b, e1.type, pts, { oneWay: e1.oneWay });
            return true;
          }
        }
      }
      for (const eid of [...n.edges]) { const e = this.edges.get(eid); this._deleteEdge(eid); if (e) { const other = e.a === id ? e.b : e.a; this._deleteNodeIfEmpty(other); } }
      this.nodes.delete(id); this._touch('nodes', id);
      return true;
    } finally { this.endBatch(); }
  }

  clear() {
    this.beginBatch();
    for (const id of [...this.edges.keys()]) this._deleteEdge(id);
    for (const id of [...this.nodes.keys()]) { this.nodes.delete(id); this._touch('nodes', id); }
    this.endBatch();
  }

  // ---------- routing ----------
  route(fromId, toId) {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return null;
    if (fromId === toId) return [fromId];
    const goal = this.nodes.get(toId).pos;
    const h = (id) => { const p = this.nodes.get(id).pos; return Math.hypot(p.x - goal.x, p.z - goal.z); };
    const g = new Map([[fromId, 0]]), came = new Map();
    const open = [{ id: fromId, f: h(fromId) }];
    const closed = new Set();
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur.id === toId) { const path = [toId]; let c = toId; while (came.has(c)) { c = came.get(c); path.push(c); } return path.reverse(); }
      if (closed.has(cur.id)) continue; closed.add(cur.id);
      const n = this.nodes.get(cur.id);
      for (const eid of n.edges) {
        const e = this.edges.get(eid); if (!e) continue;
        if (e.oneWay && e.a !== cur.id) continue;
        const nb = e.a === cur.id ? e.b : e.a;
        const ng = g.get(cur.id) + e.length / (e.speed || 12);
        if (ng < (g.get(nb) ?? Infinity)) { g.set(nb, ng); came.set(nb, cur.id); open.push({ id: nb, f: ng + h(nb) / 28 }); }
      }
    }
    return null;
  }
  routeXZ(ax, az, bx, bz) {
    const ha = this.roads.nearest(ax, az, 200), hb = this.roads.nearest(bx, bz, 200);
    if (!ha || !hb) return null;
    let best = null;
    for (const s of [ha.edge.a, ha.edge.b]) for (const t of [hb.edge.a, hb.edge.b]) {
      const r = this.route(s, t); if (!r) continue;
      let len = 0; for (let i = 1; i < r.length; i++) { const p = this.nodes.get(r[i - 1]).pos, q = this.nodes.get(r[i]).pos; len += Math.hypot(p.x - q.x, p.z - q.z); }
      len += Math.hypot(this.nodes.get(s).pos.x - ax, this.nodes.get(s).pos.z - az) + Math.hypot(this.nodes.get(t).pos.x - bx, this.nodes.get(t).pos.z - bz);
      if (!best || len < best.len) best = { len, r };
    }
    return best ? best.r : null;
  }
}
