// Sky rendering: (1) a small HDR equirect render target produced by the atmosphere ray-march (feeds the PMREM
// environment and is the base of the dome), (2) a camera-following dome that samples the equirect and adds the
// crisp per-pixel parts: sun disc + glare, moon, stars, milky way, and a sun-lit procedural cloud layer.
import * as THREE from 'three';
import { ATMOS_GLSL } from './atmosphere.js';

const EQUIRECT_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const EQUIRECT_FRAG = /* glsl */`
varying vec2 vUv;
${ATMOS_GLSL}
uniform float uCover;        // cloud cover 0..1 (overcast blending for IBL)
uniform vec3  uOvercast;     // uniform overcast radiance (computed on CPU)
uniform vec3  uSunT;         // sun transmittance at the observer
uniform vec3  uGround;       // ground radiance (CPU)
uniform vec3  uMoonT;
void main() {
  float phi = (vUv.x - 0.5) * 6.28318530718;
  float theta = (vUv.y - 0.5) * 3.14159265359;
  vec3 d = vec3(cos(theta) * cos(phi), sin(theta), cos(theta) * sin(phi));
  vec3 o = vec3(0.0, R_E + uAlt, 0.0);
  float tmax = rsiFar(o, d, R_A);
  float tg = rsiNear(o, d, R_E);
  bool ground = tg > 0.0;
  if (ground) tmax = min(tmax, tg);
  vec3 T; vec3 L = inscatter(o, d, tmax, T);
  if (ground) {
    L += T * uGround;
  } else {
    // soft sun + moon discs for IBL highlights (energy kept small: the DirectionalLight carries the real sun)
    float mus = dot(d, uSunDir);
    L += uSunT * uSunE * 12.0 * smoothstep(0.99955, 0.99985, mus);
    L += uSunT * uSunE * 0.08 * pow(max(mus, 0.0), 120.0);
    float mum = dot(d, uMoonDir);
    L += uMoonT * uMoonE * 30.0 * smoothstep(0.99975, 0.9999, mum);
  }
  // overcast: blend towards a flat grey dome (slightly darker at the horizon, brighter at zenith)
  float ov = uCover * uCover;
  vec3 overc = uOvercast * (0.75 + 0.25 * max(d.y, 0.0));
  if (ground) overc = uGround * 0.9;
  L = mix(L, overc, ov * 0.9);
  gl_FragColor = vec4(L, 1.0);
}
`;

