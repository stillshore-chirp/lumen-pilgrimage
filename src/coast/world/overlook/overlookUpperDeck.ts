import * as THREE from 'three';
import type { DeckContact } from './overlookDeckDetail';
import { OverlookModel, type OverlookFinishes } from './overlookModel';
import { DECK_LEVEL } from './overlookTerrain';

export const OVERLOOK_UPPER_DECK_HEIGHT = 7.2;
const height = OVERLOOK_UPPER_DECK_HEIGHT;
const flightRise = height / 2;
const risers = 22;
const going = 0.30;
const flightRun = risers * going;
const stairStart = -3;
const firstLanding = stairStart + flightRun;
const secondFlight = firstLanding + 1.2;
const stairTop = secondFlight + flightRun;
const stairs = { minX: 24.55, maxX: 27.15, minZ: stairStart, maxZ: stairTop };
const terrace = { minX: 10.88, maxX: 24.22, minZ: 12.1, maxZ: 23.4 };
const landing = { minX: terrace.maxX, maxX: stairs.maxX, minZ: stairTop, maxZ: 15.4 };

type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number };
type Point = readonly [x: number, z: number];

// Outline of the joined floor plates. The two endpoints leave the stair entrance open.
const perimeter: readonly Point[] = [
  [stairs.minX, stairStart], [stairs.minX, firstLanding], [stairs.minX, secondFlight], [stairs.minX, stairTop],
  [landing.minX, stairTop], [terrace.maxX, terrace.minZ], [terrace.minX, terrace.minZ],
  [terrace.minX, terrace.maxZ], [terrace.maxX, terrace.maxZ], [terrace.maxX, landing.maxZ],
  [landing.maxX, landing.maxZ], [stairs.maxX, stairTop], [stairs.maxX, secondFlight],
  [stairs.maxX, firstLanding], [stairs.maxX, stairStart],
];
const edges = perimeter.slice(1).map((end, index) => ({ start: perimeter[index], end }));

function contains(area: Footprint, x: number, z: number): boolean {
  return x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ;
}

export function isUpperDeck(x: number, z: number): boolean {
  return contains(stairs, x, z) || contains(landing, x, z) || contains(terrace, x, z);
}

function stairHeight(z: number): number {
  // Continuous support for walking, ending flush at every modeled landing.
  const lower = THREE.MathUtils.clamp((z - stairStart) / flightRun, 0, 1);
  const upper = THREE.MathUtils.clamp((z - secondFlight) / flightRun, 0, 1);
  return (lower + upper) * flightRise;
}

export function overlookDeckGround(x: number, z: number): number {
  if (contains(stairs, x, z)) return DECK_LEVEL + stairHeight(z);
  return DECK_LEVEL + (isUpperDeck(x, z) ? height : 0);
}

export function blocksUpperDeckWalking(x: number, z: number, _foot: number): boolean {
  // Test both sides of the railing so airborne players cannot bypass it and
  // the walking camera stops while its feet are still over the slab.
  const clearance = 0.27;
  return edges.some(({ start: [x1, z1], end: [x2, z2] }) =>
    x >= Math.min(x1, x2) - clearance && x <= Math.max(x1, x2) + clearance
    && z >= Math.min(z1, z2) - clearance && z <= Math.max(z1, z2) + clearance,
  );
}

function addStoneSlab(model: OverlookModel, finish: OverlookFinishes,
  { minX, maxX, minZ, maxZ }: Footprint, y: number): void {
  const width = maxX - minX, depth = maxZ - minZ;
  const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
  model.block(finish.shadowStone, x, y - 0.39, z, width, 0.53, depth);
  model.block(finish.limestone, x, y - 0.28, z, width + 0.15, 0.12, depth + 0.13);
  model.block(finish.cream, x, y - 0.121, z, width + 0.22, 0.13, depth + 0.18);
  model.block(finish.mortar, x, y - 0.052, z, width, 0.067, depth);

  const rows = Math.ceil(depth / 0.98);
  const tileDepth = depth / rows;
  const tileWidth = width / Math.ceil(width / 1.43);
  for (let row = 0; row < rows; row += 1) {
    const rowCenter = minZ + (row + 0.5) * tileDepth;
    let left = minX;
    while (left < maxX - 0.05) {
      const span = left === minX && row % 2 === 1 ? tileWidth / 2 : tileWidth;
      const right = Math.min(maxX, left + span);
      model.block(finish.limestone, (left + right) / 2, y - 0.022, rowCenter,
        right - left - 0.014, 0.044, tileDepth - 0.014);
      left = right;
    }
  }
}

