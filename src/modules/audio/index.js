// audio module — procedural ambience engine. Everything is synthesized with WebAudio (no files, CC0 by construction).
// 0 draw calls. See ARCHITECTURE.md §4/§5. Owned by the audio builder.
import { makeNoiseBuffers } from './noise.js';
import * as V from './voices.js';
import { createPanel } from './panel.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const bump = (x, c, w) => { const d = (x - c) / w; return Math.exp(-d * d); };
const toDb = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -120);
const STORE_KEY = 'skylines3.audio';

const LAYER_DEFS = [
  { name: 'wind', label: 'Wind', desc: 'pink+brown noise · LFO gusts · altitude' },
  { name: 'birds', label: 'Birds', desc: 'chirp voices · daytime · morning peak' },
  { name: 'insects', label: 'Crickets', desc: 'AM sine pulses · night only' },
  { name: 'city', label: 'City hum', desc: 'sub rumble + murmur · population' },
  { name: 'traffic', label: 'Traffic', desc: 'Doppler whooshes · vehicle density' },
  { name: 'rain', label: 'Rain', desc: 'bandpassed noise + drop transients' },
  { name: 'thunder', label: 'Thunder', desc: 'brown-noise rumble · rain only' },
  { name: 'siren', label: 'Siren', desc: 'distant wail · rare · daytime' },
  { name: 'bells', label: 'Bells', desc: 'inharmonic partials · whole hours' },
  { name: 'construction', label: 'Construction', desc: 'hammer hits · buildings:changed' },
  { name: 'ui', label: 'UI sfx', desc: 'click · confirm · error · build · bulldoze · zone' },
];
const UI_NAMES = ['click', 'confirm', 'error', 'build', 'bulldoze', 'zone'];

let S = null; // module state (one instance per page)

function loadPrefs() { try { const j = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); return { volume: clamp(Number(j.volume ?? 0.7) || 0, 0, 1), muted: !!j.muted }; } catch { return { volume: 0.7, muted: false }; } }
function savePrefs(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify({ volume: s.volume, muted: s.muted })); } catch { /* storage unavailable */ } }

function createState(ctx) {
  const prefs = loadPrefs();
  const rng = ctx.rng.fork('audio');
  return {
    ctx, rng, rngs: { noise: rng.fork('noise'), birds: rng.fork('birds'), events: rng.fork('events'), ui: rng.fork('ui'), insects: rng.fork('insects') },
    ac: null, bufs: null, o: null, nodes: null, unsupported: false, running: false, startedOnce: false,
    layers: new Map(), layerList: [], tasks: [], crickets: [],
    volume: prefs.volume, muted: prefs.muted,
    mix: { hour: 14, weather: 'clear', weatherDemo: false, daylight: 1, night: 0, morning: 0, altitude: 0, altF: 0, distance: 200, lowpass: 12000, wind: 1, rain: 0, density: 0, population: 0, vehicles: 0, demo: false },
    lastMixT: -1, lastPanelT: 0, cpuMs: 0, panelMs: 0, timer: 0, panel: null, offs: [], listeners: [], lastHourInt: -1, lastHour: NaN,
    spectrum: null, masterRms: 0, masterPeak: 0, demo: null, prevWeather: 'clear',
  };
}

