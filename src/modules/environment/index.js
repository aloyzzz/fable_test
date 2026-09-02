// environment module — sun/moon, physically based sky, lighting, camera-fitted shadows, IBL, fog, weather, rain.
// Owns: ctx.clock.sun, world.weather, scene.background/environment/fog, renderer.toneMappingExposure.
import * as THREE from 'three';
import { skyRadianceJS, transmittanceJS, MIE_BASE } from './atmosphere.js';
import { SkySystem } from './sky.js';
import { Rain } from './rain.js';
import { buildShowcase } from './showcase.js';
import { fbm } from '../../core/ProcTex.js';

const DEG = Math.PI / 180;
const LAT = 45 * DEG;
const SUN_E = 3.6;                    // top-of-atmosphere sun irradiance in three light units
const MOON_E = SUN_E * 0.0045;        // boosted moon (real is ~1/400000)
const MOON_TINT = [0.62, 0.74, 1.0];

const WEATHER = {
  clear:    { cloudCover: 0.22, wetness: 0.0, fogDensity: 0.00034, turbidity: 1.0, wind: [1.5, 0.4], cloudDark: 0.0, rain: 0 },
  overcast: { cloudCover: 0.96, wetness: 0.1, fogDensity: 0.00060, turbidity: 1.7, wind: [3.0, 1.0], cloudDark: 0.35, rain: 0 },
  rain:     { cloudCover: 1.00, wetness: 1.0, fogDensity: 0.00110, turbidity: 2.4, wind: [5.0, 2.0], cloudDark: 0.6, rain: 1 },
  fog:      { cloudCover: 0.85, wetness: 0.4, fogDensity: 0.00350, turbidity: 7.0, wind: [0.6, 0.2], cloudDark: 0.25, rain: 0 },
};

const S = {
  ctx: null, rng: null, sky: null, rain: null, pmrem: null, pmremRT: null,
  sun: null, sunTarget: null, hemi: null, fog: null, noiseTex: null, show: null,
  // weather (current, animated) and target
  cur: { ...WEATHER.clear, wind: [1.5, 0.4] }, target: { ...WEATHER.clear }, kind: 'clear',
  animTime: 0,
  lastSkyHour: -99, lastPmremHour: -99, skyFrame: -999, pmremFrame: -999, frame: 0, lastSkyCover: -1, lastSkyTurb: -1, lastPmremCover: -1,
  // lighting state (public through api)
  state: {
    hour: 0, sunEl: 0, sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), sunT: [1, 1, 1], moonT: [0, 0, 0],
    sunIntensity: 0, sunColor: new THREE.Color(), moonIntensity: 0, daylight: 1, night: 0, exposure: 0.8,
    zenith: [0, 0, 0], horizon: [0, 0, 0], ground: [0, 0, 0], skyLum: 0,
  },
  P: { betaM: MIE_BASE, g: 0.76, sunDir: [0, 1, 0], sunE: SUN_E, moonDir: [0, -1, 0], moonE: [0, 0, 0], ms: 2.6, alt: 40 },
};

// ---------- astronomy ----------
const _decl = (day) => (14.5 + 4.0 * Math.sin((day / 365) * Math.PI * 2)) * DEG;
function bodyDir(hourAngleDeg, decl, out) {
  const H = hourAngleDeg * DEG;
  const east = -Math.cos(decl) * Math.sin(H);
  const north = Math.sin(decl) * Math.cos(LAT) - Math.cos(decl) * Math.cos(H) * Math.sin(LAT);
  const up = Math.sin(decl) * Math.sin(LAT) + Math.cos(decl) * Math.cos(H) * Math.cos(LAT);
  // world frame: +X = east, -Z = north, +Y = up  (so the sunset is visible from the default showcase camera)
  return out.set(east, up, -north).normalize();
}
function sunDirection(hour, day, out) { return bodyDir((hour - 13) * 15, _decl(day), out); }
function moonDirection(hour, day, out) { return bodyDir((hour - 13) * 15 + 180, -_decl(day) * 0.8, out); }

