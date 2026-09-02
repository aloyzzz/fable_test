// Heightfield generation for the terrain module. Deterministic: every random offset comes from the
// terrain Rng fork; the noise itself is ProcTex's fixed-permutation Perlin (offsets make it seed dependent).
import { fbm, ridged, smoothstep, clamp01 } from '../../core/ProcTex.js';

const MAP = 4096, HALF = 2048;

/** Catmull-Rom spline through control points, resampled every `step` metres. Returns [{x,z,t}] with t ∈ [0,1]. */
function sampleSpline(ctrl, step) {
  const pts = [];
  const P = (i) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  const segs = ctrl.length - 1;
  for (let s = 0; s < segs; s++) {
    const p0 = P(s - 1), p1 = P(s), p2 = P(s + 1), p3 = P(s + 2);
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const z = 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
      pts.push({ x, z, t: (s + t) / segs });
    }
  }
  pts.push({ x: ctrl[ctrl.length - 1].x, z: ctrl[ctrl.length - 1].z, t: 1 });
  return pts;
}

/**
 * Fill `heights` (res×res, index = z*res + x, x/z from -2048..2048) with the map design:
 * low buildable plain around the origin, rolling hills outward, ridged mountains toward the W/N/S edges,
 * a meandering river (80–140 m) crossing W→E with a lake at the foot of the western mountains, and a bluff
 * (cliff) on the far bank NW of the origin. Water level is 0; the origin sits dry at ~4–6 m.
 */
