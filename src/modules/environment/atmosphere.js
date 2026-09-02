// Single-scattering atmosphere (Rayleigh + Mie + ozone absorption), Nishita-style, with an Earth-shadow test
// so twilight forms a real belt. The GLSL version renders the sky equirect (IBL + dome base); the JS port is used
// on the CPU for sun transmittance, zenith/horizon colours (fog, hemisphere, exposure) and api.getSkyColor().
// Both must stay in sync.

export const R_E = 6371000.0, R_A = 6471000.0, H_R = 8000.0, H_M = 1200.0;
export const BETA_R = [5.8e-6, 13.5e-6, 33.1e-6];
export const BETA_O = [0.65e-6, 1.881e-6, 0.085e-6];
export const MIE_BASE = 21e-6;

export const ATMOS_GLSL = /* glsl */`
#define R_E 6371000.0
#define R_A 6471000.0
#define H_R 8000.0
#define H_M 1200.0
const vec3 BETA_R = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const vec3 BETA_O = vec3(0.65e-6, 1.881e-6, 0.085e-6);
uniform float uBetaM;      // Mie scattering coefficient (21e-6 * turbidity)
uniform float uMieG;
uniform vec3  uSunDir;     // unit, towards sun
uniform float uSunE;       // top-of-atmosphere irradiance (three light units)
uniform vec3  uMoonDir;
uniform vec3  uMoonE;      // tinted irradiance
uniform float uMS;         // single-scattering gain
uniform float uMSK;        // multiple-scattering gain
uniform float uAlt;        // observer altitude (m)

float rsiFar(vec3 o, vec3 d, float r) { float b = dot(o, d); float c = dot(o, o) - r * r; float h = b * b - c; if (h < 0.0) return -1.0; return -b + sqrt(h); }
float rsiNear(vec3 o, vec3 d, float r) { float b = dot(o, d); float c = dot(o, o) - r * r; float h = b * b - c; if (h < 0.0) return -1.0; return -b - sqrt(h); }
float ozoneDensity(float h) { return max(0.0, 1.0 - abs(h - 25000.0) / 15000.0); }
// optical depth (rayleigh, mie, ozone) from p to space along s; x < 0 => blocked by the planet
vec3 lightDepth(vec3 p, vec3 s) {
  float t0 = -dot(p, s);
  if (t0 > 0.0) { vec3 q = p + s * t0; if (dot(q, q) < R_E * R_E) return vec3(-1.0); }
  float tl = rsiFar(p, s, R_A); float dsl = tl / 5.0; vec3 od = vec3(0.0);
  for (int j = 0; j < 5; j++) { vec3 q = p + s * (float(j) + 0.5) * dsl; float h = max(length(q) - R_E, 0.0); od += vec3(exp(-h / H_R), exp(-h / H_M), ozoneDensity(h)) * dsl; }
  return od;
}
float phaseR(float mu) { return 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu); }
float phaseM(float mu, float g) { float g2 = g * g; return 3.0 / (8.0 * 3.14159265) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5)); }
vec3 extinction(vec3 od) { return BETA_R * od.x + uBetaM * 1.1 * od.y + BETA_O * od.z; }

// In-scattered radiance along d from o (length tmax). T receives the transmittance of the path.
vec3 inscatter(vec3 o, vec3 d, float tmax, out vec3 T) {
  const int N = 16; float ds = tmax / float(N);
  vec3 sRs = vec3(0.0), sMs = vec3(0.0), sRm = vec3(0.0), sMm = vec3(0.0), sMS = vec3(0.0), sMSm = vec3(0.0); vec3 od = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = o + d * (float(i) + 0.5) * ds; float h = max(length(p) - R_E, 0.0);
    vec3 dh = vec3(exp(-h / H_R), exp(-h / H_M), ozoneDensity(h)) * ds; od += dh;
    vec3 ls = lightDepth(p, uSunDir);
    if (ls.x >= 0.0) { vec3 e1 = extinction(od + ls); vec3 att = exp(-e1); sRs += att * dh.x; sMs += att * dh.y; sMS += exp(-e1 * 0.3) * (dh.x * BETA_R + dh.y * uBetaM * 0.5); }
    vec3 lm = lightDepth(p, uMoonDir);
    if (lm.x >= 0.0) { vec3 e1 = extinction(od + lm); vec3 att = exp(-e1); sRm += att * dh.x; sMm += att * dh.y; sMSm += exp(-e1 * 0.3) * (dh.x * BETA_R + dh.y * uBetaM * 0.5); }
  }
  T = exp(-extinction(od));
  float mus = dot(d, uSunDir), mum = dot(d, uMoonDir);
  vec3 L = uSunE * (BETA_R * phaseR(mus) * sRs + uBetaM * phaseM(mus, uMieG) * sMs)
         + uMoonE * (BETA_R * phaseR(mum) * sRm + uBetaM * phaseM(mum, uMieG * 0.85) * sMm);
  // higher-order scattering approximation: isotropic, with reduced extinction so the horizon stays blue-white
  vec3 M = (uSunE * sMS + uMoonE * sMSm) * (uMSK / 12.566);
  return L * uMS + M;
}
`;

