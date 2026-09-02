// Geometry builders: path sampling with mitred joins, profile extrusion, polygon fill.
import * as THREE from 'three';

export class GeoBuilder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  get empty() { return this.idx.length === 0; }
  vertex(x, y, z, nx, ny, nz, u, v, r = 1, g = 1, b = 1) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, v); this.col.push(r, g, b);
    return this.n++;
  }
  /** Triangle whose winding is fixed to agree with vertex a's normal. */
  tri(a, b, c) {
    const P = this.pos, N = this.nrm;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az;
    const e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    const d = cx * N[a * 3] + cy * N[a * 3 + 1] + cz * N[a * 3 + 2];
    if (d >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  build() {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/** Arc-length parametrised polyline with mitred normals. right(d) = (-dz, dx) = world right-hand side of travel. */
export class PathSampler {
  constructor(points) {
    this.pts = points;
    const n = points.length;
    this.cum = new Float64Array(n);
    this.dx = new Float64Array(Math.max(1, n - 1)); this.dz = new Float64Array(Math.max(1, n - 1));
    for (let i = 1; i < n; i++) {
      let dx = points[i].x - points[i - 1].x, dz = points[i].z - points[i - 1].z;
      const l = Math.hypot(dx, dz) || 1e-6;
      this.cum[i] = this.cum[i - 1] + l; this.dx[i - 1] = dx / l; this.dz[i - 1] = dz / l;
    }
    this.length = this.cum[n - 1];
    // mitred right-normals at vertices (scaled so offsets stay parallel)
    this.nx = new Float64Array(n); this.nz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s0 = Math.max(0, i - 1), s1 = Math.min(n - 2, i);
      let nx = -this.dz[s0] - this.dz[s1], nz = this.dx[s0] + this.dx[s1];
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const cosHalf = Math.max(0.45, nx * -this.dz[s1] + nz * this.dx[s1]);
      this.nx[i] = nx / cosHalf; this.nz[i] = nz / cosHalf;
    }
  }
  segAt(s) {
    const c = this.cum; let i = 1;
    if (s >= this.length) return c.length - 2;
    while (i < c.length - 1 && c[i] < s) i++;
    return i - 1;
  }
  /** Sample at arc length s → { x,y,z, dx,dz, nx,nz }. At interior vertices the normal is the mitre. */
  at(s, out = {}) {
    const i = this.segAt(Math.max(0, Math.min(this.length, s)));
    const l = this.cum[i + 1] - this.cum[i] || 1; const t = Math.max(0, Math.min(1, (s - this.cum[i]) / l));
    const p0 = this.pts[i], p1 = this.pts[i + 1];
    out.x = p0.x + (p1.x - p0.x) * t; out.y = p0.y + (p1.y - p0.y) * t; out.z = p0.z + (p1.z - p0.z) * t;
    out.dx = this.dx[i]; out.dz = this.dz[i];
    if (t < 1e-4 && i > 0) { out.nx = this.nx[i]; out.nz = this.nz[i]; }
    else if (t > 1 - 1e-4 && i < this.pts.length - 2) { out.nx = this.nx[i + 1]; out.nz = this.nz[i + 1]; }
    else { out.nx = -this.dz[i]; out.nz = this.dx[i]; }
    out.s = s;
    return out;
  }
  /** Samples from s0 to s1 including interior vertices; optional normal overrides at the ends ({nx,nz}). */
  samples(s0, s1, n0 = null, n1 = null) {
    s0 = Math.max(0, s0); s1 = Math.min(this.length, s1);
    if (s1 - s0 < 0.01) return [];
    const out = [this.at(s0, {})];
    if (n0) { out[0].nx = n0.nx; out[0].nz = n0.nz; }
    for (let i = 1; i < this.pts.length - 1; i++) if (this.cum[i] > s0 + 0.05 && this.cum[i] < s1 - 0.05) out.push(this.at(this.cum[i], {}));
    const last = this.at(s1, {}); if (n1) { last.nx = n1.nx; last.nz = n1.nz; }
    out.push(last);
    return out;
  }
  offsetPoint(s, o, out = new THREE.Vector3()) { const q = this.at(s, {}); return out.set(q.x + q.nx * o, q.y, q.z + q.nz * o); }
}

/**
 * Extrude a profile along samples. profile: [{o0,y0,o1,y1, v0,v1}] segments (o = across offset, y = height above sample.y).
 * colorFn(sample, o) → [r,g,b]. uScale: metres per texture repeat along the path. sideSign mirrors offsets.
 */
export function extrude(gb, samples, profile, { uScale = 4, colorFn = null, sideSign = 1, vScale = null, uOffset = 0 } = {}) {
  if (samples.length < 2) return;
  const rows = [];
  for (const sm of samples) {
    const row = [];
    for (const seg of profile) {
      // profile is traversed left→right (increasing o): perpendicular (-dy, do) faces up/outward; mirror with sideSign
      const dO = seg.o1 - seg.o0, dY = seg.y1 - seg.y0;
      let nx = -dY * sideSign, ny = dO;
      const ln = Math.hypot(nx, ny) || 1; nx /= ln; ny /= ln;
      const wnx = sm.nx * nx, wnz = sm.nz * nx;
      const nl = Math.hypot(wnx, ny, wnz) || 1;
      const idx = [];
      for (const [o, y, vv] of [[seg.o0 * sideSign, seg.y0, seg.v0 ?? 0], [seg.o1 * sideSign, seg.y1, seg.v1 ?? 1]]) {
        const px = sm.x + sm.nx * o, py = sm.y + y, pz = sm.z + sm.nz * o;
        const c = colorFn ? colorFn(sm, o, px, pz) : [1, 1, 1];
        const v = vScale ? (o / vScale) : vv;
        idx.push(gb.vertex(px, py, pz, wnx / nl, ny / nl, wnz / nl, (sm.s + uOffset) / uScale, v, c[0], c[1], c[2]));
      }
      row.push(idx);
    }
    rows.push(row);
  }
  for (let i = 1; i < rows.length; i++) for (let k = 0; k < profile.length; k++) {
    const [a0, a1] = rows[i - 1][k], [b0, b1] = rows[i][k];
    gb.quad(a0, b0, b1, a1);
  }
}

/** Fill a (simple) polygon of Vector3 with up-facing triangles. uv from world xz / uvScale. */
export function fillPolygon(gb, poly, { uvScale = 6, colorFn = null, lift = 0 } = {}) {
  const pts = [];
  for (const p of poly) { const l = pts[pts.length - 1]; if (!l || Math.hypot(l.x - p.x, l.z - p.z) > 0.02) pts.push(p); }
  if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) < 0.02) pts.pop();
  if (pts.length < 3) return;
  const contour = pts.map((p) => new THREE.Vector2(p.x, p.z));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { return; }
  const base = pts.map((p) => { const c = colorFn ? colorFn(p.x, p.z) : [1, 1, 1]; return gb.vertex(p.x, p.y + lift, p.z, 0, 1, 0, p.x / uvScale, p.z / uvScale, c[0], c[1], c[2]); });
  for (const t of tris) gb.tri(base[t[0]], base[t[1]], base[t[2]]);
}

