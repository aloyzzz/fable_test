// Custom passes for the effects module: depth-tracking RenderPass, sun-shaft (god rays) pass, and the final grade pass.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** RenderPass that remembers which composer buffer received the scene (so later passes can read its depth texture). */
export class TrackedRenderPass extends RenderPass {
  constructor(scene, camera) { super(scene, camera); this.lastTarget = null; }
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    this.lastTarget = this.renderToScreen ? null : writeBuffer;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

const QUAD_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const MASK_FS = /* glsl */`
  uniform sampler2D tDepth;
  uniform vec2 sunUv;
  uniform float cameraNear, cameraFar, aspect, falloff;
  varying vec2 vUv;
  float linearize(float d) { float z = d * 2.0 - 1.0; return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear)); }
  void main() {
    float d = texture2D(tDepth, vUv).x;
    float lin = linearize(d);
    // "sky" = anything at least ~40% of the far plane away (sky domes sit near the far plane, geometry does not)
    float sky = smoothstep(cameraFar * 0.35, cameraFar * 0.6, lin);
    vec2 dv = (vUv - sunUv) * vec2(aspect, 1.0);
    float r = length(dv);
    float fall = 1.0 - smoothstep(0.0, falloff, r);
    fall *= fall;
    gl_FragColor = vec4(vec3(sky * fall), 1.0);
  }`;

const RADIAL_FS = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 sunUv;
  uniform float density, decay, weight;
  varying vec2 vUv;
  #define N 16
  void main() {
    vec2 uv = vUv;
    vec2 delta = (sunUv - uv) * density / float(N);
    float illum = 1.0; vec3 col = vec3(0.0);
    for (int i = 0; i < N; i++) { uv += delta; col += texture2D(tDiffuse, uv).rgb * illum * weight; illum *= decay; }
    gl_FragColor = vec4(col, 1.0);
  }`;

const COMP_FS = /* glsl */`
  uniform sampler2D tRays;
  uniform vec3 color;
  uniform float strength;
  varying vec2 vUv;
  void main() { float r = texture2D(tRays, vUv).r; gl_FragColor = vec4(color * r * strength, 1.0); }`;

/**
 * Cheap screen-space sun shafts: sky mask (from the scene depth) × radial falloff around the sun, two radial blurs
 * at quarter resolution, additive composite into the HDR buffer (before tone mapping). 4 draw calls, 0 when the sun
 * is off-screen / below the horizon.
 */
export class RaysPass extends Pass {
  constructor(renderPass, camera, width, height, scale = 0.25) {
    super();
    this.renderPass = renderPass; this.camera = camera;
    this.needsSwap = false; this.scale = scale;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.color = new THREE.Color(1.0, 0.86, 0.62);
    this.intensity = 0.55;          // user parameter
    this.daylight = 1;              // 0..1, set by module (weather / hour)
    this.strength = 0;              // computed per frame
    this.sunScreen = new THREE.Vector2(0.5, 0.5);
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, opts); this.rtA.texture.name = 'Rays.a';
    this.rtB = new THREE.WebGLRenderTarget(4, 4, opts); this.rtB.texture.name = 'Rays.b';
    const mk = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VS, fragmentShader: fs, depthTest: false, depthWrite: false, ...extra });
    this.maskMat = mk(MASK_FS, { tDepth: { value: null }, sunUv: { value: new THREE.Vector2() }, cameraNear: { value: 1 }, cameraFar: { value: 1000 }, aspect: { value: 1 }, falloff: { value: 1.25 } });
    this.blurMat = mk(RADIAL_FS, { tDiffuse: { value: null }, sunUv: { value: new THREE.Vector2() }, density: { value: 0.5 }, decay: { value: 0.96 }, weight: { value: 1 / 16 } });
    this.compMat = mk(COMP_FS, { tRays: { value: null }, color: { value: new THREE.Color() }, strength: { value: 0 } }, { blending: THREE.AdditiveBlending, transparent: true });
    this._quad = new FullScreenQuad(null);
    this._v = new THREE.Vector3(); this._fwd = new THREE.Vector3(); this._clear = new THREE.Color();
    this.setSize(width, height);
  }
  setSize(w, h) {
    const sw = Math.max(2, Math.round(w * this.scale)), sh = Math.max(2, Math.round(h * this.scale));
    this.rtA.setSize(sw, sh); this.rtB.setSize(sw, sh);
    this.maskMat.uniforms.aspect.value = w / h;
  }
  dispose() { this.rtA.dispose(); this.rtB.dispose(); this.maskMat.dispose(); this.blurMat.dispose(); this.compMat.dispose(); this._quad.dispose(); }
  /** Computes this frame's shaft strength (0 → the pass draws nothing). */
  _computeStrength() {
    const cam = this.camera;
    cam.getWorldDirection(this._fwd);
    const facing = this._fwd.dot(this.sunDir);
    if (facing < 0.05) return 0;
    this._v.copy(this.sunDir).multiplyScalar(2000).add(cam.position).project(cam);
    const x = this._v.x, y = this._v.y;
    this.sunScreen.set(x * 0.5 + 0.5, y * 0.5 + 0.5);
    const off = Math.max(Math.abs(x), Math.abs(y));
    const screenFade = 1 - smoothstep(1.4, 2.4, off);
    const elev = smoothstep(-0.02, 0.18, this.sunDir.y);
    return this.intensity * this.daylight * screenFade * elev;
  }
  render(renderer, writeBuffer, readBuffer) {
    const depthTex = this.renderPass.lastTarget?.depthTexture;
    this.strength = depthTex ? this._computeStrength() : 0;
    if (this.strength < 0.004) return;
    const cam = this.camera;
    renderer.getClearColor(this._clear); const oldAlpha = renderer.getClearAlpha(); const oldAuto = renderer.autoClear;
    renderer.autoClear = false;
    // 1) mask
    const mu = this.maskMat.uniforms;
    mu.tDepth.value = depthTex; mu.sunUv.value.copy(this.sunScreen); mu.cameraNear.value = cam.near; mu.cameraFar.value = cam.far;
    this._quad.material = this.maskMat; renderer.setRenderTarget(this.rtA); this._quad.render(renderer);
    // 2) two radial blurs (A→B, B→A)
    const bu = this.blurMat.uniforms; bu.sunUv.value.copy(this.sunScreen);
    this._quad.material = this.blurMat;
    bu.tDiffuse.value = this.rtA.texture; bu.density.value = 0.35; bu.decay.value = 0.97; renderer.setRenderTarget(this.rtB); this._quad.render(renderer);
    bu.tDiffuse.value = this.rtB.texture; bu.density.value = 0.85; bu.decay.value = 0.95; renderer.setRenderTarget(this.rtA); this._quad.render(renderer);
    // 3) additive composite into the current HDR buffer
    const cu = this.compMat.uniforms; cu.tRays.value = this.rtA.texture; cu.color.value.copy(this.color); cu.strength.value = this.strength;
    this._quad.material = this.compMat; renderer.setRenderTarget(this.renderToScreen ? null : readBuffer); this._quad.render(renderer);
    renderer.autoClear = oldAuto; renderer.setClearColor(this._clear, oldAlpha);
  }
}

/** Final pass (runs in display/sRGB space after OutputPass + AA): chromatic aberration, lift/gamma/gain grade, tint, vignette, grain. */
export const GradeShader = {
  name: 'CityGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1920, 1080) },
    vignette: { value: 0.28 },
    aberration: { value: 0.0012 },
    grain: { value: 0.025 },
    grainSeed: { value: 17.3 },
    lift: { value: new THREE.Vector3(0, 0, 0) },
    gamma: { value: new THREE.Vector3(1, 1, 1) },
    gain: { value: new THREE.Vector3(1, 1, 1) },
    saturation: { value: 1.0 },
    gradeMix: { value: 1.0 },
  },
  vertexShader: QUAD_VS,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float vignette, aberration, grain, grainSeed, saturation, gradeMix;
    uniform vec3 lift, gamma, gain;
    varying vec2 vUv;
    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * (r2 * 4.0) * aberration;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col = clamp(col, 0.0, 1.0);
      // lift / gamma / gain (display space), blended by gradeMix
      vec3 graded = pow(max(vec3(0.0), gain * (col + lift * (1.0 - col))), 1.0 / gamma);
      float lg = dot(graded, vec3(0.2126, 0.7152, 0.0722));
      graded = mix(vec3(lg), graded, saturation);
      col = mix(col, graded, gradeMix);
      // vignette (elliptical, gentle)
      float d = length(c * vec2(1.0, 0.82));
      col *= 1.0 - vignette * smoothstep(0.38, 0.9, d);
      // film grain: hidden in bright areas (sky) and shadows, deterministic seed
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float n = hash12(gl_FragCoord.xy + grainSeed) - 0.5;
      col += n * grain * (1.0 - l) * l * 4.0 * 0.5;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};