// ---------------- JS port ----------------
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function rsiFar(o, d, r) { const b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c; if (h < 0) return -1; return -b + Math.sqrt(h); }
function rsiNear(o, d, r) { const b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c; if (h < 0) return -1; return -b - Math.sqrt(h); }
const ozoneDensity = (h) => Math.max(0, 1 - Math.abs(h - 25000) / 15000);
const _q = [0, 0, 0];
function lightDepth(p, s, out, n = 4) {
  const t0 = -dot(p, s);
  if (t0 > 0) { _q[0] = p[0] + s[0] * t0; _q[1] = p[1] + s[1] * t0; _q[2] = p[2] + s[2] * t0; if (dot(_q, _q) < R_E * R_E) { out[0] = -1; return out; } }
  const tl = rsiFar(p, s, R_A), dsl = tl / n; out[0] = out[1] = out[2] = 0;
  for (let j = 0; j < n; j++) {
    const t = (j + 0.5) * dsl;
    _q[0] = p[0] + s[0] * t; _q[1] = p[1] + s[1] * t; _q[2] = p[2] + s[2] * t;
    const h = Math.max(Math.sqrt(dot(_q, _q)) - R_E, 0);
    out[0] += Math.exp(-h / H_R) * dsl; out[1] += Math.exp(-h / H_M) * dsl; out[2] += ozoneDensity(h) * dsl;
  }
  return out;
}
const phaseR = (mu) => 3 / (16 * Math.PI) * (1 + mu * mu);
function phaseM(mu, g) { const g2 = g * g; return 3 / (8 * Math.PI) * ((1 - g2) * (1 + mu * mu)) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * mu, 1.5)); }
function extinct(od, betaM, out) { for (let k = 0; k < 3; k++) out[k] = BETA_R[k] * od[0] + betaM * 1.1 * od[1] + BETA_O[k] * od[2]; return out; }

const _p = [0, 0, 0], _ls = [0, 0, 0], _lm = [0, 0, 0], _od = [0, 0, 0], _tmp = [0, 0, 0], _e = [0, 0, 0];
/**
 * params: { betaM, g, sunDir[3], sunE, moonDir[3], moonE[3], ms, alt }
 * Writes radiance into out[3] and transmittance into T[3] (optional). Directions are unit arrays.
 */
