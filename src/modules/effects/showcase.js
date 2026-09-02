// Showcase scene for ?showcase=effects: a tower cluster with emissive windows (bloom), alcoves/crates (AO), thin poles
// and stairs (AA), emissive street lamps, a procedural PBR plaza. Everything procedural, deterministic via ctx.rng.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, perlin, worley, smoothstep, clamp01 } from '../../core/ProcTex.js';

const WIN_PITCH_X = 4, FLOOR_H = 3.5, WIN_PER_TILE = 8;   // facade tile = 8 windows × 8 floors = 32 m × 28 m

function facadeSet(ctx, variant, rng) {
  return ctx.tex.get(`fx-facade-${variant}`, () => {
    const W = 1024, H = 1024, cell = 128;
    const albedo = new Uint8Array(W * H * 4), emis = new Uint8Array(W * H * 4), orm = new Uint8Array(W * H * 4), hf = new Float32Array(W * H);
    const nW = W / cell, nH = H / cell;
    const wins = [];
    const litChance = [0.5, 0.42, 0.6][variant];
    for (let j = 0; j < nH; j++) for (let i = 0; i < nW; i++) {
      const lit = rng.chance(litChance);
      wins.push({ lit, warm: rng.chance(0.72), bright: rng.range(0.45, 1), curtain: rng.next(), tint: rng.range(0.85, 1.1) });
    }
    const wallBase = [[0.64, 0.61, 0.56], [0.58, 0.44, 0.37], [0.36, 0.40, 0.45]][variant];
    const winRect = variant === 2 ? [10, 118, 12, 118] : [24, 104, 30, 106];   // x0,x1,y0,y1 in px within the cell
    const mullion = variant === 2 ? 64 : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const cx = x % cell, cy = y % cell, wi = Math.floor(y / cell) * nW + Math.floor(x / cell);
      const w = wins[wi];
      const inWin = cx >= winRect[0] && cx < winRect[1] && cy >= winRect[2] && cy < winRect[3];
      const onMullion = mullion && inWin && (Math.abs(cx - mullion) < 2 || Math.abs(cy - mullion) < 2);
      const frame = !inWin && cx >= winRect[0] - 3 && cx < winRect[1] + 3 && cy >= winRect[2] - 3 && cy < winRect[3] + 3;
      const nz = fbm(x / 90, y / 90, 3, 2, 0.5, 11.4);
      let r, g, b, rough, height, metal = 0, er = 0, eg = 0, eb = 0;
      if (inWin && !onMullion) {
        // glass: dark, slightly bluer, brighter reflection gradient towards the top of each pane
        const grad = 1 - (cy - winRect[2]) / (winRect[3] - winRect[2]);
        const k = 0.06 + 0.10 * grad + 0.03 * nz;
        r = k * 0.85; g = k * 0.95; b = k * 1.15; rough = 0.12; height = 0.35;
        if (w.lit) {
          const c = w.warm ? [1.0, 0.80, 0.52] : [0.74, 0.84, 1.0];
          let br = w.bright * w.tint;
          // curtains / interior variation: dim the lower part on some windows, soft noise inside
          if (w.curtain > 0.62 && grad < 0.45) br *= 0.3;
          br *= 0.85 + 0.3 * fbm(x / 22, y / 22, 2, 2, 0.5, 46);
          er = c[0] * br; eg = c[1] * br; eb = c[2] * br;
        }
      } else if (onMullion || frame) {
        const k = variant === 2 ? 0.30 : 0.70;
        r = k * 0.98; g = k; b = k * 1.02; rough = 0.45; height = 0.5; metal = variant === 2 ? 0.6 : 0;
      } else {
        // wall: base colour, macro noise, floor band, panel seam, staining under sills
        let k = 0.88 + 0.24 * nz;
        const band = cy < 7 ? 0.78 : 1;
        const seam = cx < 3 || cx > cell - 3 ? 0.7 : 1;
        const belowWin = cy >= winRect[3] && cx >= winRect[0] && cx < winRect[1] ? 1 - 0.28 * (1 - smoothstep(0, 40, cy - winRect[3])) * (0.6 + 0.4 * fbm(x / 9, y / 25, 3, 2, 0.5, 113)) : 1;
        k *= band * seam * belowWin;
        r = wallBase[0] * k; g = wallBase[1] * k; b = wallBase[2] * k;
        rough = 0.82 + 0.1 * nz; height = cy < 7 ? 0.72 : 0.6 + 0.04 * nz;
        if (variant === 1) { // brick courses
          const course = Math.floor(y / 6), bx = x + (course % 2) * 12;
          if (y % 6 === 0 || bx % 24 === 0) { r *= 0.8; g *= 0.8; b *= 0.8; height -= 0.06; }
        }
      }
      albedo[i] = clamp01(r) * 255; albedo[i + 1] = clamp01(g) * 255; albedo[i + 2] = clamp01(b) * 255; albedo[i + 3] = 255;
      emis[i] = clamp01(er) * 255; emis[i + 1] = clamp01(eg) * 255; emis[i + 2] = clamp01(eb) * 255; emis[i + 3] = 255;
      orm[i] = 255; orm[i + 1] = clamp01(rough) * 255; orm[i + 2] = clamp01(metal) * 255; orm[i + 3] = 255;
      hf[y * W + x] = height;
    }
    const map = ctx.tex.fromData(albedo, W, H, { color: true });
    const emissiveMap = ctx.tex.fromData(emis, W, H, { color: true });
    const ormT = ctx.tex.fromData(orm, W, H, { color: false });
    const normalMap = ctx.tex.normalFromHeight(hf, W, H, 4);
    return { map, emissiveMap, normalMap, roughnessMap: ormT, metalnessMap: ormT, aoMap: ormT };
  });
}