const DOME_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const DOME_FRAG = /* glsl */`
varying vec3 vDir;
uniform sampler2D tSky;
uniform sampler2D tNoise;
uniform vec3  uSunDir;
uniform vec3  uSunT;         // transmittance towards sun
uniform float uSunE;
uniform vec3  uMoonDir;
uniform float uMoonVis;      // 0..1
uniform float uNight;        // 0..1 stars visibility
uniform float uStarGain;
uniform vec3  uCamPos;
uniform float uCover;
uniform float uCloudDark;
uniform vec3  uCloudLit;     // sun-lit cloud radiance
uniform vec3  uCloudAmb;     // ambient (sky) cloud radiance
uniform vec2  uCloudOff;     // drift (in noise uv units)
uniform float uCloudH;       // layer height above camera (m)
uniform float uCloudScale;   // metres per noise tile
uniform float uCloudFog;     // aerial perspective coefficient for clouds
uniform float uSkyLum;       // approx sky luminance near zenith (for star fade)

vec3 skyAt(vec3 d) {
  vec2 uv = vec2(atan(d.z, d.x) * 0.15915494309 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830988618 + 0.5);
  return texture2D(tSky, uv).rgb;
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

vec3 stars(vec3 d) {
  float theta = asin(clamp(d.y, -1.0, 1.0));
  float phi = atan(d.z, d.x);
  float ct = max(cos(theta), 0.05);
  vec2 cells = vec2(720.0, 360.0);
  vec2 uv = vec2(phi * 0.15915494309 + 0.5, theta * 0.31830988618 + 0.5) * cells;
  vec2 cell = floor(uv), f = uv - cell;
  vec3 col = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    float h = hash12(c);
    if (h < 0.80) continue;
    vec2 off = hash22(c + 17.0);
    vec2 dl = (f - vec2(float(i), float(j)) - off);
    dl.x *= ct;                                  // cells are narrower near the pole
    float b = (h - 0.80) / 0.20; b = b * b * b * 2.5 + 0.02;
    float r = 0.10 + 0.14 * b;
    float s = exp(-dot(dl, dl) / (r * r));
    float tint = hash12(c + 3.0);
    vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.86, 0.70), tint);
    col += sc * b * s;
  }
  // faint milky way band
  vec3 mwN = normalize(vec3(0.55, 0.35, 0.76));
  float band = exp(-pow(dot(d, mwN) * 5.0, 2.0));
  float n = texture2D(tNoise, vec2(phi * 0.6, theta * 1.2)).r;
  col += vec3(0.55, 0.62, 0.8) * band * (0.25 + 0.75 * n * n) * 0.06;
  return col;
}

float cloudNoise(vec2 uv) {
  float n = texture2D(tNoise, uv).r * 0.60
          + texture2D(tNoise, uv * 2.71 + vec2(0.31, 0.17) + uCloudOff * 0.35).r * 0.28
          + texture2D(tNoise, uv * 7.3 - uCloudOff * 0.2).r * 0.12;
  return n;
}
float cloudDensity(vec2 uv) {
  float n = cloudNoise(uv);
  float th = mix(0.72, 0.22, uCover);
  float w = mix(0.26, 0.34, uCover);
  return smoothstep(th, th + w, n);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyAt(d);
  float horizonMask = smoothstep(-0.012, 0.004, d.y);

  // --- stars & milky way ---
  if (uNight > 0.001) {
    float fade = uNight * clamp(1.0 - uSkyLum * 40.0, 0.0, 1.0) * smoothstep(-0.05, 0.12, d.y);
    col += stars(d) * uStarGain * fade;
  }

  // --- moon ---
  float mum = dot(d, uMoonDir);
  if (uMoonVis > 0.001 && mum > 0.9) {
    float ang = acos(clamp(mum, -1.0, 1.0));
    float R = 0.0068;
    if (ang < R * 1.05) {
      vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 my = cross(mx, uMoonDir);
      vec2 q = vec2(dot(d, mx), dot(d, my)) / R;
      float q2 = dot(q, q);
      float z = sqrt(max(0.0, 1.0 - q2));
      vec3 n = mx * q.x + my * q.y - uMoonDir * z;
      float ndl = max(dot(n, uSunDir), 0.0);
      float lit = smoothstep(-0.02, 0.15, ndl) * (0.35 + 0.65 * ndl);
      float mare = texture2D(tNoise, q * 0.35 + 0.5).r;
      float albedo = 0.10 * (0.7 + 0.6 * mare);
      float disc = 1.0 - smoothstep(0.92, 1.05, q2);
      vec3 moonCol = vec3(1.0, 0.97, 0.9) * albedo * uSunE * lit * 3.0;
      col = mix(col, moonCol, disc * uMoonVis);
    }
    col += vec3(0.6, 0.72, 1.0) * uSunE * 0.0025 * pow(max(mum, 0.0), 220.0) * uMoonVis;
  }

  // --- sun disc + glare ---
  float mus = dot(d, uSunDir);
  float sunAng = acos(clamp(mus, -1.0, 1.0));
  float disc = 1.0 - smoothstep(0.0044, 0.0050, sunAng);
  float glare = 0.00030 / (sunAng * sunAng + 0.00010) + 0.10 * exp(-sunAng * sunAng * 180.0);
  vec3 sunAdd = uSunT * uSunE * (disc * 40.0 + glare) * horizonMask;

  // --- clouds ---
  float cloudA = 0.0; vec3 cloudCol = vec3(0.0);
  if (uCover > 0.003 && d.y > 0.0) {
    float t = uCloudH / max(d.y, 0.02);
    vec2 p = (uCamPos.xz + d.xz * t) / uCloudScale + uCloudOff;
    float den = cloudDensity(p);
    if (den > 0.001) {
      vec2 toSun = uSunDir.xz / max(uSunDir.y, 0.18) * (380.0 / uCloudScale);
      float denS = cloudDensity(p + toSun);
      float denS2 = cloudDensity(p + toSun * 2.2);
      float shade = 1.0 - 0.55 * clamp((denS + denS2) * 0.7 - den * 0.25, 0.0, 1.0);
      shade *= 1.0 - 0.45 * den;
      float silver = pow(max(mus, 0.0), 10.0) * (1.0 - den) * den * 1.6;
      vec3 lit = uCloudLit * (shade + silver);
      vec3 amb = uCloudAmb * (1.0 - 0.55 * den * (0.5 + 0.5 * uCloudDark)) * (1.0 - uCloudDark * 0.35);
      cloudCol = amb + lit * (1.0 - uCloudDark * 0.6);
      float fogF = 1.0 - exp(-t * uCloudFog);
      vec3 horizonSky = skyAt(normalize(vec3(d.x, max(d.y, 0.02), d.z)));
      cloudCol = mix(cloudCol, horizonSky, fogF);
      cloudA = den * smoothstep(0.0, 0.05, d.y) * (1.0 - fogF * 0.6);
    }
  }
  col += sunAdd * (1.0 - cloudA * 0.85);
  col = mix(col, cloudCol, cloudA);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SkySystem {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    const w = opts.width || 512, h = opts.height || 256;
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    this.rt.texture.name = 'env-sky-equirect';
    this.rt.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.equirectMat = new THREE.ShaderMaterial({
      vertexShader: EQUIRECT_VERT, fragmentShader: EQUIRECT_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        uBetaM: { value: 21e-6 }, uMieG: { value: 0.76 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunE: { value: 3.5 },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonE: { value: new THREE.Vector3() }, uMS: { value: 1.8 }, uMSK: { value: 1.0 }, uAlt: { value: 40 },
        uCover: { value: 0 }, uOvercast: { value: new THREE.Vector3() }, uSunT: { value: new THREE.Vector3(1, 1, 1) },
        uGround: { value: new THREE.Vector3() }, uMoonT: { value: new THREE.Vector3() },
      },
    });
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.equirectMat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);

    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
      uniforms: {
        tSky: { value: this.rt.texture }, tNoise: { value: opts.noise || null },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunT: { value: new THREE.Vector3(1, 1, 1) }, uSunE: { value: 3.5 },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonVis: { value: 0 }, uNight: { value: 0 }, uStarGain: { value: 0.05 },
        uCamPos: { value: new THREE.Vector3() }, uCover: { value: 0 }, uCloudDark: { value: 0 },
        uCloudLit: { value: new THREE.Vector3() }, uCloudAmb: { value: new THREE.Vector3() }, uCloudOff: { value: new THREE.Vector2() },
        uCloudH: { value: 1500 }, uCloudScale: { value: 14000 }, uCloudFog: { value: 0.000035 }, uSkyLum: { value: 0 },
      },
    });
    this.domeMat.toneMapped = true;
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.domeMat);
    this.dome.name = 'env-sky-dome';
    this.dome.scale.setScalar(4500);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.castShadow = false; this.dome.receiveShadow = false;
    this.dome.matrixAutoUpdate = true;
  }
  /** Re-render the equirect. Uniforms must already be set (see index.js). */
  renderEquirect() {
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevTone = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.rt);
    r.render(this.quadScene, this.quadCam);
    r.setRenderTarget(prevRT);
    r.toneMapping = prevTone;
  }
  dispose() {
    this.rt.dispose(); this.equirectMat.dispose(); this.domeMat.dispose(); this.dome.geometry.dispose();
    this.dome.parent?.remove(this.dome);
  }
}