function addStair(model: OverlookModel, finish: OverlookFinishes, pools: THREE.BufferGeometry[]): void {
  const x = (stairs.minX + stairs.maxX) / 2;
  const width = stairs.maxX - stairs.minX;
  for (const [start, level] of [[stairStart, 0], [secondFlight, flightRise]]) {
    for (let i = 0; i <= risers; i += 1) {
      const y = level + i * flightRise / risers;
      const front = start + Math.max(0, i - 0.5) * going;
      const back = start + Math.min(risers, i + 0.5) * going;
      const z = (front + back) * 0.5;
      const depth = back - front;
      if (y <= 0) continue;
      model.block(finish.shadowStone, x, (y - 0.052) / 2, z, width, y - 0.052, depth);
      model.block(finish.limestone, x, y - 0.026, z, width + 0.046, 0.052, depth + 0.009);
      if (i > 0) model.block(finish.bronze, x, y + 0.0005, front + 0.034, width - 0.24, 0.001, 0.017);

      // Shielded riser fixtures light three adjacent treads without projecting
      // light toward the city sightline or counting as dynamic spotlights.
      const lightStep = Math.round((i - 3) / 5) * 5 + 3;
      if (Math.abs(i - lightStep) > 1 || lightStep >= risers) continue;
      for (const side of [-1, 1]) {
        const lightX = x + side * (width / 2 - 0.23);
        if (i === lightStep) {
          model.block(finish.bronze, lightX, y - 0.056, front - 0.017, 0.32, 0.088, 0.036);
          model.block(finish.frosted, lightX, y - 0.086, front - 0.035, 0.24, 0.021, 0.028);
        }
        const pool = new THREE.PlaneGeometry(1.09, depth);
        const uv = pool.getAttribute('uv');
        for (let j = 0; j < uv.count; j += 1) {
          uv.setY(j, 0.49 - (i - lightStep) * 0.29 + (uv.getY(j) - 0.5) * 0.29);
        }
        pools.push(pool.rotateX(-Math.PI / 2).translate(lightX - side * 0.37, y + 0.004, z));
      }
    }
  }
  model.block(finish.shadowStone, x, flightRise / 2, (firstLanding + secondFlight) / 2,
    width, flightRise, secondFlight - firstLanding);
  model.block(finish.limestone, x, flightRise - 0.026, (firstLanding + secondFlight) / 2,
    width + 0.046, 0.052, secondFlight - firstLanding);
}

function addGuard(model: OverlookModel, finish: OverlookFinishes,
  start: Point, end: Point, addContact: DeckContact): void {
  const [x1, z1] = start, [x2, z2] = end;
  const length = Math.hypot(x2 - x1, z2 - z1);
  const bays = Math.ceil(length / 1.8);
  const y1 = z1 < stairTop ? stairHeight(z1) : height;
  const y2 = z2 < stairTop ? stairHeight(z2) : height;
  const at = (t: number, offset: number) => new THREE.Vector3(
    THREE.MathUtils.lerp(x1, x2, t), THREE.MathUtils.lerp(y1, y2, t) + offset,
    THREE.MathUtils.lerp(z1, z2, t),
  );
  model.rod(finish.iron, at(0, 0.18), at(1, 0.18), 0.027);
  model.rod(finish.iron, at(0, 0.97), at(1, 0.97), 0.027);
  model.rod(finish.bronze, at(0, 1.05), at(1, 1.05), 0.045, 12);
  for (let i = 0; i < bays; i += 1) {
    const post = at(i / bays, 0);
    model.block(finish.iron, post.x, post.y + 0.49, post.z, 0.077, 1.11, 0.077);
    model.block(finish.bronze, post.x, post.y + 0.047, post.z, 0.15, 0.094, 0.15);
    if (post.y === height) addContact('upper', post.x, post.z, 0.15, 0.15, 0.29, 0.82);
    const pickets = Math.ceil(length / bays / 0.20);
    for (let j = 1; j < pickets; j += 1) {
      const t = (i + j / pickets) / bays;
      const infill = at(t, 0.57);
      model.block(finish.iron, infill.x, infill.y, infill.z, 0.028, 0.80, 0.028);
    }
  }
}