/** Axis-aligned-in-lane quad: local frame (origin, dir d, right n); corners in (along, across) metres. */
export function localQuad(gb, ox, oy, oz, dx, dz, nx, nz, a0, c0, a1, c1, color, uvScale = 2) {
  const P = (a, c) => [ox + dx * a + nx * c, oy, oz + dz * a + nz * c];
  const v = [P(a0, c0), P(a1, c0), P(a1, c1), P(a0, c1)].map((p, i) => gb.vertex(p[0], p[1], p[2], 0, 1, 0, (i < 2 ? a0 : a1) / uvScale, (i === 0 || i === 3 ? c0 : c1) / uvScale, color[0], color[1], color[2]));
  gb.quad(v[0], v[1], v[2], v[3]);
}

/** Polygon given in local (along, across) coordinates placed in a lane frame. */
export function localPolygon(gb, ox, oy, oz, dx, dz, nx, nz, shape, color, uvScale = 2) {
  const contour = shape.map(([a, c]) => new THREE.Vector2(a, c));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const base = shape.map(([a, c]) => gb.vertex(ox + dx * a + nx * c, oy, oz + dz * a + nz * c, 0, 1, 0, a / uvScale, c / uvScale, color[0], color[1], color[2]));
  for (const t of tris) gb.tri(base[t[0]], base[t[1]], base[t[2]]);
}

// Marking shapes in lane-local (along, across) metres; "along" points toward the intersection.
export const ARROW_STRAIGHT = [[0, -0.18], [2.6, -0.18], [2.6, -0.65], [4.0, 0], [2.6, 0.65], [2.6, 0.18], [0, 0.18]];
// left turn: shaft, then a bar to the left (negative across) ending in a head pointing left
export const ARROW_LEFT = [[0, -0.18], [2.2, -0.18], [2.2, -0.7], [1.85, -0.7], [2.45, -1.45], [3.05, -0.7], [2.7, -0.7], [2.7, 0.18], [0, 0.18]];
