// Water: one plane at waterLevel with a MeshStandardMaterial (so sun/IBL/fog come from scene lighting) extended
// via onBeforeCompile with: depth-based colour + opacity (heightfield texture), two scrolling procedural normal
// maps, shoreline foam, and a Fresnel-mixed planar reflection. The reflection is our own layer-restricted planar
// reflector: it renders only objects on REFLECT_LAYER (a coarse terrain proxy + anything sky-like) into a
// half-float target, so the extra cost is a handful of draw calls, not a second full scene pass.
import * as THREE from 'three';
import { buildWaterNormals, buildNoiseTexture } from './textures.js';

export const REFLECT_LAYER = 5;

const PARS = /* glsl */`
uniform sampler2D tHeight;
uniform sampler2D tWN1;
uniform sampler2D tWN2;
uniform sampler2D tNoise;
uniform sampler2D tRefl;
uniform mat4 uReflMatrix;
uniform float uTime;
uniform float uWater;
uniform float uHalf;
uniform float uRes;
uniform float uReflStrength;
varying vec3 vWPos;
float waterFresnel = 0.0;
vec3 waterRefl = vec3(0.0);
`;

const COLOR = /* glsl */`
{
  vec2 huv = ((vWPos.xz + uHalf) / (2.0 * uHalf / (uRes - 1.0)) + 0.5) / uRes;
  float th = texture2D(tHeight, huv).r;
  float depth = max(uWater - th, 0.0);
  float dist = length(vViewPosition);
  vec3 shallow = vec3(0.075, 0.36, 0.34);
  vec3 deep = vec3(0.012, 0.055, 0.12);
  float dk = 1.0 - exp(-depth * 0.24);
  vec3 col = mix(shallow, deep, dk);
  float alpha = mix(0.32, 0.94, 1.0 - exp(-depth * 0.32));
  // shoreline foam: noisy band that breathes with time
  float band = smoothstep(2.4, 0.0, depth);
  float fn = texture2D(tNoise, vWPos.xz / 16.0 + uTime * vec2(0.012, 0.008)).a;
  float fn2 = texture2D(tNoise, vWPos.xz / 47.0 - uTime * vec2(0.006, 0.01)).g;
  float pulse = 0.5 + 0.5 * sin(uTime * 0.9 + vWPos.x * 0.05 + vWPos.z * 0.07 + fn2 * 6.0);
  float foam = band * smoothstep(0.42, 0.72, fn * 0.7 + fn2 * 0.3 + 0.25 * band * pulse) * (1.0 - smoothstep(300.0, 1500.0, dist));
  foam += smoothstep(0.6, 0.0, depth) * 0.35 * (1.0 - smoothstep(300.0, 1500.0, dist));
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, vec3(0.78, 0.82, 0.82), foam * 0.85);
  alpha = max(alpha, foam * 0.9);
  diffuseColor.rgb = col;
  diffuseColor.a = alpha;
}
`;

const NORMAL = /* glsl */`
{
  float dist = length(vViewPosition);
  vec2 uv1 = vWPos.xz / 26.0 + uTime * vec2(0.021, 0.013);
  vec2 uv2 = vWPos.xz / 8.5 - uTime * vec2(0.017, 0.031);
  vec2 uv3 = vWPos.xz / 61.0 + uTime * vec2(-0.009, 0.006);
  vec3 n1 = texture2D(tWN1, uv1).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tWN2, uv2).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(tWN1, uv3).xyz * 2.0 - 1.0;
  float nStr = mix(0.55, 0.10, smoothstep(40.0, 900.0, dist));
  vec2 nxy = (n1.xy * 0.6 + n2.xy * 0.45 + n3.xy * 0.5) * nStr;
  vec3 nW = normalize(vec3(nxy.x, 1.0, nxy.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  // reflection lookup (projected, distorted by the wave normal)
  vec4 rc = uReflMatrix * vec4(vWPos, 1.0);
  vec2 ruv = rc.xy / max(rc.w, 1e-3);
  ruv += nxy * mix(0.06, 0.015, smoothstep(40.0, 900.0, dist));
  ruv = clamp(ruv, vec2(0.002), vec2(0.998));
  waterRefl = texture2D(tRefl, ruv).rgb * uReflStrength;
  vec3 V = normalize(vViewPosition);
  float NoV = clamp(dot(normal, V), 0.0, 1.0);
  waterFresnel = 0.025 + 0.975 * pow(1.0 - NoV, 5.0);
}
`;

const OUT = /* glsl */`
vec3 outgoingLight = totalDiffuse * (1.0 - waterFresnel) + waterRefl * waterFresnel + totalSpecular + totalEmissiveRadiance;
diffuseColor.a = mix(diffuseColor.a, 1.0, waterFresnel);
`;

