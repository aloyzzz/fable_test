// Turns the road graph into geometry: per-edge ribbons (asphalt, curbs, sidewalks, markings, medians)
// and per-node intersection polygons with filleted corners, crosswalks, stop lines and cul-de-sac bulbs.
import * as THREE from 'three';
import { GeoBuilder, PathSampler, extrude, fillPolygon, localQuad, localPolygon, ARROW_STRAIGHT, ARROW_LEFT } from './geom.js';
import { layoutOf, laneOffsets, markingsFor, CURB_W, CURB_H } from './layout.js';
import { macroAt, TILE } from './materials.js';
import { Rng } from '../../core/Rng.js';

const TAU = Math.PI * 2;
const PAINT_LIFT = 0.015;
const FILLET_R = 6;
const FLAT_ANGLE = Math.sin(THREE.MathUtils.degToRad(17));  // |sin φ| below this → borders treated as parallel
const PASS_COS = Math.cos(THREE.MathUtils.degToRad(165));   // dot below this → straight-through node
export const CATEGORIES = ['asphalt', 'curb', 'paving', 'paint', 'grass'];

const WHITE = [1, 1, 1], YELLOW = [1, 0.78, 0.16];
const right = (dx, dz) => ({ nx: -dz, nz: dx });
const hash = (a, b, c = 0) => Rng.hash2(Math.round(a * 7), Math.round(b * 13), c);

export class RoadBuilder {
  constructor(graph) {
    this.graph = graph;
    this.samplers = new Map();
    this.nodeInfo = new Map();
    this.edgeGeo = new Map();
    this.nodeGeo = new Map();
  }
  sampler(e) { let s = this.samplers.get(e.id); if (!s || s.pts !== e.points) { s = new PathSampler(e.points); this.samplers.set(e.id, s); } return s; }
  drop(edgeIds, nodeIds) {
    for (const id of edgeIds) { this.samplers.delete(id); this.disposeSet(this.edgeGeo.get(id)); this.edgeGeo.delete(id); }
    for (const id of nodeIds) { this.disposeSet(this.nodeGeo.get(id)); this.nodeGeo.delete(id); this.nodeInfo.delete(id); }
  }
  disposeSet(set) { if (!set) return; for (const k in set) set[k]?.dispose?.(); }

  // ---------- node analysis ----------
  edgeEnd(e, nodeId) {
    const atA = e.a === nodeId;
    const sp = this.sampler(e);
    const sm = atA ? sp.at(0, {}) : sp.at(sp.length, {});
    const dx = atA ? sm.dx : -sm.dx, dz = atA ? sm.dz : -sm.dz;
    const L = layoutOf(e.type);
    const sideSign = atA ? 1 : -1;
    return {
      e, atA, sp, dx, dz, theta: Math.atan2(dz, dx), A: L.asphalt, sw: L.sidewalk, L, sideSign,
      sAt: (u) => (atA ? u : sp.length - u),
      border: (u, side) => sp.offsetPoint(atA ? u : sp.length - u, sideSign * side * L.asphalt),
    };
  }
  /** Border polyline of an edge end on `side` (+1 = right of outgoing dir) from distance u0 to u1 from the node. */
  borderPath(end, side, u0, u1) {
    const o = end.sideSign * side * end.A;
    const sA = end.sAt(u0), sB = end.sAt(u1);
    const sm = end.sp.samples(Math.min(sA, sB), Math.max(sA, sB));
    const pts = sm.map((q) => new THREE.Vector3(q.x + q.nx * o, q.y, q.z + q.nz * o));
    if (sA > sB) pts.reverse();
    if (pts.length === 0) pts.push(end.border(u0, side), end.border(u1, side));
    return pts;
  }