const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

// ---------- per-frame lighting ----------
const _d = [0, 0, 0], _rad = [0, 0, 0], _T = [0, 0, 0], _tmp3 = [0, 0, 0];
function computeLighting(ctx) {
  const st = S.state, P = S.P, cur = S.cur, clock = ctx.clock;
  st.hour = clock.hour;
  sunDirection(clock.hour, clock.day, st.sunDir);
  moonDirection(clock.hour, clock.day, st.moonDir);
  clock.sun.copy(st.sunDir);
  st.sunEl = Math.asin(st.sunDir.y) / DEG;
  P.sunDir[0] = st.sunDir.x; P.sunDir[1] = st.sunDir.y; P.sunDir[2] = st.sunDir.z;
  P.moonDir[0] = st.moonDir.x; P.moonDir[1] = st.moonDir.y; P.moonDir[2] = st.moonDir.z;
  P.betaM = MIE_BASE * cur.turbidity;
  const moonUp = sstep(-6, 4, Math.asin(st.moonDir.y) / DEG);
  for (let k = 0; k < 3; k++) P.moonE[k] = MOON_E * MOON_TINT[k] * moonUp;

  // transmittances
  transmittanceJS(P.sunDir, P, st.sunT, 40);
  transmittanceJS(P.moonDir, P, st.moonT, 40);
  // sky samples: zenith, 8 horizon directions (2.5 deg), and ground estimate
  skyRadianceJS([0, 1, 0], P, st.zenith);
  st.horizon[0] = st.horizon[1] = st.horizon[2] = 0;
  const el = Math.sin(2.5 * DEG), ce = Math.cos(2.5 * DEG);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2; _d[0] = Math.cos(a) * ce; _d[1] = el; _d[2] = Math.sin(a) * ce;
    skyRadianceJS(_d, P, _rad, null, 8);
    st.horizon[0] += _rad[0] / 8; st.horizon[1] += _rad[1] / 8; st.horizon[2] += _rad[2] / 8;
  }
  // sky irradiance estimate (hemisphere): pi * mean radiance, mean ~ 0.55 zenith + 0.45 horizon
  const skyIrr = _tmp3; for (let k = 0; k < 3; k++) skyIrr[k] = Math.PI * (0.55 * st.zenith[k] + 0.45 * st.horizon[k]);
  const cover = cur.cloudCover, ov = cover * cover;
  // overcast dome radiance: a fraction of total daylight, tinted by the sun transmittance
  const sunUp = Math.max(st.sunDir.y, 0);
  const overc = [0, 0, 0];
  for (let k = 0; k < 3; k++) overc[k] = (SUN_E * sunUp * (0.4 + 0.6 * st.sunT[k]) * 0.12 + skyIrr[k] * 0.35 + P.moonE[k] * Math.max(st.moonDir.y, 0) * 0.5) / Math.PI * (1 - 0.45 * cur.cloudDark);
  // blend sky samples towards overcast so fog/hemisphere/exposure follow
  for (let k = 0; k < 3; k++) { st.zenith[k] = lerp(st.zenith[k], overc[k], ov * 0.9); st.horizon[k] = lerp(st.horizon[k], overc[k] * 0.85, ov * 0.9); skyIrr[k] = Math.PI * (0.55 * st.zenith[k] + 0.45 * st.horizon[k]); }
  st.skyLum = lum(st.zenith);

  // sun light
  const elFade = sstep(-1.5, 3.5, st.sunEl);
  const tl = lum(st.sunT);
  const sunStrength = SUN_E * elFade * Math.pow(Math.max(tl, 1e-4), 0.55) * (1 - 0.88 * Math.pow(cover, 1.5));
  const mx = Math.max(st.sunT[0], st.sunT[1], st.sunT[2], 1e-4);
  st.sunColor.setRGB(lerp(st.sunT[0] / mx, 1, 0.22), lerp(st.sunT[1] / mx, 1, 0.22), lerp(st.sunT[2] / mx, 1, 0.22));
  st.sunIntensity = sunStrength;
  // moon light
  const moonStrength = 0.07 * moonUp * Math.pow(Math.max(lum(st.moonT), 1e-4), 0.5) * (1 - 0.85 * Math.pow(cover, 1.5));
  st.moonIntensity = moonStrength;
  st.daylight = sstep(-8, 4, st.sunEl);
  st.night = 1 - sstep(-14, -3, st.sunEl);

  // ground radiance (for the equirect lower hemisphere)
  const albedo = [0.20, 0.21, 0.15];
  for (let k = 0; k < 3; k++) st.ground[k] = albedo[k] * (SUN_E * st.sunT[k] * sunUp * (1 - 0.88 * Math.pow(cover, 1.5)) + skyIrr[k] + P.moonE[k] * Math.max(st.moonDir.y, 0)) / Math.PI;

  // exposure curve (log-space piecewise on elevation), overcast lifted
  const e = st.sunEl;
  const keys = [[-90, 6.0], [-18, 6.0], [-12, 4.2], [-6, 2.4], [0, 1.25], [10, 0.85], [90, 0.85]];
  let expo = 0.85;
  for (let i = 0; i < keys.length - 1; i++) if (e >= keys[i][0] && e <= keys[i + 1][0]) { const t = (e - keys[i][0]) / (keys[i + 1][0] - keys[i][0]); expo = Math.exp(lerp(Math.log(keys[i][1]), Math.log(keys[i + 1][1]), t)); break; }
  expo *= 1 + 0.45 * ov * st.daylight;
  st.exposure = expo;
}