export class Water {
  constructor(ctx, heightTex, waterLevel) {
    this.ctx = ctx;
    const { swell, ripple } = buildWaterNormals(ctx.tex);
    const noise = buildNoiseTexture(ctx.tex);
    const size = 4096;
    this.rtSize = this._pickSize();
    this.rt = new THREE.WebGLRenderTarget(this.rtSize.w, this.rtSize.h, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false });
    this.rt.texture.minFilter = THREE.LinearFilter; this.rt.texture.magFilter = THREE.LinearFilter;
    this.uniforms = {
      tHeight: { value: heightTex }, tWN1: { value: swell }, tWN2: { value: ripple }, tNoise: { value: noise },
      tRefl: { value: this.rt.texture }, uReflMatrix: { value: new THREE.Matrix4() }, uTime: { value: 0 },
      uWater: { value: waterLevel }, uHalf: { value: size / 2 }, uRes: { value: ctx.world.terrain.res }, uReflStrength: { value: 1.0 },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.09, metalness: 0.0, transparent: true, depthWrite: true });
    mat.customProgramCacheKey = () => 'terrain-water-v1';
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + PARS)
        .replace('#include <map_fragment>', COLOR)
        .replace('#include <normal_fragment_maps>', NORMAL)
        .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', OUT);
    };
    this.material = mat;
    const geo = new THREE.PlaneGeometry(size, size, 8, 8); geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'terrain-water';
    this.mesh.position.y = waterLevel;
    this.mesh.receiveShadow = true; this.mesh.castShadow = false;
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    // planar reflection state
    this.reflCam = new THREE.PerspectiveCamera();
    this.reflCam.layers.set(REFLECT_LAYER);
    this._tmp = { plane: new THREE.Plane(), n: new THREE.Vector3(), v: new THREE.Vector3(), t: new THREE.Vector3(), q: new THREE.Vector4(), rot: new THREE.Matrix4(), clip: new THREE.Vector4(), pos: new THREE.Vector3(), cpos: new THREE.Vector3() };
    this.mesh.onBeforeRender = (renderer, scene, camera) => this._renderReflection(renderer, scene, camera);
    this._onResize = () => this._resize();
    ctx.events.on('resize', this._onResize);
  }
  _pickSize() { const w = Math.max(256, Math.min(1024, Math.floor(window.innerWidth / 2))); const h = Math.max(144, Math.min(576, Math.floor(window.innerHeight / 2))); return { w, h }; }
  _resize() { const s = this._pickSize(); if (s.w !== this.rtSize.w || s.h !== this.rtSize.h) { this.rtSize = s; this.rt.setSize(s.w, s.h); } }
  setLevel(h) { this.mesh.position.y = h; this.uniforms.uWater.value = h; }
  update(dt) { this.uniforms.uTime.value += dt; }
  _renderReflection(renderer, scene, camera) {
    if (renderer.xr?.isPresenting) return;
    const T = this._tmp, rc = this.reflCam;
    const level = this.mesh.position.y;
    T.pos.set(0, level, 0); T.n.set(0, 1, 0);
    T.cpos.setFromMatrixPosition(camera.matrixWorld);
    if (T.cpos.y <= level + 0.5) return; // under water: keep last reflection
    T.rot.extractRotation(camera.matrixWorld);
    T.v.subVectors(T.cpos, T.pos); T.v.reflect(T.n).negate(); T.v.add(T.pos);
    T.t.set(0, 0, -1).applyMatrix4(T.rot).add(T.cpos);
    T.t.sub(T.pos); T.t.reflect(T.n).negate(); T.t.add(T.pos);
    rc.position.copy(T.v);
    rc.up.set(0, 1, 0).applyMatrix4(T.rot).reflect(T.n);
    rc.lookAt(T.t);
    rc.near = camera.near; rc.far = camera.far;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(camera.projectionMatrix);
    // texture matrix
    const M = this.uniforms.uReflMatrix.value;
    M.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    M.multiply(rc.projectionMatrix); M.multiply(rc.matrixWorldInverse);
    // oblique near plane so geometry below the water is clipped
    T.plane.setFromNormalAndCoplanarPoint(T.n, T.pos); T.plane.applyMatrix4(rc.matrixWorldInverse);
    T.clip.set(T.plane.normal.x, T.plane.normal.y, T.plane.normal.z, T.plane.constant);
    const p = rc.projectionMatrix, q = T.q;
    q.x = (Math.sign(T.clip.x) + p.elements[8]) / p.elements[0];
    q.y = (Math.sign(T.clip.y) + p.elements[9]) / p.elements[5];
    q.z = -1.0; q.w = (1.0 + p.elements[10]) / p.elements[14];
    T.clip.multiplyScalar(2.0 / T.clip.dot(q));
    p.elements[2] = T.clip.x; p.elements[6] = T.clip.y; p.elements[10] = T.clip.z + 1.0; p.elements[14] = T.clip.w;
    // render, preserving renderer.info totals (a nested render() resets the counters)
    const info = renderer.info;
    const calls = info.render.calls, tris = info.render.triangles, lines = info.render.lines, points = info.render.points;
    const prevRT = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled, prevShadow = renderer.shadowMap.autoUpdate, prevTone = renderer.toneMapping;
    renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
    this.mesh.visible = false;
    renderer.setRenderTarget(this.rt);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, rc);
    this.mesh.visible = true;
    renderer.xr.enabled = prevXr; renderer.shadowMap.autoUpdate = prevShadow; renderer.toneMapping = prevTone;
    renderer.setRenderTarget(prevRT);
    info.render.calls += calls; info.render.triangles += tris; info.render.lines += lines; info.render.points += points;
  }
  dispose() {
    this.ctx.events.off('resize', this._onResize);
    this.rt.dispose(); this.material.dispose(); this.mesh.geometry.dispose();
  }
}
