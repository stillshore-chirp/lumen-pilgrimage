import * as THREE from 'three';
import { OverlookModel, overlookFinishes, seededDetail, type OverlookFinishes } from './overlookModel';
import { addOverlookPavilion } from './overlookPavilion';
import { DECK_FRONT, DECK_LEVEL, DECK_SIDE } from './overlookTerrain';
import { addOverlookUpperDeck } from './overlookUpperDeck';

const benchLocations = [[-22.5, -10.2], [22.5, -10.2], [-29.2, 4.7], [29.2, 4.7]] as const;
const viewerLocations = [[-19.3, -21.17, 0.14], [18.7, -21.17, -0.56]] as const;
const wallLamps = [
  ...[-31, -23, -15, -5, 3, 11, 21, 31].map(x => ({ x, z: DECK_FRONT, yaw: 0 })),
  { x: -DECK_SIDE, z: -19.4, yaw: Math.PI / 2 },
  { x: DECK_SIDE, z: -19.4, yaw: -Math.PI / 2 },
];

export const OVERLOOK_DECK_OBSTACLES = [
  ...benchLocations.map(([x, z]) => ({ minX: x - 1.85, maxX: x + 1.85, minZ: z - 0.52, maxZ: z + 0.62 })),
  ...viewerLocations.map(([x, z]) => ({ minX: x - 0.46, maxX: x + 0.46, minZ: z - 0.46, maxZ: z + 0.46 })),
] as const;

type SlabField = { minX: number; maxX: number; minZ: number; maxZ: number; seamX: number; seamZ: number; color: number };

const slabFields: SlabField[] = [
  { minX: -34.52, maxX: 34.52, minZ: -23.53, maxZ: -22.74, seamX: 1.38, seamZ: 0.79, color: 0xbab3a1 },
  { minX: -34.52, maxX: 34.52, minZ: -22.74, maxZ: -22.56, seamX: 1.38, seamZ: 0.18, color: 0x888b8a },
  { minX: -34.52, maxX: -32.95, minZ: -22.56, maxZ: 31.03, seamX: 1.57, seamZ: 1.23, color: 0xbab3a1 },
  { minX: 32.95, maxX: 34.52, minZ: -22.56, maxZ: 31.03, seamX: 1.57, seamZ: 1.23, color: 0xbab3a1 },
  { minX: -32.95, maxX: 32.95, minZ: -22.56, maxZ: 8.38, seamX: 1.74, seamZ: 1.18, color: 0xc7b9a0 },
  { minX: -32.95, maxX: -24.00, minZ: 8.38, maxZ: 31.03, seamX: 1.74, seamZ: 1.18, color: 0xc7b9a0 },
  { minX: 24.00, maxX: 32.95, minZ: 8.38, maxZ: 31.03, seamX: 1.74, seamZ: 1.18, color: 0xc7b9a0 },
];

