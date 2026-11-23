import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { createResidenceDoors } from './residenceDoors';
import type { ResidenceMaterials } from './residenceMaterials';
import { RESIDENCE_BALCONY_DOOR, RESIDENCE_BATH_SERVICE_SHAFT, RESIDENCE_FACADE_PIERS, RESIDENCE_ROOMS,
  RESIDENCE_STAIR_ENCLOSURE, RESIDENCE_TEA_HEARTH, RESIDENCE_TEA_TATAMI, RESIDENCE_WALLS,
  type ResidenceDoorOpening, type ResidenceRect } from './residencePlan';

type Wall = (typeof RESIDENCE_WALLS)[number];
type Opening = NonNullable<Wall['openings']>[number];
type WallLine = Pick<Wall, 'axis' | 'fixed'>;

export const SOUTH_GLASS_NORTH = .10;
export const EAST_GLASS_EAST = 22.70;
const ELEVATOR_CENTERS = [1.70, 4.15, 6.60] as const;
const GUARD_BASE = .058;
const UPPER_SLAB_BOTTOM = 3.19;

function lineRect({ axis, fixed }: WallLine, from: number, to: number, near: number, far: number): ResidenceRect {
  return axis === 'e' ? [from, fixed + near, to, fixed + far] : [fixed + near, from, fixed + far, to];
}

function floorAround([west, south, east, north]: ResidenceRect,
  [cutWest, cutSouth, cutEast, cutNorth]: ResidenceRect): ResidenceRect[] {
  return [[west, south, cutWest, north], [cutEast, south, east, north],
    [cutWest, south, cutEast, cutSouth], [cutWest, cutNorth, cutEast, north]];
}

function createShellGeometry(root: THREE.Group) {
  const batches = new Map<THREE.Group, Map<THREE.Material, THREE.BufferGeometry[]>>();
  const geometries = new Set<THREE.BufferGeometry>();

  function add(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Group) {
    if (material.transparent) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = material.name;
      parent.add(mesh);
      geometries.add(geometry);
      return;
    }
    let batch = batches.get(parent);
    if (!batch) {
      batch = new Map();
      batches.set(parent, batch);
    }
    const pieces = batch.get(material) ?? [];
    pieces.push(geometry);
    batch.set(material, pieces);
  }

  function box(material: THREE.Material, rect: ResidenceRect, bottom: number, top: number,
    parent = root, crossfall = 0, verticalGrain = false) {
    const [west, south, east, north] = rect;
    if (east - west < .0001 || north - south < .0001 || top - bottom < .0001) return;
    const geometry = new THREE.BoxGeometry(east - west, top - bottom, north - south)
      .translate((west + east) / 2, (bottom + top) / 2, -(south + north) / 2);
    if (crossfall) {
      geometry.applyMatrix4(new THREE.Matrix4().set(
        1, 0, 0, 0,
        -crossfall, 1, 0, crossfall * west,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ));
    }
    const { position, normal, uv } = geometry.attributes;
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const x = position.getX(vertex);
      const y = position.getY(vertex);
      const north = -position.getZ(vertex);
      if (Math.abs(normal.getY(vertex)) > .9) {
        uv.setXY(vertex, x, north);
      } else {
        const horizontal = Math.abs(normal.getX(vertex)) > .9 ? north : x;
        uv.setXY(vertex, verticalGrain ? y : horizontal, verticalGrain ? horizontal : y);
      }
    }
    add(geometry, material, parent);
  }

  function pane(material: THREE.Material, line: WallLine, offset: number, from: number, to: number,
    bottom: number, top: number, parent = root) {
    const center = (from + to) / 2;
    const geometry = new THREE.PlaneGeometry(to - from, top - bottom);
    if (line.axis === 'e') {
      geometry.translate(center, (bottom + top) / 2, -(line.fixed + offset));
    } else {
      geometry.rotateY(Math.PI / 2).translate(line.fixed + offset, (bottom + top) / 2, -center);
    }
    add(geometry, material, parent);
  }

  function spindle(material: THREE.Material, parent: THREE.Group, start: THREE.Vector3, end: THREE.Vector3, radius: number) {
    const direction = end.clone().sub(start);
    const cylinder = new THREE.CylinderGeometry(radius, radius, direction.length(), 12);
    const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    cylinder.applyQuaternion(orientation);
    cylinder.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
    add(cylinder, material, parent);
  }

  return {
    box, pane, spindle,
    finish() {
      for (const [parent, batch] of batches) {
        for (const [material, pieces] of batch) {
          const geometry = mergeGeometries(pieces);
          for (const piece of pieces) piece.dispose();
          if (!geometry) throw new Error('Incompatible residence shell geometry');
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = material.name;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          parent.add(mesh);
          geometries.add(geometry);
        }
      }
      batches.clear();
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      geometries.clear();
    },
  };
}