function applyLighting(ctx) {
  const st = S.state, cur = S.cur, scene = ctx.scene, r = ctx.renderer;
  r.toneMappingExposure = st.exposure;
  // one shadow-casting directional light: sun by day, moon by night
  const useMoon = st.moonIntensity > st.sunIntensity;
  const dir = useMoon ? st.moonDir : st.sunDir;
  S.lightDir.copy(dir);
  if (useMoon) { S.sun.color.setRGB(MOON_TINT[0], MOON_TINT[1], MOON_TINT[2]); S.sun.intensity = st.moonIntensity; }
  else { S.sun.color.copy(st.sunColor); S.sun.intensity = st.sunIntensity; }
  // hemisphere fill: small (IBL carries the ambient) but keeps the night readable
  S.hemi.color.setRGB(st.zenith[0], st.zenith[1], st.zenith[2]);
  S.hemi.groundColor.setRGB(st.ground[0], st.ground[1], st.ground[2]);
  S.hemi.intensity = 0.6 + 1.2 * st.night;
  // fog: horizon colour, density from weather (a touch denser at night so the horizon glows)
  S.fog.color.setRGB(st.horizon[0], st.horizon[1], st.horizon[2]);
  S.fog.density = cur.fogDensity;
  scene.environmentIntensity = 1.0;
  // dome uniforms
  const u = S.sky.domeMat.uniforms;
  u.uSunDir.value.copy(st.sunDir); u.uSunT.value.set(st.sunT[0], st.sunT[1], st.sunT[2]); u.uSunE.value = SUN_E;
  u.uMoonDir.value.copy(st.moonDir); u.uMoonVis.value = sstep(-1, 2, Math.asin(st.moonDir.y) / DEG);
  u.uNight.value = st.night; u.uSkyLum.value = st.skyLum;
  u.uCamPos.value.copy(ctx.camera.position);
  u.uCover.value = cur.cloudCover; u.uCloudDark.value = cur.cloudDark;
  const cloudUp = sstep(-5, 1.5, st.sunEl);
  const cT = st.sunT;
  const litScale = SUN_E * 0.62 * cloudUp / Math.PI;
  const mUp = sstep(-4, 2, Math.asin(st.moonDir.y) / DEG);
  u.uCloudLit.value.set(cT[0] * litScale + S.P.moonE[0] * mUp * 0.3, cT[1] * litScale + S.P.moonE[1] * mUp * 0.3, cT[2] * litScale + S.P.moonE[2] * mUp * 0.3);
  u.uCloudAmb.value.set(st.zenith[0] * 1.3 + st.horizon[0] * 0.5, st.zenith[1] * 1.3 + st.horizon[1] * 0.5, st.zenith[2] * 1.3 + st.horizon[2] * 0.5);
  const w = S.cur.wind;
  u.uCloudOff.value.set(S.animTime * w[0] * 2.2 / 14000, S.animTime * w[1] * 2.2 / 14000);
  u.uCloudFog.value = 0.000035 + cur.fogDensity * 0.04;
}