function addPaving(model: OverlookModel, finish: OverlookFinishes): void {
  const retainingHeight = 13.80, batter = 2.58;
  const retaining = new THREE.BoxGeometry(71.2, retainingHeight, 55.63);
  const retainingPosition = retaining.getAttribute('position');
  const retainingUv = retaining.getAttribute('uv');
  for (let i = 0; i < retainingPosition.count; i += 1) {
    let x = retainingPosition.getX(i), y = retainingPosition.getY(i), z = retainingPosition.getZ(i);
    if (y < 0) {
      x += Math.sign(x) * batter;
      if (z < 0) z -= batter;
    }
    y -= retainingHeight * 0.5 + 0.29;
    z += 3.29;
    retainingPosition.setXYZ(i, x, y, z);
    retainingUv.setXY(i, (i < 8 ? z : x) * 0.27, (i < 8 || i >= 16 ? y : z) * 0.27);
  }
  retaining.computeVertexNormals();
  model.mesh(retaining, finish.foundation);
  for (const [y, height] of [[-1.58, 0.16], [-3.15, 0.12], [-5.08, 0.13]]) {
    const projection = (-y - 0.29) * batter / retainingHeight;
    model.block(finish.limestone, 0, y, 3.29 - projection * 0.5,
      71.32 + projection * 2, height, 55.75 + projection);
  }
  model.block(finish.shadowStone, 0, -0.83, 3.29, 71.30, 0.195, 55.73);
  model.block(finish.limestone, 0, -0.485, 3.29, 71.55, 0.38, 55.95);
  model.block(finish.cream, 0, -0.186, 3.29, 71.72, 0.215, 56.10);
  model.block(finish.mortar, 0, -0.078, 3.29, 70.51, 0.085, 55.3);

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const triangles: number[] = [];
  const random = seededDetail(58549);
  const tint = new THREE.Color();
  const stone = new THREE.Color();
  const addSlab = (left: number, right: number, near: number, far: number, color: number) => {
    const x = (left + right) / 2, z = (near + far) / 2;
    const wear = (random() - 0.48) * 0.14 + Math.sin(x * 0.34 + z * 0.13) * Math.sin(z * 0.61) * 0.038;
    tint.setHex(color).multiplyScalar(1 + wear);
    const top = (random() - 0.63) * 0.010;
    const first = positions.length / 3;
    const inset = 0.011 + random() * 0.007;
    for (const [bevel, y, shade] of [[0, top - 0.036, 0.74], [0.031, top, 1]] as const) {
      const minX = left + inset + bevel, maxX = right - inset - bevel;
      const minZ = near + inset + bevel, maxZ = far - inset - bevel;
      const chamfer = Math.min(0.026, (maxZ - minZ) * 0.18, (maxX - minX) * 0.18);
      for (const [x1, z1] of [
        [minX + chamfer, minZ], [minX, minZ + chamfer], [minX, maxZ - chamfer], [minX + chamfer, maxZ],
        [maxX - chamfer, maxZ], [maxX, maxZ - chamfer], [maxX, minZ + chamfer], [maxX - chamfer, minZ],
      ]) {
        stone.copy(tint).multiplyScalar(shade * (0.985 + random() * 0.03));
        positions.push(x1, y, z1);
        uvs.push(x1 * 0.31, z1 * 0.31);
        colors.push(stone.r, stone.g, stone.b);
      }
    }
    for (let i = 0; i < 8; i += 1) {
      const a = first + i, b = first + ((i + 1) % 8);
      triangles.push(a, b, a + 8, b, b + 8, a + 8);
    }
    // Keep the flagstone face flat while the chamfer catches light at the joint.
    for (let i = 8; i < 16; i += 1) {
      const k = first + i;
      positions.push(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]);
      uvs.push(uvs[k * 2], uvs[k * 2 + 1]);
      colors.push(colors[k * 3], colors[k * 3 + 1], colors[k * 3 + 2]);
    }
    for (let i = 1; i < 7; i += 1) triangles.push(first + 16, first + 16 + i, first + 17 + i);
  };
  for (const { minX, maxX, minZ, maxZ, seamX, seamZ, color } of slabFields) {
    const rows = Math.max(1, Math.round((maxZ - minZ) / seamZ));
    const stepZ = (maxZ - minZ) / rows;
    for (let row = 0; row < rows; row += 1) {
      const near = minZ + row * stepZ;
      let left = minX;
      const columns = Math.round((maxX - minX) / seamX);
      const stepX = (maxX - minX) / columns;
      const offset = row % 2 ? stepX * 0.43 : stepX;
      for (let right = minX + offset; right < maxX - 0.11; right += stepX) {
        addSlab(left, right, near, near + stepZ, color);
        left = right;
      }
      addSlab(left, maxX, near, near + stepZ, color);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  model.mesh(geometry, finish.paving, false);
}

function addCompass(model: OverlookModel, finish: OverlookFinishes): void {
  const z = -4;
  model.column(finish.shadowStone, 0, 0.010, z, 2.15, 2.15, 0.024, 64);
  for (const [radius, width] of [[2.09, 0.041], [1.88, 0.024], [0.48, 0.042]]) {
    model.mesh(new THREE.RingGeometry(radius - width, radius, 72).rotateX(-Math.PI / 2).translate(0, 0.024, z),
      finish.brass, false);
  }
  for (let i = 0; i < 8; i += 1) {
    const angle = i * Math.PI / 4;
    const radius = i % 2 === 0 ? 1.81 : 1.17;
    const mark = new THREE.Shape();
    mark.moveTo(0, 0.44);
    mark.lineTo(0.21, 0);
    mark.lineTo(0, -radius);
    mark.lineTo(-0.21, 0);
    model.mesh(new THREE.ShapeGeometry(mark).rotateX(-Math.PI / 2).rotateY(angle).translate(0, 0.025, z),
      i % 2 === 0 ? finish.brass : finish.bronze, false);
  }
  model.column(finish.brass, 0, 0.024, z, 0.13, 0.13, 0.018, 20);
}

function addPier(model: OverlookModel, finish: OverlookFinishes, x: number, z: number, lantern = false): void {
  model.block(finish.shadowStone, x, 0.078, z, 0.86, 0.16, 0.86);
  model.block(finish.cream, x, 0.178, z, 0.98, 0.092, 0.98);
  model.block(finish.limestone, x, 0.593, z, 0.72, 0.80, 0.72);
  model.block(finish.cream, x, 0.97, z, 0.85, 0.11, 0.85);
  model.block(finish.cream, x, 1.054, z, 0.95, 0.075, 0.95);
  model.block(finish.limestone, x, 1.101, z, 0.86, 0.046, 0.86);
  if (!lantern) return;
  model.column(finish.bronze, x, 1.17, z, 0.23, 0.28, 0.13, 8, Math.PI / 8);
  model.column(finish.frosted, x, 1.343, z, 0.202, 0.218, 0.246, 8, Math.PI / 8);
  for (let i = 0; i < 8; i += 1) {
    const angle = i * Math.PI * 0.25 + Math.PI / 8;
    model.column(finish.bronze, x + Math.sin(angle) * 0.208, 1.348, z + Math.cos(angle) * 0.208,
      0.018, 0.021, 0.285, 6);
  }
  model.column(finish.bronze, x, 1.489, z, 0.206, 0.25, 0.091, 8, Math.PI / 8);
  model.column(finish.bronze, x, 1.54, z, 0.115, 0.206, 0.071, 8, Math.PI / 8);
  model.column(finish.brass, x, 1.591, z, 0.057, 0.067, 0.037, 8);
}

function addRail(model: OverlookModel, finish: OverlookFinishes,
  fixed: number, piers: readonly number[], axis: 'x' | 'z'): void {
  const style = (material: THREE.Material, run: number, y: number, w: number, h: number, d: number,
    yaw = 0) => model.block(material, axis === 'x' ? run : fixed, y, axis === 'x' ? fixed : run, w, h, d,
      yaw + (axis === 'x' ? 0 : Math.PI / 2));
  const span = piers.at(-1)! - piers[0];
  const middle = (piers[0] + piers.at(-1)!) / 2;
  style(finish.limestone, middle, 0.071, span, 0.195, 0.76);
  style(finish.cream, middle, 0.16, span, 0.111, 0.884);
  for (let i = 1; i < piers.length; i += 1) {
    const from = piers[i - 1], to = piers[i];
    const length = to - from;
    const center = (from + to) / 2;
    style(finish.iron, center, 0.293, length, 0.053, 0.092);
    style(finish.iron, center, 0.945, length, 0.060, 0.112);
    style(finish.bronze, center, 0.987, length, 0.039, 0.148);
    const sections = Math.max(2, Math.round(length / 2.3));
    for (let bay = 0; bay < sections; bay += 1) {
      const width = length / sections;
      const start = from + bay * width;
      const center = start + width / 2;
      style(finish.iron, start + width, 0.618, 0.103, 0.74, 0.103);
      style(finish.iron, center, 0.608, 0.053, 0.659, 0.050);
      for (const offset of [-0.39, -0.24, 0.24, 0.39]) {
        style(finish.iron, center + offset * width, 0.608, 0.042, 0.659, 0.042);
      }
      const a = axis === 'x' ? new THREE.Vector3(center, 0.792, fixed) : new THREE.Vector3(fixed, 0.792, center);
      const b = axis === 'x' ? new THREE.Vector3(center + 0.13, 0.608, fixed) : new THREE.Vector3(fixed, 0.608, center + 0.13);
      const c = axis === 'x' ? new THREE.Vector3(center, 0.424, fixed) : new THREE.Vector3(fixed, 0.424, center);
      const d = axis === 'x' ? new THREE.Vector3(center - 0.13, 0.608, fixed) : new THREE.Vector3(fixed, 0.608, center - 0.13);
      model.rod(finish.iron, a, b, 0.019);
      model.rod(finish.iron, b, c, 0.019);
      model.rod(finish.iron, c, d, 0.019);
      model.rod(finish.iron, d, a, 0.019);
    }
  }
}

function addParapet(model: OverlookModel, finish: OverlookFinishes,
  fixed: number, from: number, to: number, axis: 'x' | 'z'): void {
  const stone = (material: THREE.Material, left: number, right: number, y: number, height: number, depth: number) => {
    const center = (left + right) * 0.5;
    model.block(material, axis === 'x' ? center : fixed, y, axis === 'x' ? fixed : center,
      right - left, height, depth, axis === 'x' ? 0 : Math.PI / 2);
  };
  stone(finish.shadowStone, from, to, 0.39, 0.76, 0.72);
  stone(finish.shadowStone, from, to, 0.047, 0.15, 1.02);
  stone(finish.cream, from, to, 0.139, 0.054, 0.92);
  for (const [offset, y, height] of [[1.08, 0.30, 0.251], [2.15, 0.54, 0.211]]) {
    let left = from;
    for (let edge = from + offset; edge < to - 0.38; edge += 2.15) {
      stone(finish.limestone, left + 0.008, edge - 0.008, y, height, 0.76);
      left = edge;
    }
    stone(finish.limestone, left + 0.008, to - 0.008, y, height, 0.76);
  }
  stone(finish.shadowStone, from, to, 0.659, 0.027, 0.82);
  stone(finish.cream, from, to, 0.718, 0.105, 0.94);
  stone(finish.limestone, from, to, 0.787, 0.054, 0.88);
}

function addBench(model: OverlookModel, finish: OverlookFinishes, x: number, z: number): void {
  for (const offset of [-1.33, 1.33]) {
    const arm = x + offset;
    model.block(finish.cream, arm, 0.068, z + 0.08, 0.47, 0.146, 1.03);
    model.block(finish.limestone, arm, 0.28, z + 0.14, 0.34, 0.28, 0.69);
    model.block(finish.iron, arm, 0.63, z + 0.44, 0.065, 0.77, 0.088);
    model.rod(finish.iron, new THREE.Vector3(arm, 0.49, z - 0.33), new THREE.Vector3(arm, 0.73, z - 0.32), 0.037);
    model.rod(finish.iron, new THREE.Vector3(arm, 0.72, z - 0.34), new THREE.Vector3(arm, 0.72, z + 0.43), 0.04);
  }
  for (let i = 0; i < 5; i += 1) {
    model.block(finish.wood[i % 3], x, 0.451, z - 0.354 + i * 0.162, 3.59, 0.09, 0.143);
  }
  for (let i = 0; i < 4; i += 1) {
    model.block(finish.wood[(i + 1) % 3], x, 0.60 + i * 0.135, z + 0.395 + i * 0.022, 3.58, 0.106, 0.072);
  }
}

function addViewer(model: OverlookModel, finish: OverlookFinishes, x: number, z: number, yaw: number): void {
  const origin = new THREE.Vector3(x, 1.39, z);
  const place = (geometry: THREE.BufferGeometry, material: THREE.Material) =>
    model.mesh(geometry.rotateY(yaw).translate(origin.x, origin.y, origin.z), material);
  model.column(finish.cream, x, 0.064, z, 0.411, 0.454, 0.128, 12);
  model.column(finish.bronze, x, 0.136, z, 0.252, 0.324, 0.062, 12);
  model.column(finish.iron, x, 0.53, z, 0.092, 0.139, 0.76, 12);
  model.column(finish.bronze, x, 0.933, z, 0.107, 0.11, 0.064, 12);
  model.column(finish.iron, x, 1.115, z, 0.119, 0.081, 0.304, 12);
  const body = new THREE.Shape();
  body.moveTo(-0.305, -0.098);
  body.lineTo(-0.24, -0.164);
  body.lineTo(0.24, -0.164);
  body.lineTo(0.305, -0.098);
  body.lineTo(0.305, 0.102);
  body.lineTo(0.222, 0.171);
  body.lineTo(-0.222, 0.171);
  body.lineTo(-0.305, 0.102);
  const castShell = new THREE.ExtrudeGeometry(body, {
    depth: 0.33, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.031, bevelThickness: 0.032,
  }).translate(0, 0, -0.165);
  place(castShell, finish.pewter);
  for (const offset of [-0.14, 0.14]) {
    place(new THREE.CylinderGeometry(0.101, 0.106, 0.10, 20).rotateX(Math.PI / 2).translate(offset, 0.037, -0.218), finish.iron);
    place(new THREE.CylinderGeometry(0.072, 0.072, 0.018, 20).rotateX(Math.PI / 2).translate(offset, 0.037, -0.271), finish.lens);
    place(new THREE.CylinderGeometry(0.072, 0.083, 0.085, 18).rotateX(Math.PI / 2).translate(offset, 0.018, 0.224), finish.bronze);
    place(new THREE.CylinderGeometry(0.049, 0.049, 0.017, 18).rotateX(Math.PI / 2).translate(offset, 0.018, 0.271), finish.lens);
  }
  place(new THREE.BoxGeometry(0.126, 0.070, 0.015).translate(0, -0.089, 0.2), finish.brass);
  place(new THREE.BoxGeometry(0.056, 0.013, 0.007).translate(0, -0.082, 0.21), finish.iron);
}

function addLampPools(group: THREE.Group, model: OverlookModel, finish: OverlookFinishes,
  upperPools: readonly THREE.BufferGeometry[]): THREE.Group {
  const resolution = 64;
  const pixels = new Uint8Array(resolution ** 2 * 4);
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const r = Math.hypot((x + 0.5) / resolution * 2 - 1, (y + 0.5) / resolution * 2 - 1);
      const fade = Math.round(255 * Math.max(0, 1 - r ** 1.65) ** 2.5);
      const i = (x + resolution * y) * 4;
      pixels.set([fade, fade, fade, 255], i);
    }
  }
  const falloff = new THREE.DataTexture(pixels, resolution, resolution);
  falloff.magFilter = falloff.minFilter = THREE.LinearFilter;
  falloff.needsUpdate = true;
  const haze = new THREE.MeshBasicMaterial({
    color: 0xeaa55e, alphaMap: falloff, opacity: 0.44, depthWrite: false,
    transparent: true, blending: THREE.AdditiveBlending,
  });
  const lamps = new THREE.Group();
  lamps.name = 'Amber grazing light and terrace lanterns';
  const pools = new OverlookModel();
  const wash = haze.clone();
  wash.color.setHex(0xffb960);
  wash.opacity = 0.72;
  for (const { x, z, yaw } of wallLamps) {
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    model.block(finish.bronze, x + 0.418 * nx, 0.586, z + 0.418 * nz, 0.49, 0.105, 0.145, yaw);
    model.block(finish.frosted, x + 0.442 * nx, 0.533, z + 0.442 * nz, 0.36, 0.027, 0.093, yaw);

    // A half-disc starts under the hood and spreads over the floor on the inner side.
    const floor = new THREE.PlaneGeometry(5.45, 3.65);
    const uv = floor.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 1) uv.setY(i, uv.getY(i) * 0.5);
    pools.mesh(floor.rotateX(-Math.PI / 2).rotateY(yaw).translate(x + 2.29 * nx, 0.014, z + 2.29 * nz), wash, false);

    const wall = new THREE.PlaneGeometry(2.86, 0.56);
    const wallUv = wall.getAttribute('uv'), positions = wall.getAttribute('position');
    for (let i = 0; i < wallUv.count; i += 1) {
      if (wallUv.getY(i) === 1) positions.setX(i, positions.getX(i) * 0.17);
      wallUv.setY(i, wallUv.getY(i) * 0.5);
    }
    pools.mesh(wall.rotateY(yaw).translate(x + 0.384 * nx, 0.276, z + 0.384 * nz), wash, false);
  }
  for (const [x, z] of [[-33.55, -6], [33.55, -6], [-33.55, 11], [33.55, 11]]) {
    pools.mesh(new THREE.PlaneGeometry(5.8, 5.8).rotateX(-Math.PI / 2).translate(x, 0.017, z), haze, false);
  }
  for (const pool of upperPools) pools.mesh(pool, wash, false);
  pools.finish(lamps);
  for (const x of [-5.68, 5.68]) {
    const lamp = new THREE.PointLight(0xffbf7d, 154, 14.5, 2);
    lamp.position.set(x, 3.37, 7.97);
    lamps.add(lamp);
  }
  group.add(lamps);
  return lamps;
}

