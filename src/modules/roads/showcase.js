// Demo network for ?showcase=roads: 5×4 block grid of locals, a curved avenue crossing diagonally,
// a highway along the north edge with ramps, a 5-way junction, T-junctions, cul-de-sacs, an alley and a roundabout.
import * as THREE from 'three';

export function buildShowcase(ctx, api) {
  const xs = [-240, -144, -48, 48, 144, 240], zs = [-256, -128, 0, 128, 256];
  api.beginBatch();
  for (const z of zs) api.addRoad({ x: -240, z }, { x: 240, z }, 'local');
  for (const x of xs) api.addRoad({ x, z: -256 }, { x, z: 256 }, 'local');
  // avenue crossing the grid diagonally: straight inside the grid (every crossing lands mid-block, 48/64 m from the
  // crossroads — a curved diagonal cannot clear a 96×128 grid), with a sweeping curved approach outside the SW boundary
  // whose end tangent matches the diagonal so the boundary node is a clean crossroads.
  api.addRoad({ x: -192, z: -256 }, { x: 192, z: 256 }, 'avenue');
  api.addRoad({ x: -352, z: -304 }, { x: -192, z: -256 }, 'avenue', { via: { x: -228, z: -304 }, snap: false });
  // highway along the north edge
  api.addRoad({ x: -460, z: 336 }, { x: 460, z: 336 }, 'highway');
  // Right-hand traffic: the carriageway on the grid side of the highway flows west (a→b is +x, right side is +z).
  // on-ramp: avenue end → westbound carriageway (heads west at the merge); off-ramp: westbound → NE corner; on-ramp at the NW corner.
  api.addRoad({ x: 192, z: 256 }, { x: 40, z: 336 }, 'local', { via: { x: 140, z: 300 }, oneWay: true, snap: false });
  api.addRoad({ x: 340, z: 336 }, { x: 240, z: 256 }, 'local', { via: { x: 280, z: 300 }, oneWay: true, snap: false });
  api.addRoad({ x: -240, z: 256 }, { x: -400, z: 336 }, 'local', { via: { x: -330, z: 296 }, oneWay: true, snap: false });
  // 5-way junction at (144,0) with a diagonal ending in a cul-de-sac
  api.addRoad({ x: 144, z: 0 }, { x: 208, z: -72 }, 'local');
  // T-junction on the south boundary + cul-de-sac stub
  api.addRoad({ x: 0, z: -256 }, { x: 0, z: -336 }, 'local');
  // alley through a block (T-junctions at both ends)
  api.addRoad({ x: 192, z: 0 }, { x: 192, z: 128 }, 'alley');
  api.endBatch();
  // roundabout replacing the (-144,128) crossroads
  api.addRoundabout(-144, 128, 30, 'local');

  ctx.rig.lookAt(new THREE.Vector3(150, 95, 150), new THREE.Vector3(10, 0, 10));
  const s = api.stats();
  ctx.log(`roads showcase: ${s.edges} edges, ${s.nodes} nodes, last rebuild ${s.lastRebuildMs} ms`);
}