type ShellGeometry = ReturnType<typeof createShellGeometry>;

function addFloorsAndCeilings(geometry: ShellGeometry, materials: ResidenceMaterials) {
  const ceilings: { rect: ResidenceRect; height: number }[] = [];
  for (const room of RESIDENCE_ROOMS) {
    for (const rect of room.rectangles) {
      const [west, south, east, north] = rect;
      const finish: ResidenceRect = [
        west,
        south === 0 ? SOUTH_GLASS_NORTH : south,
        east === 22.8 && room.floor !== 'deck' ? EAST_GLASS_EAST : east,
        north,
      ];
      if (room.id === '04') {
        for (const slab of floorAround(finish, RESIDENCE_TEA_HEARTH)) geometry.box(materials.core, slab, -.31, -.035);
        geometry.box(materials.core, RESIDENCE_TEA_HEARTH, -.31, -.15);
        for (const oak of floorAround(finish, RESIDENCE_TEA_TATAMI)) geometry.box(materials.oak, oak, -.035, 0);
      } else {
        geometry.box(materials.core, finish, -.31, -.035);
        geometry.box(materials[room.floor], finish, -.035, 0, undefined, room.floor === 'deck' ? .006 : 0);
      }
      // The upper floor slab forms the soffit over the recessed deck.
      geometry.box(materials.core, rect, UPPER_SLAB_BOTTOM, 3.50);
      if (room.ceiling !== null) {
        geometry.box(materials.ceiling, rect, room.ceiling, room.ceiling + .065);
        ceilings.push({ rect, height: room.ceiling });
      }
    }
  }
  // Close the step where open rooms meet, including the kitchen and gallery
  // edges of the higher living room ceiling.
  for (const [index, first] of ceilings.entries()) {
    const [west, south, east, north] = first.rect;
    for (const second of ceilings.slice(index + 1)) {
      if (first.height === second.height) continue;
      const [nextWest, nextSouth, nextEast, nextNorth] = second.rect;
      const bottom = Math.min(first.height, second.height);
      const top = Math.max(first.height, second.height) + .015;
      if (east === nextWest || west === nextEast) {
        const edge = east === nextWest ? east : west;
        geometry.box(materials.ceiling, [edge - .023, Math.max(south, nextSouth),
          edge + .023, Math.min(north, nextNorth)], bottom, top);
      }
      if (north === nextSouth || south === nextNorth) {
        const edge = north === nextSouth ? north : south;
        geometry.box(materials.ceiling, [Math.max(west, nextWest), edge - .023,
          Math.min(east, nextEast), edge + .023], bottom, top);
      }
    }
  }
}

function addRoomSideFinishes(geometry: ShellGeometry, materials: ResidenceMaterials, wall: Wall,
  from: number, to: number) {
  const half = wall.thickness / 2;
  for (const room of RESIDENCE_ROOMS) {
    if (room.floor === 'deck') continue;
    for (const [west, south, east, north] of room.rectangles) {
      const [parallelStart, parallelEnd, crossStart, crossEnd] = wall.axis === 'e'
        ? [west, east, south, north] : [south, north, west, east];
      const side = wall.fixed === crossStart ? 1 : wall.fixed === crossEnd ? -1 : 0;
      if (!side) continue;
      const start = Math.max(from, parallelStart);
      const end = Math.min(to, parallelEnd);
      if (start >= end) continue;
      const face = (depth: number, inset = 0) => lineRect(wall, start + inset, end - inset,
        side > 0 ? half - .002 : -half - depth, side > 0 ? half + depth : -half + .002);
      if (room.floor === 'tile') {
        geometry.box(materials.tile, face(.011), .005, 2.16);
        geometry.box(materials.metal, face(.014), 2.16, 2.168);
      } else {
        const base = room.floor === 'core' ? materials.darkMetal : materials.trim;
        geometry.box(base, face(.013, .006), .008, .069);
        geometry.box(base, face(.008, .006), .069, .077);
      }
    }
  }
}