  computeNode(node) {
    const ends = node.edges.map((id) => this.graph.edges.get(id)).filter(Boolean).map((e) => this.edgeEnd(e, node.id));
    ends.sort((p, q) => p.theta - q.theta);
    const k = ends.length;
    const info = { id: node.id, kind: 'none', ends, trims: new Map(), normals: new Map(), polygon: null, corners: [], junction: k >= 3, degree: k };
    if (k === 0) return info;
    const ny = node.pos.y;

    if (k === 1) {
      const E = ends[0];
      const R = E.L.bulb;
      info.kind = 'deadend';
      if (R > E.A + 1 && E.e.length > R * 2) {
        const trim = Math.sqrt(R * R - E.A * E.A);
        info.trims.set(E.e.id, trim);
        const EP = E.border(trim, 1), EM = E.border(trim, -1);
        const a0 = Math.atan2(EP.z - node.pos.z, EP.x - node.pos.x), a1raw = Math.atan2(EM.z - node.pos.z, EM.x - node.pos.x);
        let a1 = a1raw; while (a1 <= a0) a1 += TAU;
        const n = Math.max(8, Math.ceil((a1 - a0) * R / 1.5));
        const arc = [EP];
        for (let i = 1; i < n; i++) { const a = a0 + (a1 - a0) * i / n; arc.push(new THREE.Vector3(node.pos.x + Math.cos(a) * R, ny, node.pos.z + Math.sin(a) * R)); }
        arc.push(EM);
        info.polygon = [EM, EP, ...arc.slice(1, -1)];
        if (E.sw > 0) info.corners.push({ path: arc, sw: E.sw, flat: false });
      } else info.trims.set(E.e.id, 0);
      return info;
    }

    if (k === 2) {
      const [E0, E1] = ends;
      const dot = E0.dx * E1.dx + E0.dz * E1.dz;
      if (dot < PASS_COS && E0.e.type === E1.e.type && E0.e.oneWay === E1.e.oneWay) {
        info.kind = 'pass';
        for (const [E, O] of [[E0, E1], [E1, E0]]) {
          const tx = E.atA ? E.dx : -E.dx, tz = E.atA ? E.dz : -E.dz;          // travel direction a→b at the node
          let ox = O.dx, oz = O.dz; if (ox * tx + oz * tz < 0) { ox = -ox; oz = -oz; }
          const r1 = right(tx, tz), r2 = right(ox, oz);
          let mx = r1.nx + r2.nx, mz = r1.nz + r2.nz; const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
          const c = Math.max(0.45, mx * r1.nx + mz * r1.nz);
          info.normals.set(E.e.id, { nx: mx / c, nz: mz / c });
          info.trims.set(E.e.id, 0);
        }
        return info;
      }
    }

    info.kind = 'junction';
    // pairs of angularly adjacent edges
    const pairs = [];
    const want = new Map(ends.map((E) => [E.e.id, k >= 3 ? 2 : 1.5]));
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k, Ei = ends[i], Ej = ends[j];
      let phi = Ej.theta - Ei.theta; while (phi <= 1e-6) phi += TAU;
      const pair = { i, j, phi, flat: true, sI: 0, sJ: 0, arc: null };
      pairs.push(pair);
      const s = Math.sin(phi);
      if (Math.abs(s) < FLAT_ANGLE || k === 1) continue;
      // corner: intersection of Ei's right border with Ej's left border (relative to node)
      const ni = right(Ei.dx, Ei.dz), nj = right(Ej.dx, Ej.dz);
      const Rx = -nj.nx * Ej.A - ni.nx * Ei.A, Rz = -nj.nz * Ej.A - ni.nz * Ei.A;
      const det = -(Ei.dx * Ej.dz - Ei.dz * Ej.dx);
      if (Math.abs(det) < 1e-6) continue;
      const ti = (Rx * -Ej.dz - Rz * -Ej.dx) / det;
      const tj = (Ei.dx * Rz - Ei.dz * Rx) / det;
      const Cx = ni.nx * Ei.A + Ei.dx * ti, Cz = ni.nz * Ei.A + Ei.dz * ti;
      const psi = Math.min(phi, TAU - phi);
      let r = FILLET_R * Math.min(1.6, Math.max(0.7, Math.min(Ei.A, Ej.A) / 5));
      if (psi < THREE.MathUtils.degToRad(70)) r *= Math.max(0.35, psi / THREE.MathUtils.degToRad(70));
      const f = r / Math.tan(psi / 2);
      pair.flat = false; pair.sI = ti + f; pair.sJ = tj + f; pair.r = r;
      // arc from T_i to T_j around the fillet centre
      let bx = Ei.dx + Ej.dx, bz = Ei.dz + Ej.dz; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
      const cd = r / Math.sin(psi / 2);
      const cx = Cx + bx * cd, cz = Cz + bz * cd;
      const Tix = Cx + Ei.dx * f, Tiz = Cz + Ei.dz * f, Tjx = Cx + Ej.dx * f, Tjz = Cz + Ej.dz * f;
      const a0 = Math.atan2(Tiz - cz, Tix - cx); let da = Math.atan2(Tjz - cz, Tjx - cx) - a0;
      while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      const n = Math.max(3, Math.ceil(Math.abs(da) * r / 1.0));
      pair.arc = [];
      for (let q = 0; q <= n; q++) { const a = a0 + da * q / n; pair.arc.push(new THREE.Vector3(node.pos.x + cx + Math.cos(a) * r, ny, node.pos.z + cz + Math.sin(a) * r)); }
      want.set(Ei.e.id, Math.max(want.get(Ei.e.id), pair.sI, ti + 0.5));
      want.set(Ej.e.id, Math.max(want.get(Ej.e.id), pair.sJ, tj + 0.5));
    }
    for (const E of ends) info.trims.set(E.e.id, Math.min(want.get(E.e.id), E.e.length * 0.45));