// ------------------------------------------------------------------ graph
function buildGraph(s) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('WebAudio not supported');
  const ac = new AC({ latencyHint: 'playback' });
  s.ac = ac;
  ac.onstatechange = () => { s.running = ac.state === 'running'; };
  s.bufs = makeNoiseBuffers(ac, s.rngs.noise, 6);
  s.o = { ac, bufs: s.bufs, rng: s.rngs.events };
  const gain = (v) => { const g = ac.createGain(); g.gain.value = v; return g; };
  const biquad = (type, f, q = 0.7) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const loop = (buf, rng) => { const src = ac.createBufferSource(); src.buffer = buf; src.loop = true; src.start(0, rng.range(0, buf.duration * 0.8)); return src; };
  const lfo = (hz, amount, target) => { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = hz; const g = gain(amount); o.connect(g); g.connect(target); o.start(); return o; };

  const master = gain(s.muted ? 0 : s.volume);
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
  const masterAn = ac.createAnalyser(); masterAn.fftSize = 512; masterAn.smoothingTimeConstant = 0.7;
  master.connect(comp); comp.connect(masterAn); masterAn.connect(ac.destination);
  const ambBus = gain(1); const lpf = biquad('lowpass', 12000, 0.4); ambBus.connect(lpf); lpf.connect(master);
  const uiBus = gain(1); uiBus.connect(master);
  s.nodes = { master, comp, masterAn, ambBus, lpf, uiBus, masterBuf: new Float32Array(512), specBuf: new Uint8Array(masterAn.frequencyBinCount) };
  s.spectrum = s.nodes.specBuf;

  for (const def of LAYER_DEFS) {
    const inNode = gain(0), userNode = gain(1), an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
    inNode.connect(userNode); userNode.connect(an); an.connect(def.name === 'ui' ? uiBus : ambBus);
    const L = { ...def, inNode, userNode, an, buf: new Float32Array(2048), rms: 0, meter: 0, peakHold: 0, peakT: 0, auto: 0, applied: -1, user: 1, note: '', events: 0 };
    s.layers.set(def.name, L); s.layerList.push(L);
  }
  const rng = s.rngs.noise;
  const inOf = (n) => s.layers.get(n).inNode;
  // wind: filtered pink + brown bed, LFOs on cutoff and gain -> gusts
  { const dest = inOf('wind');
    const pink = loop(s.bufs.pink, rng), lp = biquad('lowpass', 420, 0.9), g = gain(3.2); pink.connect(lp); lp.connect(g); g.connect(dest);
    const brown = loop(s.bufs.brown, rng), lp2 = biquad('lowpass', 150, 0.8), g2 = gain(0.9); brown.connect(lp2); lp2.connect(g2); g2.connect(dest);
    const whistle = loop(s.bufs.white, rng), bp = biquad('bandpass', 900, 6), g3 = gain(0.25); whistle.connect(bp); bp.connect(g3); g3.connect(dest);
    lfo(0.045, 240, lp.frequency); lfo(0.13, 1.1, g.gain); lfo(0.021, 0.35, g2.gain); lfo(0.07, 0.22, g3.gain); lfo(0.03, 300, bp.frequency); }
  // city hum: sub rumble + murmur band + beating sub oscillators
  { const dest = inOf('city');
    const brown = loop(s.bufs.brown, rng), lp = biquad('lowpass', 110, 0.9), g = gain(1.2); brown.connect(lp); lp.connect(g); g.connect(dest);
    const pink = loop(s.bufs.pink, rng), bp = biquad('bandpass', 600, 0.6), g2 = gain(1.6); pink.connect(bp); bp.connect(g2); g2.connect(dest);
    const roar = loop(s.bufs.pink, rng), lp3 = biquad('lowpass', 900, 0.5), g3 = gain(0.8); roar.connect(lp3); lp3.connect(g3); g3.connect(dest);
    for (const [f, a] of [[52, 0.22], [54.6, 0.16], [104, 0.05]]) { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f; const og = gain(a); o.connect(og); og.connect(dest); o.start(); }
    lfo(0.08, 0.5, g2.gain); lfo(0.017, 0.3, g3.gain); lfo(0.05, 120, bp.frequency); }
  // crickets: 3 persistent voices gated by scheduled bursts
  { const dest = inOf('insects'); const o = { ac, bufs: s.bufs, rng: s.rngs.insects };
    for (const pan of [-0.7, 0.15, 0.75]) s.crickets.push(V.cricketVoice(o, dest, pan)); }
  // rain bed
  { const dest = inOf('rain');
    const pink = loop(s.bufs.pink, rng), hp = biquad('highpass', 1100, 0.7), lp = biquad('lowpass', 9000, 0.5), g = gain(3.0); pink.connect(hp); hp.connect(lp); lp.connect(g); g.connect(dest);
    const white = loop(s.bufs.white, rng), bp = biquad('bandpass', 3800, 0.7), g2 = gain(0.35); white.connect(bp); bp.connect(g2); g2.connect(dest);
    const low = loop(s.bufs.brown, rng), lp2 = biquad('lowpass', 300, 0.7), g3 = gain(0.5); low.connect(lp2); lp2.connect(g3); g3.connect(dest);
    lfo(0.09, 0.6, g.gain); lfo(0.05, 0.12, g2.gain); }
  startGenerators(s);
}

