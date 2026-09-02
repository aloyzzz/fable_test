// Terrain splat material: MeshStandardMaterial + onBeforeCompile. Keeps three's full PBR lighting/shadows/IBL
// and replaces albedo / normal / roughness / AO with a 6-layer height-blended splat driven by slope, height
// and noise. Two tiling scales (detail 5 m, far 41 m) cross-fade with distance; macro noise breaks tiling.
import * as THREE from 'three';
import { buildLayerArrays, buildNoiseTexture } from './textures.js';

const L = { grass: 0, grassDry: 1, dirt: 2, rock: 3, sand: 4, snow: 5 };

const PARS = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray tAlb;
uniform sampler2DArray tNrm;
uniform sampler2DArray tOrm;
uniform sampler2D tNoise;
uniform float uWater;
uniform float uSnowLine;
uniform float uDetailScale;
uniform float uFarScale;
varying vec3 vWPos;
varying vec3 vWNormal;

vec3 tsNormal(vec2 uv, float layer) { return texture(tNrm, vec3(uv, layer)).xyz * 2.0 - 1.0; }

// planar (XZ) sample of one layer at two scales. Returns albedo (rgb) + height (a); writes normal + orm.
vec4 sampleFlat(float layer, vec2 p, float kFar, out vec3 n, out vec2 orm) {
  vec2 uvD = p * uDetailScale;
  vec2 uvF = mat2(0.86, -0.5, 0.5, 0.86) * p * uFarScale;
  vec4 aD = texture(tAlb, vec3(uvD, layer));
  vec4 aF = texture(tAlb, vec3(uvF, layer));
  vec3 nD = tsNormal(uvD, layer);
  vec3 nF = tsNormal(uvF, layer);
  vec4 oD = texture(tOrm, vec3(uvD, layer));
  vec4 oF = texture(tOrm, vec3(uvF, layer));
  // far-scale albedo modulates the detail (breaks tiling at overview), and replaces it with distance
  vec3 col = mix(aD.rgb * (0.85 + 0.3 * aF.a), aF.rgb * (0.85 + 0.3 * aD.a), kFar);
  n = normalize(vec3(nD.xy * (1.0 - 0.8 * kFar) + nF.xy * 0.6, nD.z));
  orm = mix(oD.rg, oF.rg, kFar);
  return vec4(col, mix(aD.a, aF.a, kFar * 0.5));
}