function plazaSet(ctx) {
  return ctx.tex.pbr('fx-plaza', 1024, 1024, (o, x, y, u, v) => {
    const tiles = 8, tu = u * tiles, tv = v * tiles;
    const fx = tu - Math.floor(tu), fy = tv - Math.floor(tv);
    const grout = Math.min(fx, 1 - fx, fy, 1 - fy) < 0.035;
    const id = Math.floor(tu) + Math.floor(tv) * tiles;
    const tileVar = 0.9 + 0.2 * fbm(id * 3.1, id * 1.7, 2);
    const n = fbm(u * 40, v * 40, 4, 2, 0.5, 40), macro = fbm(u * 3, v * 3, 3, 2, 0.5, 3);
    const crack = worley(u * 12, v * 12, 12, 5);
    const crackLine = smoothstep(0.03, 0.0, crack.f2 - crack.f1) * (macro > 0.55 ? 1 : 0);
    let k = (0.52 + 0.1 * n + 0.08 * (macro - 0.5)) * tileVar;
    if (grout) k *= 0.62;
    k *= 1 - 0.35 * crackLine;
    o.albedo[0] = k * 1.0; o.albedo[1] = k * 0.97; o.albedo[2] = k * 0.92;
    o.rough = grout ? 0.95 : 0.72 + 0.2 * n;
    o.height = grout ? 0.3 : 0.55 + 0.05 * n - 0.2 * crackLine;
    o.ao = grout ? 0.7 : 1;
  }, { normalStrength: 3 });
}

function concreteSet(ctx) {
  return ctx.tex.pbr('fx-concrete', 512, 512, (o, x, y, u, v) => {
    const n = fbm(u * 24, v * 24, 4, 2, 0.5, 24), macro = fbm(u * 2 + 5, v * 2, 3, 2, 0.5, 2);
    const seam = (v * 4) % 1 < 0.02 || (u * 4) % 1 < 0.02;
    let k = 0.55 + 0.12 * n + 0.1 * (macro - 0.5);
    if (seam) k *= 0.75;
    const stain = smoothstep(0.55, 0.8, fbm(u * 6, v * 30, 3, 2, 0.5, 6)) * 0.2;
    k *= 1 - stain;
    o.albedo[0] = k; o.albedo[1] = k * 0.98; o.albedo[2] = k * 0.95;
    o.rough = 0.85 + 0.1 * n; o.height = seam ? 0.4 : 0.5 + 0.06 * n;
  }, { normalStrength: 2 });
}

