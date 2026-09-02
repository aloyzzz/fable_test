// Procedural PBR materials for roads. All textures come from ctx.tex (ProcTex) → CC0 by construction.
import * as THREE from 'three';
import { fbm, worley, perlin, smoothstep, clamp01 } from '../../core/ProcTex.js';

export const TILE = { asphalt: 6, curb: 2, paving: 4, grass: 2, paint: 2, concrete: 3 };

function sizeFor(quality, hi, lo) { return quality === 'low' ? lo : hi; }

export function createMaterials(ctx) {
  const tex = ctx.tex;
  const q = ctx.quality;

  // ---------- asphalt ----------
  const AS = sizeFor(q, 1024, 512);
  const asphaltSet = tex.pbr('roads/asphalt', AS, AS, (o, x, y, u, v) => {
    const T = 6;
    const aggregate = fbm(u * 96, v * 96, 3, 2.1, 0.55, 96);           // fine grain
    const grain2 = fbm(u * 220 + 3.1, v * 220 + 7.7, 2, 2, 0.5, 220);   // very fine speckle
    const macro = fbm(u * 3 + 11, v * 3 + 5, 4, 2, 0.5, 3);             // patchiness
    const macro2 = fbm(u * 1.5 + 41, v * 1.5 + 23, 3, 2, 0.5, 1.5);
    // cracks: worley cell edges masked by a low-frequency mask
    const wc = worley(u * 7, v * 7, 7, 11);
    const edge = wc.f2 - wc.f1;
    const crackMask = smoothstep(0.52, 0.66, fbm(u * 2.2 + 91, v * 2.2 + 17, 3, 2, 0.5, 2));
    const crackW = 0.018 + 0.02 * fbm(u * 40, v * 40, 2, 2, 0.5, 40);
    const crack = (1 - smoothstep(0, crackW, edge)) * crackMask;
    // patch repairs: a few worley cells at a different tone
    const wp = worley(u * 3 + 0.5, v * 3 + 0.25, 3, 29);
    const isPatch = wp.id > 0.86 ? 1 : 0;
    const patchEdge = isPatch * (1 - smoothstep(0.0, 0.03, wp.f2 - wp.f1));
    let g = 0.285 + (aggregate - 0.5) * 0.12 + (grain2 - 0.5) * 0.07 + (macro - 0.5) * 0.06 + (macro2 - 0.5) * 0.05;
    g *= 1 - 0.55 * crack;
    g *= 1 - 0.12 * isPatch;             // fresh patch is darker
    g *= 1 - 0.35 * patchEdge;           // sealed seam
    // faint warm/cool tint variation
    const tint = (macro2 - 0.5) * 0.02;
    o.albedo[0] = g + tint * 0.6; o.albedo[1] = g; o.albedo[2] = g - tint * 0.5;
    o.height = 0.5 + (aggregate - 0.5) * 0.5 + (grain2 - 0.5) * 0.3 - crack * 0.6 - patchEdge * 0.4 + (macro - 0.5) * 0.2;
    o.rough = 0.86 + (aggregate - 0.5) * 0.12 - isPatch * 0.12 + crack * 0.1 + (macro - 0.5) * 0.08;
    o.ao = 1 - crack * 0.4 - patchEdge * 0.2;
  }, { normalStrength: 2.5 });
  const asphalt = tex.material(asphaltSet, { vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 0.8, name: 'roads/asphalt' });
  asphalt.normalScale.set(0.6, 0.6);

  // ---------- curb / concrete ----------
  const CS = sizeFor(q, 512, 256);
  const curbSet = tex.pbr('roads/curb', CS, CS, (o, x, y, u, v) => {
    const speck = fbm(u * 64, v * 64, 3, 2, 0.5, 64);
    const macro = fbm(u * 4 + 7, v * 4 + 3, 3, 2, 0.5, 4);
    const grime = 1 - smoothstep(0.05, 0.42, v) ;                     // v=0: base of the curb face
    const streak = fbm(u * 30, v * 6, 3, 2, 0.5, 30) * 0.5;
    let g = 0.66 + (speck - 0.5) * 0.10 + (macro - 0.5) * 0.08;
    g *= 1 - grime * (0.30 + streak * 0.3);
    o.albedo[0] = g * 1.0; o.albedo[1] = g * 0.985; o.albedo[2] = g * 0.955;
    o.height = 0.5 + (speck - 0.5) * 0.4;
    o.rough = 0.72 + (speck - 0.5) * 0.15 + grime * 0.12;
    o.ao = 1 - grime * 0.25;
  }, { normalStrength: 1.5 });
  const curb = tex.material(curbSet, { vertexColors: true, roughness: 1, metalness: 1, name: 'roads/curb' });
  curb.normalScale.set(0.5, 0.5);

  // ---------- sidewalk paving ----------
  const PS = sizeFor(q, 1024, 512);
  const pavingSet = tex.pbr('roads/paving', PS, PS, (o, x, y, u, v) => {
    const T = 4;                                  // metres per tile
    const tw = 0.6, th = 0.4;                     // paver size (m), running bond
    const ny = Math.floor(v * T / th);
    const rowOff = (ny & 1) ? tw * 0.5 : 0;
    const fx = ((u * T + rowOff) % tw + tw) % tw, fz = (v * T) % th;
    const nx = Math.floor((u * T + rowOff) / tw);
    const seam = 0.018;
    const dx = Math.min(fx, tw - fx), dz = Math.min(fz, th - fz);
    const d = Math.min(dx, dz);
    const inSeam = 1 - smoothstep(seam, seam + 0.012, d);
    const bevel = 1 - smoothstep(seam, seam + 0.06, d);
    const id = ((nx * 73856093) ^ (((ny % 10) + 10) * 19349663)) >>> 0;
    const tileTone = ((id % 1000) / 1000 - 0.5) * 0.10;
    const speck = fbm(u * 128, v * 128, 3, 2, 0.5, 128);
    const macro = fbm(u * 3 + 17, v * 3 + 9, 3, 2, 0.5, 3);
    const dirt = fbm(u * 12 + 3, v * 12 + 5, 3, 2, 0.5, 12);
    let g = 0.58 + tileTone + (speck - 0.5) * 0.08 + (macro - 0.5) * 0.10;
    g *= 1 - inSeam * (0.45 + dirt * 0.2);
    g *= 1 - bevel * 0.08;
    o.albedo[0] = g * 1.0; o.albedo[1] = g * 0.97; o.albedo[2] = g * 0.92;
    o.height = 0.5 + (speck - 0.5) * 0.25 - inSeam * 0.5 - bevel * 0.25 + tileTone * 0.5;
    o.rough = 0.78 + (speck - 0.5) * 0.12 + inSeam * 0.15 - tileTone;
    o.ao = 1 - inSeam * 0.45 - bevel * 0.1;
  }, { normalStrength: 2.5 });
  const paving = tex.material(pavingSet, { vertexColors: true, roughness: 1, metalness: 1, name: 'roads/paving' });
  paving.normalScale.set(0.7, 0.7);

  // ---------- grass (medians, islands) ----------
  const GS = sizeFor(q, 512, 256);
  const grassSet = tex.pbr('roads/grass', GS, GS, (o, x, y, u, v) => {
    const fine = fbm(u * 80, v * 80, 4, 2.2, 0.55, 80);
    const macro = fbm(u * 3 + 5, v * 3 + 1, 3, 2, 0.5, 3);
    const dry = smoothstep(0.55, 0.75, fbm(u * 2 + 31, v * 2 + 13, 3, 2, 0.5, 2));
    const l = 0.30 + (fine - 0.5) * 0.18 + (macro - 0.5) * 0.08;
    o.albedo[0] = l * (0.95 + dry * 0.5); o.albedo[1] = l * 1.35 - dry * 0.05; o.albedo[2] = l * 0.55;
    o.height = 0.5 + (fine - 0.5) * 0.6;
    o.rough = 0.92 - (fine - 0.5) * 0.1;
  }, { normalStrength: 1.5 });
  const grass = tex.material(grassSet, { vertexColors: true, roughness: 1, metalness: 1, name: 'roads/grass' });

  // ---------- paint (lane markings) ----------
  const PA = sizeFor(q, 256, 128);
  const paintMap = tex.get('roads/paint-map', () => tex.make(PA, PA, (px, x, y, u, v) => {
    const n = fbm(u * 24, v * 24, 3, 2, 0.5, 24);
    const g = (0.90 + (n - 0.5) * 0.14) * 255;
    px[0] = g; px[1] = g; px[2] = g * 0.98;
  }, { color: true }));
  const paintAlpha = tex.get('roads/paint-alpha', () => tex.make(PA, PA, (px, x, y, u, v) => {
    const wear = fbm(u * 5 + 3, v * 5 + 9, 4, 2, 0.5, 5);
    const speck = fbm(u * 48, v * 48, 2, 2, 0.5, 48);
    const a = smoothstep(0.30, 0.42, wear + (speck - 0.5) * 0.18) * 255;
    px[0] = px[1] = px[2] = a;
  }, { color: false }));
  const paintRough = tex.get('roads/paint-rough', () => tex.make(PA, PA, (px, x, y, u, v) => {
    const n = fbm(u * 16, v * 16, 3, 2, 0.5, 16);
    const g = (0.55 + (n - 0.5) * 0.3) * 255; px[0] = 255; px[1] = g; px[2] = 0;
  }, { color: false }));
  const paint = new THREE.MeshStandardMaterial({ map: paintMap, alphaMap: paintAlpha, roughnessMap: paintRough, alphaTest: 0.5, roughness: 1, metalness: 0, vertexColors: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, name: 'roads/paint' });

  return { asphalt, curb, paving, grass, paint, sets: { asphaltSet, curbSet, pavingSet, grassSet } };
}

/** Apply weather wetness to the materials (called from update). */
export function applyWetness(mats, wet) {
  wet = clamp01(wet || 0);
  if (mats._wet === wet) return; mats._wet = wet;
  mats.asphalt.roughness = 1 - 0.6 * wet; mats.asphalt.color.setScalar(1 - 0.38 * wet);
  mats.paving.roughness = 1 - 0.45 * wet; mats.paving.color.setScalar(1 - 0.28 * wet);
  mats.curb.roughness = 1 - 0.4 * wet; mats.curb.color.setScalar(1 - 0.25 * wet);
  mats.paint.roughness = 1 - 0.4 * wet; mats.paint.color.setScalar(1 - 0.12 * wet);
  mats.grass.roughness = 1 - 0.2 * wet; mats.grass.color.setScalar(1 - 0.2 * wet);
}

/** Deterministic macro variation for vertex colours, sampled in world space. */
export function macroAt(x, z) { return 1 + (perlin(x / 37 + 100, z / 37 + 100) * 0.5 + perlin(x / 9 + 7, z / 9 + 3) * 0.25) * 0.14; }
