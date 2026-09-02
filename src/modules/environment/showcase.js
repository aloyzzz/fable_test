// Lighting test scene for ?showcase=environment: PBR ground, roughness/metalness sphere rows, a mini skyline with
// emissive windows and a few tall thin shadow casters. Every texture is procedural (ctx.tex). Draw calls: 4 + shadows.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, worley, perlin, smoothstep, clamp01 } from '../../core/ProcTex.js';

function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1013904223);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- textures ----------
export function makeGroundMaterial(ctx) {
  const set = ctx.tex.pbr('env-grass', 1024, 1024, (o, x, y, u, v) => {
    const blades = fbm(u * 96, v * 96, 3, 2.2, 0.5, 96);          // fine blade texture (~15 cm)
    const tufts = fbm(u * 22 + 3.1, v * 22 + 1.7, 4, 2, 0.5, 22);  // 60 cm tufts
    const patch = fbm(u * 2.6 + 7.7, v * 2.6 + 2.2, 4, 2, 0.55, 2.6); // ~5 m dry/damp patches
    const w = worley(u * 30, v * 30, 30, 5);
    const dirtMask = smoothstep(0.66, 0.80, fbm(u * 4 + 11, v * 4 + 4, 4, 2, 0.5, 4)) * smoothstep(0.35, 0.5, tufts);
    // desaturated meadow green, dry straw patches, darker damp areas
    const t = 0.5 + 0.5 * (blades - 0.5) * 1.6 + 0.4 * (tufts - 0.5);
    let r = 0.25 + 0.09 * t, g = 0.31 + 0.10 * t, b = 0.13 + 0.05 * t;
    const dryness = smoothstep(0.50, 0.72, patch) * 0.8;
    r = r * (1 - dryness) + 0.50 * dryness; g = g * (1 - dryness) + 0.44 * dryness; b = b * (1 - dryness) + 0.24 * dryness;
    const damp = smoothstep(0.48, 0.30, patch) * 0.3;
    r *= 1 - damp; g *= 1 - damp * 0.85; b *= 1 - damp * 0.7;
    const dr = 0.40 + 0.10 * w.f1, dg = 0.32 + 0.07 * w.f1, db = 0.22 + 0.05 * w.f1;
    r = r * (1 - dirtMask) + dr * dirtMask; g = g * (1 - dirtMask) + dg * dirtMask; b = b * (1 - dirtMask) + db * dirtMask;
    o.albedo[0] = r; o.albedo[1] = g; o.albedo[2] = b;
    o.height = 0.5 + 0.30 * (blades - 0.5) * (1 - dirtMask) + 0.12 * (tufts - 0.5) + 0.12 * (w.f1 - 0.5) * dirtMask;
    o.rough = 0.90 - 0.12 * dirtMask + 0.06 * (blades - 0.5);
  }, { normalStrength: 2.5 });
  const macro = ctx.tex.get('env-grass-macro', () => ctx.tex.make(256, 256, (px, x, y, u, v) => {
    const n = fbm(u * 4 + 5, v * 4 + 9, 4, 2, 0.5, 4), m = fbm(u * 11 + 1, v * 11 + 3, 3, 2, 0.5, 11);
    const k = 0.72 + 0.5 * n + 0.12 * (m - 0.5);
    px[0] = 255 * clamp01(k * (1 + 0.12 * (m - 0.5))); px[1] = 255 * clamp01(k); px[2] = 255 * clamp01(k * (1 - 0.12 * (n - 0.5)));
  }, { color: false }));
  const rep = 3000 / 10;
  for (const t of [set.map, set.normalMap, set.roughnessMap]) t.repeat.set(rep, rep);
  const mat = ctx.tex.material(set, { metalness: 0, roughness: 1, normalScale: new THREE.Vector2(0.9, 0.9) });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.macroMap = { value: macro };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform sampler2D macroMap;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n{ vec3 mc = texture2D(macroMap, vMapUv * 0.011).rgb; diffuseColor.rgb *= mc; }');
  };
  mat.customProgramCacheKey = () => 'env-ground-macro';
  return mat;
}

