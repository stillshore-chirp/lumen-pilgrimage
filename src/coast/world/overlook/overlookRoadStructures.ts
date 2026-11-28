import * as THREE from 'three';
import { sampleCorridorRoad, type CorridorRoad, type OverlookCorridorPlan } from './overlookCorridorPlan';
import { createTunnelPortal, createTwinBoreLining } from './overlookTunnel';

function roadSlab(road: CorridorRoad): THREE.BufferGeometry {
  const w = road.plan.halfWidth;
  const section = [[-w, -3.52], [w, -3.52], [w, -0.44], [0, -0.02], [-w, -0.44]];
  const vertices: number[] = [];
  const point = (i: number, j: number) => {
    const frame = road.frames[i], [lateral, y] = section[j];
    return new THREE.Vector3(frame.x + frame.nx * lateral, frame.y + y, frame.z + frame.nz * lateral);
  };
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, outward: THREE.Vector3) => {
    if (b.clone().sub(a).cross(c.clone().sub(a)).dot(outward) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) vertices.push(p.x, p.y, p.z);
  };
  for (let i = 0; i + 1 < road.frames.length; i += 1) {
    const a = road.frames[i], b = road.frames[i + 1], nx = a.nx + b.nx, nz = a.nz + b.nz, norm = Math.hypot(nx, nz);
    for (let j = 0; j < section.length; j += 1) {
      const k = (j + 1) % section.length, dl = section[k][0] - section[j][0], dy = section[k][1] - section[j][1];
      const out = new THREE.Vector3(nx / norm * dy, -dl, nz / norm * dy);
      const p = point(i, j), q = point(i + 1, j), r = point(i + 1, k), s = point(i, k);
      triangle(p, q, r, out); triangle(p, r, s, out);
    }
  }
  const face = THREE.ShapeUtils.triangulateShape(section.map(([x, y]) => new THREE.Vector2(x, y)), []);
  for (const [i, near] of [[0, 1], [road.frames.length - 1, road.frames.length - 2]]) {
    const a = road.frames[i], b = road.frames[near], out = new THREE.Vector3(a.x - b.x, a.y - b.y, a.z - b.z);
    for (const [x, y, z] of face) triangle(point(i, x), point(i, y), point(i, z), out);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
}

export function createOverlookRoadStructures(plan: OverlookCorridorPlan) {
  const group = new THREE.Group(); group.name = 'Continuous road slabs, covered bores, and open portals';
  const concrete = new THREE.MeshStandardMaterial({ color: 0x938d7f, roughness: 0.92 });
  const liningMaterial = new THREE.MeshStandardMaterial({ color: 0x73746f, roughness: 0.95 });
  const geometries: THREE.BufferGeometry[] = [];
  const structures: { roadId: number; lining: readonly THREE.Mesh[]; portal: THREE.Mesh }[] = [];
  for (const road of plan.roads) {
    const geometry = roadSlab(road), slab = new THREE.Mesh(geometry, concrete);
    slab.name = `Road ${road.id} closed slab contacting pier tops`; group.add(slab); geometries.push(geometry);
  }
  for (const portal of plan.portals) {
    const road = plan.roads[portal.roadId];
    const frames = road.frames.filter(p => p.station < portal.frame.station).concat(portal.frame);
    const lining = createTwinBoreLining(frames, { halfWidth: portal.halfWidth, floorRecess: 0.04 });
    const bores = lining.bores.map((geometry, index) => {
      const mesh = new THREE.Mesh(geometry, liningMaterial); mesh.name = `Road ${road.id} lined bore ${index}`;
      group.add(mesh); geometries.push(geometry); return mesh;
    });
    const inside = sampleCorridorRoad(road, portal.frame.station - 1);
    const f = portal.frame;
    const geometry = createTunnelPortal(f, inside, { halfWidth: portal.halfWidth, floorRecess: 0.04 },
      { depth: portal.headwallDepth, outerHalfWidth: portal.outerHalfWidth, bottomHeight: -3.52, crest: portal.crest });
    const headwall = new THREE.Mesh(geometry, concrete); headwall.name = `Road ${road.id} two-hole portal headwall`;
    group.add(headwall); geometries.push(geometry); structures.push({ roadId: road.id, lining: bores, portal: headwall });
  }
  return { group, structures, dispose() { for (const geometry of geometries) geometry.dispose(); concrete.dispose(); liningMaterial.dispose(); } };
}