export function generateHeightfield(heights, res, rng, waterLevel = 0) {
  const off = []; for (let i = 0; i < 12; i++) off.push(rng.range(-5000, 5000));
  const step = MAP / (res - 1);

  // --- river centreline (control points hand-designed, jittered by the seed) ---
  const j = (a) => rng.range(-a, a);
  const ctrl = [
    { x: -2300, z: 340 + j(40) }, { x: -1850, z: 240 + j(40) }, { x: -1500, z: -20 + j(40) }, { x: -1250, z: -280 + j(30) },
    { x: -900, z: -330 + j(30) }, { x: -620, z: -290 + j(30) }, { x: -430, z: -440 + j(20) }, { x: -260, z: -640 + j(20) },
    { x: -40, z: -760 + j(30) }, { x: 260, z: -800 + j(40) }, { x: 620, z: -720 + j(40) }, { x: 980, z: -830 + j(40) },
    { x: 1350, z: -700 + j(40) }, { x: 1750, z: -790 + j(40) }, { x: 2300, z: -720 + j(40) },
  ];
  const river = sampleSpline(ctrl, 20);
  const nR = river.length;
  const rx = new Float32Array(nR), rz = new Float32Array(nR), rt = new Float32Array(nR);
  for (let i = 0; i < nR; i++) { rx[i] = river[i].x; rz[i] = river[i].z; rt[i] = river[i].t; }
  // river width along t: 80..140 m, smooth
  const widthAt = (t) => 80 + 60 * fbm(t * 4.0 + off[0] * 0.001, off[1] * 0.001, 3);

  // --- lake (ellipse, noise-warped) at the foot of the western mountains, threaded by the river ---
  const lake = { cx: -1120 + j(40), cz: -300 + j(30), rx: 330, rz: 215, rot: -0.35 };
  const lakeSdf = (x, z) => {
    const dx = x - lake.cx, dz = z - lake.cz, c = Math.cos(lake.rot), s = Math.sin(lake.rot);
    const ex = (dx * c - dz * s) / lake.rx, ez = (dx * s + dz * c) / lake.rz;
    const r = Math.sqrt(ex * ex + ez * ez);
    const warp = (fbm(x / 260 + off[2], z / 260 + off[3], 3) - 0.5) * 0.45;
    return (r - 1 + warp) * Math.min(lake.rx, lake.rz); // metres-ish, negative inside
  };

  let minH = Infinity, maxH = -Infinity;
  for (let iz = 0; iz < res; iz++) {
    const z = -HALF + iz * step;
    for (let ix = 0; ix < res; ix++) {
      const x = -HALF + ix * step;
      const r = Math.hypot(x, z);
      const edge = Math.max(Math.abs(x), Math.abs(z));

      // 1. core plain + rolling hills (4..40 m), gentle slopes
      const rollA = fbm(x / 720 + off[4], z / 720 + off[5], 4, 2, 0.5);
      const rollB = fbm(x / 210 + off[6], z / 210 + off[7], 3, 2, 0.5);
      const rise = smoothstep(380, 1150, r);
      let h = 3.6 + 2.2 * rollB + rise * (10 + 26 * rollA + 4 * rollB);

      // 2. foothills + mountains toward the edges (W, N, S; the east stays open as a valley for the river)
      const wob = (fbm(x / 900 + off[8], z / 900 + off[9], 3) - 0.5) * 420;
      const eastOpen = smoothstep(900, 1900, x) * (1 - smoothstep(300, 1000, Math.abs(z + 700))); // river valley exit
      const foot = smoothstep(950, 1450, edge + wob * 0.5);
      const mount = smoothstep(1250, 1900, edge + wob) * (1 - 0.85 * eastOpen);
      const rg = ridged(x / 760 + off[10], z / 760 + off[11], 5);
      const mh = 40 * foot * fbm(x / 330 + off[2], z / 330 + off[3], 4) + mount * (45 + 168 * rg);
      h += mh;
      const mount01 = clamp01(mh / 120);

      // 3. river: distance to centreline (brute force, nR ~ 300)
      // coarse pass every 6th point, then refine locally (the centreline is smooth, 20 m sampled)
      let best = 1e9, bi = 0;
      for (let i = 0; i < nR; i += 6) { const dx = rx[i] - x, dz = rz[i] - z; const d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
      const lo = Math.max(0, bi - 7), hi = Math.min(nR - 1, bi + 7);
      for (let i = lo; i <= hi; i++) { const dx = rx[i] - x, dz = rz[i] - z; const d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
      const d = Math.sqrt(best);
      const t = rt[bi];
      const w = widthAt(t), hw = w * 0.5;
      // side of the river (sign of cross product with local tangent)
      const i1 = Math.min(nR - 1, bi + 1), i0 = Math.max(0, bi - 1);
      const tx = rx[i1] - rx[i0], tz = rz[i1] - rz[i0];
      const side = Math.sign(tx * (z - rz[bi]) - tz * (x - rx[bi])) || 1;

      // flood plain: pull the terrain to ~4 m near the river (wider where it cuts through mountains)
      const plainH = 3.4 + 2.0 * rollB + 1.2 * fbm(x / 60 + off[0], z / 60 + off[1], 2);
      const valleyW = 200 + 320 * mount01;
      const valley = 1 - smoothstep(hw + 15, hw + valleyW, d);
      h = h * (1 - valley) + plainH * valley;

      // bluff on the far (NW) bank between t ≈ 0.31..0.44: cliff rising to ~30 m
      const tB = smoothstep(0.30, 0.335, t) * (1 - smoothstep(0.42, 0.455, t));
      if (tB > 0 && side < 0) {
        const bluffTop = 26 + 9 * fbm(x / 140 + off[4], z / 140 + off[5], 3) + 6 * tB;
        const cliff = smoothstep(hw + 6, hw + 34 + 18 * fbm(x / 45 + off[6], z / 45 + off[7], 2), d);
        const back = 1 - smoothstep(hw + 150, hw + 420, d);
        const bluffH = plainH + (bluffTop - plainH) * cliff;
        const m = tB * back;
        const target = Math.max(h, bluffH);
        h = h * (1 - m) + target * m;
      }

      // channel: elliptic bed, ~9 m deep at the centre, with a gentle beach outside the water line
      if (d < hw + 40) {
        let rh;
        if (d < hw) { const q = d / hw; rh = waterLevel + 1.0 - 10.5 * Math.sqrt(Math.max(0, 1 - q * q)); }
        else rh = waterLevel + 1.0 + ((d - hw) / 40) * 2.8;
        h = Math.min(h, rh);
      }

      // 4. lake
      const ld = lakeSdf(x, z);
      if (ld < 220) {
        const shore = 1 - smoothstep(40, 220, ld);
        h = h * (1 - shore) + plainH * shore;
        let lh;
        if (ld < 0) lh = waterLevel + 1.0 - 14 * smoothstep(0, 140, -ld);
        else lh = waterLevel + 1.0 + (ld / 40) * 2.8;
        h = Math.min(h, lh);
      }

      // 5. origin protection: dry, nearly flat, buildable
      const core = 1 - smoothstep(300, 560, r);
      const flatH = 4.2 + 1.6 * rollB;
      h = h * (1 - core) + flatH * core;

      if (h < -30) h = -30;
      heights[iz * res + ix] = h;
      if (h < minH) minH = h; if (h > maxH) maxH = h;
    }
  }
  return { minH, maxH, river, lake };
}
