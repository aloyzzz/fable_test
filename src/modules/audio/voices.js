// One-shot synthesized voices. Every function takes an "o" bag { ac, bufs, rng } plus a start time `t`
// and a destination node, schedules its automation, and cleans its nodes up when finished.
// Rules: no setValueCurveAtTime (overlap throws), exponential ramps never target 0, all randomness from o.rng.
const EPS = 0.0001;

function gain(ac, v = 1) { const g = ac.createGain(); g.gain.value = v; return g; }
function biquad(ac, type, f, q = 1) { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
function panner(ac, p) { const n = ac.createStereoPanner(); n.pan.value = Math.max(-1, Math.min(1, p)); return n; }
function noise(ac, buf, rng, dur) {
  const s = ac.createBufferSource(); s.buffer = buf;
  const off = rng.range(0, Math.max(0, buf.duration - dur - 0.05));
  return { s, off };
}
function chain(nodes, dest) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); nodes[nodes.length - 1].connect(dest); }
function cleanup(src, nodes) { src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* already gone */ } } }; }
// Attack → hold → exponential decay envelope on an AudioParam
function envAD(p, t, peak, attack, decay, hold = 0) {
  p.setValueAtTime(EPS, t); p.linearRampToValueAtTime(peak, t + attack);
  if (hold > 0) p.setValueAtTime(peak, t + attack + hold);
  p.exponentialRampToValueAtTime(EPS, t + attack + hold + decay);
}

// ---------------------------------------------------------------- birds
export function birdPhrase(o, t, dest, pan) {
  const { ac, rng } = o;
  const p = panner(ac, pan); const lp = biquad(ac, 'lowpass', 7000, 0.5); lp.connect(p); p.connect(dest);
  const base = rng.range(2100, 3700), n = rng.int(2, 6);
  let tt = t, last = null;
  for (let i = 0; i < n; i++) {
    const osc = ac.createOscillator(); osc.type = 'sine'; const g = gain(ac, 0);
    osc.connect(g); g.connect(lp);
    const f0 = base * rng.range(0.92, 1.08), kind = rng.next();
    let dur;
    if (kind < 0.4) { dur = rng.range(0.06, 0.12); osc.frequency.setValueAtTime(f0, tt); osc.frequency.exponentialRampToValueAtTime(f0 * rng.range(1.25, 1.6), tt + dur); }
    else if (kind < 0.7) { dur = rng.range(0.12, 0.26); osc.frequency.setValueAtTime(f0 * 1.3, tt); osc.frequency.exponentialRampToValueAtTime(f0 * 0.8, tt + dur); }
    else { dur = rng.range(0.15, 0.32); const k = Math.floor(dur / 0.03); osc.frequency.setValueAtTime(f0, tt); for (let j = 1; j <= k; j++) osc.frequency.linearRampToValueAtTime(j % 2 ? f0 * 1.18 : f0, tt + j * 0.03); }
    const peak = rng.range(0.25, 0.45);
    g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(peak, tt + 0.008);
    g.gain.setTargetAtTime(0, tt + dur * 0.55, dur * 0.16);
    osc.start(tt); osc.stop(tt + dur + 0.12);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
    last = osc; tt += dur + rng.range(0.05, 0.22);
  }
  if (last) { const prev = last.onended; last.onended = () => { prev(); lp.disconnect(); p.disconnect(); }; }
  return tt - t;
}