function setEquirectUniforms() {
  const st = S.state, P = S.P, u = S.sky.equirectMat.uniforms;
  u.uBetaM.value = P.betaM; u.uMieG.value = P.g; u.uSunDir.value.copy(st.sunDir); u.uSunE.value = SUN_E;
  u.uMoonDir.value.copy(st.moonDir); u.uMoonE.value.set(P.moonE[0], P.moonE[1], P.moonE[2]); u.uMS.value = P.ms; u.uAlt.value = P.alt;
  u.uCover.value = S.cur.cloudCover;
  const ov = S.cur.cloudCover * S.cur.cloudCover;
  // uOvercast: the overcast dome radiance ~ zenith after blending (zenith already blended in computeLighting)
  u.uOvercast.value.set(st.zenith[0], st.zenith[1], st.zenith[2]);
  u.uSunT.value.set(st.sunT[0], st.sunT[1], st.sunT[2]);
  u.uMoonT.value.set(st.moonT[0], st.moonT[1], st.moonT[2]);
  u.uGround.value.set(st.ground[0], st.ground[1], st.ground[2]);
  void ov;
}

function refreshSky(ctx, force) {
  const st = S.state;
  const dh = Math.abs(st.hour - S.lastSkyHour);
  const wChanged = Math.abs(S.cur.cloudCover - S.lastSkyCover) > 0.01 || Math.abs(S.cur.turbidity - S.lastSkyTurb) > 0.05;
  const due = force || ((dh > 0.02 || wChanged) && S.frame - S.skyFrame >= 6);
  if (due) {
    setEquirectUniforms();
    S.sky.renderEquirect();
    S.lastSkyHour = st.hour; S.skyFrame = S.frame; S.lastSkyCover = S.cur.cloudCover; S.lastSkyTurb = S.cur.turbidity;
  }
  const dp = Math.abs(st.hour - S.lastPmremHour);
  const pChanged = Math.abs(S.cur.cloudCover - S.lastPmremCover) > 0.02;
  const pdue = force || ((dp > 0.2 || pChanged) && S.frame - S.pmremFrame >= 12 && due);
  if (pdue) {
    const prevTone = ctx.renderer.toneMapping;
    ctx.renderer.toneMapping = THREE.NoToneMapping;
    S.pmremRT = S.pmrem.fromEquirectangular(S.sky.rt.texture, S.pmremRT);
    ctx.renderer.toneMapping = prevTone;
    ctx.scene.environment = S.pmremRT.texture;
    S.lastPmremHour = st.hour; S.pmremFrame = S.frame; S.lastPmremCover = S.cur.cloudCover;
  }
}

