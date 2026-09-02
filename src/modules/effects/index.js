// effects module — post-processing pipeline. Owned by the effects builder. See ARCHITECTURE.md §4.
// Pipeline: Render(HDR half-float) → GTAO (½ res, denoised) → UnrealBloom (¼ res, 5 mips) → sun shafts (¼ res)
//           → OutputPass (ACES + sRGB, exactly once) → SMAA (FXAA at low) → grade (vignette/CA/grain/lift-gamma-gain).
// ?fx=off disables the module entirely (core renders directly) — used as the A/B baseline.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SAOPass } from 'three/addons/postprocessing/SAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { TrackedRenderPass, RaysPass, GradeShader } from './passes.js';
import { buildShowcase, findStageLights } from './showcase.js';

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const dayFactor = (h) => smoothstep(5.5, 7.5, h) * (1 - smoothstep(18, 20, h));
const goldenFactor = (h) => Math.max(Math.exp(-((h - 7.0) ** 2) / 0.9), Math.exp(-((h - 18.4) ** 2) / 0.9));

const DEFAULTS = {
  bloomStrength: 0.35, bloomRadius: 0.6, bloomThreshold: 1.0,
  aoIntensity: 1.0, aoRadius: 4.0,
  vignette: 0.28, grain: 0.03, aberration: 0.0012, grade: 1.0, saturation: 1.04,
  raysIntensity: 0.55,
};
const PASS_NAMES = ['ao', 'bloom', 'rays', 'smaa', 'grade'];

const S = {
  ctx: null, rng: null, composer: null, passes: {}, passList: [],
  enabled: true, quality: 'high', params: { ...DEFAULTS }, toggles: { ao: true, bloom: true, rays: true, smaa: true, grade: true },
  cpuMs: 0, cpuAvg: 0, frames: 0, logged: false, unsub: [], showcase: null, stageLights: null, envLive: false,
  _sun: new THREE.Vector3(), _grainSeed: 17.3,
};

function envLive(ctx) { const m = ctx.modules.environment; return !!(m && m.status === 'ok' && !m.def?.stub); }

function makeNoiseTexture(rng, size = 64) {
  // Same layout GTAOPass._generateNoise uses, but driven by the seeded rng (GTAOPass uses Math.random → non-deterministic).
  const simplex = new SimplexNoise({ random: () => rng.next() });
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
    const k = (i * size + j) * 4;
    data[k] = (simplex.noise(i, j) * 0.5 + 0.5) * 255; data[k + 1] = (simplex.noise(i + size, j) * 0.5 + 0.5) * 255;
    data[k + 2] = (simplex.noise(i, j + size) * 0.5 + 0.5) * 255; data[k + 3] = (simplex.noise(i + size, j + size) * 0.5 + 0.5) * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
}

function disposeComposer() {
  if (!S.composer) return;
  for (const p of S.composer.passes) { try { p.dispose?.(); } catch { /* ignore */ } }
  try { S.composer.renderTarget1.depthTexture?.dispose(); S.composer.renderTarget2.depthTexture?.dispose(); S.composer.dispose(); } catch { /* ignore */ }
  S.composer = null; S.passes = {}; S.passList = [];
}