// ------------------------------------------------------------------ scheduler (audio-clock based)
function schedule(s, at, fn) { s.tasks.push({ at, fn }); }
const LOOKAHEAD = 3.0; // seconds of audio scheduled ahead: survives main-thread stalls and background-tab timer throttling
function runTasks(s) {
  if (!s.ac || !s.running) return;
  const now = s.ac.currentTime, T = s.tasks;
  for (let i = T.length - 1; i >= 0; i--) {
    const t = T[i];
    if (t.at <= now + LOOKAHEAD) { T.splice(i, 1); try { t.fn(Math.max(t.at, now + 0.02)); } catch (e) { s.ctx.log('audio task failed', e?.message || e); } }
  }
}
function startGenerators(s) {
  const { ac } = s; const rng = s.rngs.events; const bird = s.rngs.birds; const demo = !!s.demo;
  const L = (n) => s.layers.get(n);
  const active = (n, th = 0.02) => L(n).auto > th && s.running && !s.muted;
  // two bird singers
  for (let k = 0; k < 2; k++) {
    const singer = (t) => {
      if (!active('birds')) { schedule(s, t + 0.5, singer); return; }
      const dur = V.birdPhrase({ ac, bufs: s.bufs, rng: bird }, t, L('birds').inNode, bird.range(-0.9, 0.9)); L('birds').events++;
      const rate = 0.55 + 0.45 * s.mix.morning;
      schedule(s, t + dur + bird.range(0.4, 3.2) / rate, singer);
    };
    schedule(s, ac.currentTime + bird.range(0.2, 1.5), singer);
  }
  // crickets
  s.crickets.forEach((c, i) => {
    const r = s.rngs.insects;
    const chirp = (t) => {
      if (!active('insects')) { schedule(s, t + 0.5, chirp); return; }
      const d = c.burst(t); L('insects').events++; schedule(s, t + d + r.range(0.25, 1.4), chirp);
    };
    schedule(s, ac.currentTime + 0.3 * i, chirp);
  });
  // traffic whooshes
  const whoosh = (t) => {
    const d = s.mix.density;
    if (!active('traffic') || d < 0.03) { schedule(s, t + 0.6, whoosh); return; }
    const dur = V.whoosh(s.o, t, L('traffic').inNode, 0.6 + 0.4 * d); L('traffic').events++;
    schedule(s, t + dur * rng.range(0.3, 0.9) + rng.range(0.8, 4.5) / Math.max(0.15, d), whoosh);
  };
  schedule(s, ac.currentTime + 1, whoosh);
  // rain drops
  const drop = (t) => {
    if (!active('rain')) { schedule(s, t + 0.4, drop); return; }
    V.rainDrop(s.o, t, L('rain').inNode); L('rain').events++; schedule(s, t + rng.range(0.05, 0.22), drop);
  };
  schedule(s, ac.currentTime + 0.5, drop);
  // thunder
  const thunder = (t) => {
    if (!active('thunder') || s.mix.rain < 0.5) { schedule(s, t + 1, thunder); return; }
    const dur = V.thunder(s.o, t, L('thunder').inNode); L('thunder').events++;
    schedule(s, t + dur + (demo ? rng.range(6, 16) : rng.range(15, 50)), thunder);
  };
  schedule(s, ac.currentTime + (demo ? 2 : rng.range(5, 20)), thunder);
  // siren (rare, daytime, needs a city)
  const siren = (t) => {
    if (!active('siren') || s.mix.daylight < 0.3 || s.mix.density < 0.1) { schedule(s, t + 2, siren); return; }
    const dur = V.siren(s.o, t, L('siren').inNode); L('siren').events++;
    schedule(s, t + dur + (demo ? rng.range(25, 50) : rng.range(90, 260)), siren);
  };
  schedule(s, ac.currentTime + (demo ? rng.range(6, 14) : rng.range(30, 120)), siren);
  // demo construction bursts (showcase only; in game this is driven by buildings:changed)
  if (demo) {
    const build = (t) => { if (active('construction')) { V.hammer(s.o, t, L('construction').inNode, rng.range(-0.6, 0.6), 0.8); L('construction').events++; } schedule(s, t + rng.range(14, 30), build); };
    schedule(s, ac.currentTime + rng.range(3, 8), build);
  }
}