export function makeFacadeMaterial(ctx) {
  const N = 16;
  const set = ctx.tex.pbr('env-facade', 1024, 1024, (o, x, y, u, v) => {
    const cx = Math.floor(u * N), cy = Math.floor(v * N);
    const fu = u * N - cx, fv = v * N - cy;
    const grime = fbm(u * 6, v * 6, 4, 2, 0.5, 6);
    const streak = fbm(u * 40, v * 3, 3, 2, 0.6, 40);
    const inWin = fu > 0.10 && fu < 0.90 && fv > 0.18 && fv < 0.82;
    if (inWin) {
      const pane = hash2(cx, cy, 3);
      const tint = 0.85 + 0.3 * pane;
      const refl = fbm(u * 3 + pane, v * 7, 2, 2, 0.5, 3) * 0.08;
      o.albedo[0] = (0.11 + refl) * tint; o.albedo[1] = (0.14 + refl) * tint; o.albedo[2] = (0.17 + refl) * tint;
      // interior blinds/curtains for some panes
      if (pane > 0.7 && fv > 0.55) { o.albedo[0] = 0.40; o.albedo[1] = 0.38; o.albedo[2] = 0.34; o.rough = 0.8; } else o.rough = 0.10 + 0.05 * pane;
      o.height = 0.42; o.metal = 0;
    } else {
      const spandrel = fv >= 0.82 || fv <= 0.18;
      const dirtUnder = spandrel && fv < 0.18 ? smoothstep(0.18, 0.05, fv) * 0.5 * (0.5 + streak) : 0;
      let base = spandrel ? 0.42 : 0.66;
      base *= 0.85 + 0.3 * grime;
      base *= 1 - dirtUnder;
      o.albedo[0] = base * 1.0; o.albedo[1] = base * 0.97; o.albedo[2] = base * 0.92;
      o.rough = spandrel ? 0.6 + 0.2 * grime : 0.82 + 0.1 * grime;
      o.height = spandrel ? 0.58 : 0.62;
      o.metal = 0;
    }
  }, { normalStrength: 4 });
  const emissive = ctx.tex.get('env-facade-emissive', () => ctx.tex.make(1024, 1024, (px, x, y, u, v) => {
    const cx = Math.floor(u * N), cy = Math.floor(v * N);
    const fu = u * N - cx, fv = v * N - cy;
    const inWin = fu > 0.11 && fu < 0.89 && fv > 0.19 && fv < 0.81;
    const on = hash2(cx, cy, 11);
    if (!inWin || on < 0.58) { px[0] = px[1] = px[2] = 0; return; }
    const cool = hash2(cx, cy, 5) > 0.72;
    const br = 0.55 + 0.45 * hash2(cx, cy, 9);
    const grad = 0.75 + 0.25 * (1 - fv);
    const c = cool ? [0.72, 0.85, 1.0] : [1.0, 0.78, 0.50];
    px[0] = 255 * c[0] * br * grad; px[1] = 255 * c[1] * br * grad; px[2] = 255 * c[2] * br * grad;
  }, { color: true }));
  const mat = ctx.tex.material(set, { metalness: 1, roughness: 1, emissive: new THREE.Color(1, 1, 1), emissiveMap: emissive, emissiveIntensity: 0, normalScale: new THREE.Vector2(1, 1) });
  return mat;
}

export function makeRoofMaterial(ctx) {
  const set = ctx.tex.pbr('env-roof', 512, 512, (o, x, y, u, v) => {
    const w = worley(u * 60, v * 60, 60, 21);
    const n = fbm(u * 8, v * 8, 4, 2, 0.5, 8);
    const g = 0.30 + 0.12 * w.f1 + 0.10 * (n - 0.5);
    o.albedo[0] = g * 1.02; o.albedo[1] = g; o.albedo[2] = g * 0.96;
    o.height = 0.5 + 0.2 * (w.f1 - 0.5); o.rough = 0.92; o.metal = 0;
  }, { normalStrength: 2 });
  return ctx.tex.material(set, { metalness: 1, roughness: 1 });
}