    // polygon + corner paths
    const poly = [];
    for (let i = 0; i < k; i++) {
      const pair = pairs[i], Ei = ends[i], Ej = ends[pair.j];
      const trimI = info.trims.get(Ei.e.id), trimJ = info.trims.get(Ej.e.id);
      const EM = Ei.border(trimI, -1), EP = Ei.border(trimI, 1);
      poly.push(EM, EP);
      const swC = Math.min(Ei.sw, Ej.sw);
      if (pair.flat) {
        const EMj = Ej.border(trimJ, -1);
        if (swC > 0 && k > 1) info.corners.push({ path: [EP, EMj], sw: swC, flat: true });
        continue;
      }
      const sI = Math.min(pair.sI, trimI), sJ = Math.min(pair.sJ, trimJ);
      const pb = this.borderPath(Ei, 1, trimI, sI);
      const mb = this.borderPath(Ej, -1, sJ, trimJ);
      const arc = pair.arc.slice(); arc[0] = pb[pb.length - 1]; arc[arc.length - 1] = mb[0];
      const cornerPath = [...pb, ...arc.slice(1, -1), ...mb];
      poly.push(...pb.slice(1), ...arc.slice(1, -1), ...mb.slice(0, -1));
      if (swC > 0) info.corners.push({ path: cornerPath, sw: swC, flat: false });
    }
    info.polygon = poly;
    return info;
  }

  // ---------- profiles ----------
  curbProfile(A) {
    return [{ o0: A, y0: 0, o1: A, y1: CURB_H, v0: 0, v1: 0.35 }, { o0: A, y0: CURB_H, o1: A + CURB_W, y1: CURB_H, v0: 0.35, v1: 1 }];
  }
  backProfile(A, sw) { return [{ o0: A + sw, y0: CURB_H, o1: A + sw + 0.3, y1: -0.05, v0: 1, v1: 0.15 }]; }
  pavingProfile(A, sw) { return [{ o0: A + CURB_W, y0: CURB_H, o1: A + sw, y1: CURB_H }]; }

  pavingColor(kerbO) {
    // kerbO(o) → distance from the kerb (0 at kerb edge)
    return (sm, o, px, pz) => { const d = kerbO(o); const wear = 1 - 0.14 * (1 - Math.min(1, d / 1.2)); const m = macroAt(px * 0.7, pz * 0.7); return [wear * m, wear * m, wear * m * 0.99]; };
  }

  // ---------- edge geometry ----------
  buildEdge(e) {
    const sp = this.sampler(e), L = layoutOf(e.type);
    const ia = this.nodeInfo.get(e.a), ib = this.nodeInfo.get(e.b);
    const trimA = ia?.trims.get(e.id) || 0, trimB = ib?.trims.get(e.id) || 0;
    const nA = ia?.normals.get(e.id) || null, nB = ib?.normals.get(e.id) || null;
    const s0 = trimA, s1 = sp.length - trimB;
    const G = { asphalt: new GeoBuilder(), curb: new GeoBuilder(), paving: new GeoBuilder(), paint: new GeoBuilder(), grass: new GeoBuilder() };
    if (s1 - s0 < 0.3) return this.finish(G);
    const samples = sp.samples(s0, s1, nA, nB);
    const lanes = laneOffsets(e.type, e.oneWay);
    const junA = !!ia?.junction, junB = !!ib?.junction;
    const A = L.asphalt;

    // --- asphalt ribbon with lane-aware cross vertices (for wear bands via vertex colour)
    const xs = new Set([-A, A]);
    for (const l of lanes) for (const d of [-1.25, -0.85, 0, 0.85, 1.25]) { const o = l.offset + d; if (Math.abs(o) < A - 0.2) xs.add(+o.toFixed(3)); }
    const cross = [...xs].sort((p, q) => p - q);
    const prof = []; for (let i = 1; i < cross.length; i++) prof.push({ o0: cross[i - 1], y0: 0, o1: cross[i], y1: 0 });
    const laneEdge = Math.max(...lanes.map((l) => Math.abs(l.offset))) + L.laneW / 2;
    const asphaltColor = (sm, o, px, pz) => {
      let f = macroAt(px, pz);
      let wear = 0;
      for (const l of lanes) { const d = Math.abs(Math.abs(o - l.offset) - 0.85); wear = Math.max(wear, Math.exp(-(d * d) / (0.22))); }
      f *= 1 + 0.11 * wear;
      if (Math.abs(o) > laneEdge + 0.2) f *= 0.94;
      const dA = sm.s - s0, dB = s1 - sm.s;
      let dark = 0;
      if (junA) dark = Math.max(dark, 1 - Math.min(1, dA / 18));
      if (junB) dark = Math.max(dark, 1 - Math.min(1, dB / 18));
      f *= 1 - 0.17 * dark * dark;
      return [f, f, f * 0.985];
    };
    extrude(G.asphalt, samples, prof, { uScale: TILE.asphalt, vScale: TILE.asphalt, colorFn: asphaltColor });

    // --- curbs + sidewalks
    if (L.sidewalk > 0) {
      for (const side of [1, -1]) {
        extrude(G.curb, samples, this.curbProfile(A), { uScale: TILE.curb, sideSign: side, colorFn: (sm, o, px, pz) => { const m = macroAt(px, pz); return [m, m, m]; } });
        extrude(G.curb, samples, this.backProfile(A, L.sidewalk), { uScale: TILE.curb, sideSign: side });
        extrude(G.paving, samples, this.pavingProfile(A, L.sidewalk), { uScale: TILE.paving, vScale: TILE.paving, sideSign: side, colorFn: this.pavingColor((o) => Math.abs(o) - A - CURB_W) });
      }
    } else {
      // highway: gravel shoulder slope down to the ground
      extrude(G.curb, samples, [{ o0: A, y0: 0, o1: A + 1.2, y1: -0.05, v0: 0.3, v1: 0.1 }], { uScale: TILE.curb, sideSign: 1, colorFn: () => [0.55, 0.52, 0.48] });
      extrude(G.curb, samples, [{ o0: A, y0: 0, o1: A + 1.2, y1: -0.05, v0: 0.3, v1: 0.1 }], { uScale: TILE.curb, sideSign: -1, colorFn: () => [0.55, 0.52, 0.48] });
    }

    // --- markings
    const paintColor = (c, fade) => [c[0] * fade, c[1] * fade, c[2] * fade];
    const gapA = junA && L.crosswalk ? 4.4 : 0, gapB = junB && L.crosswalk ? 4.4 : 0;
    for (const m of markingsFor(e.type, e.oneWay)) {
      const col = m.color === 'yellow' ? YELLOW : WHITE;
      const isEdgeLine = Math.abs(m.offset) > laneEdge - 0.3;
      const from = s0 + (isEdgeLine ? 0 : gapA), to = s1 - (isEdgeLine ? 0 : gapB);
      const profM = [{ o0: m.offset - m.w / 2, y0: PAINT_LIFT, o1: m.offset + m.w / 2, y1: PAINT_LIFT }];
      if (m.kind === 'solid') {
        const fade = 0.8 + 0.2 * hash(e.id, m.offset);
        if (to - from > 0.5) extrude(G.paint, sp.samples(from, to, from === s0 ? nA : null, to === s1 ? nB : null), profM, { uScale: TILE.paint, vScale: TILE.paint, colorFn: () => paintColor(col, fade) });
      } else {
        const dash = 3, gap = 4.5;
        for (let sd = from + 1; sd + dash <= to; sd += dash + gap) {
          const fade = 0.7 + 0.3 * hash(e.id, sd, 3);
          extrude(G.paint, sp.samples(sd, sd + dash), profM, { uScale: TILE.paint, vScale: TILE.paint, colorFn: () => paintColor(col, fade) });
        }
      }
    }
    // crosswalks, stop lines, arrows at junction ends
    for (const end of [{ atA: true, info: ia, trim: trimA }, { atA: false, info: ib, trim: trimB }]) {
      if (!end.info?.junction || !L.crosswalk || s1 - s0 < 9) continue;
      const sAt = (u) => (end.atA ? s0 + u : s1 - u);            // u = distance from the ribbon end (trim line)
      const q = sp.at(sAt(1.75), {});
      let dx = q.dx, dz = q.dz; if (end.atA) { dx = -dx; dz = -dz; }    // toward the node
      const rn = right(dx, dz);
      const fadeC = 0.75 + 0.25 * hash(e.id, end.atA ? 1 : 2, 5);
      // zebra stripes: local (along, across) frame at the crosswalk centre, along = toward node
      for (let o = -A + 0.45; o + 0.55 <= A - 0.4; o += 1.0) {
        const fadeS = fadeC * (0.85 + 0.15 * hash(e.id, o, 7));
        localQuad(G.paint, q.x, q.y + PAINT_LIFT, q.z, dx, dz, rn.nx, rn.nz, -1.25, o, 1.25, o + 0.55, paintColor(WHITE, fadeS));
      }
      // stop line across the incoming lanes (looking toward the node, incoming traffic is on the right → local across > 0)
      const q2 = sp.at(sAt(3.7), {});
      const inFull = e.oneWay ? !end.atA : true;
      if (inFull) {
        const c0 = e.oneWay ? -A + 0.35 : 0.35, c1 = A - 0.35;
        localQuad(G.paint, q2.x, q2.y + PAINT_LIFT, q2.z, dx, dz, rn.nx, rn.nz, -0.22, c0, 0.22, c1, paintColor(WHITE, fadeC));
      }
      // arrows on incoming lanes
      if (L.arrows && s1 - s0 > 26 && inFull) {
        const incoming = lanes.filter((l) => e.oneWay ? true : (end.atA ? l.dir < 0 : l.dir > 0));
        // lane offsets are in the a→b frame; in the local frame "across" is right of `toward node` direction
        const perDir = incoming.length;
        incoming.forEach((l, idx) => {
          const across = end.atA ? -l.offset : l.offset;
          const q3 = sp.at(sAt(8.5), {});
          const inner = perDir > 1 && (end.atA ? l.offset === Math.max(...incoming.map((x) => x.offset)) : l.offset === Math.min(...incoming.map((x) => x.offset)));
          const shape = inner && !e.oneWay ? ARROW_LEFT : ARROW_STRAIGHT;
          const fadeA = 0.7 + 0.3 * hash(e.id, across, 11);
          localPolygon(G.paint, q3.x + rn.nx * across, q3.y + PAINT_LIFT, q3.z + rn.nz * across, dx, dz, rn.nx, rn.nz, shape, paintColor(WHITE, fadeA));
        });
      }
    }

    // --- median
    if (L.median > 0 && !e.oneWay) {
      const m = L.median;
      const m0 = (ia?.kind === 'pass' ? s0 : s0 + 5.2), m1 = (ib?.kind === 'pass' ? s1 : s1 - 5.2);
      if (m1 - m0 > m * 2 + 2) this.buildMedian(G, sp, m0, m1, m, L.medianKind, ia?.kind === 'pass', ib?.kind === 'pass');
    }
    return this.finish(G);
  }

  buildMedian(G, sp, m0, m1, m, kind, openA, openB) {
    const outline = [];
    const side = (o) => sp.samples(m0, m1).map((q) => new THREE.Vector3(q.x + q.nx * o, q.y, q.z + q.nz * o));
    const cap = (s, forward) => {
      const c = sp.at(s, {}); const pts = [];
      const n = 10;
      for (let i = 1; i < n; i++) { const a = (forward ? 0 : Math.PI) + Math.PI * i / n; pts.push(new THREE.Vector3(c.x + c.nx * m * Math.cos(a) + c.dx * m * Math.sin(a), c.y, c.z + c.nz * m * Math.cos(a) + c.dz * m * Math.sin(a))); }
      return pts;
    };
    const capOrFlat = (s, forward) => cap(s, forward);
    outline.push(...side(m), ...(openB ? [] : capOrFlat(m1, true)), ...side(-m).reverse(), ...(openA ? [] : capOrFlat(m0, false)));
    outline.push(outline[0].clone());
    const osp = new PathSampler(outline);
    const osm = osp.samples(0, osp.length);
    // kerb ring: path is the kerb face; +o = outward (right of travel)
    extrude(G.curb, osm, [{ o0: 0, y0: 0, o1: 0, y1: CURB_H, v0: 0, v1: 0.35 }, { o0: -0.3, y0: CURB_H, o1: 0, y1: CURB_H, v0: 1, v1: 0.35 }], { uScale: TILE.curb });
    // inner fill
    const inner = outline.map((p, i) => { const q = osp.at(osp.cum[i] ?? 0, {}); return new THREE.Vector3(p.x - q.nx * 0.3, p.y, p.z - q.nz * 0.3); });
    inner.pop();
    if (kind === 'grass') fillPolygon(G.grass, inner, { uvScale: TILE.grass, lift: CURB_H + 0.02, colorFn: (x, z) => { const mm = macroAt(x * 1.3, z * 1.3); return [mm, mm, mm]; } });
    else {
      fillPolygon(G.curb, inner, { uvScale: TILE.concrete, lift: CURB_H, colorFn: () => [0.92, 0.92, 0.92] });
      // jersey barrier
      const bs = sp.samples(m0 + m, m1 - m);
      const B = [{ o0: -0.42, y0: CURB_H, o1: -0.3, y1: 0.5, v0: 0.05, v1: 0.4 }, { o0: -0.3, y0: 0.5, o1: -0.17, y1: 0.95, v0: 0.4, v1: 0.8 }, { o0: -0.17, y0: 0.95, o1: 0.17, y1: 0.95, v0: 0.8, v1: 0.9 },
                 { o0: 0.17, y0: 0.95, o1: 0.3, y1: 0.5, v0: 0.8, v1: 0.4 }, { o0: 0.3, y0: 0.5, o1: 0.42, y1: CURB_H, v0: 0.4, v1: 0.05 }];
      extrude(G.curb, bs, B, { uScale: TILE.curb, colorFn: (sm, o, px, pz) => { const mm = 0.9 * macroAt(px, pz); return [mm, mm, mm]; } });
      // barrier end caps
      for (const [s, fwd] of [[m0 + m, -1], [m1 - m, 1]]) {
        const c = sp.at(s, {});
        const P = (o, y) => new THREE.Vector3(c.x + c.nx * o, c.y + y, c.z + c.nz * o);
        const cap = [P(-0.42, CURB_H), P(-0.3, 0.5), P(-0.17, 0.95), P(0.17, 0.95), P(0.3, 0.5), P(0.42, CURB_H)];
        const base = cap.map((p) => G.curb.vertex(p.x, p.y, p.z, c.dx * fwd, 0, c.dz * fwd, p.x / 2, p.y / 2, 0.9, 0.9, 0.9));
        for (let i = 1; i < base.length - 1; i++) G.curb.tri(base[0], base[i], base[i + 1]);
      }
    }
  }

  // ---------- node geometry ----------
  buildNode(node, info) {
    const G = { asphalt: new GeoBuilder(), curb: new GeoBuilder(), paving: new GeoBuilder(), paint: new GeoBuilder(), grass: new GeoBuilder() };
    if (!info.polygon) return this.finish(G);
    const junction = info.junction;
    fillPolygon(G.asphalt, info.polygon, { uvScale: TILE.asphalt, colorFn: (x, z) => { const f = macroAt(x, z) * (junction ? 0.86 : 0.95); return [f, f, f * 0.985]; } });
    for (const c of info.corners) {
      if (c.path.length < 2) continue;
      const psp = new PathSampler(c.path);
      if (psp.length < 0.2) continue;
      const sm = psp.samples(0, psp.length);
      extrude(G.curb, sm, this.curbProfile(0), { uScale: TILE.curb, sideSign: -1, colorFn: (s, o, px, pz) => { const m = macroAt(px, pz); return [m, m, m]; } });
      extrude(G.curb, sm, this.backProfile(0, c.sw), { uScale: TILE.curb, sideSign: -1 });
      extrude(G.paving, sm, this.pavingProfile(0, c.sw), { uScale: TILE.paving, vScale: TILE.paving, sideSign: -1, colorFn: this.pavingColor((o) => Math.abs(o) - CURB_W) });
    }
    return this.finish(G);
  }

  /** Circular kerbed grass island (roundabouts). */
  buildIsland(cx, cz, r, y) {
    const G = { asphalt: new GeoBuilder(), curb: new GeoBuilder(), paving: new GeoBuilder(), paint: new GeoBuilder(), grass: new GeoBuilder() };
    const n = Math.max(24, Math.ceil(TAU * r / 1.5));
    const ring = [];
    for (let i = 0; i <= n; i++) { const a = TAU * i / n; ring.push(new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)); }
    const psp = new PathSampler(ring);
    const sm = psp.samples(0, psp.length);
    // increasing angle → right side = inward; kerb face at o=0 faces outward (toward the road)
    extrude(G.curb, sm, [{ o0: 0, y0: 0, o1: 0, y1: CURB_H, v0: 0, v1: 0.35 }, { o0: 0, y0: CURB_H, o1: 0.35, y1: CURB_H, v0: 0.35, v1: 1 }], { uScale: TILE.curb });
    extrude(G.paving, sm, [{ o0: 0.35, y0: CURB_H, o1: 1.6, y1: CURB_H }], { uScale: TILE.paving, vScale: TILE.paving, colorFn: this.pavingColor((o) => o - 0.35) });
    extrude(G.curb, sm, [{ o0: 1.6, y0: CURB_H, o1: 1.6, y1: CURB_H + 0.12, v0: 0.4, v1: 0.6 }, { o0: 1.6, y0: CURB_H + 0.12, o1: 1.85, y1: CURB_H + 0.12, v0: 0.6, v1: 1 }], { uScale: TILE.curb });
    const inner = ring.slice(0, -1).map((p) => new THREE.Vector3(cx + (p.x - cx) * (r - 1.8) / r, y, cz + (p.z - cz) * (r - 1.8) / r));
    fillPolygon(G.grass, inner, { uvScale: TILE.grass, lift: CURB_H + 0.14, colorFn: (x, z) => { const mm = macroAt(x * 1.3, z * 1.3); return [mm, mm, mm]; } });
    return this.finish(G);
  }

  finish(G) { const out = {}; for (const k of CATEGORIES) out[k] = G[k].build(); return out; }
}