export function skyRadianceJS(d, P, out, T, N = 10) {
  const o = [0, R_E + P.alt, 0];
  let tmax = rsiFar(o, d, R_A);
  const tg = rsiNear(o, d, R_E); if (tg > 0) tmax = Math.min(tmax, tg);
  const ds = tmax / N;
  let sRs0 = 0, sRs1 = 0, sRs2 = 0, sMs0 = 0, sMs1 = 0, sMs2 = 0, sRm0 = 0, sRm1 = 0, sRm2 = 0, sMm0 = 0, sMm1 = 0, sMm2 = 0, m0 = 0, m1 = 0, m2 = 0, mm0 = 0, mm1 = 0, mm2 = 0;
  _od[0] = _od[1] = _od[2] = 0;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * ds;
    _p[0] = o[0] + d[0] * t; _p[1] = o[1] + d[1] * t; _p[2] = o[2] + d[2] * t;
    const h = Math.max(Math.sqrt(dot(_p, _p)) - R_E, 0);
    const dhr = Math.exp(-h / H_R) * ds, dhm = Math.exp(-h / H_M) * ds; _od[0] += dhr; _od[1] += dhm; _od[2] += ozoneDensity(h) * ds;
    lightDepth(_p, P.sunDir, _ls);
    if (_ls[0] >= 0) {
      _tmp[0] = _od[0] + _ls[0]; _tmp[1] = _od[1] + _ls[1]; _tmp[2] = _od[2] + _ls[2]; extinct(_tmp, P.betaM, _e);
      const a0 = Math.exp(-_e[0]), a1 = Math.exp(-_e[1]), a2 = Math.exp(-_e[2]);
      sRs0 += a0 * dhr; sRs1 += a1 * dhr; sRs2 += a2 * dhr; sMs0 += a0 * dhm; sMs1 += a1 * dhm; sMs2 += a2 * dhm;
      const b0 = Math.exp(-_e[0] * 0.3), b1 = Math.exp(-_e[1] * 0.3), b2 = Math.exp(-_e[2] * 0.3), mie = dhm * P.betaM * 0.5;
      m0 += b0 * (dhr * BETA_R[0] + mie); m1 += b1 * (dhr * BETA_R[1] + mie); m2 += b2 * (dhr * BETA_R[2] + mie);
    }
    if (P.moonE[0] > 0) {
      lightDepth(_p, P.moonDir, _lm);
      if (_lm[0] >= 0) {
        _tmp[0] = _od[0] + _lm[0]; _tmp[1] = _od[1] + _lm[1]; _tmp[2] = _od[2] + _lm[2]; extinct(_tmp, P.betaM, _e);
        const a0 = Math.exp(-_e[0]), a1 = Math.exp(-_e[1]), a2 = Math.exp(-_e[2]);
        sRm0 += a0 * dhr; sRm1 += a1 * dhr; sRm2 += a2 * dhr; sMm0 += a0 * dhm; sMm1 += a1 * dhm; sMm2 += a2 * dhm;
        const b0 = Math.exp(-_e[0] * 0.3), b1 = Math.exp(-_e[1] * 0.3), b2 = Math.exp(-_e[2] * 0.3), mie = dhm * P.betaM * 0.5;
        mm0 += b0 * (dhr * BETA_R[0] + mie); mm1 += b1 * (dhr * BETA_R[1] + mie); mm2 += b2 * (dhr * BETA_R[2] + mie);
      }
    }
  }
  extinct(_od, P.betaM, _e);
  if (T) { T[0] = Math.exp(-_e[0]); T[1] = Math.exp(-_e[1]); T[2] = Math.exp(-_e[2]); }
  const mus = dot(d, P.sunDir), mum = dot(d, P.moonDir);
  const prs = phaseR(mus), pms = phaseM(mus, P.g), prm = phaseR(mum), pmm = phaseM(mum, P.g * 0.85);
  const mk = P.msk / 12.566;
  out[0] = (P.sunE * (BETA_R[0] * prs * sRs0 + P.betaM * pms * sMs0) + P.moonE[0] * (BETA_R[0] * prm * sRm0 + P.betaM * pmm * sMm0)) * P.ms + (P.sunE * m0 + P.moonE[0] * mm0) * mk;
  out[1] = (P.sunE * (BETA_R[1] * prs * sRs1 + P.betaM * pms * sMs1) + P.moonE[1] * (BETA_R[1] * prm * sRm1 + P.betaM * pmm * sMm1)) * P.ms + (P.sunE * m1 + P.moonE[1] * mm1) * mk;
  out[2] = (P.sunE * (BETA_R[2] * prs * sRs2 + P.betaM * pms * sMs2) + P.moonE[2] * (BETA_R[2] * prm * sRm2 + P.betaM * pmm * sMm2)) * P.ms + (P.sunE * m2 + P.moonE[2] * mm2) * mk;
  return out;
}

/** Transmittance from the observer to space along direction s (e.g. sun). Zero if the planet blocks it. */
export function transmittanceJS(s, P, out, alt = P.alt) {
  const o = [0, R_E + alt, 0];
  lightDepth(o, s, _ls, 8);
  if (_ls[0] < 0) { out[0] = out[1] = out[2] = 0; return out; }
  extinct(_ls, P.betaM, _e);
  out[0] = Math.exp(-_e[0]); out[1] = Math.exp(-_e[1]); out[2] = Math.exp(-_e[2]);
  return out;
}