function addWindow(geometry: ShellGeometry, materials: ResidenceMaterials, wall: Wall, opening: Opening) {
  const { from, to, bottom, top } = opening;
  const half = wall.thickness / 2;
  const sillOffset = wall.axis === 'e' && wall.fixed === 0 ? SOUTH_GLASS_NORTH
    : wall.axis === 'n' && wall.fixed === 22.8 ? EAST_GLASS_EAST - wall.fixed : 0;
  // At the main facade the outward edge of the lower rail lines up with the
  // glass. A projecting sill or slab would hide the near street from above.
  const southFacade = sillOffset > 0;
  const eastFacade = sillOffset < 0;
  const railMin = southFacade ? sillOffset : sillOffset - .045;
  const railMax = eastFacade ? sillOffset : sillOffset + .045;
  const sillNear = southFacade ? sillOffset : -half;
  const sillFar = eastFacade ? sillOffset : half;
  geometry.box(materials.wall, lineRect(wall, from, to, sillNear, sillFar), 0, bottom - .02);
  geometry.box(materials.darkMetal, lineRect(wall, from, to, railMin, railMax), bottom - .024, bottom);
  geometry.box(materials.darkMetal, lineRect(wall, from, to, sillOffset - .052, sillOffset + .052), top, top + .038);

  const outerJamb = .034;
  const mullion = .042;
  const divisions = Math.max(1, Math.round((to - from) / 2.15));
  const frame = (left: number, right: number) => geometry.box(materials.darkMetal,
    lineRect(wall, left, right, sillOffset - .050, sillOffset + .050), bottom, top);
  frame(from, from + outerJamb);
  frame(to - outerJamb, to);
  for (let section = 0; section < divisions; section += 1) {
    const left = from + (to - from) * section / divisions;
    const right = from + (to - from) * (section + 1) / divisions;
    geometry.pane(materials.glass, wall, sillOffset, left + (section === 0 ? outerJamb : mullion / 2),
      right - (section === divisions - 1 ? outerJamb : mullion / 2), bottom, top);
    if (section + 1 < divisions) frame(right - mullion / 2, right + mullion / 2);
  }
}

function addDoorFrame(geometry: ShellGeometry, material: THREE.Material, wall: Wall, opening: Opening) {
  const { from, to, top } = opening;
  const half = wall.thickness / 2;
  const jamb = .022;
  const lining = (left: number, right: number, low: number, high: number) => geometry.box(material,
    lineRect(wall, left, right, -half - .006, half + .006), low, high);
  lining(from, from + jamb, 0, top);
  lining(to - jamb, to, 0, top);
  lining(from + jamb, to - jamb, top - jamb, top);
  for (const [near, far] of [[-half - .014, -half + .003], [half - .003, half + .014]]) {
    geometry.box(material, lineRect(wall, from - .033, from + .011, near, far), .004, top + .034);
    geometry.box(material, lineRect(wall, to - .011, to + .033, near, far), .004, top + .034);
    geometry.box(material, lineRect(wall, from + .011, to - .011, near, far), top - .011, top + .034);
  }
}

function addHingedLeaf(blade: THREE.Group, geometry: ShellGeometry, materials: ResidenceMaterials,
  opening: ResidenceDoorOpening, width: number, halfLeaf: number) {
  const handle = width - .102;
  const panelHeight = opening.top - .036;
  geometry.box(materials.cabinetry, [.008, -halfLeaf + .001, width, halfLeaf - .001], .014, panelHeight, blade, 0, true);
  geometry.box(materials.trim, [width - .020, -halfLeaf, width, halfLeaf], .020, panelHeight - .007, blade, 0, true);
  for (const center of [.22, panelHeight - .23]) {
    geometry.spindle(materials.metal, blade, new THREE.Vector3(.006, center - .031, 0),
      new THREE.Vector3(.006, center + .031, 0), .012);
  }
  for (const sign of [-1, 1]) {
    const rose = new THREE.Vector3(handle, .987, halfLeaf * sign);
    const standOff = new THREE.Vector3(handle, .987, (halfLeaf + .007) * sign);
    const pivot = new THREE.Vector3(handle, .987, .052 * sign);
    const tip = new THREE.Vector3(handle - .105, .984, .057 * sign);
    geometry.spindle(materials.metal, blade, rose, standOff, .027);
    geometry.spindle(materials.metal, blade, standOff, pivot, .0095);
    geometry.spindle(materials.metal, blade, pivot, tip, .010);
  }
}