// ---------------------------------------------------------------- crickets (persistent voice + gate scheduling)
export function cricketVoice(o, dest, pan) {
  const { ac, rng } = o;
  const f = rng.range(4200, 5300);
  const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.value = f;
  const osc2 = ac.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = f * 1.012;
  const am = gain(ac, 0.5); const lfo = ac.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = rng.range(26, 44);
  const lfoG = gain(ac, 0.5); lfo.connect(lfoG); lfoG.connect(am.gain);
  const gate = gain(ac, 0); const bp = biquad(ac, 'bandpass', f, 3); const p = panner(ac, pan);
  osc.connect(am); osc2.connect(am); am.connect(bp); bp.connect(gate); gate.connect(p); p.connect(dest);
  osc.start(); osc2.start(); lfo.start();
  return {
    burst(t) { // returns duration of the burst
      const k = rng.int(2, 4), len = rng.range(0.08, 0.14), gap = 0.07;
      gate.gain.setValueAtTime(0, t);
      let tt = t;
      for (let i = 0; i < k; i++) { gate.gain.linearRampToValueAtTime(0.35, tt + 0.012); gate.gain.setValueAtTime(0.35, tt + len); gate.gain.linearRampToValueAtTime(0, tt + len + 0.015); tt += len + gap; }
      return tt - t;
    },
    stop() { try { osc.stop(); osc2.stop(); lfo.stop(); } catch { /* noop */ } for (const n of [osc, osc2, lfo, lfoG, am, bp, gate, p]) { try { n.disconnect(); } catch { /* noop */ } } },
  };
}

// ---------------------------------------------------------------- traffic whoosh (Doppler-ish pass-by)
export function whoosh(o, t, dest, amp = 1) {
  const { ac, bufs, rng } = o;
  const dur = rng.range(1.3, 2.6), dir = rng.sign(), width = rng.range(0.6, 1);
  const { s, off } = noise(ac, bufs.white, rng, dur + 0.1);
  const bp = biquad(ac, 'bandpass', 2400, 1.1); bp.frequency.setValueAtTime(rng.range(1800, 3000), t); bp.frequency.exponentialRampToValueAtTime(rng.range(300, 500), t + dur);
  const g = gain(ac, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55 * amp, t + dur * 0.45); g.gain.linearRampToValueAtTime(0, t + dur);
  const p = panner(ac, -dir * width); p.pan.setValueAtTime(-dir * width, t); p.pan.linearRampToValueAtTime(dir * width, t + dur);
  chain([s, bp, g, p], dest);
  // engine tone with pitch drop
  const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(rng.range(80, 110), t); osc.frequency.exponentialRampToValueAtTime(rng.range(50, 65), t + dur);
  const lp = biquad(ac, 'lowpass', 260, 0.7); const eg = gain(ac, 0); eg.gain.setValueAtTime(0, t); eg.gain.linearRampToValueAtTime(0.18 * amp, t + dur * 0.45); eg.gain.linearRampToValueAtTime(0, t + dur);
  chain([osc, lp, eg], p);
  s.start(t, off); s.stop(t + dur + 0.05); osc.start(t); osc.stop(t + dur + 0.05);
  cleanup(s, [s, bp, g, p, osc, lp, eg]);
  return dur;
}

// ---------------------------------------------------------------- rain drop transient
export function rainDrop(o, t, dest) {
  const { ac, bufs, rng } = o;
  const { s, off } = noise(ac, bufs.white, rng, 0.1);
  const bp = biquad(ac, 'bandpass', rng.range(2500, 7500), 9);
  const g = gain(ac, 0); envAD(g.gain, t, rng.range(0.15, 0.4), 0.003, rng.range(0.03, 0.07));
  const p = panner(ac, rng.range(-1, 1));
  chain([s, bp, g, p], dest); s.start(t, off); s.stop(t + 0.12); cleanup(s, [s, bp, g, p]);
}

