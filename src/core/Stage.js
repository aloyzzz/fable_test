// Fallback staging helpers for showcases: used only if a module's showcaseDeps (e.g. environment) failed/missing.
import * as THREE from 'three';
export class Stage {
  constructor(scene, tex) { this.scene = scene; this.tex = tex; this.objects = []; }
  ground(size = 600) {
    const g = new THREE.PlaneGeometry(size, size); g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0x556644, roughness: 0.95 });
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.name = 'stage-ground';
    this.scene.add(mesh); this.objects.push(mesh); return mesh;
  }
  light() {
    const sun = new THREE.DirectionalLight(0xfff2e0, 3); sun.position.set(300, 400, 200); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -300; sun.shadow.camera.right = 300; sun.shadow.camera.top = 300; sun.shadow.camera.bottom = -300; sun.shadow.camera.far = 1500;
    const hemi = new THREE.HemisphereLight(0x9fc5ff, 0x55432a, 1.2);
    this.scene.add(sun, hemi); this.objects.push(sun, hemi);
    this.scene.background = new THREE.Color(0x8fb6e6);
    return { sun, hemi };
  }
  clear() { for (const o of this.objects) o.parent?.remove(o); this.objects.length = 0; }
}