function addFusuma(blade: THREE.Group, geometry: ShellGeometry, materials: ResidenceMaterials, wall: Wall,
  opening: ResidenceDoorOpening, width: number, halfLeaf: number, offset: number) {
  const { from, to, top } = opening;
  const left = from - width - .025;
  const guide = (low: number, high: number) => geometry.box(materials.cedar,
    lineRect(wall, left, to + .028, offset - .033, offset + .030), low, high);
  guide(top - .019, top + .038);
  guide(-.012, .001);
  for (const jamb of [left, to + .008]) {
    geometry.box(materials.cedar, lineRect(wall, jamb, jamb + .028, offset - .033, offset + .030), .001, top);
  }
  const stile = .033;
  const panelBottom = .009;
  const panelTop = top - .014;
  const panel = (finish: THREE.Material, start: number, end: number, bottom: number, cap: number,
    depth: number, vertical = false) => geometry.box(finish, [start, -depth, end, depth], bottom, cap, blade, 0, vertical);
  for (const start of [0, width - stile]) {
    panel(materials.cabinetry, start, start + stile, panelBottom, panelTop, halfLeaf, true);
  }
  panel(materials.cabinetry, stile, width - stile, panelBottom, .054, halfLeaf);
  panel(materials.cabinetry, stile, width - stile, panelTop - .038, panelTop, halfLeaf);
  panel(materials.washi, stile, width - stile, .054, panelTop - .038, halfLeaf - .003);
  for (const side of [-1, 1]) {
    const handle = new THREE.Vector3(width - .105, .902, side * (halfLeaf - .003));
    const front = new THREE.Vector3(handle.x, handle.y, side * (halfLeaf - .001));
    geometry.spindle(materials.cabinetry, blade, handle, front, .031);
    geometry.spindle(materials.darkMetal, blade, front, new THREE.Vector3(handle.x, handle.y, side * halfLeaf), .024);
  }
}

function addGalleryPocket(geometry: ShellGeometry, materials: ResidenceMaterials, wall: Wall, opening: Opening) {
  const { from, to, top } = opening;
  const half = wall.thickness / 2;
  const slot = .040;
  const end = wall.to - .044;
  const box = (finish: THREE.Material, left: number, right: number, near: number, far: number,
    low: number, high: number, verticalGrain = false) =>
    geometry.box(finish, lineRect(wall, left, right, near, far), low, high, undefined, 0, verticalGrain);
  for (const [near, far] of [[-half, -slot], [slot, half]]) {
    box(materials.wall, to, end, near, far, 0, top);
    box(materials.cabinetry, to - .016, to + .019, near - .002, far + .002, .001, top, true);
  }
  box(materials.wall, end, wall.to, -half, half, 0, top);
  box(materials.wall, to, wall.to, -half, half, top, wall.height);
  box(materials.cabinetry, from - .019, from + .012, -half - .006, half + .006, .001, top, true);
  for (const [near, far] of [[-half - .006, -slot], [slot, half + .006]]) {
    box(materials.cabinetry, from, to, near, far, top - .027, top + .021);
  }
  box(materials.darkMetal, from, end, -slot, slot, top - .013, top + .003);
  addRoomSideFinishes(geometry, materials, wall, to, wall.to);
}