// ------------------------------------------------------------------ mix (world state -> layer gains)
function envLive(ctx) { const m = ctx.modules.environment; return !!(m && m.status === 'ok' && !m.def?.stub); }
function computeMix(s) {
  const { ctx } = s; const { world, clock, rig } = ctx; const m = s.mix;
  const cam = world.camera.position;
  m.hour = clock.hour;
  m.demo = !!s.demo;
  if (s.demo && !envLive(ctx)) {
    const p = ctx.params.get('weather');
    m.weather = p || ((m.hour >= 15.5 && m.hour < 17.5) ? 'rain' : 'clear'); m.weatherDemo = true;
  } else { m.weather = world.weather?.kind || 'clear'; m.weatherDemo = false; }
  m.daylight = smooth(5.5, 7.5, m.hour) * (1 - smooth(18.5, 20.5, m.hour));
  m.night = 1 - m.daylight;
  m.morning = bump(m.hour, 7.2, 2.0);
  m.altitude = cam.y;
  m.altF = clamp((cam.y - 15) / 700, 0, 1);
  m.distance = rig?.distance ?? cam.length();
  const t = clamp(Math.log(Math.max(1, m.distance) / 30) / Math.log(100), 0, 1);
  m.lowpass = 18000 * Math.pow(1500 / 18000, Math.pow(t, 1.3));
  m.wind = world.weather?.wind?.length ? world.weather.wind.length() : 1;
  m.rain = m.weather === 'rain' ? 1 : 0;
  // city density: traffic api > world.vehicles, plus population
  let vehicles = 0;
  const tr = ctx.modules.traffic;
  if (tr && tr.status === 'ok' && typeof tr.api?.getVehicleCountNear === 'function') {
    const r = clamp(m.distance, 100, 1200);
    const n = tr.api.getVehicleCountNear(world.camera.target.x, world.camera.target.z, r);
    vehicles = Number.isFinite(n) ? n : world.vehicles?.length || 0;
  } else vehicles = world.vehicles?.length || 0;
  let population = world.sim?.population || 0;
  if (s.demo) { vehicles = s.demo.vehicles; population = s.demo.population; }
  m.vehicles = vehicles; m.population = population;
  m.density = clamp(population / 15000, 0, 1) * 0.6 + clamp(vehicles / 80, 0, 1) * 0.4;
  const groundF = (1 - m.altF) * (1 - m.altF);
  const windN = clamp(m.wind / 4, 0, 1);
  const L = (n) => s.layers.get(n);
  L('wind').auto = 0.12 + 0.55 * m.altF + 0.35 * windN + 0.15 * m.rain;
  L('birds').auto = m.daylight * groundF * (0.55 + 0.45 * m.morning) * (1 - 0.75 * m.rain);
  L('insects').auto = m.night * groundF * 0.85 * (1 - 0.6 * m.rain);
  L('city').auto = (0.06 + 0.7 * m.density) * (0.6 + 0.4 * (1 - m.altF)) * (0.35 + 0.65 * m.daylight);
  L('traffic').auto = (0.1 + 0.9 * m.density) * groundF * (0.4 + 0.6 * m.daylight);
  L('rain').auto = m.rain * 0.9;
  L('thunder').auto = m.rain;
  L('siren').auto = m.density > 0.1 ? 0.8 : 0;
  L('bells').auto = 1; L('construction').auto = 1; L('ui').auto = 1;
  L('wind').note = `alt ${(m.altF * 100).toFixed(0)}%`; L('birds').note = `day ${(m.daylight * 100).toFixed(0)}%`; L('insects').note = `night ${(m.night * 100).toFixed(0)}%`;
  L('city').note = `density ${(m.density * 100).toFixed(0)}%`; L('traffic').note = `${vehicles} veh`; L('rain').note = m.rain ? 'raining' : 'dry'; L('thunder').note = m.rain ? 'armed' : 'idle';
  L('siren').note = m.daylight > 0.3 ? 'day' : 'night'; L('bells').note = 'hourly'; L('construction').note = m.demo ? 'demo' : 'event'; L('ui').note = 'events';
}
function applyMix(s) {
  const { ac } = s; if (!ac) return;
  const now = ac.currentTime;
  for (const L of s.layerList) {
    const target = clamp(L.auto, 0, 1.5);
    if (Math.abs(target - L.applied) > 0.003) { L.inNode.gain.setTargetAtTime(target, now, 0.5); L.applied = target; }
  }
  const lpf = s.nodes.lpf; if (Math.abs(lpf._applied - s.mix.lowpass) > 20 || lpf._applied === undefined) { lpf.frequency.setTargetAtTime(s.mix.lowpass, now, 0.35); lpf._applied = s.mix.lowpass; }
}
function applyMaster(s) {
  if (!s.ac) return;
  s.nodes.master.gain.setTargetAtTime(s.muted ? 0 : s.volume * s.volume, s.ac.currentTime, 0.05);
}

