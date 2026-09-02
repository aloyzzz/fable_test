// Chunked terrain mesh: 4×4 chunks of 1024 m at the native 8 m heightfield spacing (129×129 verts, 32k tris each),
// so the whole map is ≤ 16 draw calls, 524k triangles, no LOD popping and no cracks (shared edge samples).
// Plus a coarse 32 m proxy (1 draw call) used only by the water's planar reflection.
import * as THREE from 'three';

export const CHUNKS = 4;

function computeNormal(heights, res, ix, iz, step, out) {
  const xl = Math.max(0, ix - 1), xr = Math.min(res - 1, ix + 1), zd = Math.max(0, iz - 1), zu = Math.min(res - 1, iz + 1);
  const hl = heights[iz * res + xl], hr = heights[iz * res + xr];
  const hd = heights[zd * res + ix], hu = heights[zu * res + ix];
  const dx = (xr - xl) * step, dz = (zu - zd) * step;
  let nx = (hl - hr) / dx * 2, ny = 2, nz = (hd - hu) / dz * 2;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  out[0] = nx / len; out[1] = ny / len; out[2] = nz / len;
}

/** Build a grid geometry over heightfield sample range [x0..x1] × [z0..z1] (inclusive) with stride `skip`. */
export function buildGridGeometry(heights, res, size, x0, z0, x1, z1, skip = 1) {
  const step = size / (res - 1);
  const nx = Math.floor((x1 - x0) / skip) + 1, nz = Math.floor((z1 - z0) / skip) + 1;
  const pos = new Float32Array(nx * nz * 3), nrm = new Float32Array(nx * nz * 3);
  const n = [0, 0, 0];
  let k = 0;
  for (let j = 0; j < nz; j++) {
    const iz = z0 + j * skip;
    for (let i = 0; i < nx; i++) {
      const ix = x0 + i * skip;
      pos[k] = -size / 2 + ix * step; pos[k + 1] = heights[iz * res + ix]; pos[k + 2] = -size / 2 + iz * step;
      computeNormal(heights, res, ix, iz, step * skip, n);
      nrm[k] = n[0]; nrm[k + 1] = n[1]; nrm[k + 2] = n[2];
      k += 3;
    }
  }
  const idx = new (nx * nz > 65535 ? Uint32Array : Uint16Array)((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    // alternate the diagonal so long slopes don't show a directional bias
    if ((i + j) & 1) { idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
    else { idx[q++] = a; idx[q++] = c; idx[q++] = d; idx[q++] = a; idx[q++] = d; idx[q++] = b; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  g.userData.range = { x0, z0, x1, z1, skip, nx, nz };
  return g;
}

/** Update the heights/normals of an existing grid geometry in place (after edits). */
export function refreshGridGeometry(g, heights, res, size) {
  const { x0, z0, skip, nx, nz } = g.userData.range;
  const step = size / (res - 1);
  const pos = g.attributes.position.array, nrm = g.attributes.normal.array;
  const n = [0, 0, 0];
  let k = 0;
  for (let j = 0; j < nz; j++) {
    const iz = z0 + j * skip;
    for (let i = 0; i < nx; i++) {
      const ix = x0 + i * skip;
      pos[k + 1] = heights[iz * res + ix];
      computeNormal(heights, res, ix, iz, step * skip, n);
      nrm[k] = n[0]; nrm[k + 1] = n[1]; nrm[k + 2] = n[2];
      k += 3;
    }
  }
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  g.computeBoundingSphere(); g.computeBoundingBox();
}

export class TerrainMesh {
  constructor(world, material) {
    this.world = world; this.material = material;
    this.group = new THREE.Group(); this.group.name = 'terrain';
    this.chunks = [];
    const { res, heights } = world.terrain, size = world.size;
    const per = (res - 1) / CHUNKS;
    for (let cz = 0; cz < CHUNKS; cz++) for (let cx = 0; cx < CHUNKS; cx++) {
      const g = buildGridGeometry(heights, res, size, cx * per, cz * per, (cx + 1) * per, (cz + 1) * per, 1);
      const m = new THREE.Mesh(g, material);
      m.name = `terrain-chunk-${cx}-${cz}`;
      m.receiveShadow = true; m.castShadow = true;
      m.matrixAutoUpdate = false;
      this.chunks.push(m); this.group.add(m);
    }
    // coarse proxy for the planar reflection only (layer-restricted)
    const pg = buildGridGeometry(heights, res, size, 0, 0, res - 1, res - 1, 4);
    this.proxy = new THREE.Mesh(pg, material);
    this.proxy.name = 'terrain-reflection-proxy';
    this.proxy.castShadow = false; this.proxy.receiveShadow = false;
    this.proxy.matrixAutoUpdate = false;
    this.group.add(this.proxy);
  }
  /** Rebuild the chunks whose sample range intersects [ix0..ix1]×[iz0..iz1] (heightfield indices). */
  refreshRange(ix0, iz0, ix1, iz1) {
    const { res, heights } = this.world.terrain, size = this.world.size;
    let n = 0;
    for (const m of this.chunks) {
      const r = m.geometry.userData.range;
      if (ix1 < r.x0 || ix0 > r.x1 || iz1 < r.z0 || iz0 > r.z1) continue;
      refreshGridGeometry(m.geometry, heights, res, size); n++;
    }
    refreshGridGeometry(this.proxy.geometry, heights, res, size);
    return n;
  }
  dispose() { for (const m of this.chunks) m.geometry.dispose(); this.proxy.geometry.dispose(); this.group.parent?.remove(this.group); }
}