// ---------- geometry helpers ----------
function quad(pos, nrm, uv, idx, a, b, c, d, n, uvs) {
  const base = pos.length / 3;
  for (const p of [a, b, c, d]) pos.push(p[0], p[1], p[2]);
  for (let i = 0; i < 4; i++) nrm.push(n[0], n[1], n[2]);
  for (const t of uvs) uv.push(t[0], t[1]);
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function boxSides(cx, cz, w, h, d, uScale, vScale, uOff, vOff) {
  const pos = [], nrm = [], uv = [], idx = [];
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const su = (len) => len / uScale, sv = h / vScale;
  const face = (a, b, c, dd, n, len) => quad(pos, nrm, uv, idx, a, b, c, dd, n, [[uOff, vOff], [uOff + su(len), vOff], [uOff + su(len), vOff + sv], [uOff, vOff + sv]]);
  face([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], [1, 0, 0], d);
  face([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], [-1, 0, 0], d);
  face([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], [0, 0, 1], w);
  face([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], [0, 0, -1], w);
  return geom(pos, nrm, uv, idx);
}
function boxTop(cx, cz, w, h, d, s) {
  const pos = [], nrm = [], uv = [], idx = [];
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  quad(pos, nrm, uv, idx, [x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], [[x0 / s, z1 / s], [x1 / s, z1 / s], [x1 / s, z0 / s], [x0 / s, z0 / s]]);
  return geom(pos, nrm, uv, idx);
}
function geom(pos, nrm, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function buildShowcase(ctx, rng) {
  const objects = [];
  const scene = ctx.scene;

  // ground
  const groundGeo = new THREE.PlaneGeometry(3000, 3000, 1, 1); groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, makeGroundMaterial(ctx));
  ground.receiveShadow = true; ground.name = 'env-show-ground';
  scene.add(ground); objects.push(ground);

  // spheres: 12 columns (roughness 0..1) x 2 rows (dielectric, metal) in one draw call via a 12x2 ORM texture
  const NC = 12, NR = 2, R = 2.6;
  const orm = new Uint8Array(NC * NR * 4), alb = new Uint8Array(NC * NR * 4);
  for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
    const i = (r * NC + c) * 4;
    orm[i] = 255; orm[i + 1] = Math.round(255 * (c / (NC - 1))); orm[i + 2] = r === 1 ? 255 : 0; orm[i + 3] = 255;
    const col = r === 1 ? [232, 214, 178] : [205, 200, 192];
    alb[i] = col[0]; alb[i + 1] = col[1]; alb[i + 2] = col[2]; alb[i + 3] = 255;
  }
  const ormTex = new THREE.DataTexture(orm, NC, NR, THREE.RGBAFormat); ormTex.magFilter = ormTex.minFilter = THREE.NearestFilter; ormTex.needsUpdate = true;
  const albTex = new THREE.DataTexture(alb, NC, NR, THREE.RGBAFormat); albTex.magFilter = albTex.minFilter = THREE.NearestFilter; albTex.colorSpace = THREE.SRGBColorSpace; albTex.needsUpdate = true;
  const sphereGeos = [];
  for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
    const g = new THREE.SphereGeometry(R, 40, 28);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (c + 0.5) / NC, (r + 0.5) / NR);
    g.translate(-(NC - 1) / 2 * 6.2 + c * 6.2, R, 34 + r * 8);
    sphereGeos.push(g);
  }
  const spheres = new THREE.Mesh(mergeGeometries(sphereGeos, false), new THREE.MeshStandardMaterial({ map: albTex, roughnessMap: ormTex, metalnessMap: ormTex, roughness: 1, metalness: 1 }));
  spheres.castShadow = true; spheres.receiveShadow = true; spheres.name = 'env-show-spheres';
  scene.add(spheres); objects.push(spheres);

  // mini skyline: towers with facade (sides) + roof (tops); tall thin columns + a wall for shadow tests
  const facadeMat = makeFacadeMaterial(ctx);
  const roofMat = makeRoofMaterial(ctx);
  const sides = [], tops = [];
  const towers = [];
  const cols = 5, rows = 4;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const cx = -110 + i * 42 + rng.range(-6, 6), cz = -200 + j * 44 + rng.range(-6, 6);
    const centre = Math.exp(-(((i - 2.2) ** 2) / 4 + ((j - 1.6) ** 2) / 3));
    const h = rng.range(22, 55) + centre * rng.range(60, 130);
    const w = rng.range(16, 30), d = rng.range(16, 30);
    towers.push({ cx, cz, w, h, d });
  }
  const WIN = 56 / 16; // 3.5 m window pitch, 16 windows per texture tile
  for (const t of towers) {
    const uOff = Math.round(rng.range(0, 16)) / 16, vOff = 0;
    sides.push(boxSides(t.cx, t.cz, t.w, t.h, t.d, WIN * 16, WIN * 16, uOff, vOff));
    tops.push(boxTop(t.cx, t.cz, t.w, t.h, t.d, 12));
    // small roof block (HVAC / stair head)
    const bw = t.w * 0.3, bd = t.d * 0.3, bh = 3.5;
    const bx = t.cx + rng.range(-t.w * 0.25, t.w * 0.25), bz = t.cz + rng.range(-t.d * 0.25, t.d * 0.25);
    const g = boxSides(bx, bz, bw, bh, bd, 12, 12, 0, 0); g.translate(0, t.h, 0); tops.push(g);
    const gt = boxTop(bx, bz, bw, bh, bd, 12); gt.translate(0, t.h, 0); tops.push(gt);
  }
  // shadow test columns and a long wall (concrete: roof material)
  for (let i = 0; i < 5; i++) { const x = -70 + i * 14, z = 4; tops.push(boxSides(x, z, 1.6, 26 + i * 6, 1.6, 12, 12, 0, 0)); tops.push(boxTop(x, z, 1.6, 26 + i * 6, 1.6, 12)); }
  tops.push(boxSides(40, -30, 90, 6, 1.2, 12, 12, 0, 0)); tops.push(boxTop(40, -30, 90, 6, 1.2, 12));
  const facade = new THREE.Mesh(mergeGeometries(sides, false), facadeMat);
  facade.castShadow = true; facade.receiveShadow = true; facade.name = 'env-show-facades';
  const roofs = new THREE.Mesh(mergeGeometries(tops, false), roofMat);
  roofs.castShadow = true; roofs.receiveShadow = true; roofs.name = 'env-show-roofs';
  scene.add(facade, roofs); objects.push(facade, roofs);

  return { objects, facadeMat, dispose() { for (const o of objects) { o.parent?.remove(o); o.geometry?.dispose(); } } };
}