function addGalleryLeaf(blade: THREE.Group, geometry: ShellGeometry, materials: ResidenceMaterials,
  top: number, width: number, halfDepth: number) {
  const bottom = .009;
  const pullLeft = .059;
  const pullRight = .101;
  const pullBottom = .852;
  const pullTop = 1.095;
  const face = (left: number, right: number, low: number, high: number) =>
    geometry.box(materials.cabinetry, [left, -halfDepth + .003, right, halfDepth - .003], low, high, blade, 0, true);
  face(0, pullLeft, bottom, top);
  face(pullRight, width, bottom, top);
  face(pullLeft, pullRight, bottom, pullBottom);
  face(pullLeft, pullRight, pullTop, top);
  geometry.box(materials.darkMetal, [pullLeft, -.017, pullRight, .017], pullBottom, pullTop, blade);
  for (const sign of [-1, 1]) {
    const inner = sign * (halfDepth - .008);
    const outer = sign * (halfDepth - .003);
    const between = (left: number, right: number, low: number, high: number, material: THREE.Material) =>
      geometry.box(material, [left, Math.min(inner, outer), right, Math.max(inner, outer)], low, high, blade);
    between(pullLeft, pullLeft + .008, pullBottom, pullTop, materials.metal);
    between(pullRight - .005, pullRight, pullBottom, pullTop, materials.metal);
    for (const edge of [pullBottom, pullTop - .005]) {
      between(pullLeft + .008, pullRight - .005, edge, edge + .005, materials.metal);
    }
    for (let index = 1; index <= 7; index++) {
      const centre = width - .036 - index * .033;
      const near = sign * (halfDepth - .004);
      const far = sign * halfDepth;
      geometry.box(materials.cabinetry, [centre - .009, Math.min(near, far), centre + .009, Math.max(near, far)],
        bottom + .020, top - .019, blade, 0, true);
    }
  }
}

function addBalconySidelight(geometry: ShellGeometry, materials: ResidenceMaterials, wall: Wall, opening: Opening) {
  const { from, to, bottom, top } = opening;
  const jamb = .028;
  const offset = .035;
  const rail = (left: number, right: number, low: number, high: number) => geometry.box(materials.darkMetal,
    lineRect(wall, left, right, offset - .016, offset + .016), low, high);
  rail(from, to, .001, bottom);
  rail(from, to, top, top + .032);
  rail(from, from + jamb, bottom, top);
  rail(to - jamb, to, bottom, top);
  geometry.pane(materials.glass, wall, offset, from + jamb, to - jamb, bottom, top);
}

function addBalconyOpening(geometry: ShellGeometry, materials: ResidenceMaterials, wall: Wall, opening: Opening,
  slidingLeaf: THREE.Group) {
  const { from, to, top } = opening;
  const frame = .028;
  const offset = -.035;
  const clearBottom = .044;
  const rect = (left: number, right: number, near: number, far: number) => lineRect(wall, left, right, near, far);
  geometry.box(materials.darkMetal, rect(from, to, -.115, .115), top, top + .032);
  const trackEnd = to + (to - from);
  geometry.box(materials.darkMetal, rect(from, trackEnd, -.106, .106), -.009, .001);
  for (const rail of [-.067, -.015, .034, .085]) {
    geometry.box(materials.metal, rect(from, trackEnd, rail, rail + .009), -.002, .003);
  }
  const leaf = (left: number, right: number, low: number, high: number) => geometry.box(materials.darkMetal,
    rect(left, right, offset - .016, offset + .016), low, high, slidingLeaf);
  leaf(from, to, .004, clearBottom);
  leaf(from, to, top - .035, top - .004);
  leaf(from, from + frame, clearBottom, top - .035);
  leaf(to - frame, to, clearBottom, top - .035);
  geometry.pane(materials.glass, wall, offset, from + frame, to - frame, clearBottom, top - .035, slidingLeaf);
  for (const face of [offset - .022, offset + .014]) {
    geometry.box(materials.metal, rect(from + .006, from + .023, face, face + .009), .91, 1.10, slidingLeaf);
  }
}

function addGuard(geometry: ShellGeometry, materials: ResidenceMaterials, wall: Wall) {
  const { from, to, height } = wall;
  const rail = Math.min(wall.thickness / 2, .029);
  const capHeight = .027;
  geometry.box(materials.darkMetal, lineRect(wall, from, to, -rail, rail), height - capHeight, height);
  geometry.box(materials.darkMetal, lineRect(wall, from, to, -.039, .039), -.018, GUARD_BASE);
  const sections = Math.max(1, Math.round((to - from) / 1.85));
  const post = .023;
  for (let index = 0; index <= sections; index += 1) {
    const center = THREE.MathUtils.lerp(from + post / 2, to - post / 2, index / sections);
    geometry.box(materials.darkMetal, lineRect(wall, center - post / 2, center + post / 2, -rail, rail),
      GUARD_BASE, height - capHeight);
    if (index === sections) break;
    const next = THREE.MathUtils.lerp(from + post / 2, to - post / 2, (index + 1) / sections);
    geometry.pane(materials.guard, wall, 0, center + post / 2, next - post / 2, GUARD_BASE, height - capHeight);
  }
}