function addLandingPier(model: OverlookModel, finish: OverlookFinishes, x: number, z: number): void {
  const stem = height - 0.57;
  model.block(finish.shadowStone, x, 0.12, z, 0.97, 0.24, 0.97);
  model.block(finish.cream, x, 0.27, z, 0.89, 0.15, 0.89);
  model.block(finish.limestone, x, stem / 2, z, 0.56, stem, 0.56);
  for (const offset of [-0.17, 0, 0.17]) {
    model.block(finish.shadowStone, x + offset, stem * 0.51, z + 0.28, 0.047, stem - 0.86, 0.018);
    model.block(finish.shadowStone, x + 0.28, stem * 0.51, z + offset, 0.018, stem - 0.86, 0.047);
  }
  model.block(finish.cream, x, stem - 0.11, z, 0.73, 0.19, 0.73);
  model.block(finish.cream, x, stem + 0.04, z, 0.91, 0.12, 0.91);
}

function addLowLights(model: OverlookModel, finish: OverlookFinishes,
  pools: THREE.BufferGeometry[], addContact: DeckContact): void {
  const front = terrace.minZ;
  for (const x of [12.33, 16.17, 20.03, 23.24]) {
    model.block(finish.limestone, x, height + 0.154, front + 0.079, 0.55, 0.31, 0.26);
    addContact('upper', x, front + 0.079, 0.55, 0.26, 0.40, 0.75);
    model.block(finish.bronze, x, height + 0.14, front + 0.211, 0.40, 0.094, 0.060);
    model.block(finish.frosted, x, height + 0.104, front + 0.236, 0.33, 0.031, 0.059);
    pools.push(new THREE.PlaneGeometry(1.7, 1.4).rotateX(-Math.PI / 2)
      .translate(x, height + 0.007, front + 0.70));
  }
  const x = landing.maxX, z = (landing.minZ + landing.maxZ) / 2;
  model.block(finish.bronze, x - 0.048, height + 0.22, z, 0.096, 0.10, 0.50);
  model.block(finish.frosted, x - 0.092, height + 0.17, z, 0.06, 0.028, 0.42);
  pools.push(new THREE.PlaneGeometry(1.37, 1.75).rotateX(-Math.PI / 2)
    .translate(x - 0.74, height + 0.007, z));
}

export function addOverlookUpperDeck(model: OverlookModel, finish: OverlookFinishes,
  addContact: DeckContact): THREE.BufferGeometry[] {
  const pools: THREE.BufferGeometry[] = [];
  addStair(model, finish, pools);
  addStoneSlab(model, finish, terrace, height);
  addStoneSlab(model, finish, landing, height);
  addLandingPier(model, finish, landing.maxX - 0.49, landing.maxZ - 0.49);
  addLandingPier(model, finish, landing.maxX - 0.49, landing.minZ + 0.53);
  for (const { start, end } of edges) addGuard(model, finish, start, end, addContact);
  model.block(finish.iron, stairs.maxX, 0.51, stairStart, 0.077, 1.05, 0.077);
  for (const x of [stairs.minX, stairs.maxX]) {
    model.block(finish.limestone, x, 0.24, stairStart, 0.28, 0.48, 0.36);
    model.block(finish.cream, x, 0.50, stairStart, 0.33, 0.070, 0.41);
  }
  addLowLights(model, finish, pools, addContact);
  return pools;
}
