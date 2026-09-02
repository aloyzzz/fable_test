// Procedural texture library. Everything generated here is CC0 by construction.
// Usage: const t = ctx.tex.get('asphalt', () => ctx.tex.make(1024, 1024, (px, x, y, u, v, n) => {...}))
import * as THREE from 'three';

// ---------- noise primitives (deterministic, seedable) ----------
const PERM = new Uint8Array(512);
function buildPerm(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
buildPerm(1337);
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function grad(h, x, y) { switch (h & 7) { case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y; case 4: return x; case 5: return -x; case 6: return y; default: return -y; } }

/** 2D Perlin noise, optionally tileable with period px,py (integers). Returns [-1,1]. */
export function perlin(x, y, px = 0, py = 0) {
  let xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const wrap = (a, p) => (p > 0 ? ((a % p) + p) % p : a) & 255;
  const x0 = wrap(xi, px), x1 = wrap(xi + 1, px), y0 = wrap(yi, py), y1 = wrap(yi + 1, py);
  const aa = PERM[PERM[x0] + y0], ab = PERM[PERM[x0] + y1], ba = PERM[PERM[x1] + y0], bb = PERM[PERM[x1] + y1];
  return lerp(lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u), lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u), v);
}
/** fbm in [0,1]. tile = period in noise units (freq) so texture tiles at u,v ∈ [0,1). */
export function fbm(x, y, octaves = 5, lacunarity = 2, gain = 0.5, tile = 0) {
  let amp = 0.5, sum = 0, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin(x * f, y * f, tile ? Math.round(tile * f) : 0, tile ? Math.round(tile * f) : 0);
    norm += amp; amp *= gain; f *= lacunarity;
  }
  return 0.5 + 0.5 * (sum / norm);
}
export function ridged(x, y, octaves = 5, tile = 0) {
  let amp = 0.5, sum = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(perlin(x * f, y * f, tile ? Math.round(tile * f) : 0, tile ? Math.round(tile * f) : 0));
    sum += n * n * amp; amp *= 0.5; f *= 2;
  }
  return sum;
}
function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1013904223);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Worley/cellular noise. Returns {f1, f2, id} distances in cell units. Tileable with period. */
export function worley(x, y, period = 0, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    let cx = xi + i, cy = yi + j;
    let wx = cx, wy = cy;
    if (period > 0) { wx = ((cx % period) + period) % period; wy = ((cy % period) + period) % period; }
    const ox = hash2(wx, wy, seed), oy = hash2(wx, wy, seed + 7);
    const dx = cx + ox - x, dy = cy + oy - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, seed + 13); } else if (d < f2) f2 = d;
  }
  return { f1, f2, id };
}
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mix = lerp;
export function hsl(h, s, l) { const c = new THREE.Color(); c.setHSL(h, s, l, THREE.SRGBColorSpace); return c; }

// ---------- texture factory ----------
export class ProcTex {
  constructor(renderer) {
    this.renderer = renderer;
    this.cache = new Map();
    this.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  }
  /** Cached get. */
  get(key, fn) {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key);
  }
  /**
   * Make an RGBA texture. fn(px, x, y, u, v) writes px[0..3] in 0..255 (alpha default 255).
   * opts: { color: bool (sRGB colour texture), repeat: [x,y], wrap: Repeat, filter: mipmaps }
   */
  make(w, h, fn, opts = {}) {
    const data = new Uint8Array(w * h * 4);
    const px = [0, 0, 0, 255];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      px[0] = 0; px[1] = 0; px[2] = 0; px[3] = 255;
      fn(px, x, y, x / w, y / h);
      const i = (y * w + x) * 4;
      data[i] = px[0] < 0 ? 0 : px[0] > 255 ? 255 : px[0];
      data[i + 1] = px[1] < 0 ? 0 : px[1] > 255 ? 255 : px[1];
      data[i + 2] = px[2] < 0 ? 0 : px[2] > 255 ? 255 : px[2];
      data[i + 3] = px[3] < 0 ? 0 : px[3] > 255 ? 255 : px[3];
    }
    return this.fromData(data, w, h, opts);
  }
  fromData(data, w, h, opts = {}) {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.wrapS = t.wrapT = opts.wrap ?? THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = opts.filter ?? THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = t.minFilter !== THREE.LinearFilter;
    t.anisotropy = this.anisotropy;
    t.colorSpace = opts.color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  }
  /** Height field (Float32Array w*h, 0..1) → tangent-space normal map. strength in texels. Tileable. */
  normalFromHeight(hf, w, h, strength = 2, opts = {}) {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const l = hf[y * w + ((x - 1 + w) % w)], r = hf[y * w + ((x + 1) % w)];
      const d = hf[((y - 1 + h) % h) * w + x], u = hf[((y + 1) % h) * w + x];
      let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = (nz * 0.5 + 0.5) * 255; data[i + 3] = 255;
    }
    return this.fromData(data, w, h, { ...opts, color: false });
  }
  /** Grey map from a scalar function (0..1) → texture usable as roughness/ao/metalness (packs into all channels). */
  scalar(w, h, fn, opts = {}) {
    return this.make(w, h, (px, x, y, u, v) => { const g = clamp01(fn(x, y, u, v)) * 255; px[0] = px[1] = px[2] = g; }, { ...opts, color: false });
  }
  /** Convenience: full PBR set from a description fn returning {albedo:[r,g,b] 0..1, height:0..1, rough:0..1, metal?:0..1}. */
  pbr(key, w, h, fn, opts = {}) {
    return this.get(key, () => {
      const hf = new Float32Array(w * h);
      const albedo = new Uint8Array(w * h * 4), rough = new Uint8Array(w * h * 4);
      const out = { albedo: [0.5, 0.5, 0.5], height: 0.5, rough: 0.5, metal: 0, ao: 1 };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        out.albedo[0] = out.albedo[1] = out.albedo[2] = 0.5; out.height = 0.5; out.rough = 0.5; out.metal = 0; out.ao = 1;
        fn(out, x, y, x / w, y / h);
        const i = (y * w + x) * 4;
        albedo[i] = clamp01(out.albedo[0]) * 255; albedo[i + 1] = clamp01(out.albedo[1]) * 255; albedo[i + 2] = clamp01(out.albedo[2]) * 255; albedo[i + 3] = 255;
        hf[y * w + x] = out.height;
        // ORM-ish: R = ao, G = roughness, B = metalness (three uses G for roughness, B for metalness)
        rough[i] = clamp01(out.ao) * 255; rough[i + 1] = clamp01(out.rough) * 255; rough[i + 2] = clamp01(out.metal) * 255; rough[i + 3] = 255;
      }
      const map = this.fromData(albedo, w, h, { ...opts, color: true });
      const orm = this.fromData(rough, w, h, { ...opts, color: false });
      const normalMap = this.normalFromHeight(hf, w, h, opts.normalStrength ?? 3, opts);
      return { map, normalMap, roughnessMap: orm, metalnessMap: orm, aoMap: orm, heights: hf };
    });
  }
  /** Build a MeshStandardMaterial (or Physical) from a pbr() set. */
  material(set, params = {}, physical = false) {
    const M = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    return new M({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, metalnessMap: set.metalnessMap, aoMap: set.aoMap, roughness: 1, metalness: 1, ...params });
  }
}