export function createOverlookDeck(): { group: THREE.Group; setTimeOfDay(time: 'day' | 'night'): void } {
  const group = new THREE.Group();
  group.name = 'Hilltop observatory terrace';
  group.position.y = DECK_LEVEL;
  const model = new OverlookModel();
  const finish = overlookFinishes();
  addPaving(model, finish);
  addCompass(model, finish);
  const sidePiers = [-15, -6, 2.5, 11, 24];
  addParapet(model, finish, DECK_FRONT, -DECK_SIDE - 0.51, DECK_SIDE + 0.51, 'x');
  for (const side of [-1, 1]) {
    const x = side * DECK_SIDE;
    addParapet(model, finish, x, DECK_FRONT + 0.39, sidePiers[0], 'z');
    addPier(model, finish, x, DECK_FRONT);
    addRail(model, finish, x, sidePiers, 'z');
    for (const z of sidePiers) addPier(model, finish, x, z, z === -6 || z === 11);
    addRail(model, finish, 24, side < 0 ? [x, -24.25] : [24.25, x], 'x');
    addPier(model, finish, side * 24.25, 24);
  }
  for (const [x, z] of benchLocations) addBench(model, finish, x, z);
  for (const [x, z, yaw] of viewerLocations) addViewer(model, finish, x, z, yaw);
  addOverlookPavilion(model, finish);
  const upperPools = addOverlookUpperDeck(model, finish);
  const lamps = addLampPools(group, model, finish, upperPools);
  model.finish(group);
  lamps.visible = false;
  return {
    group,
    setTimeOfDay(time) {
      const night = time === 'night';
      finish.frosted.emissiveIntensity = night ? 2.25 : 0.04;
      finish.window.emissiveIntensity = night ? 1.08 : 0;
      lamps.visible = night;
    },
  };
}