function crateSet(ctx) {
  return ctx.tex.pbr('fx-crate', 256, 256, (o, x, y, u, v) => {
    const planks = 4, p = v * planks, fp = p - Math.floor(p);
    const gap = fp < 0.06 || fp > 0.94;
    const grain = fbm(u * 3 + Math.floor(p) * 7, v * 60, 4, 2, 0.6, 3);
    const edgeBand = u < 0.09 || u > 0.91 || v < 0.09 || v > 0.91;
    let k = 0.42 + 0.22 * grain;
    if (gap) k *= 0.45;
    if (edgeBand) k *= 0.8;
    const nail = ((u * 16) % 1 < 0.12 && (v * 16) % 1 < 0.12 && ((u * 4) % 1 < 0.12 || (u * 4) % 1 > 0.88)) ? 1 : 0;
    o.albedo[0] = k * 1.05; o.albedo[1] = k * 0.78; o.albedo[2] = k * 0.5;
    if (nail) { o.albedo[0] = o.albedo[1] = o.albedo[2] = 0.25; }
    o.rough = 0.8 + 0.15 * grain; o.height = gap ? 0.3 : edgeBand ? 0.62 : 0.5 + 0.08 * grain;
  }, { normalStrength: 2.5 });
}

function roofSet(ctx) {
  return ctx.tex.pbr('fx-roof', 512, 512, (o, x, y, u, v) => {
    const w = worley(u * 40, v * 40, 40, 3), n = fbm(u * 10, v * 10, 3, 2, 0.5, 10);
    const stone = smoothstep(0.35, 0.0, w.f1);
    let k = 0.34 + 0.16 * n + 0.14 * stone * (0.7 + 0.6 * w.id);
    o.albedo[0] = k; o.albedo[1] = k * 0.98; o.albedo[2] = k * 0.95;
    o.rough = 0.95; o.height = 0.4 + 0.25 * stone;
  }, { normalStrength: 2 });
}

// BoxGeometry index layout: 6 indices per face; faces px, nx, py, ny, pz, nz.
function boxPart(w, h, d, faces) {
  const g = new THREE.BoxGeometry(w, h, d);
  const src = g.index.array, idx = [];
  for (const f of faces) for (let k = 0; k < 6; k++) idx.push(src[f * 6 + k]);
  g.setIndex(idx);
  return g;
}
function towerSides(w, h, d, uvOff, tint) {
  const g = boxPart(w, h, d, [0, 1, 4, 5]);
  const uv = g.attributes.uv;
  const tileW = WIN_PITCH_X * WIN_PER_TILE, tileH = FLOOR_H * WIN_PER_TILE;
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    const extent = face < 2 ? d : w;
    uv.setXY(i, uv.getX(i) * (extent / tileW) + uvOff[0] + face * 0.375, uv.getY(i) * (h / tileH) + uvOff[1]);
  }
  const col = new Float32Array(uv.count * 3);
  for (let i = 0; i < uv.count; i++) { col[i * 3] = tint[0]; col[i * 3 + 1] = tint[1]; col[i * 3 + 2] = tint[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function placed(g, x, y, z, ry = 0) { if (ry) g.rotateY(ry); g.translate(x, y, z); return g; }
function box(w, h, d, x, y, z, ry = 0) { return placed(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ry); }
function withUvScale(g, sx, sy) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy); return g; }

export function findStageLights(scene) {
  let sun = null, hemi = null;
  scene.traverse((o) => { if (o.isDirectionalLight && !sun) sun = o; if (o.isHemisphereLight && !hemi) hemi = o; });
  return { sun, hemi };
}