function addElevators(geometry: ShellGeometry, materials: ResidenceMaterials, indicator: THREE.Material,
  wall: Wall) {
  const depth = wall.thickness / 2;
  const width = 1.52;
  const height = 2.24;
  let from = wall.from;
  const face = (finish: THREE.Material, start: number, end: number, bottom: number, top: number,
    front: number, back: number) => geometry.box(finish, lineRect(wall, start, end, front, back), bottom, top);
  for (const center of ELEVATOR_CENTERS) {
    const left = center - width / 2;
    const right = center + width / 2;
    face(materials.wall, from, left, 0, wall.height, -depth, depth);
    face(materials.wall, left, right, height, wall.height, -depth, depth);
    face(materials.darkMetal, left, right, 0, height, .018, depth);
    face(materials.metal, left + .031, center - .005, .014, height - .038, -.008, .020);
    face(materials.metal, center + .005, right - .031, .014, height - .038, -.008, .020);
    face(materials.darkMetal, left - .011, left + .031, 0, height + .012, -depth - .016, .002);
    face(materials.darkMetal, right - .031, right + .011, 0, height + .012, -depth - .016, .002);
    face(materials.darkMetal, left + .031, right - .031, height - .038, height + .012, -depth - .016, .002);
    face(materials.metal, left + .031, right - .031, -.007, .014, -depth - .017, .002);
    face(materials.darkMetal, center - .112, center + .112, height + .093, height + .182, -depth - .020, -depth);
    face(indicator, center - .019, center + .019, height + .123, height + .145, -depth - .022, -depth - .020);
    face(materials.darkMetal, right + .142, right + .218, .96, 1.134, -depth - .023, -depth);
    face(indicator, right + .171, right + .190, 1.022, 1.045, -depth - .025, -depth - .023);
    from = right;
  }
  face(materials.wall, from, wall.to, 0, wall.height, -depth, depth);
}

function addStairDoor(geometry: ShellGeometry, materials: ResidenceMaterials, line: WallLine, center: number) {
  const face = (material: THREE.Material, start: number, end: number, low: number, high: number,
    near: number, far: number) => geometry.box(material, lineRect(line, center + start, center + end, near, far), low, high);
  const exposed = line.axis === 'e' ? .13 : -.13;
  const side = Math.sign(exposed);
  const plate = (material: THREE.Material, start: number, end: number, low: number, high: number,
    projection: number, thickness: number) => {
    const near = exposed + side * projection;
    const far = near + side * thickness;
    face(material, start, end, low, high, Math.min(near, far), Math.max(near, far));
  };
  plate(materials.darkMetal, -.526, .526, .001, 2.204, -.002, .020);
  plate(materials.ceiling, -.480, .480, .014, 2.158, .017, .012);
  plate(materials.metal, -.375, .375, .994, 1.018, .028, .020);
  plate(materials.darkMetal, -.439, -.346, .971, 1.057, .028, .026);
  plate(materials.darkMetal, .351, .443, .971, 1.057, .028, .026);
}