// triplanar sample of the rock layer (strata stay horizontal on cliffs)
vec4 sampleRock(vec3 N, float kFar, out vec3 n, out vec2 orm) {
  float layer = 3.0;
  vec3 w = abs(N); w = pow(w, vec3(4.0)); w /= (w.x + w.y + w.z);
  float s = uDetailScale * 0.7;
  vec2 uvX = vWPos.zy * s, uvY = vWPos.xz * s, uvZ = vWPos.xy * s;
  vec2 fX = vWPos.zy * uFarScale, fY = vWPos.xz * uFarScale, fZ = vWPos.xy * uFarScale;
  vec4 aX = mix(texture(tAlb, vec3(uvX, layer)), texture(tAlb, vec3(fX, layer)), kFar);
  vec4 aY = mix(texture(tAlb, vec3(uvY, layer)), texture(tAlb, vec3(fY, layer)), kFar);
  vec4 aZ = mix(texture(tAlb, vec3(uvZ, layer)), texture(tAlb, vec3(fZ, layer)), kFar);
  vec3 nX = tsNormal(uvX, layer), nY = tsNormal(uvY, layer), nZ = tsNormal(uvZ, layer);
  vec2 oX = texture(tOrm, vec3(uvX, layer)).rg, oY = texture(tOrm, vec3(uvY, layer)).rg, oZ = texture(tOrm, vec3(uvZ, layer)).rg;
  // whiteout-style triplanar normal blend, in world space
  nX = vec3(nX.xy + N.zy, abs(nX.z) * N.x);
  nY = vec3(nY.xy + N.xz, abs(nY.z) * N.y);
  nZ = vec3(nZ.xy + N.xy, abs(nZ.z) * N.z);
  vec3 nw = normalize(nX.zyx * w.x + nY.xzy * w.y + nZ.xyz * w.z);
  n = nw; // world-space already
  orm = oX * w.x + oY * w.y + oZ * w.z;
  return aX * w.x + aY * w.y + aZ * w.z;
}
`;

const SPLAT = /* glsl */`
{
  vec3 N = normalize(vWNormal);
  float h = vWPos.y;
  float slope = 1.0 - N.y;                              // 0 flat .. 1 vertical
  float dist = length(vViewPosition);
  float kFar = smoothstep(45.0, 420.0, dist);
  vec4 nzA = texture2D(tNoise, vWPos.xz / 610.0 + 0.17);   // macro
  vec4 nzB = texture2D(tNoise, vWPos.xz / 131.0 + 0.61);   // mid
  vec4 nzC = texture2D(tNoise, vWPos.xz / 23.0 + 0.29);    // fine breakup
  float macro = nzA.r, mid = nzB.g, fine = nzC.a;

  // ---- layer weights ----
  float w[6];
  float rockT = 0.21 + 0.10 * (mid - 0.5) + 0.04 * (fine - 0.5);
  float rock = smoothstep(rockT - 0.05, rockT + 0.06, slope);
  rock = max(rock, smoothstep(120.0, 200.0, h) * smoothstep(0.10, 0.22, slope + 0.1 * (nzB.b - 0.5)));
  float sand = smoothstep(uWater + 3.2 + 2.5 * mid, uWater + 0.6, h) * (1.0 - smoothstep(0.18, 0.34, slope));
  float dirt = smoothstep(0.11, 0.22, slope + 0.06 * (fine - 0.5)) * 0.85;
  dirt = max(dirt, smoothstep(0.72, 0.86, nzB.b + 0.15 * (fine - 0.5)) * 0.7);
  dirt = max(dirt, smoothstep(uWater + 6.0 + 3.0 * mid, uWater + 2.5, h) * 0.6);
  float snow = smoothstep(uSnowLine - 12.0 + 24.0 * mid, uSnowLine + 12.0 + 24.0 * mid, h) * (1.0 - smoothstep(0.35, 0.6, slope));
  float dry = smoothstep(0.42, 0.80, macro + 0.35 * (mid - 0.5) + 0.12 * (fine - 0.5));
  dry = max(dry, smoothstep(0.12, 0.24, slope) * 0.6);
  // priority: snow > rock > sand > dirt > grass
  float rem = 1.0;
  w[5] = snow * rem; rem -= w[5];
  w[3] = rock * rem; rem -= w[3];
  w[4] = sand * rem; rem -= w[4];
  w[2] = dirt * rem; rem -= w[2];
  w[1] = dry * rem;  rem -= w[1];
  w[0] = rem;

  // ---- sample active layers ----
  vec4 a[6]; vec3 n[6]; vec2 o[6];
  for (int i = 0; i < 6; i++) { a[i] = vec4(0.0); n[i] = vec3(0.0, 0.0, 1.0); o[i] = vec2(1.0, 0.9); }
  for (int i = 0; i < 6; i++) {
    if (w[i] > 0.004) {
      if (i == 3) a[i] = sampleRock(N, kFar, n[i], o[i]);
      else a[i] = sampleFlat(float(i), vWPos.xz, kFar, n[i], o[i]);
    } else { w[i] = 0.0; }
  }
  // ---- height-based blend ----
  float hk = mix(0.30, 0.10, kFar);
  float b[6]; float ma = 0.0;
  for (int i = 0; i < 6; i++) { b[i] = (w[i] > 0.0) ? w[i] + a[i].a * hk : -1.0; ma = max(ma, b[i]); }
  ma -= mix(0.30, 0.40, kFar);
  float bs = 0.0;
  vec3 alb = vec3(0.0); vec3 nTS = vec3(0.0); vec3 nRock = vec3(0.0); vec2 orm = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    float bi = max(b[i] - ma, 0.0) * w[i];
    bs += bi;
    alb += a[i].rgb * bi; orm += o[i] * bi;
    if (i == 3) nRock += n[i] * bi; else nTS += n[i] * bi;
  }
  float inv = 1.0 / max(bs, 1e-4);
  alb *= inv; orm *= inv; nTS *= inv; nRock *= inv;

  // ---- macro colour variation (breaks tiling at overview): tint by 2 large noises ----
  vec4 nzD = texture2D(tNoise, vWPos.xz / 1700.0 + 0.43);
  float grassy = w[0] + w[1];
  vec3 tint = mix(vec3(0.86, 0.88, 0.80), vec3(1.10, 1.06, 0.96), nzD.g);
  tint *= mix(0.90, 1.08, nzA.b);
  alb *= mix(vec3(1.0), tint, 0.45 + 0.45 * grassy);
  // damp zones: darker, greener grass in low noisy patches and toward water
  float damp = smoothstep(0.52, 0.70, nzB.r + 0.2 * (fine - 0.5)) * grassy;
  damp = max(damp, smoothstep(uWater + 9.0, uWater + 2.5, h) * grassy * 0.7);
  alb *= mix(vec3(1.0), vec3(0.70, 0.78, 0.66), damp);
  orm.g = mix(orm.g, 0.95, damp * 0.5);
  // wet band right at the shoreline
  float wet = smoothstep(uWater + 1.8, uWater + 0.2, h) * (1.0 - w[5]);
  alb *= mix(1.0, 0.5, wet);
  orm.g = mix(orm.g, 0.28, wet);

  // ---- world-space normal from tangent-space detail (uv = world xz) ----
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = cross(T, N);
  float nStr = mix(1.0, 0.35, kFar);
  vec3 nFlat = normalize(T * nTS.x * nStr + B * nTS.y * nStr + N * max(nTS.z, 0.2));
  float rockShare = w[3];
  vec3 nWorld = normalize(mix(nFlat, normalize(mix(N, nRock, nStr)), rockShare));

  splatAlbedo = alb;
  splatRough = clamp(orm.g, 0.2, 1.0);
  splatAO = mix(1.0, orm.r, 0.7);
  splatNormalWS = nWorld;
}
`;

export function createTerrainMaterial(ctx, opts = {}) {
  const layers = buildLayerArrays(ctx.tex);
  const noise = buildNoiseTexture(ctx.tex);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0 });
  const uniforms = {
    tAlb: { value: layers.albedo }, tNrm: { value: layers.normal }, tOrm: { value: layers.orm }, tNoise: { value: noise },
    uWater: { value: opts.waterLevel ?? 0 }, uSnowLine: { value: opts.snowLine ?? 218 },
    uDetailScale: { value: 1 / 5.2 }, uFarScale: { value: 1 / 41.0 },
  };
  mat.userData.uniforms = uniforms;
  mat.customProgramCacheKey = () => 'terrain-splat-v1';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <map_fragment>', 'vec3 splatAlbedo; float splatRough; float splatAO; vec3 splatNormalWS;\n' + SPLAT + '\ndiffuseColor.rgb *= splatAlbedo;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = splatRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(splatNormalWS, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= splatAO;\nreflectedLight.indirectSpecular *= splatAO;');
  };
  return mat;
}
export { L as LAYER_INDEX };
