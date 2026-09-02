// Procedural PBR layer textures for the terrain splat shader. All CC0 by construction (ProcTex noise).
// Layers are packed into three DataArrayTextures (albedo+height, normal, ORM) so the splat shader needs only
// 3 samplers regardless of layer count.
import * as THREE from 'three';
import { fbm, ridged, worley, smoothstep, clamp01, mix } from '../../core/ProcTex.js';

export const LAYERS = ['grass', 'grassDry', 'dirt', 'rock', 'sand', 'snow'];
export const LAYER_SIZE = 512;

const sat = (c, s) => { const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; return [l + (c[0] - l) * s, l + (c[1] - l) * s, l + (c[2] - l) * s]; };
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// ----- per-layer pixel functions (u,v ∈ [0,1), all tileable) -----
function grassFn(out, x, y, u, v) {
  const T = 6; // tile period in noise units
  const macro = fbm(u * T, v * T, 3, 2, 0.5, T);                    // patch-scale mottling
  const clump = fbm(u * T * 4 + 3.1, v * T * 4 + 7.7, 3, 2, 0.55, T * 4);
  const blades = fbm(u * T * 24, v * T * 24, 3, 2.1, 0.6, T * 24);  // blade-level noise
  const fine = fbm(u * T * 64 + 1.3, v * T * 64 + 9.2, 2, 2, 0.5, T * 64);
  const wc = worley(u * 9, v * 9, 9, 3);                             // clover / weed clumps
  const weeds = smoothstep(0.62, 0.3, wc.f1) * smoothstep(0.55, 0.85, wc.id);
  const lush = [0.11, 0.21, 0.055], mid = [0.16, 0.26, 0.075], yellow = [0.28, 0.30, 0.10], weed = [0.09, 0.17, 0.05];
  let c = lerp3(mid, lush, smoothstep(0.35, 0.7, macro));
  c = lerp3(c, yellow, smoothstep(0.55, 0.85, clump) * 0.55);
  c = lerp3(c, weed, weeds * 0.8);
  const bl = 0.72 + 0.55 * blades + 0.18 * (fine - 0.5);
  c = scale(c, bl);
  out.albedo = c;
  out.height = clamp01(0.35 + 0.35 * blades + 0.2 * fine + 0.15 * weeds + 0.1 * (clump - 0.5));
  out.rough = 0.86 + 0.1 * (1 - blades);
  out.ao = 0.75 + 0.25 * out.height;
}
function grassDryFn(out, x, y, u, v) {
  const T = 6;
  const macro = fbm(u * T + 5.5, v * T + 2.5, 3, 2, 0.5, T);
  const clump = fbm(u * T * 5 + 1.1, v * T * 5 + 3.7, 3, 2, 0.55, T * 5);
  const blades = fbm(u * T * 26 + 3.3, v * T * 26, 3, 2.1, 0.6, T * 26);
  const fine = fbm(u * T * 64 + 4.3, v * T * 64 + 2.2, 2, 2, 0.5, T * 64);
  const wc = worley(u * 7 + 2, v * 7, 7, 11);
  const bare = smoothstep(0.55, 0.25, wc.f1) * smoothstep(0.6, 0.9, wc.id); // bare earth patches
  const straw = [0.40, 0.35, 0.15], olive = [0.25, 0.27, 0.10], earth = [0.30, 0.22, 0.13], green = [0.17, 0.25, 0.08];
  let c = lerp3(olive, straw, smoothstep(0.3, 0.7, macro));
  c = lerp3(c, green, smoothstep(0.6, 0.85, clump) * 0.5);
  c = lerp3(c, earth, bare * 0.85);
  c = scale(c, 0.72 + 0.55 * blades + 0.2 * (fine - 0.5));
  out.albedo = c;
  out.height = clamp01(0.3 + 0.35 * blades + 0.2 * fine - 0.2 * bare + 0.1 * (clump - 0.5));
  out.rough = 0.8 + 0.12 * (1 - blades) + 0.05 * bare;
  out.ao = 0.75 + 0.25 * out.height;
}
function dirtFn(out, x, y, u, v) {
  const T = 5;
  const macro = fbm(u * T + 8.1, v * T + 1.9, 4, 2, 0.5, T);
  const grain = fbm(u * T * 32 + 2.1, v * T * 32 + 6.1, 3, 2, 0.55, T * 32);
  const wp = worley(u * 40, v * 40, 40, 5);                          // pebbles
  const pebble = smoothstep(0.42, 0.18, wp.f1) * smoothstep(0.35, 0.65, wp.id);
  const wc = worley(u * 6 + 1, v * 6 + 4, 6, 21);                    // dried mud crack cells
  const crack = 1 - smoothstep(0.02, 0.09, wc.f2 - wc.f1);
  const brown = [0.30, 0.215, 0.135], dark = [0.19, 0.135, 0.085], pale = [0.42, 0.34, 0.24], stone = [0.36, 0.34, 0.31];
  let c = lerp3(dark, brown, smoothstep(0.25, 0.75, macro));
  c = lerp3(c, pale, smoothstep(0.55, 0.8, grain) * 0.35);
  c = lerp3(c, stone, pebble * 0.7);
  c = scale(c, (0.8 + 0.4 * grain) * (1 - 0.45 * crack));
  out.albedo = c;
  out.height = clamp01(0.45 + 0.25 * grain + 0.35 * pebble - 0.35 * crack + 0.1 * (macro - 0.5));
  out.rough = 0.88 - 0.1 * pebble + 0.06 * crack;
  out.ao = 0.7 + 0.3 * out.height;
}
function rockFn(out, x, y, u, v) {
  const T = 4;
  // horizontal strata: 7 bands per tile along v, warped by tileable noise
  const warp = (fbm(u * T * 2, v * T * 2, 3, 2, 0.5, T * 2) - 0.5) * 0.35;
  const band = v * 7 + warp * 2.5 + 0.6 * fbm(u * T * 5 + 4.4, v * T * 5, 2, 2, 0.5, T * 5);
  const bf = band - Math.floor(band);                                 // 0..1 within a band
  const terrace = smoothstep(0.0, 0.15, bf) * (1 - smoothstep(0.7, 1.0, bf));
  const bandId = Math.floor(band);
  const bandTone = 0.5 + 0.5 * Math.sin(bandId * 2.399 + 1.1);        // per-band colour shift (tiles: 7 bands)
  const rg = ridged(u * T * 6 + 2.2, v * T * 6 + 1.2, 4, T * 6);
  const grain = fbm(u * T * 40 + 3.3, v * T * 40 + 8.8, 3, 2, 0.55, T * 40);
  const wc = worley(u * 10 + 3, v * 10 + 2, 10, 33);
  const fracture = 1 - smoothstep(0.015, 0.06, wc.f2 - wc.f1);       // fracture lines
  const lichen = smoothstep(0.62, 0.8, fbm(u * T * 3 + 9.9, v * T * 3 + 4.4, 3, 2, 0.5, T * 3));
  const grey = [0.40, 0.385, 0.36], tan = [0.47, 0.41, 0.33], dark = [0.24, 0.23, 0.22], moss = [0.30, 0.34, 0.20];
  let c = lerp3(grey, tan, bandTone * 0.7);
  c = lerp3(c, dark, smoothstep(0.55, 0.9, rg) * 0.45);
  c = lerp3(c, dark, fracture * 0.55);
  c = lerp3(c, moss, lichen * 0.35);
  c = scale(c, (0.75 + 0.45 * grain) * (0.7 + 0.35 * terrace));
  out.albedo = c;
  out.height = clamp01(0.25 + 0.4 * terrace + 0.25 * rg + 0.12 * grain - 0.3 * fracture);
  out.rough = 0.72 + 0.15 * grain + 0.1 * fracture - 0.1 * lichen;
  out.ao = 0.55 + 0.45 * out.height;
}
function sandFn(out, x, y, u, v) {
  const T = 6;
  const macro = fbm(u * T + 3.3, v * T + 6.6, 3, 2, 0.5, T);
  const grain = fbm(u * T * 48 + 1.1, v * T * 48 + 2.2, 2, 2, 0.5, T * 48);
  const rw = (fbm(u * T * 3 + 7.7, v * T * 3, 2, 2, 0.5, T * 3) - 0.5) * 1.6;
  const ripple = 0.5 + 0.5 * Math.sin((v * 22 + rw) * Math.PI * 2);   // wind/water ripples (22 per tile)
  const wp = worley(u * 30 + 5, v * 30 + 5, 30, 8);
  const shell = smoothstep(0.25, 0.1, wp.f1) * smoothstep(0.75, 0.95, wp.id);
  const pale = [0.70, 0.62, 0.46], warm = [0.62, 0.52, 0.36], grey = [0.55, 0.52, 0.45];
  let c = lerp3(warm, pale, smoothstep(0.3, 0.7, macro));
  c = lerp3(c, grey, smoothstep(0.6, 0.85, grain) * 0.25);
  c = lerp3(c, [0.85, 0.82, 0.75], shell * 0.8);
  c = scale(c, 0.85 + 0.2 * grain + 0.1 * (ripple - 0.5));
  out.albedo = c;
  out.height = clamp01(0.4 + 0.25 * ripple + 0.15 * grain + 0.25 * shell + 0.1 * (macro - 0.5));
  out.rough = 0.72 + 0.1 * grain;
  out.ao = 0.85 + 0.15 * out.height;
}
function snowFn(out, x, y, u, v) {
  const T = 5;
  const dune = fbm(u * T + 1.2, v * T + 8.3, 4, 2, 0.5, T);
  const grain = fbm(u * T * 40 + 6.1, v * T * 40 + 3.1, 2, 2, 0.5, T * 40);
  const crust = smoothstep(0.55, 0.75, fbm(u * T * 8 + 2.2, v * T * 8 + 5.5, 3, 2, 0.5, T * 8));
  const white = [0.86, 0.88, 0.92], blue = [0.72, 0.78, 0.88];
  let c = lerp3(blue, white, smoothstep(0.3, 0.7, dune));
  c = scale(c, 0.95 + 0.08 * (grain - 0.5) + 0.04 * crust);
  out.albedo = c;
  out.height = clamp01(0.3 + 0.5 * dune + 0.1 * grain + 0.1 * crust);
  out.rough = 0.45 + 0.2 * (1 - crust) + 0.1 * grain;
  out.ao = 0.9 + 0.1 * out.height;
}
const FNS = { grass: grassFn, grassDry: grassDryFn, dirt: dirtFn, rock: rockFn, sand: sandFn, snow: snowFn };
const NORMAL_STRENGTH = { grass: 2.2, grassDry: 2.0, dirt: 3.2, rock: 4.5, sand: 2.0, snow: 1.6 };