function build() {
  const { renderer, scene, camera } = S.ctx;
  disposeComposer();
  const size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
  const W = Math.max(1, Math.round(size.width * pr)), H = Math.max(1, Math.round(size.height * pr));
  const high = S.quality === 'high';
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(W, H), depthBuffer: true });
  rt.texture.name = 'fx.rt1';
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  const P = {};
  P.render = new TrackedRenderPass(scene, camera);
  composer.addPass(P.render);
  if (high) {
    let ao = null;
    try {
      ao = new GTAOPass(scene, camera, Math.max(1, W >> 1), Math.max(1, H >> 1));
      ao.output = GTAOPass.OUTPUT.Default;
      ao.updateGtaoMaterial({ radius: S.params.aoRadius, distanceExponent: 1, thickness: 1, distanceFallOff: 1, scale: 1.25, samples: 16, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
      // deterministic denoise noise
      const old = ao.pdNoiseTexture; ao.pdNoiseTexture = makeNoiseTexture(S.rng.fork('gtao-noise')); ao.pdMaterial.uniforms.tNoise.value = ao.pdNoiseTexture; old.dispose();
      // the normal/depth pre-pass must not re-render the shadow maps
      const orig = ao._renderOverride.bind(ao);
      ao._renderOverride = (...a) => { const s = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false; try { orig(...a); } finally { renderer.shadowMap.autoUpdate = s; } };
      ao.kind = 'gtao';
    } catch (e) {
      S.ctx.log('effects: GTAO unavailable, falling back to SAO', e?.message || e);
      ao = new SAOPass(scene, camera, Math.max(1, W >> 1), Math.max(1, H >> 1));
      ao.params.saoIntensity = 0.02; ao.params.saoScale = 100; ao.params.saoKernelRadius = 40; ao.params.saoBlur = true; ao.kind = 'sao';
    }
    P.ao = ao; composer.addPass(ao);
  }
  P.bloom = new UnrealBloomPass(new THREE.Vector2(Math.max(1, W >> 1), Math.max(1, H >> 1)), S.params.bloomStrength, S.params.bloomRadius, S.params.bloomThreshold);
  P.bloom.highPassUniforms.smoothWidth.value = 0.15;
  composer.addPass(P.bloom);
  if (high) { P.rays = new RaysPass(P.render, camera, W, H, 0.25); composer.addPass(P.rays); }
  P.output = new OutputPass(); composer.addPass(P.output);
  P.smaa = high ? new SMAAPass() : new FXAAPass(); composer.addPass(P.smaa);
  P.grade = new ShaderPass(GradeShader); composer.addPass(P.grade);
  P.grade.uniforms.grainSeed.value = S._grainSeed;
  S.composer = composer; S.passes = P;
  const dbg = S.ctx.params.get('fxdebug');
  if (dbg === 'ao' && P.ao?.kind === 'gtao') { P.ao.output = GTAOPass.OUTPUT.Denoise; P.bloom.enabled = false; }
  S.passList = ['render', ...(P.ao ? [P.ao.kind + '½'] : []), 'bloom¼', ...(P.rays ? ['rays¼'] : []), 'output(ACES+sRGB)', high ? 'smaa' : 'fxaa', 'grade'];
  applySizes(); applyParams(); applyToggles();
  if (dbg === 'ao') P.bloom.enabled = false;
  S.logged = false; S.frames = 0; S.cpuAvg = 0;
}

function applySizes() {
  const { renderer } = S.ctx; if (!S.composer) return;
  const size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
  const W = Math.max(1, Math.round(size.width * pr)), H = Math.max(1, Math.round(size.height * pr));
  S.composer.setPixelRatio(pr); S.composer.setSize(size.width, size.height);   // this sets every pass to full res…
  const P = S.passes;                                                             // …so re-apply the reduced sizes:
  P.ao?.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
  P.bloom.setSize(Math.max(1, W >> (S.quality === 'high' ? 1 : 2)), Math.max(1, H >> (S.quality === 'high' ? 1 : 2)));  // bloom halves internally → ¼ (⅛ at low)
  P.rays?.setSize(W, H);
  P.grade.uniforms.resolution.value.set(W, H);
}

function applyParams() {
  const P = S.passes, p = S.params; if (!S.composer) return;
  if (P.ao?.kind === 'gtao') { P.ao.blendIntensity = p.aoIntensity; P.ao.updateGtaoMaterial({ radius: p.aoRadius }); }
  else if (P.ao) P.ao.params.saoIntensity = 0.02 * p.aoIntensity;
  P.bloom.radius = p.bloomRadius;
  const g = P.grade.uniforms;
  g.vignette.value = p.vignette; g.grain.value = p.grain; g.aberration.value = p.aberration; g.gradeMix.value = Math.max(0, Math.min(1, Number(p.grade)));
  if (P.rays) P.rays.intensity = p.raysIntensity;
}

function applyToggles() {
  const P = S.passes, t = S.toggles; if (!S.composer) return;
  if (P.ao) P.ao.enabled = t.ao;
  P.bloom.enabled = t.bloom;
  if (P.rays) P.rays.enabled = t.rays;
  P.smaa.enabled = t.smaa;
  P.grade.enabled = t.grade;
}

/** Hour / weather driven values (bloom, grade tint, sun shafts). Called every frame before composer.render. */
function updateDynamic() {
  const { ctx } = S, P = S.passes, p = S.params;
  const h = ctx.clock.hour, w = ctx.world.weather;
  const day = dayFactor(h), night = 1 - day, golden = goldenFactor(h) * day;
  // bloom: stronger and slightly lower threshold at night and on wet streets
  P.bloom.strength = lerp(p.bloomStrength, p.bloomStrength * 1.8, night) + (w.wetness || 0) * 0.08;
  P.bloom.threshold = lerp(p.bloomThreshold, p.bloomThreshold * 0.85, night);
  // grade: warm day / golden-hour lift, cool night with a gentle blue lift so shadows stay readable
  const g = P.grade.uniforms;
  const gainDay = [1.02, 1.0, 0.965], gainGold = [1.06, 0.985, 0.90], gainNight = [0.93, 0.965, 1.07];
  const liftNight = [0.012, 0.02, 0.05];
  const mixGain = (i) => lerp(lerp(gainDay[i], gainGold[i], golden), gainNight[i], night);
  g.gain.value.set(mixGain(0), mixGain(1), mixGain(2));
  g.lift.value.set(liftNight[0] * night, liftNight[1] * night, liftNight[2] * night);
  g.gamma.value.set(1, 1, 1);
  g.saturation.value = lerp(p.saturation, p.saturation * 0.92, night);
  // sun shafts
  if (P.rays) {
    if (S.envLive) ctx.clock.sunDirection(S._sun);
    else if (S.stageLights?.sun) S._sun.copy(S.stageLights.sun.position).normalize();
    else ctx.clock.sunDirection(S._sun);
    P.rays.sunDir.copy(S._sun);
    const cloud = w.cloudCover || 0;
    P.rays.daylight = day * (1 - cloud * 0.85) * (w.kind === 'fog' ? 1.4 : w.kind === 'rain' ? 0.5 : 1);
    P.rays.color.setRGB(lerp(1.0, 1.0, golden), lerp(0.86, 0.66, golden), lerp(0.62, 0.38, golden));
  }
}

function renderFrame(renderer, scene, camera, dt) {
  if (!S.enabled || !S.composer) { renderer.info.autoReset = true; renderer.render(scene, camera); return; }
  renderer.info.autoReset = false; renderer.info.reset();
  const t0 = performance.now();
  updateDynamic();
  S.composer.render(dt);
  S.cpuMs = performance.now() - t0;
  S.cpuAvg = S.frames < 5 ? S.cpuMs : S.cpuAvg * 0.95 + S.cpuMs * 0.05;
  S.frames++;
  if (!S.logged && S.frames === 120) {
    S.logged = true;
    S.ctx.log(`effects: passes [${S.passList.join(' → ')}] quality=${S.quality} cpu≈${S.cpuAvg.toFixed(2)} ms/frame (composer, CPU side) drawCalls=${renderer.info.render.calls}`);
  }
}

/** Showcase-only: while environment is a stub, drive the core's fallback sun/hemi/background by the hour so night shots mean something. */
function driveStage(ctx) {
  const L = S.stageLights; if (!L?.sun) return;
  const h = ctx.clock.hour, day = dayFactor(h), golden = goldenFactor(h) * day;
  L.sun.intensity = lerp(0.06, 3.0, day);
  L.sun.color.setRGB(lerp(0.55, lerp(1.0, 1.0, golden), day), lerp(0.65, lerp(0.95, 0.72, golden), day), lerp(1.0, lerp(0.88, 0.45, golden), day));
  if (L.hemi) { L.hemi.intensity = lerp(0.16, 1.2, day); L.hemi.color.setRGB(lerp(0.35, 0.62, day), lerp(0.42, 0.77, day), lerp(0.7, 1.0, day)); }
  if (ctx.scene.background?.isColor) ctx.scene.background.setRGB(lerp(0.02, lerp(0.56, 0.72, golden), day), lerp(0.03, lerp(0.71, 0.62, golden), day), lerp(0.07, lerp(0.9, 0.62, golden), day));
}
/** Showcase: window/lamp emissives and lamp point lights follow the hour (runs with a live or stub environment). */
function driveShowcase(ctx) {
  const sc = S.showcase; if (!sc) return;
  const night = 1 - dayFactor(ctx.clock.hour);
  for (const m of sc.facadeMats) m.emissiveIntensity = lerp(0.08, 4.0, night);
  sc.lampMat.emissiveIntensity = lerp(0, 9, night);
  for (const l of sc.lights) l.intensity = lerp(0, 160, night);
}

export default {
  name: 'effects',
  wave: 1,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 30, triangles: 500000 },

  async init(ctx) {
    S.ctx = ctx; S.rng = ctx.rng.fork('effects');
    S._grainSeed = 1 + Math.floor(S.rng.next() * 1000);
    S.quality = ctx.quality === 'low' ? 'low' : 'high';
    S.envLive = envLive(ctx);
    if (ctx.params.get('fx') === 'off') {
      S.enabled = false;
      ctx.log('effects: disabled via ?fx=off (plain renderer.render baseline)');
      return;
    }
    build();
    ctx.registerRender(renderFrame);
    S.unsub.push(ctx.events.on('resize', () => { try { applySizes(); } catch (e) { ctx.log('effects: resize failed', e); } }));
    S.unsub.push(ctx.events.on('module:status', (e) => { if (e.name === 'environment') S.envLive = envLive(ctx); }));
    ctx.log(`effects: pipeline ready [${S.passList.join(' → ')}]`);
  },

  update(dt, ctx) {
    const q = ctx.quality === 'low' ? 'low' : 'high';
    if (q !== S.quality && S.enabled) { S.quality = q; build(); }
    if (S.showcase) {
      driveShowcase(ctx);
      if (!S.envLive) { if (!S.stageLights) S.stageLights = findStageLights(ctx.scene); driveStage(ctx); }
    }
  },

  async showcase(ctx) {
    S.stageLights = findStageLights(ctx.scene);
    S.showcase = buildShowcase(ctx, S.rng.fork('showcase'));
    driveShowcase(ctx); if (!S.envLive) driveStage(ctx);
    ctx.log('effects: showcase built (towers, alcoves, crates, poles, lamps)');
  },

  dispose(ctx) {
    for (const u of S.unsub) u(); S.unsub = [];
    S.showcase?.dispose(); S.showcase = null;
    disposeComposer();
    ctx.renderer.info.autoReset = true;
    ctx.registerRender(null);
  },

  api: {
    setEnabled(on) {
      S.enabled = !!on;
      if (!S.ctx) return;
      if (S.enabled && !S.composer) { build(); }
      S.ctx.registerRender(renderFrame);
    },
    isEnabled() { return S.enabled; },
    setQuality(q) { const nq = q === 'low' ? 'low' : 'high'; if (nq !== S.quality) { S.quality = nq; if (S.composer) build(); } },
    getQuality() { return S.quality; },
    /** {bloomStrength, bloomRadius, bloomThreshold, aoIntensity, aoRadius, vignette, grain, aberration, grade(0..1), saturation, raysIntensity} */
    setParams(obj = {}) { for (const k in obj) if (k in DEFAULTS && obj[k] != null && Number.isFinite(Number(obj[k]))) S.params[k] = Number(obj[k]); applyParams(); return { ...S.params }; },
    getParams() { return { ...S.params }; },
    resetParams() { S.params = { ...DEFAULTS }; applyParams(); return { ...S.params }; },
    /** toggle('ao'|'bloom'|'smaa'|'grade'|'rays', bool) — omit bool to flip */
    toggle(name, on) { if (!PASS_NAMES.includes(name)) return false; S.toggles[name] = on == null ? !S.toggles[name] : !!on; applyToggles(); return S.toggles[name]; },
    getToggles() { return { ...S.toggles }; },
    getPasses() { return S.passList.slice(); },
    getStats() { return { enabled: S.enabled, quality: S.quality, passes: S.passList.slice(), cpuMs: +S.cpuMs.toFixed(3), cpuAvgMs: +S.cpuAvg.toFixed(3), raysStrength: S.passes.rays ? +S.passes.rays.strength.toFixed(3) : 0, drawCalls: S.ctx?.renderer.info.render.calls ?? 0 }; },
    rebuild() { if (S.composer || S.enabled) build(); },
  },
};