// ---------------------------------------------------------------- thunder
export function thunder(o, t, dest) {
  const { ac, bufs, rng } = o;
  const p = panner(ac, rng.range(-0.8, 0.8)); p.connect(dest);
  const nodes = [p];
  let t0 = t;
  if (rng.chance(0.5)) { // close crack
    const { s, off } = noise(ac, bufs.white, rng, 0.4);
    const bp = biquad(ac, 'bandpass', rng.range(600, 1200), 0.8); const g = gain(ac, 0);
    envAD(g.gain, t, 0.6, 0.015, 0.3); chain([s, bp, g], p); s.start(t, off); s.stop(t + 0.5); cleanup(s, [s, bp, g]);
    t0 = t + rng.range(0.15, 0.5);
  }
  const attack = rng.range(0.25, 0.9), rumble = rng.range(2, 4.5), decay = rng.range(1.5, 3.5);
  const total = attack + rumble + decay;
  const { s, off } = noise(ac, bufs.brown, rng, total + 0.1);
  const lp = biquad(ac, 'lowpass', 80, 0.9); lp.frequency.setValueAtTime(rng.range(60, 90), t0); lp.frequency.linearRampToValueAtTime(rng.range(110, 160), t0 + attack); lp.frequency.linearRampToValueAtTime(55, t0 + total);
  const g = gain(ac, 0); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1.0, t0 + attack);
  let tt = t0 + attack; const steps = rng.int(4, 8);
  for (let i = 0; i < steps; i++) { tt += rumble / steps; g.gain.linearRampToValueAtTime(rng.range(0.3, 1.0), tt); }
  g.gain.exponentialRampToValueAtTime(EPS, t0 + total);
  chain([s, lp, g], p); s.start(t0, off); s.stop(t0 + total + 0.05); cleanup(s, [s, lp, g, ...nodes]);
  return t0 - t + total;
}

// ---------------------------------------------------------------- distant siren (passing by)
export function siren(o, t, dest) {
  const { ac, rng } = o;
  const cycles = rng.int(3, 5), half = rng.range(0.9, 1.4), dur = cycles * 2 * half;
  const lo = rng.range(600, 720), hi = lo * rng.range(1.6, 1.85);
  const p = panner(ac, 0); const from = rng.range(-0.9, 0.9); p.pan.setValueAtTime(from, t); p.pan.linearRampToValueAtTime(from * -0.6, t + dur);
  const lp = biquad(ac, 'lowpass', 1800, 0.6); lp.connect(p); p.connect(dest);
  const g = gain(ac, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + dur * 0.35); g.gain.setValueAtTime(0.12, t + dur * 0.55); g.gain.linearRampToValueAtTime(0, t + dur);
  g.connect(lp);
  const oscs = [];
  for (const [type, amp, det] of [['triangle', 1, 0], ['square', 0.25, 3]]) {
    const osc = ac.createOscillator(); osc.type = type; osc.detune.value = det; const og = gain(ac, amp); osc.connect(og); og.connect(g);
    osc.frequency.setValueAtTime(lo, t);
    let tt = t; for (let i = 0; i < cycles; i++) { tt += half; osc.frequency.linearRampToValueAtTime(hi, tt); tt += half; osc.frequency.linearRampToValueAtTime(lo, tt); }
    osc.start(t); osc.stop(t + dur + 0.05); oscs.push(osc, og);
  }
  oscs[0].onended = () => { for (const n of [...oscs, g, lp, p]) { try { n.disconnect(); } catch { /* noop */ } } };
  return dur;
}

// ---------------------------------------------------------------- church / clock bell
const BELL = [[0.5, 0.55, 7], [1, 1, 5], [1.19, 0.5, 3.2], [1.5, 0.35, 2.6], [2.0, 0.45, 2.0], [2.51, 0.16, 1.4], [3.0, 0.1, 1.0], [4.16, 0.05, 0.6]];
export function bell(o, t, dest, base = 330, amp = 0.22, pan = 0.15) {
  const { ac, rng } = o;
  const p = panner(ac, pan); const lp = biquad(ac, 'lowpass', 4500, 0.5); lp.connect(p); p.connect(dest);
  const master = gain(ac, amp); master.connect(lp);
  let longest = null, maxDecay = 0;
  for (const [ratio, a, decay] of BELL) {
    const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.value = base * ratio * rng.range(0.997, 1.003);
    const g = gain(ac, 0); g.gain.setValueAtTime(EPS, t); g.gain.linearRampToValueAtTime(a, t + 0.004); g.gain.exponentialRampToValueAtTime(EPS, t + decay);
    osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + decay + 0.05);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
    if (decay > maxDecay) { maxDecay = decay; longest = osc; }
  }
  const prev = longest.onended; longest.onended = () => { prev(); master.disconnect(); lp.disconnect(); p.disconnect(); };
  return maxDecay;
}

