// Rain: one LineSegments draw call of streaks wrapped in a box around the camera (in front of it).
import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec3 aSeed;
attribute float aEnd;
uniform vec3 uCenter;
uniform vec3 uFall;      // fall vector per second (m/s), includes wind
uniform float uTime;
uniform vec3 uBox;       // half width, height, half depth
uniform float uLen;
varying float vAlpha;
void main() {
  vec3 b = vec3(aSeed.x * 2.0 - 1.0, 0.0, aSeed.z * 2.0 - 1.0) * uBox.xzz;
  float cycle = uBox.y / max(-uFall.y, 1.0);
  float ph = fract(aSeed.y + uTime / cycle);
  float y = uBox.y * (1.0 - ph);
  vec3 p = vec3(b.x + uFall.x * (uBox.y - y) / max(-uFall.y, 1.0), y, b.z + uFall.z * (uBox.y - y) / max(-uFall.y, 1.0));
  p += uCenter;
  if (aEnd > 0.5) p -= normalize(uFall) * uLen * (0.6 + 0.8 * aSeed.x);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  vAlpha = smoothstep(2.0, 12.0, dist) * (1.0 - smoothstep(uBox.x * 0.7, uBox.x * 1.3, dist));
  gl_Position = projectionMatrix * mv;
}
`;
const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Rain {
  constructor(rng, count = 5000) {
    const pos = new Float32Array(count * 2 * 3);
    const seed = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const sx = rng.next(), sy = rng.next(), sz = rng.next();
      for (let k = 0; k < 2; k++) {
        const v = i * 2 + k;
        seed[v * 3] = sx; seed[v * 3 + 1] = sy; seed[v * 3 + 2] = sz; end[v] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false,
      uniforms: {
        uCenter: { value: new THREE.Vector3() }, uFall: { value: new THREE.Vector3(0, -11, 0) }, uTime: { value: 0 },
        uBox: { value: new THREE.Vector3(90, 70, 90) }, uLen: { value: 1.6 }, uColor: { value: new THREE.Color(0.6, 0.65, 0.7) }, uOpacity: { value: 0.28 },
      },
    });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.name = 'env-rain';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 900;
    this.mesh.visible = false;
    this._fwd = new THREE.Vector3();
  }
  /** intensity 0..1 ; ambient = sky radiance (linear) used to tint the streaks */
  update(camera, time, intensity, wind, ambient, exposure) {
    const u = this.mat.uniforms;
    this.mesh.visible = intensity > 0.01;
    if (!this.mesh.visible) return;
    camera.getWorldDirection(this._fwd);
    const box = u.uBox.value;
    // scale the box with camera height so rain is visible from overview too
    const s = THREE.MathUtils.clamp(camera.position.y / 60, 1, 8);
    box.set(90 * s, 70 * s, 90 * s);
    u.uLen.value = 1.6 * s;
    u.uCenter.value.copy(camera.position).addScaledVector(this._fwd, box.x * 0.6);
    u.uCenter.value.y = camera.position.y - box.y * 0.7;
    u.uFall.value.set(wind.x * 0.9, -11 - 2 * s, wind.y * 0.9);
    u.uTime.value = time;
    u.uOpacity.value = 0.32 * intensity;
    // streaks are lit by the sky: brightness ~ ambient, kept readable at night by exposure
    const lum = Math.max(ambient.r * 0.3 + ambient.g * 0.6 + ambient.b * 0.1, 0.002);
    const k = Math.max(lum * 2.5, 0.08 / Math.max(exposure, 0.2));
    u.uColor.value.setRGB(k * 0.95, k, k * 1.05);
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.parent?.remove(this.mesh); }
}