// ---------- shadows: fit the ortho frustum to the camera every frame, snap to texels ----------
const _c = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function fitShadow(ctx) {
  const sun = S.sun, cam = ctx.camera, rig = ctx.rig;
  const dist = Math.max(rig.distance, cam.position.distanceTo(rig.target));
  const size = THREE.MathUtils.clamp(dist * 1.6, 120, 2400);
  const res = sun.shadow.mapSize.x;
  const texel = size / res;
  // light-space basis (matches Object3D.lookAt with up = +Y)
  _z.copy(S.lightDir).normalize();
  _x.crossVectors(_up, _z); if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0); _x.normalize();
  _y.crossVectors(_z, _x);
  _c.copy(rig.target);
  // bias the centre a bit towards the camera side of the target so close objects get resolution
  _c.addScaledVector(cam.position.clone().sub(rig.target).setY(0).normalize(), -size * 0.05);
  const px = Math.round(_c.dot(_x) / texel) * texel, py = Math.round(_c.dot(_y) / texel) * texel, pz = _c.dot(_z);
  _c.set(0, 0, 0).addScaledVector(_x, px).addScaledVector(_y, py).addScaledVector(_z, pz);
  const D = size * 1.4 + 300;
  sun.position.copy(_c).addScaledVector(_z, D);
  S.sunTarget.position.copy(_c);
  const sc = sun.shadow.camera;
  const half = size / 2;
  if (sc.left !== -half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = D * 2; sc.updateProjectionMatrix(); }
  sun.shadow.normalBias = texel * 1.6;
  sun.shadow.bias = -0.00012;
}

// ---------- weather ----------
function setWeather(kind) {
  if (!WEATHER[kind]) kind = 'clear';
  S.kind = kind;
  S.target = { ...WEATHER[kind] };
  const w = S.ctx.world.weather;
  w.kind = kind;
  if (S.ctx.clock.paused || !S.ctx.app.ready) snapWeather();
  writeWorldWeather();
  S.ctx.events.emit('weather:changed', w);
}
function snapWeather() { const t = S.target; S.cur = { ...t, wind: [t.wind[0], t.wind[1]] }; }
function animWeather(dt) {
  const t = S.target, c = S.cur, k = Math.min(1, dt / 4.0);
  for (const key of ['cloudCover', 'wetness', 'fogDensity', 'turbidity', 'cloudDark', 'rain']) c[key] = lerp(c[key], t[key], k);
  c.wind[0] = lerp(c.wind[0], t.wind[0], k); c.wind[1] = lerp(c.wind[1], t.wind[1], k);
}
function writeWorldWeather() {
  const w = S.ctx.world.weather, c = S.cur;
  w.cloudCover = c.cloudCover; w.wetness = c.wetness; w.fogDensity = c.fogDensity; w.wind.set(c.wind[0], c.wind[1]);
}

// ---------- module ----------
const api = {
  setWeather,
  getWeather: () => S.ctx?.world.weather,
  getSunDirection: (out = new THREE.Vector3()) => out.copy(S.state.sunDir),
  getMoonDirection: (out = new THREE.Vector3()) => out.copy(S.state.moonDir),
  getSunColor: (out = new THREE.Color()) => out.copy(S.state.sunColor),
  getSunIntensity: () => S.state.sunIntensity,
  getSunElevation: () => S.state.sunEl,
  getSunLight: () => S.sun,
  getExposure: () => S.state.exposure,
  getDaylight: () => S.state.daylight,
  isNight: () => S.state.daylight < 0.5,
  getSkyColor: (dir, out = new THREE.Color()) => {
    const d = [dir.x, dir.y, dir.z]; const l = Math.hypot(d[0], d[1], d[2]) || 1; d[0] /= l; d[1] /= l; d[2] /= l;
    skyRadianceJS(d, S.P, _rad, null, 8);
    const ov = S.cur.cloudCover * S.cur.cloudCover * 0.9;
    return out.setRGB(lerp(_rad[0], S.state.zenith[0], ov), lerp(_rad[1], S.state.zenith[1], ov), lerp(_rad[2], S.state.zenith[2], ov));
  },
  getHorizonColor: (out = new THREE.Color()) => out.setRGB(S.state.horizon[0], S.state.horizon[1], S.state.horizon[2]),
  getZenithColor: (out = new THREE.Color()) => out.setRGB(S.state.zenith[0], S.state.zenith[1], S.state.zenith[2]),
  getState: () => S.state,
  setupMaterial: (mat) => mat,   // no CSM: plain shadow maps work on every material
  getEnvironmentMap: () => S.pmremRT?.texture ?? null,
};