export function createResidenceShell(materials: ResidenceMaterials) {
  const group = new THREE.Group();
  group.name = 'Residence walls, floors, glazing and common elevator hall';
  const leaf = new THREE.Group();
  leaf.name = 'Primary bedroom balcony sliding panel';
  group.add(leaf);
  const geometry = createShellGeometry(group);
  const movingLeaves = new Map<ResidenceDoorOpening, THREE.Group>();
  let balconyOpenAmount = 0;
  const indicator = new THREE.MeshBasicMaterial({ name: 'Elevator indicator', color: 0x9d9c80 });
  materials.glass.side = THREE.DoubleSide;
  materials.glass.forceSinglePass = true;
  materials.glass.needsUpdate = true;
  materials.guard.side = THREE.DoubleSide;
  materials.guard.forceSinglePass = true;
  materials.guard.needsUpdate = true;
  addFloorsAndCeilings(geometry, materials);

  for (const wall of RESIDENCE_WALLS) {
    if (wall.kind === 'guard') {
      addGuard(geometry, materials, wall);
      continue;
    }
    if (wall.axis === 'e' && wall.fixed === 17.70 && wall.from === 0) {
      addElevators(geometry, materials, indicator, wall);
      continue;
    }
    const half = wall.thickness / 2;
    const height = wall.kind === 'exterior' ? UPPER_SLAB_BOTTOM : wall.height;
    const body = (from: number, to: number, bottom: number, top: number) => geometry.box(materials.wall,
      lineRect(wall, from, to, -half, half), bottom, top);
    const solid = (from: number, to: number) => {
      body(from, to, 0, height);
      addRoomSideFinishes(geometry, materials, wall, from, to);
    };
    let from = wall.from;
    for (const opening of wall.openings ?? []) {
      solid(from, opening.from);
      body(opening.from, opening.to, opening.top, height);
      if (opening.kind === 'window') {
        if (wall.axis === 'n' && wall.fixed === RESIDENCE_BALCONY_DOOR.e) {
          addBalconySidelight(geometry, materials, wall, opening);
        } else {
          addWindow(geometry, materials, wall, opening);
        }
      } else if (opening.kind === 'balcony-door') {
        addBalconyOpening(geometry, materials, wall, opening, leaf);
      } else if (opening.kind === 'gallery-slide') {
        addGalleryPocket(geometry, materials, wall, opening);
        from = wall.to;
        break;
      } else if (opening.kind === 'door' || opening.kind === 'fusuma') {
        const fusuma = opening.kind === 'fusuma';
        addDoorFrame(geometry, fusuma ? materials.cedar : materials.trim, wall, opening);
      }
      from = opening.to;
    }
    solid(from, wall.to);
  }
  for (const pier of RESIDENCE_FACADE_PIERS) {
    geometry.box(materials.wall, pier, -.31, UPPER_SLAB_BOTTOM);
  }
  geometry.box(materials.wall, RESIDENCE_BATH_SERVICE_SHAFT, 0, 2.55);
  const [stairWest, , stairEast, stairNorth] = RESIDENCE_STAIR_ENCLOSURE;
  addStairDoor(geometry, materials, { axis: 'e', fixed: stairNorth }, (stairWest + stairEast) / 2);
  addStairDoor(geometry, materials, { axis: 'n', fixed: 16.5 }, 16.65);
  // Flush drainage slot just beyond the bedroom's threshold.
  geometry.box(materials.darkMetal, [20.844, 12.09, 20.902, 15.14], -.017, -.0002);
  for (let north = 12.12; north < 15.13; north += .086) {
    geometry.box(materials.metal, [20.849, north, 20.897, north + .012], -.005, .0002);
  }

  const doors = createResidenceDoors(({ wall, opening }, pose) => {
    let blade = movingLeaves.get(opening);
    if (!blade) {
      blade = new THREE.Group();
      blade.name = opening.kind === 'door' ? `Hinged door: ${opening.id}`
        : opening.kind === 'fusuma' ? 'Tea room fusuma' : 'Gallery pocket door';
      group.add(blade);
      movingLeaves.set(opening, blade);
      if (opening.kind === 'fusuma') {
        const offset = (wall.axis === 'e' ? pose.north : pose.east) - wall.fixed;
        addFusuma(blade, geometry, materials, wall, opening, pose.width, pose.halfDepth, offset);
      } else if (opening.kind === 'gallery-slide') {
        addGalleryLeaf(blade, geometry, materials, opening.top - .015, pose.width, pose.halfDepth);
      } else {
        addHingedLeaf(blade, geometry, materials, opening, pose.width, pose.halfDepth);
      }
    }
    blade.position.set(pose.east, 0, -pose.north);
    blade.rotation.y = pose.angle;
  }, () => balconyOpenAmount);
  geometry.finish();

  return {
    group,
    doors,
    setTimeOfDay(time: CoastTimeOfDay) {
      indicator.color.setHex(time === 'night' ? 0xf3c58d : 0x9d9c80);
    },
    setBalconyDoor(openAmount: number) {
      const { nFrom, nTo } = RESIDENCE_BALCONY_DOOR;
      balconyOpenAmount = THREE.MathUtils.clamp(openAmount, 0, 1);
      leaf.position.z = -(nTo - nFrom) * balconyOpenAmount;
    },
    dispose() {
      geometry.dispose();
      indicator.dispose();
      group.clear();
    },
  };
}