// ------------------------------------------------------------------ analysis
function analyse(s) {
  const { layerList } = s; const now = s.ac.currentTime;
  for (const L of layerList) {
    L.an.getFloatTimeDomainData(L.buf);
    let sum = 0; const b = L.buf, n = b.length; for (let i = 0; i < n; i++) sum += b[i] * b[i];
    const rms = Math.sqrt(sum / n);
    L.rms = rms;
    L.meter = rms > L.meter ? rms : L.meter * 0.9 + rms * 0.1;
    if (rms >= L.peakHold) { L.peakHold = rms; L.peakT = now; } else if (now - L.peakT > 2.5) L.peakHold *= 0.97;
  }
  const mb = s.nodes.masterBuf; s.nodes.masterAn.getFloatTimeDomainData(mb);
  let sum = 0, pk = 0; for (let i = 0; i < mb.length; i++) { const v = mb[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
  s.masterRms = Math.sqrt(sum / mb.length); s.masterPeak = pk;
  if (s.panel) s.nodes.masterAn.getByteFrequencyData(s.nodes.specBuf);
}
function analysisSnapshot(s) {
  const m = s.mix;
  return {
    running: s.running, contextState: s.ac ? s.ac.state : (s.unsupported ? 'unsupported' : 'none'), sampleRate: s.ac ? s.ac.sampleRate : 0, currentTime: s.ac ? s.ac.currentTime : 0,
    muted: s.muted, volume: s.volume, cpuMs: s.cpuMs, panelMs: s.panelMs, tasks: s.tasks.length,
    master: { rms: s.masterRms, peak: s.masterPeak, db: toDb(s.masterRms) },
    layers: s.layerList.map((L) => ({ name: L.name, label: L.label, desc: L.desc, gain: L.auto * L.user, auto: L.auto, user: L.user, rms: L.rms, db: toDb(L.rms), meterDb: toDb(L.meter), peakDb: toDb(L.peakHold), active: L.auto > 0.02, note: L.note, events: L.events })),
    params: { hour: m.hour, weather: m.weather, weatherDemo: m.weatherDemo, daylight: m.daylight, altitude: m.altitude, distance: m.distance, lowpass: m.lowpass, wind: m.wind, population: m.population, vehicles: m.vehicles, density: m.density, demo: m.demo },
    spectrum: s.spectrum,
  };
}

// ------------------------------------------------------------------ control
function start() {
  const s = S; if (!s || s.unsupported) return false;
  if (!s.ac) {
    try { buildGraph(s); } catch (e) { s.unsupported = true; s.ctx.log('audio: WebAudio unavailable —', e?.message || e); return false; }
    computeMix(s); applyMix(s);
  }
  if (s.ac.state !== 'running') { const p = s.ac.resume(); if (p && p.catch) p.then(() => { s.running = s.ac.state === 'running'; }).catch(() => { /* still blocked */ }); }
  s.running = s.ac.state === 'running';
  s.startedOnce = true;
  if (!s.timer) s.timer = setInterval(() => { if (S === s) runTasks(s); }, 250);
  return s.running;
}
function play(name) {
  const s = S; if (!s || !s.ac || !s.running || !UI_NAMES.includes(name)) return false;
  const L = s.layers.get('ui'); if (!L) return false;
  V.uiSfx({ ac: s.ac, bufs: s.bufs, rng: s.rngs.ui }, name, s.ac.currentTime + 0.01, L.inNode); L.events++;
  return true;
}
function onBuildingsChanged(p) {
  const s = S; if (!s || !s.ac || !s.running || !p?.added?.length) return;
  const { world } = s.ctx; const tgt = world.camera.target; const cam = world.camera.position;
  const reach = clamp(s.mix.distance * 1.5, 120, 900);
  let best = null, bestD = Infinity;
  for (const id of p.added.slice(0, 64)) {
    const b = world.buildings?.get?.(id); if (!b) continue;
    const pt = b.footprint?.[0] || world.lots?.get?.(b.lotId)?.center; if (!pt) continue;
    const d = Math.hypot(pt.x - tgt.x, pt.z - tgt.z);
    if (d < bestD) { bestD = d; best = pt; }
  }
  if (!best || bestD > reach) return;
  // pan from the camera's right vector
  const fx = tgt.x - cam.x, fz = tgt.z - cam.z, fl = Math.hypot(fx, fz) || 1; const rx = fz / fl, rz = -fx / fl;
  const pan = clamp(((best.x - tgt.x) * rx + (best.z - tgt.z) * rz) / reach * 2, -1, 1);
  const amp = 0.5 + 0.5 * (1 - bestD / reach);
  V.hammer(s.o, s.ac.currentTime + 0.05, s.layers.get('construction').inNode, pan, amp); s.layers.get('construction').events++;
}
function onTimeChanged(p) {
  const s = S; if (!s || !s.ac || !s.running) return;
  const h = p.hour; const hi = Math.floor(h);
  if (s.lastHourInt >= 0 && hi !== s.lastHourInt && Math.abs(h - s.lastHour) < 0.5 && hi >= 7 && hi <= 21 && !s.ctx.clock.paused) {
    const dest = s.layers.get('bells').inNode; const t = s.ac.currentTime + 0.05;
    V.bell(s.o, t, dest, 330, 0.22, 0.15); V.bell(s.o, t + 1.6, dest, 330, 0.2, 0.15);
    if (hi === 12) V.bell(s.o, t + 3.2, dest, 247, 0.22, 0.15);
    s.layers.get('bells').events++;
  }
  s.lastHourInt = hi; s.lastHour = h;
}

const api = {
  start, play,
  isRunning() { return !!(S && S.running); },
  isSupported() { return !!(S && !S.unsupported && (window.AudioContext || window.webkitAudioContext)); },
  setVolume(v) { if (!S) return; S.volume = clamp(Number(v) || 0, 0, 1); applyMaster(S); savePrefs(S); },
  getVolume() { return S ? S.volume : 0; },
  mute(b = true) { if (!S) return; S.muted = !!b; applyMaster(S); savePrefs(S); },
  isMuted() { return !!(S && S.muted); },
  setLayerGain(name, g) { const L = S?.layers.get(name); if (!L) return false; L.user = clamp(Number(g) || 0, 0, 2); if (S.ac) L.userNode.gain.setTargetAtTime(L.user, S.ac.currentTime, 0.1); return true; },
  getLayers() { return S ? S.layerList.map((L) => ({ name: L.name, gain: L.auto * L.user, auto: L.auto, user: L.user, rms: L.rms })) : []; },
  getLayerNames() { return LAYER_DEFS.map((d) => d.name); },
  getSfxNames() { return UI_NAMES.slice(); },
  getAnalysis() { return S ? analysisSnapshot(S) : null; },
  getState() { return S ? { running: S.running, muted: S.muted, volume: S.volume, contextState: S.ac ? S.ac.state : 'none', supported: api.isSupported() } : null; },
  showPanel(show = true) {
    if (!S) return; const root = document.getElementById('ui') || document.body;
    if (show && !S.panel) S.panel = createPanel(root, api); else if (!show && S.panel) { S.panel.destroy(); S.panel = null; }
  },
};

export default {
  name: 'audio',
  wave: 1,
  deps: [],
  showcaseDeps: ['environment'],
  budget: { drawCalls: 0, triangles: 0 },

  async init(ctx) {
    S = createState(ctx);
    const s = S;
    // start on first user gesture (autoplay policy); never creates a context before that in game mode
    const gesture = () => { if (!s.running) start(); if (s.running) unbind(); };
    const unbind = () => { for (const [ev, fn, opt] of s.listeners) window.removeEventListener(ev, fn, opt); s.listeners.length = 0; };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) { const opt = { capture: true, passive: true }; window.addEventListener(ev, gesture, opt); s.listeners.push([ev, gesture, opt]); }
    s.unbind = unbind;
    s.offs.push(ctx.events.on('time:changed', onTimeChanged));
    s.offs.push(ctx.events.on('weather:changed', () => { computeMix(s); applyMix(s); }));
    s.offs.push(ctx.events.on('buildings:changed', onBuildingsChanged));
    s.offs.push(ctx.events.on('tool:changed', () => play('click')));
    s.offs.push(ctx.events.on('camera:changed', () => { s.lastMixT = -1; }));
    ctx.log('audio: engine ready (waiting for gesture / showcase autostart)');
  },

  update(dt, ctx) {
    const s = S; if (!s) return;
    const t0 = performance.now();
    if (s.ac) {
      const now = ctx.clock.elapsed;
      if (now - s.lastMixT >= 0.1 || s.lastMixT < 0) { s.lastMixT = now; computeMix(s); applyMix(s); }
      if (s.running) { runTasks(s); analyse(s); }
      else if (s.demo && s.demo.retry !== undefined) { s.demo.retry -= dt; if (s.demo.retry <= 0) { s.demo.retry = 1.5; start(); } }
    } else if (s.demo && !s.unsupported && !s.startedOnce) start();
    const t1 = performance.now();
    s.cpuMs = s.cpuMs * 0.95 + (t1 - t0) * 0.05;
    if (s.panel && t1 - s.lastPanelT > 33) { s.lastPanelT = t1; const a = analysisSnapshot(s); if (!s.ac) { a.spectrum = null; computeMix(s); } s.panel.update(a, t1); s.panelMs = s.panelMs * 0.9 + (performance.now() - t1) * 0.1; }
  },

  async showcase(ctx) {
    const s = S;
    s.demo = { population: 9000, vehicles: 48, retry: 1.5 };
    if (!ctx.clock.paused) ctx.clock.setSpeed(480); // a game day in 3 minutes
    api.showPanel(true);
    start();
    computeMix(s); applyMix(s);
    ctx.log(`audio showcase: context ${s.ac ? s.ac.state : 'none'}, ${s.layerList.length} layers`);
  },

  dispose(ctx) {
    const s = S; if (!s) return;
    for (const off of s.offs) off(); s.offs.length = 0;
    s.unbind?.();
    if (s.panel) { s.panel.destroy(); s.panel = null; }
    for (const c of s.crickets) c.stop();
    s.tasks.length = 0;
    if (s.timer) { clearInterval(s.timer); s.timer = 0; }
    if (s.ac) { try { s.ac.close(); } catch { /* noop */ } }
    S = null;
  },
  api,
};