export default {
  name: 'environment',
  wave: 1,
  deps: [],
  showcaseDeps: [],
  budget: { drawCalls: 20, triangles: 500000 },

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('environment');
    const scene = ctx.scene;
    // tileable cloud/detail noise (also used for moon mare, milky way)
    S.noiseTex = ctx.tex.get('env-cloud-noise', () => ctx.tex.make(512, 512, (px, x, y, u, v) => {
      const n = fbm(u * 4, v * 4, 6, 2.05, 0.52, 4);
      const g = 255 * Math.min(1, Math.max(0, (n - 0.5) * 1.6 + 0.5));
      px[0] = px[1] = px[2] = g;
    }, { color: false }));
    S.sky = new SkySystem(ctx.renderer, { width: 512, height: 256, noise: S.noiseTex });
    scene.add(S.sky.dome);
    scene.background = null;
    S.pmrem = new THREE.PMREMGenerator(ctx.renderer);
    S.pmrem.compileEquirectangularShader();

    S.sun = new THREE.DirectionalLight(0xffffff, 3);
    S.sun.name = 'env-sun';
    S.sun.castShadow = true;
    const res = ctx.quality === 'high' ? 4096 : 2048;
    S.sun.shadow.mapSize.set(res, res);
    S.sun.shadow.camera.near = 1; S.sun.shadow.camera.far = 4000;
    S.sunTarget = new THREE.Object3D(); S.sunTarget.name = 'env-sun-target';
    S.sun.target = S.sunTarget;
    S.lightDir = new THREE.Vector3(0, 1, 0);
    S.hemi = new THREE.HemisphereLight(0x8fb0ff, 0x4a3b28, 0.5); S.hemi.name = 'env-hemi';
    scene.add(S.sun, S.sunTarget, S.hemi);
    S.fog = new THREE.FogExp2(0xaabbcc, 0.00034);
    scene.fog = S.fog;
    S.rain = new Rain(S.rng.fork('rain'), 5000);
    scene.add(S.rain.mesh);

    const kind = ctx.params.get('weather');
    S.kind = WEATHER[kind] ? kind : 'clear';
    S.target = { ...WEATHER[S.kind] }; snapWeather(); ctx.world.weather.kind = S.kind; writeWorldWeather();

    computeLighting(ctx);
    applyLighting(ctx);
    fitShadow(ctx);
    refreshSky(ctx, true);
    ctx.log('environment ready: sun el', S.state.sunEl.toFixed(1), 'exposure', S.state.exposure.toFixed(2));
  },

  update(dt, ctx) {
    S.frame++;
    if (!ctx.clock.paused) { S.animTime += dt; animWeather(dt); }
    writeWorldWeather();
    computeLighting(ctx);
    applyLighting(ctx);
    fitShadow(ctx);
    S.sky.dome.position.copy(ctx.camera.position);
    refreshSky(ctx, false);
    if (S.rain) {
      const amb = S.hemi.color;
      S.rain.update(ctx.camera, S.animTime, S.cur.rain, ctx.world.weather.wind, amb, S.state.exposure);
    }
    if (S.show) {
      // window lights: ramp up through dusk, most on in the evening, fewer late at night
      const h = ctx.clock.hour;
      const late = h > 23 || h < 5 ? 0.55 : 1;
      S.show.facadeMat.emissiveIntensity = (1 - S.state.daylight) * 0.85 * late;
    }
  },

  async showcase(ctx) {
    S.show = buildShowcase(ctx, S.rng.fork('showcase'));
    ctx.rig.lookAt(new THREE.Vector3(150, 48, 165), new THREE.Vector3(-10, 28, -30));
  },

  dispose(ctx) {
    S.show?.dispose(); S.show = null;
    S.rain?.dispose(); S.sky?.dispose();
    for (const o of [S.sun, S.sunTarget, S.hemi]) o?.parent?.remove(o);
    S.pmremRT?.dispose(); S.pmrem?.dispose();
    ctx.scene.environment = null; ctx.scene.fog = null;
  },
  api,
};