// ---------------------------------------------------------------- construction hammer
export function hammer(o, t, dest, pan = 0, amp = 1) {
  const { ac, bufs, rng } = o;
  const p = panner(ac, pan); const lp = biquad(ac, 'lowpass', 5000, 0.5); lp.connect(p); p.connect(dest);
  const n = rng.int(4, 7); let tt = t; let lastSrc = null;
  for (let i = 0; i < n; i++) {
    const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(rng.range(160, 200), tt); osc.frequency.exponentialRampToValueAtTime(55, tt + 0.07);
    const g = gain(ac, 0); envAD(g.gain, tt, 0.7 * amp, 0.003, 0.14); osc.connect(g); g.connect(lp); osc.start(tt); osc.stop(tt + 0.2);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
    const { s, off } = noise(ac, bufs.white, rng, 0.1);
    const bp = biquad(ac, 'bandpass', rng.range(2600, 3600), 5); const cg = gain(ac, 0); envAD(cg.gain, tt, 0.35 * amp, 0.002, 0.05);
    chain([s, bp, cg], lp); s.start(tt, off); s.stop(tt + 0.1); cleanup(s, [s, bp, cg]); lastSrc = s;
    tt += rng.range(0.4, 0.55);
  }
  const prev = lastSrc.onended; lastSrc.onended = () => { prev(); lp.disconnect(); p.disconnect(); };
  return tt - t;
}

// ---------------------------------------------------------------- UI sfx
export function uiSfx(o, name, t, dest) {
  const { ac, bufs, rng } = o;
  const tone = (type, f0, f1, dur, amp, when = t, filt = 8000) => {
    const osc = ac.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(f0, when); if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const lp = biquad(ac, 'lowpass', filt, 0.6); const g = gain(ac, 0); envAD(g.gain, when, amp, 0.004, dur);
    chain([osc, lp, g], dest); osc.start(when); osc.stop(when + dur + 0.05); osc.onended = () => { osc.disconnect(); lp.disconnect(); g.disconnect(); };
  };
  const burst = (buf, type, f, q, dur, amp, when = t) => {
    const { s, off } = noise(ac, buf, rng, dur + 0.05); const b = biquad(ac, type, f, q); const g = gain(ac, 0); envAD(g.gain, when, amp, 0.003, dur);
    chain([s, b, g], dest); s.start(when, off); s.stop(when + dur + 0.05); cleanup(s, [s, b, g]);
  };
  switch (name) {
    case 'click': burst(bufs.white, 'bandpass', 3200, 2, 0.02, 0.35); tone('sine', 1900, 1500, 0.03, 0.18); return 0.06;
    case 'confirm': tone('triangle', 660, 660, 0.07, 0.22); tone('triangle', 880, 880, 0.12, 0.22, t + 0.075); tone('sine', 1320, 1320, 0.14, 0.08, t + 0.075); return 0.25;
    case 'error': tone('sawtooth', 240, 150, 0.22, 0.14, t, 1400); tone('square', 120, 90, 0.2, 0.06, t + 0.02, 600); return 0.25;
    case 'build': tone('sine', 130, 48, 0.16, 0.5); burst(bufs.brown, 'lowpass', 500, 0.7, 0.12, 0.5); tone('sine', 420, 940, 0.14, 0.14, t + 0.04); return 0.25;
    case 'bulldoze': burst(bufs.brown, 'lowpass', 380, 0.8, 0.32, 0.9); burst(bufs.white, 'bandpass', 1400, 0.9, 0.25, 0.28, t + 0.02); tone('sine', 90, 35, 0.3, 0.4); return 0.4;
    case 'zone': tone('sine', 520, 560, 0.1, 0.16); tone('sine', 1040, 1120, 0.1, 0.05); burst(bufs.white, 'bandpass', 5000, 3, 0.015, 0.12); return 0.15;
    default: return 0;
  }
}