function makeArray(tex, w, h, n, colour) {
  const t = new THREE.DataArrayTexture(null, w, h, n);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = tex.anisotropy;
  t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

/** Build (cached) the three layer arrays. Albedo alpha = layer height (for height-based splat blending). */
export function buildLayerArrays(tex) {
  return tex.get('terrain:layers', () => {
    const w = LAYER_SIZE, h = LAYER_SIZE, n = LAYERS.length, px = w * h * 4;
    const alb = new Uint8Array(px * n), nrm = new Uint8Array(px * n), orm = new Uint8Array(px * n);
    LAYERS.forEach((name, li) => {
      const set = tex.pbr(`terrain:${name}`, w, h, FNS[name], { normalStrength: NORMAL_STRENGTH[name] });
      alb.set(set.map.image.data, li * px);
      nrm.set(set.normalMap.image.data, li * px);
      orm.set(set.roughnessMap.image.data, li * px);
      // pack height into albedo alpha
      const hf = set.heights;
      for (let i = 0; i < w * h; i++) alb[li * px + i * 4 + 3] = clamp01(hf[i]) * 255;
    });
    const albedo = makeArray(tex, w, h, n, true); albedo.image.data = alb; albedo.needsUpdate = true;
    const normal = makeArray(tex, w, h, n, false); normal.image.data = nrm; normal.needsUpdate = true;
    const ormT = makeArray(tex, w, h, n, false); ormT.image.data = orm; ormT.needsUpdate = true;
    return { albedo, normal, orm: ormT };
  });
}

/** Tileable RGBA noise: R macro fbm, G mid fbm, B ridged, A fine fbm. Linear, 512². */
export function buildNoiseTexture(tex) {
  return tex.get('terrain:noise', () => tex.make(512, 512, (px, x, y, u, v) => {
    px[0] = fbm(u * 4 + 11.1, v * 4 + 3.3, 4, 2, 0.5, 4) * 255;
    px[1] = fbm(u * 8 + 5.5, v * 8 + 9.9, 4, 2, 0.5, 8) * 255;
    px[2] = clamp01(ridged(u * 6 + 2.2, v * 6 + 7.7, 4, 6) * 1.3) * 255;
    px[3] = fbm(u * 32 + 1.5, v * 32 + 4.5, 3, 2, 0.55, 32) * 255;
  }, { color: false }));
}

/** Two tileable water normal maps (broad swell, fine ripples). */
export function buildWaterNormals(tex) {
  const swell = tex.get('terrain:waterN1', () => {
    const w = 256, h = 256, hf = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const a = fbm(u * 5 + 3.3, v * 5 + 1.1, 4, 2, 0.5, 5);
      const b = 0.5 + 0.5 * Math.sin((u * 3 + 0.6 * fbm(u * 4, v * 4, 2, 2, 0.5, 4)) * Math.PI * 2);
      hf[y * w + x] = 0.7 * a + 0.3 * b;
    }
    return tex.normalFromHeight(hf, w, h, 5.0);
  });
  const ripple = tex.get('terrain:waterN2', () => {
    const w = 256, h = 256, hf = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const a = fbm(u * 12 + 7.7, v * 12 + 2.2, 4, 2, 0.55, 12);
      const r = ridged(u * 9 + 1.1, v * 9 + 5.5, 3, 9);
      hf[y * w + x] = 0.65 * a + 0.35 * (1 - r);
    }
    return tex.normalFromHeight(hf, w, h, 4.0);
  });
  return { swell, ripple };
}

/** Heightfield as a float texture (R32F, res×res), for water depth lookup. Caller updates .image.data + needsUpdate. */
export function makeHeightTexture(heights, res) {
  const t = new THREE.DataTexture(heights, res, res, THREE.RedFormat, THREE.FloatType);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false; t.flipY = false; t.needsUpdate = true;
  return t;
}