export function buildShowcase(ctx, rng) {
  const group = new THREE.Group(); group.name = 'effects-showcase';
  const tex = ctx.tex;
  const anisoRepeat = (set, r) => { for (const t of [set.map, set.normalMap, set.roughnessMap]) { t.repeat.set(r, r); } };

  // ---- ground (plaza) — sits just above the core's flat stage ground
  const plaza = plazaSet(ctx); anisoRepeat(plaza, 36);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(720, 720, 1, 1).rotateX(-Math.PI / 2), tex.material(plaza, { metalness: 0 }));
  ground.position.y = 0.04; ground.receiveShadow = true; ground.name = 'fx-ground';
  group.add(ground);

  // ---- towers: 3 facade variants, merged per variant (3 draw calls), roofs merged (1), roof props merged
  const facadeMats = [0, 1, 2].map((v) => {
    const set = facadeSet(ctx, v, rng.fork('facade' + v));
    return new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, metalnessMap: set.metalnessMap, aoMap: set.aoMap, emissiveMap: set.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 1, metalness: 1, vertexColors: true, normalScale: new THREE.Vector2(0.8, 0.8) });
  });
  const sidesByVariant = [[], [], []], roofs = [], parapets = [], hvacs = [], antennas = [], stairsAndConcrete = [];
  const towers = [];
  const pitch = 30;
  for (let gz = -3; gz < 3; gz++) for (let gx = -3; gx < 3; gx++) {
    if (Math.abs(gx + 0.5) < 1.6 && Math.abs(gz + 0.5) < 1.6) continue;  // central plaza stays free
    const cx = (gx + 0.5) * pitch + rng.range(-2, 2), cz = (gz + 0.5) * pitch + rng.range(-2, 2);
    const w = Math.round(rng.range(12, 23)), d = Math.round(rng.range(12, 23));
    const distC = Math.hypot(cx, cz);
    const floors = Math.max(5, Math.round(rng.range(5, 26) * (distC < 60 ? 1.15 : 0.9)));
    const h = floors * FLOOR_H;
    const variant = rng.int(0, 2);
    const tintK = rng.range(0.85, 1.08);
    const tint = [tintK * rng.range(0.96, 1.04), tintK, tintK * rng.range(0.94, 1.03)];
    towers.push({ cx, cz, w, d, h, variant });
    sidesByVariant[variant].push(placed(towerSides(w, h, d, [rng.int(0, 7) * 0.125, rng.int(0, 7) * 0.125], tint), cx, h / 2, cz));
    roofs.push(placed(withUvScale(boxPart(w, 0.2, d, [2]), w / 8, d / 8), cx, h, cz));
    // parapet ring
    const t = 0.45, ph = 1.1;
    parapets.push(box(w, ph, t, cx, h, cz - d / 2 + t / 2), box(w, ph, t, cx, h, cz + d / 2 - t / 2), box(t, ph, d - 2 * t, cx - w / 2 + t / 2, h, cz), box(t, ph, d - 2 * t, cx + w / 2 - t / 2, h, cz));
    // roof HVAC / stair head
    const nH = rng.int(1, 3);
    for (let k = 0; k < nH; k++) { const bw = rng.range(2, 4.5), bd = rng.range(2, 4), bh = rng.range(1.5, 3.2); hvacs.push(box(bw, bh, bd, cx + rng.range(-w / 2 + 3, w / 2 - 3), h, cz + rng.range(-d / 2 + 3, d / 2 - 3))); }
    if (rng.chance(0.4)) { const ah = rng.range(6, 14); antennas.push(placed(new THREE.CylinderGeometry(0.12, 0.16, ah, 8), cx + rng.range(-w / 4, w / 4), h + ah / 2, cz + rng.range(-d / 4, d / 4))); }
  }
  sidesByVariant.forEach((list, v) => { if (!list.length) return; const m = new THREE.Mesh(mergeGeometries(list, false), facadeMats[v]); m.castShadow = m.receiveShadow = true; m.name = 'fx-towers-' + v; group.add(m); });
  const roof = roofSet(ctx);
  const roofMesh = new THREE.Mesh(mergeGeometries([...roofs, ...parapets], false), tex.material(roof, { metalness: 0 }));
  roofMesh.castShadow = roofMesh.receiveShadow = true; roofMesh.name = 'fx-roofs'; group.add(roofMesh);

  // ---- concrete: alcove building (deep recessed entrance + overhang), plinth + stairs, HVAC boxes
  const conc = concreteSet(ctx); anisoRepeat(conc, 1);
  const concMat = tex.material(conc, { metalness: 0 }); concMat.map.repeat.set(2, 2); concMat.normalMap.repeat.set(2, 2); concMat.roughnessMap.repeat.set(2, 2);
  {
    const ax = -8, az = 16, aw = 24, ad = 12, ah = 9;      // building centre; entrance faces +x
    const rw = 7, rd = 5, rh = 5.5;                          // recess width (along z), depth (along x), height
    // rear block + two flanking blocks + lintel slab above recess + overhang canopy
    stairsAndConcrete.push(box(aw - rd, ah, ad, ax - rd / 2, 0, az));                                  // back mass
    stairsAndConcrete.push(box(rd, ah, (ad - rw) / 2, ax + (aw - rd) / 2, 0, az - rw / 2 - (ad - rw) / 4)); // left flank
    stairsAndConcrete.push(box(rd, ah, (ad - rw) / 2, ax + (aw - rd) / 2, 0, az + rw / 2 + (ad - rw) / 4)); // right flank
    stairsAndConcrete.push(box(rd, ah - rh, rw, ax + (aw - rd) / 2, rh, az));                           // lintel above recess
    stairsAndConcrete.push(box(3.5, 0.5, ad + 2, ax + aw / 2 + 1.75, rh + 0.2, az));                     // canopy overhang
    stairsAndConcrete.push(box(3.6, 0.35, 0.35, ax + aw / 2 + 1.8, 0, az - ad / 2 - 0.6));               // low kerb pieces
    // second deep alcove row on the north face: three niches
    for (let k = 0; k < 3; k++) { const nx = ax - 8 + k * 6; stairsAndConcrete.push(box(1.2, ah, 3, nx, 0, az - ad / 2 - 1.5)); }
    stairsAndConcrete.push(box(aw - 2, 1.2, 3.2, ax - 1, ah - 1.2, az - ad / 2 - 1.6));                  // top band over the niches
  }
  {
    const px = 22, pz = 24, pw = 12, pd = 10, ph = 1.8;      // plinth
    stairsAndConcrete.push(box(pw, ph, pd, px, 0, pz));
    const steps = 6, sh = ph / steps, sd = 0.42;
    for (let k = 0; k < steps; k++) stairsAndConcrete.push(box(6, sh * (k + 1), sd, px, 0, pz + pd / 2 + (steps - k) * sd - sd / 2));
    stairsAndConcrete.push(box(0.6, 3.4, 0.6, px - pw / 2 + 0.3, ph, pz - pd / 2 + 0.3), box(0.6, 3.4, 0.6, px + pw / 2 - 0.3, ph, pz - pd / 2 + 0.3)); // pillars
    stairsAndConcrete.push(box(pw, 0.4, 1.2, px, ph + 3.4, pz - pd / 2 + 0.6));                                                                        // beam → shadowed underside
  }
  const concMesh = new THREE.Mesh(mergeGeometries([...stairsAndConcrete, ...hvacs], false), concMat);
  concMesh.castShadow = concMesh.receiveShadow = true; concMesh.name = 'fx-concrete'; group.add(concMesh);

  // ---- crates in the alley (AO between boxes and against the wall)
  const crate = crateSet(ctx);
  const crates = [];
  const layout = [[0, 0, 0], [1.05, 0, 0], [0, 0, 1.05], [1.05, 0, 1.05], [0.5, 1, 0.5], [1.55, 1, 0.2], [2.2, 0, 0.3], [0.2, 2, 0.7], [3.0, 0, 1.4]];
  for (const [ox, oy, oz] of layout) { const s = 1; crates.push(box(s, s, s, 10 + ox, oy * s, 4 + oz, rng.range(-0.15, 0.15))); }
  for (let k = 0; k < 5; k++) crates.push(box(1, 1, 1, 14.2 + k * 0.02, k, 9.5, k * 0.08));       // 5-high stack
  const cratesMesh = new THREE.Mesh(mergeGeometries(crates, false), tex.material(crate, { metalness: 0 }));
  cratesMesh.castShadow = cratesMesh.receiveShadow = true; cratesMesh.name = 'fx-crates'; group.add(cratesMesh);
  // a low wall behind the crates so they sit in a corner
  const wall = new THREE.Mesh(mergeGeometries([box(9, 3.2, 0.5, 12, 0, 3.0), box(0.5, 3.2, 8, 7.75, 0, 6.75)], false), concMat);
  wall.castShadow = wall.receiveShadow = true; wall.name = 'fx-wall'; group.add(wall);

  // ---- poles: lamp posts, flag poles, antennas (thin geometry for AA)
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x2e3134, metalness: 0.85, roughness: 0.38 });
  const poles = [...antennas];
  const lampPositions = [[-24, 0, -20], [18, 0, -24], [26, 0, 8], [-26, 0, 26], [-4, 0, -30], [30, 0, 30], [-30, 0, 2], [4, 0, 32]];
  const lampHeads = [];
  for (const [lx, , lz] of lampPositions) {
    poles.push(placed(new THREE.CylinderGeometry(0.11, 0.16, 8, 10), lx, 4, lz));
    poles.push(placed(new THREE.CylinderGeometry(0.07, 0.09, 1.6, 8), lx, 8.0, lz + 0.8, 0).rotateX(0)); // short arm (vertical extension)
    const arm = new THREE.CylinderGeometry(0.07, 0.07, 1.8, 8); arm.rotateZ(Math.PI / 2); poles.push(placed(arm, lx + 0.9, 8, lz));
    lampHeads.push(placed(new THREE.SphereGeometry(0.42, 16, 12), lx + 1.7, 7.9, lz));
  }
  for (const [fx, fz] of [[24, -8], [27, -3], [-20, 10]]) { poles.push(placed(new THREE.CylinderGeometry(0.06, 0.09, 14, 8), fx, 7, fz)); poles.push(placed(new THREE.SphereGeometry(0.18, 8, 6), fx, 14.1, fz)); }
  // railing (thin horizontal bars) along the plinth
  for (let k = 0; k < 2; k++) { const bar = new THREE.CylinderGeometry(0.03, 0.03, 12, 6); bar.rotateZ(Math.PI / 2); poles.push(placed(bar, 22, 1.8 + 0.5 + k * 0.45, 24 - 5 + 0.15)); }
  for (let k = 0; k < 9; k++) poles.push(placed(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), 22 - 6 + k * 1.5, 1.8 + 0.5, 24 - 5 + 0.15));
  const polesMesh = new THREE.Mesh(mergeGeometries(poles, false), metalMat);
  polesMesh.castShadow = true; polesMesh.name = 'fx-poles'; group.add(polesMesh);

  // ---- emissive lamp heads (bloom) + a few real point lights (≤ 8 budget → 4)
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd0a0, emissiveIntensity: 0, roughness: 0.4 });
  const lampMesh = new THREE.Mesh(mergeGeometries(lampHeads, false), lampMat); lampMesh.name = 'fx-lamps'; group.add(lampMesh);
  const lights = [];
  for (const [lx, , lz] of lampPositions.slice(0, 4)) { const L = new THREE.PointLight(0xffd0a0, 0, 42, 2); L.position.set(lx + 1.7, 7.6, lz); group.add(L); lights.push(L); }

  ctx.scene.add(group);

  // ---- camera: sun near the top edge for the sun-shaft shot
  const { sun } = findStageLights(ctx.scene);
  const sunDir = sun ? sun.position.clone().normalize() : ctx.clock.sunDirection(new THREE.Vector3());
  const hx = sunDir.x, hz = sunDir.z, hl = Math.hypot(hx, hz) || 1;
  const camPitch = 0.42;
  const pos = new THREE.Vector3(-14, 3, -30);
  const target = pos.clone().add(new THREE.Vector3((hx / hl) * Math.cos(camPitch), Math.sin(camPitch), (hz / hl) * Math.cos(camPitch)).multiplyScalar(120));
  ctx.rig.lookAt(pos, target);

  return {
    group, facadeMats, lampMat, lights,
    dispose() { ctx.scene.remove(group); group.traverse((o) => { o.geometry?.dispose?.(); }); },
  };
}
