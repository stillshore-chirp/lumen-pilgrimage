import {
  BoxGeometry, BufferGeometry, CylinderGeometry, DataTexture, DoubleSide, Float32BufferAttribute, Group,
  InstancedMesh, LinearFilter, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D,
  type Texture,
} from 'three';
import {
  ATRIUM_BOUNDS, ATRIUM_FIRST_BRIDGE, ATRIUM_FIRST_LEVEL_FORECOURT, ATRIUM_GALLERY_EDGE, ATRIUM_GALLERY_FRONTS,
  ATRIUM_LEVELS, ATRIUM_REAR_GALLERY, ATRIUM_STAIR_WEST_LINK, ATRIUM_UPPER_LANDING, ATRIUM_UPPER_STAIR,
  atriumFirstLevelInnerEdge,
} from './atriumLayout';
import {
  ATRIUM_TENANT_COMMON, ATRIUM_TENANTS,
} from './atriumTenantPlan';

/**
 * The shell is deliberately independent from the concourse floor, furniture and
 * stair assembly.  The camera starts close to z=0 and looks down the negative Z
 * axis, so all gallery dimensions below are kept in that same metre grid.
 */

type BoxSpec = readonly [
  x: number, y: number, z: number, width: number, height: number, depth: number, yaw?: number,
];
type PlanPoint = readonly [x: number, z: number];
type EdgeSegment = readonly [PlanPoint, PlanPoint];

type AtriumMaterials = {
  ceiling: MeshStandardMaterial;
  limestone: MeshStandardMaterial;
  plaster: MeshStandardMaterial;
  plasterLight: MeshStandardMaterial;
  coveReturn: MeshStandardMaterial;
  bronze: MeshStandardMaterial;
  bronzeLight: MeshStandardMaterial;
  darkBronze: MeshStandardMaterial;
  champagne: MeshStandardMaterial;
  glass: MeshPhysicalMaterial;
  screen: MeshPhysicalMaterial;
  cove: MeshBasicMaterial;
  pierWash: MeshBasicMaterial;
  spot: MeshBasicMaterial;
  displayWarm: MeshBasicMaterial;
  displayCool: MeshBasicMaterial;
  displayNeutral: MeshBasicMaterial;
  blueScreen: MeshBasicMaterial;
};

type LightingTargets = {
  setLighting(artificialOn: boolean, time: 'day' | 'night'): void;
};

const INNER_EDGE = ATRIUM_GALLERY_EDGE;
const OUTER_EDGE = 15;
const FRONT_Z = ATRIUM_BOUNDS.maxZ;
const REAR_Z = ATRIUM_BOUNDS.minZ;
const STORY_TOPS = [8.75, 13.28, 17.20] as const;
const GALLERY_FRONT = ATRIUM_GALLERY_FRONTS;

// Offset toward the shops, drop below the slab and received cove light.
const COVE_PROFILE = [
  [.018, .006, .06], [.075, -.006, .34], [.131, -.027, 1], [.205, -.050, .86],
  [.325, -.074, .64], [.57, -.10, .43], [.84, -.14, .27], [1.13, -.19, .16],
  [1.42, -.229, .11], [1.70, -.238, .09], [1.83, -.23, .20], [1.90, -.199, .43],
  [1.96, -.149, .31], [2.02, -.067, .11], [2.07, .006, .02],
] as const;

function makeMaterials(): AtriumMaterials {
  const solid = (name: string, color: number, roughness: number, metalness = 0): MeshStandardMaterial =>
    new MeshStandardMaterial({ name, color, roughness, metalness });
  const glass = (name: string, color: number, opacity: number, roughness: number): MeshPhysicalMaterial =>
    new MeshPhysicalMaterial({
      name, color, opacity, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true,
      roughness, metalness: 0.06, ior: 1.48, specularIntensity: 0.72,
    });
  const coveFalloff = new DataTexture(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1);
  coveFalloff.name = 'Cove reflected-light intensity';
  coveFalloff.minFilter = coveFalloff.magFilter = LinearFilter;
  coveFalloff.needsUpdate = true;
  return {
    ceiling: solid('Commercial atrium microtextured ceiling', 0xf0e6d8, .91),
    limestone: solid('Warm honed limestone atrium stone', 0xbba890, .77),
    plaster: solid('Warm mineral atrium plaster', 0xd9c6ae, .84),
    plasterLight: solid('Cream limestone light reveals', 0xefe1cc, .74),
    coveReturn: new MeshStandardMaterial({ name: 'Rounded plaster cove with reflected light',
      color: 0xe9dcc8, roughness: .83, emissive: 0xffdfb9, emissiveMap: coveFalloff }),
    bronze: solid('Taupe bronze fascia', 0x796752, .51, .38),
    bronzeLight: solid('Fine fluted bronze fascia', 0x83715e, .48, .37),
    darkBronze: solid('Shadow gap dark bronze', 0x342b27, .49, .35),
    champagne: solid('Pale champagne titanium slim profiles', 0xc1b4a0, .22, .66),
    glass: glass('Low-iron upper gallery glazing', 0xb9bfb5, .19, .13),
    screen: glass('Transparent architectural screen', 0x74c0d9, .33, .13),
    cove: new MeshBasicMaterial({ name: 'Warm concealed cove diffuser', color: 0xffc27f, toneMapped: false }),
    pierWash: new MeshBasicMaterial({ name: 'Grazing warm light on limestone piers', color: 0xffe6c1,
      vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true,
      toneMapped: false }),
    spot: new MeshBasicMaterial({ name: 'Warm recessed spot face', color: 0xffd09b, toneMapped: false }),
    displayWarm: new MeshBasicMaterial({ name: 'Warm upper retail display panel', color: 0xe8c08f,
      transparent: true, opacity: .78, depthWrite: false, toneMapped: false }),
    displayCool: new MeshBasicMaterial({ name: 'Cool upper retail display panel', color: 0xa8c6ca,
      transparent: true, opacity: .65, depthWrite: false, toneMapped: false }),
    displayNeutral: new MeshBasicMaterial({ name: 'Neutral upper retail display panel', color: 0xc1b8a8,
      transparent: true, opacity: .70, depthWrite: false, toneMapped: false }),
    blueScreen: new MeshBasicMaterial({ name: 'Soft blue screen glow', color: 0x7fc7ef, transparent: true, opacity: .52,
      depthWrite: false, toneMapped: false }),
  };
}

function addBox(group: Group, material: MeshStandardMaterial | MeshPhysicalMaterial | MeshBasicMaterial,
  [x, y, z, width, height, depth, yaw = 0]: BoxSpec, name: string): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addInstancedBoxes(group: Group, material: MeshStandardMaterial | MeshBasicMaterial, name: string,
  boxes: readonly BoxSpec[]): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, boxes.length);
  mesh.name = name;
  const transform = new Object3D();
  boxes.forEach(([x, y, z, width, height, depth, yaw = 0], index) => {
    transform.position.set(x, y, z);
    transform.rotation.set(0, yaw, 0);
    transform.scale.set(width, height, depth);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = mesh.receiveShadow = !material.transparent && !(material instanceof MeshBasicMaterial);
  group.add(mesh);
  return mesh;
}

function createPlanExtrusion(points: readonly PlanPoint[], bottom: number, top: number): BufferGeometry {
  const positions: number[] = [];
  for (const [x, z] of points) positions.push(x, bottom, z);
  for (const [x, z] of points) positions.push(x, top, z);
  const indices: number[] = [];
  const count = points.length;
  for (let index = 1; index < count - 1; index += 1) {
    // The plan points are wound for an upward-facing top. The reversed base
    // keeps the underside visible from the concourse camera.
    indices.push(0, index + 1, index, count, count + index, count + index + 1);
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(index, next, count + next, index, count + next, count + index);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addPlanMesh(group: Group, material: MeshStandardMaterial, points: readonly PlanPoint[], bottom: number,
  top: number, name: string): Mesh {
  const mesh = new Mesh(createPlanExtrusion(points, bottom, top), material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addEdgeRibbon(group: Group, material: MeshStandardMaterial | MeshBasicMaterial,
  segment: EdgeSegment, y: number, height: number, depth: number, name: string): Mesh {
  const [[startX, startZ], [endX, endZ]] = segment;
  const dx = endX - startX;
  const dz = endZ - startZ;
  const length = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dz, dx);
  return addBox(group, material, [(startX + endX) * .5, y, (startZ + endZ) * .5,
    length, height, depth, yaw], name);
}

function addCoveReturn(group: Group, material: MeshStandardMaterial, segment: EdgeSegment,
  inward: PlanPoint, underside: number, widthScale: number, dropScale: number, name: string): void {
  const [[x0, z0], [x1, z1]] = segment;
  const positions: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const facesDown = (z1 - z0) * inward[0] - (x1 - x0) * inward[1] < 0;
  for (const [index, [offset, drop, light]] of COVE_PROFILE.entries()) {
    const shiftX = inward[0] * offset * widthScale;
    const shiftZ = inward[1] * offset * widthScale;
    const y = underside + drop * dropScale;
    positions.push(x0 + shiftX, y, z0 + shiftZ, x1 + shiftX, y, z1 + shiftZ);
    uv.push(.25 + .5 * light, .5, .25 + .5 * light, .5);
    if (index === 0) continue;
    const a = (index - 1) * 2;
    indices.push(...(facesDown ? [a, a + 1, a + 3, a, a + 3, a + 2] : [a, a + 3, a + 1, a, a + 2, a + 3]));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function firstLevelPlanSections(side: number, front: number, back: number): PlanPoint[][] {
  const { taperZ, galleryEdge } = ATRIUM_FIRST_LEVEL_FORECOURT;
  const innerFront: PlanPoint = [atriumFirstLevelInnerEdge(front, side < 0 ? -1 : 1), front];
  const innerTaper: PlanPoint = [side * galleryEdge, taperZ];
  const innerBack: PlanPoint = [side * galleryEdge, back];
  const outerFront: PlanPoint = [side * OUTER_EDGE, front];
  const outerTaper: PlanPoint = [side * OUTER_EDGE, taperZ];
  const outerBack: PlanPoint = [side * OUTER_EDGE, back];
  return side < 0
    ? [[innerFront, innerTaper, outerTaper, outerFront], [innerTaper, innerBack, outerBack, outerTaper]]
    : [[innerFront, outerFront, outerTaper, innerTaper], [innerTaper, outerTaper, outerBack, innerBack]];
}

function firstLevelEdgeSegments(side: number, front: number, back: number): EdgeSegment[] {
  const { taperZ, galleryEdge } = ATRIUM_FIRST_LEVEL_FORECOURT;
  const first: PlanPoint = [atriumFirstLevelInnerEdge(front, side < 0 ? -1 : 1), front];
  const taper: PlanPoint = [side * galleryEdge, taperZ];
  const rear: PlanPoint = [side * galleryEdge, back];
  return [[first, taper], [taper, rear]];
}

function addFirstLevelGallery(group: Group, materials: AtriumMaterials, side: number,
  front: number, back: number): void {
  const plans = firstLevelPlanSections(side, front, back);
  const floor = ATRIUM_LEVELS[0];
  const slabBottom = floor - .49;
  // The deck is a continuous pale slab; only the narrow edge assembly below
  // carries the darker bronze tone visible from the floor.
  for (const [index, plan] of plans.entries()) {
    addPlanMesh(group, materials.plasterLight, plan, slabBottom, floor - .30,
      `Level 4.55 tapered cream soffit slab ${index + 1}`);
    addPlanMesh(group, materials.limestone, plan, floor - .30, floor,
      `Level 4.55 tapered structural slab ${index + 1}`);
  }

  const segments = firstLevelEdgeSegments(side, front, back);
  for (const [index, segment] of segments.entries()) {
    addEdgeRibbon(group, materials.bronze, segment, floor + .34, 1.60, .16,
      `Level 4.55 tapered bronze fluted fascia ${index + 1}`);
    addEdgeRibbon(group, materials.darkBronze, segment, floor - .427, .040, .18,
      `Level 4.55 lower brown metal reveal ${index + 1}`);
    addEdgeRibbon(group, materials.darkBronze, segment, floor + 1.105, .042, .18,
      `Level 4.55 upper brown metal reveal ${index + 1}`);
    addCoveReturn(group, materials.coveReturn, segment, [side, 0], slabBottom, 1, 1,
      `Level 4.55 tapered cove and plaster return ${index + 1}`);
  }

  const ribs: BoxSpec[] = [];
  for (const segment of segments) {
    const [[startX, startZ], [endX, endZ]] = segment;
    const dx = endX - startX, dz = endZ - startZ;
    const length = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    const count = Math.ceil(length / .123);
    for (let index = 0; index < count; index += 1) {
      const t = (index + .5) / count;
      const x = startX + dx * t - side * .082 * Math.abs(dz) / length;
      const z = startZ + dz * t + side * .082 * dx * Math.sign(dz) / length;
      ribs.push([x, floor + .34, z, .022, 1.46, .026, yaw]);
    }
  }
  addInstancedBoxes(group, materials.bronzeLight, 'Level 4.55 tapered fascia ribs', ribs);

  // A taller, quiet glass band starts exactly at the upper reveal, preserving
  // the same taper while keeping the guard profiles thin and champagne-toned.
  for (const [index, segment] of segments.entries()) {
    addEdgeRibbon(group, materials.glass, segment, floor + 1.81, 1.34, .032,
      `Level 4.55 tapered upper gallery glass ${index + 1}`);
    addEdgeRibbon(group, materials.champagne, segment, floor + 2.505, .070, .070,
      `Level 4.55 tapered champagne handrail ${index + 1}`);
  }
  const posts: BoxSpec[] = [];
  for (const segment of segments) {
    const [[startX, startZ], [endX, endZ]] = segment;
    const dx = endX - startX, dz = endZ - startZ;
    const length = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    const count = Math.max(1, Math.ceil(length / 1.50));
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      posts.push([startX + dx * t, floor + 1.79, startZ + dz * t, .058, 1.36, .058, yaw]);
    }
  }
  addInstancedBoxes(group, materials.champagne, 'Level 4.55 tapered guard posts', posts);
}

function addGalleryFascia(group: Group, materials: AtriumMaterials, side: number,
  level: number, front: number, back: number): void {
  const centerZ = (front + back) * .5;
  const edgeX = side * (INNER_EDGE + .065);
  addBox(group, materials.plasterLight, [side * (INNER_EDGE + .01), level - .047, centerZ, .12, .09,
    front - back + .22], `Level ${level.toFixed(2)} cream soffit return`);
  addCoveReturn(group, materials.coveReturn, [[side * (INNER_EDGE - .095), front],
    [side * (INNER_EDGE - .095), back]], [side, 0], level - .489, .73, .70,
  `Level ${level.toFixed(2)} recessed cream cove`);

  const fins: BoxSpec[] = [];
  for (const [start, end] of galleryRailRuns(side, level, front, back)) {
    const length = Math.abs(start - end);
    addBox(group, materials.bronze, [edgeX, level + .30, (start + end) * .5, .16, .68, length],
      `Level ${level.toFixed(2)} inner shadow fascia`);
    const count = Math.ceil(length / .145);
    for (let index = 0; index < count; index += 1) {
      const z = start + (end - start) * (index + .5) / count;
      fins.push([side * (INNER_EDGE - .015), level + .30, z, .027, .61, .023]);
    }
  }
  addInstancedBoxes(group, materials.bronzeLight, `Level ${level.toFixed(2)} repeated bronze ribs`, fins);
}

function galleryRailRuns(side: number, floor: number, front: number, back: number): [number, number][] {
  if (side < 0 && floor === ATRIUM_LEVELS[1]) {
    const upper = ATRIUM_UPPER_STAIR.start.z;
    return [[front, -36.78], [-43.34, upper + 1.36], [upper - 1.36, back]];
  }
  if (side > 0 && floor === ATRIUM_LEVELS[2]) {
    return [[front, ATRIUM_UPPER_LANDING.maxZ], [ATRIUM_UPPER_LANDING.minZ, back]];
  }
  return [[front, back]];
}

function addGuardRail(group: Group, materials: AtriumMaterials, side: number,
  floor: number, front: number, back: number): void {
  for (const [start, end] of galleryRailRuns(side, floor, front, back)) {
    const zMin = Math.min(start, end), zMax = Math.max(start, end);
    const depth = zMax - zMin;
    if (depth < .2) continue;
    const x = side * (INNER_EDGE + .015);
    addBox(group, materials.glass, [x, floor + .69, (start + end) * .5, .028, 1.22, depth],
      `Level ${floor.toFixed(2)} gallery guard glass`);
    addBox(group, materials.champagne, [x, floor + 1.34, (start + end) * .5, .072, .075, depth + .08],
      `Level ${floor.toFixed(2)} champagne handrail`);
    const posts: BoxSpec[] = [];
    const count = Math.max(1, Math.ceil(depth / 1.55));
    for (let index = 0; index <= count; index += 1) {
      posts.push([x, floor + .68, start + (end - start) * index / count, .084, 1.30, .084]);
    }
    addInstancedBoxes(group, materials.champagne, `Level ${floor.toFixed(2)} guard posts`, posts);
  }
}

function addPierWash(group: Group, materials: AtriumMaterials, side: number, piers: readonly BoxSpec[]): void {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const spread = [[.02, .22, .42], [.09, .32, .86], [.28, .49, .60], [.52, .65, .27], [.80, .81, 0]];
  const acrossBeam = [[-1, 0], [-.52, .58], [0, 1], [.52, .58], [1, 0]];
  const sources: BoxSpec[] = [];
  for (const [x, y, z, width, height, depth] of piers) {
    const face = x - side * (width * .5 + .003);
    const top = y + height * .5;
    for (const center of [z - depth * .215, z + depth * .215]) {
      const base = positions.length / 3;
      for (const [row, [drop, radius, intensity]] of spread.entries()) {
        for (const [column, [offset, light]] of acrossBeam.entries()) {
          positions.push(face, top - drop * height, center + offset * radius * depth * .49);
          colors.push(1, 1, 1, light * intensity);
          if (row === 0 || column === 0) continue;
          const a = base + (row - 1) * acrossBeam.length + column - 1;
          const b = a + acrossBeam.length;
          indices.push(a, a + 1, b + 1, a, b + 1, b);
        }
      }
      sources.push([face - side * .16, top - .06, center, .087, .022, .085]);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  const wash = new Mesh(geometry, materials.pierWash);
  wash.name = 'Paired downlight pools on upper limestone piers';
  // The wash sits on the stone underneath the transparent balcony guards.
  wash.renderOrder = -1;
  group.add(wash);
  addInstancedBoxes(group, materials.spot, 'Upper limestone pier downlights', sources);
}

function addUpperGallery(group: Group, materials: AtriumMaterials, side: number,
  levelIndex: number, floor: number, front: number, back: number): void {
  const centerZ = (front + back) * .5;
  const depth = Math.abs(front - back);
  const centerX = side * ((INNER_EDGE + OUTER_EDGE) * .5);
  if (levelIndex === 0) {
    addFirstLevelGallery(group, materials, side, front, back);
  } else {
    addBox(group, materials.darkBronze, [centerX, floor - .22, centerZ, OUTER_EDGE - INNER_EDGE + .18, .42, depth + .18],
      `Level ${floor.toFixed(2)} structural slab shadow`);
    addBox(group, materials.plasterLight, [centerX, floor - .405, centerZ, OUTER_EDGE - INNER_EDGE + .20, .16, depth + .20],
      `Level ${floor.toFixed(2)} full-width cream soffit plane`);
    addBox(group, materials.limestone, [centerX, floor - .045, centerZ, OUTER_EDGE - INNER_EDGE + .22, .10, depth + .22],
      `Level ${floor.toFixed(2)} structural slab limestone edge`);
    addGalleryFascia(group, materials, side, floor, front, back);
    addGuardRail(group, materials, side, floor, front, back);
  }

  const upper = STORY_TOPS[levelIndex];
  const roomBottom = floor + .24;
  const roomHeight = upper - roomBottom;
  addBox(group, materials.plaster, [side * (OUTER_EDGE - .14), roomBottom + roomHeight * .5, centerZ,
    .26, roomHeight, depth], `Level ${floor.toFixed(2)} outer wall continuation`);
  addBox(group, materials.ceiling, [side * 11.6, upper - .07, centerZ, 6.45, .14, depth],
    `Level ${floor.toFixed(2)} recessed ceiling`);

  // Shop windows sit behind the outer piers. The first gallery is visible from
  // below and its closer frontage brings the lit stone into the concourse view.
  const bays = Math.ceil(depth / 4.65);
  const bayDepth = depth / bays;
  const frontage = levelIndex === 0 ? 10.22 : 12.82;
  const bayGlass: BoxSpec[] = [];
  const bayFrames: BoxSpec[] = [];
  const piers: BoxSpec[] = [];
  const pierJoints: BoxSpec[] = [];
  const windowDisplays: BoxSpec[][] = [[], [], []];
  const displayMaterials = [materials.displayWarm, materials.displayCool, materials.displayNeutral];
  for (let index = 0; index < bays; index += 1) {
    const z = front - bayDepth * (index + .5);
    const pattern = (index + levelIndex + (side > 0 ? 2 : 0)) % 4;
    const window = frontage + [.48, 1.24, .80, 1.58][pattern];
    const sill = roomBottom + [.21, .36, .10, .31][pattern];
    const head = upper - [.56, .88, .44, .69][pattern];
    const span = bayDepth - [.69, .92, .56, .74][pattern];
    const centerY = (sill + head) * .5;
    bayGlass.push([side * window, centerY, z, .024, head - sill, span]);
    for (const edge of [-1, 1]) {
      bayFrames.push([side * (window - .035), centerY, z + edge * span * .5, .073, head - sill, .064]);
      bayFrames.push([side * (window - .035), centerY, z + edge * span * .165, .046, head - sill, .037]);
    }
    addBox(group, materials.darkBronze, [side * (window + .66), roomBottom + roomHeight * .5, z,
      .095, roomHeight, bayDepth + .02], `Level ${floor.toFixed(2)} recessed shop backing`);
    addBox(group, materials.darkBronze, [side * (window - .025), head + .10, z, .24, .22, span + .13],
      `Level ${floor.toFixed(2)} recessed shop transom`);
    addBox(group, materials.limestone, [side * (window + .28), sill + .055, z, .69, .14, span],
      `Level ${floor.toFixed(2)} limestone window sill`);
    const displays = windowDisplays[(index + 2 * levelIndex + (side > 0 ? 1 : 0)) % 3];
    displays.push([side * (window - .16), head + .09, z - span * .073, .025, .055, span * .46]);
    displays.push([side * (window + .57), sill + (head - sill) * .43, z - span * .18,
      .028, (head - sill) * .55, span * .30]);
    displays.push([side * (window + .58), sill + (head - sill) * .34, z + span * .19,
      .028, (head - sill) * .38, span * .25]);

    const pierZ = z + bayDepth * .5;
    const pierWidth = pattern === 1 ? 1.04 : .73;
    piers.push([side * (frontage + .12), roomBottom + roomHeight * .5, pierZ, .54, roomHeight, pierWidth]);
    for (let y = roomBottom + .64; y < upper - .26; y += .65) {
      pierJoints.push([side * (frontage - .151), y, pierZ, .012, .010, pierWidth - .02]);
    }
  }
  addInstancedBoxes(group, materials.glass, `Level ${floor.toFixed(2)} upper shop glazing`, bayGlass);
  addInstancedBoxes(group, materials.champagne, `Level ${floor.toFixed(2)} shop mullions`, bayFrames);
  addInstancedBoxes(group, materials.limestone, `Level ${floor.toFixed(2)} honed limestone piers`, piers);
  addInstancedBoxes(group, materials.plaster, `Level ${floor.toFixed(2)} limestone course joints`, pierJoints);
  windowDisplays.forEach((boxes, index) => addInstancedBoxes(group, displayMaterials[index],
    `Level ${floor.toFixed(2)} upper shop display highlights`, boxes));
  addPierWash(group, materials, side, piers);
}

function addCrossRail(group: Group, materials: AtriumMaterials,
  minX: number, maxX: number, front: number, floor: number): void {
  const width = maxX - minX;
  const x = (minX + maxX) * .5;
  addBox(group, materials.glass, [x, floor + .65, front, width, 1.14, .026], 'Cross gallery guard glass');
  addBox(group, materials.champagne, [x, floor + 1.25, front, width, .057, .059], 'Cross gallery handrail');
  const count = Math.max(1, Math.ceil(width / 1.42));
  const posts: BoxSpec[] = Array.from({ length: count + 1 }, (_, index) =>
    [minX + width * index / count, floor + .64, front, .050, 1.23, .048]);
  addInstancedBoxes(group, materials.champagne, 'Cross gallery slim guard posts', posts);
}

function addCrossDeck(group: Group, materials: AtriumMaterials, floor: number,
  area: { minX: number; maxX: number; minZ: number; maxZ: number }, label: string,
  hasParapet = true, beamSetback = 0): void {
  const { minX, maxX, minZ, maxZ } = area;
  const x = (minX + maxX) * .5, z = (minZ + maxZ) * .5;
  const width = maxX - minX, depth = maxZ - minZ;
  addBox(group, materials.plasterLight, [x, floor - .272, z - beamSetback * .5, width, .44, depth - beamSetback],
    `${label} deep cream soffit`);
  addBox(group, materials.limestone, [x, floor - .055, z, width + .015, .107, depth + .015],
    `${label} limestone deck`);
  if (beamSetback > 0) return;
  const fasciaY = hasParapet ? floor + .19 : floor - .197;
  addBox(group, materials.bronze, [x, fasciaY, maxZ - .035, width, .38, .095], `${label} near fascia`);
  addCoveReturn(group, materials.coveReturn, [[minX, maxZ - .035], [maxX, maxZ - .035]],
    [0, -1], floor - .496, .66, .64, `${label} warm cove`);
}

function addRearBridges(group: Group, materials: AtriumMaterials): void {
  addCrossDeck(group, materials, ATRIUM_LEVELS[0], ATRIUM_FIRST_BRIDGE, 'First gallery projecting return');
  addCrossRail(group, materials, ATRIUM_FIRST_BRIDGE.minX, ATRIUM_FIRST_BRIDGE.maxX - .15,
    ATRIUM_FIRST_BRIDGE.maxZ - .035, ATRIUM_LEVELS[0]);
  addCrossDeck(group, materials, ATRIUM_LEVELS[1], ATRIUM_STAIR_WEST_LINK, 'West curved stair receiving wing', false);
  addCrossDeck(group, materials, ATRIUM_LEVELS[2], ATRIUM_UPPER_LANDING, 'Upper diagonal stair head', false, 1.34);
  addCrossRail(group, materials, ATRIUM_UPPER_LANDING.minX, INNER_EDGE - .04,
    ATRIUM_UPPER_LANDING.maxZ - .035, ATRIUM_LEVELS[2]);
  addCrossRail(group, materials, ATRIUM_UPPER_LANDING.minX, INNER_EDGE - .04,
    ATRIUM_UPPER_LANDING.minZ + .035, ATRIUM_LEVELS[2]);

  const rear = { minX: -INNER_EDGE, maxX: INNER_EDGE, minZ: REAR_Z, maxZ: ATRIUM_REAR_GALLERY };
  for (const floor of ATRIUM_LEVELS.slice(1)) {
    addCrossDeck(group, materials, floor, rear, 'Back gallery link');
    addCrossRail(group, materials, rear.minX, rear.maxX, rear.maxZ, floor);
  }
}

function addGroundSideShell(group: Group, materials: AtriumMaterials, side: -1 | 1): void {
  const wallThickness = .18;
  const wallX = ATRIUM_TENANT_COMMON.existingPerimeterX;
  const groundTop = ATRIUM_TENANT_COMMON.soffit;
  const name = side < 0 ? 'West' : 'East';
  const sideBays = ATRIUM_TENANTS
    .filter(bay => bay.side === (side < 0 ? 'west' : 'east'))
    .slice()
    .sort((first, second) => first.span[0] - second.span[0]);
  let cursor = ATRIUM_TENANT_COMMON.nearS;

  const addRange = (startS: number, endS: number, label: string): void => {
    if (endS <= startS) return;
    const width = endS - startS;
    const z = -(startS + endS) * .5;
    addBox(group, materials.plaster, [side * wallX, groundTop * .5, z, wallThickness, groundTop, width],
      `${name} ground side wall ${label}`);
    // The dark strip is kept on the concourse-facing edge. Splitting both
    // elements by bay span prevents one continuous backing wall from enclosing
    // a neighboring tenant while preserving the existing upper shell.
    addBox(group, materials.darkBronze, [side * (wallX - wallThickness * .5), groundTop * .5, z,
      .028, groundTop - .24, width], `${name} ground vertical reveal ${label}`);
  };

  for (const bay of sideBays) {
    if (bay.span[0] > cursor) addRange(cursor, bay.span[0], 'interstitial');
    cursor = bay.span[1];
  }
  if (cursor < ATRIUM_TENANT_COMMON.rearS) addRange(cursor, ATRIUM_TENANT_COMMON.rearS, 'rear return');
}

function addOuterStructure(group: Group, materials: AtriumMaterials): void {
  const wallDepth = Math.abs(FRONT_Z - REAR_Z) + .3;
  const wallCenter = (FRONT_Z + REAR_Z) * .5;
  const groundTop = ATRIUM_TENANT_COMMON.soffit;
  for (const side of [-1, 1] as const) {
    // Keep the upper wall continuous for the existing galleries. The ground
    // course is supplied by the tenant-span segments below.
    const upperHeight = 17.04 - groundTop;
    addBox(group, materials.plaster, [side * (OUTER_EDGE - .12), groundTop + upperHeight * .5, wallCenter,
      .26, upperHeight, wallDepth], `${side < 0 ? 'West' : 'East'} outer atrium upper wall`);
    addGroundSideShell(group, materials, side);

    // Piers crossing a ground-floor shop are removed from the lower course;
    // their gallery-height shafts and trims remain in the established shell.
    const pierBoxes: BoxSpec[] = [];
    const upperPierHeight = 16.90 - groundTop;
    for (let index = 0; index <= 4; index += 1) {
      const z = FRONT_Z - index * (Math.abs(FRONT_Z - REAR_Z) / 4);
      pierBoxes.push([side * 14.54, groundTop + upperPierHeight * .5, z, .42, upperPierHeight, .48]);
      for (const y of [4.28, 8.88, 13.28]) {
        pierBoxes.push([side * 14.48, y, z, .58, .16, .66]);
      }
    }
    addInstancedBoxes(group, materials.plasterLight, `${side < 0 ? 'West' : 'East'} upper column details`, pierBoxes);

    for (const relocation of ATRIUM_TENANT_COMMON.pierRelocations) {
      if ((relocation.x < 0) !== (side < 0)) continue;
      addBox(group, materials.plasterLight, [relocation.x, groundTop * .5, -relocation.groundS,
        .58, groundTop, .66], `${side < 0 ? 'West' : 'East'} ${relocation.bay} relocated ground decorative pier`);
      addBox(group, materials.bronzeLight, [relocation.x, groundTop - .10, -relocation.groundS,
        .66, .10, .74], `${relocation.bay} ground pier upper trim`);
    }

    const upperRevealHeight = 16.25 - groundTop;
    addBox(group, materials.darkBronze, [side * (OUTER_EDGE - .245), groundTop + upperRevealHeight * .5, wallCenter,
      .035, upperRevealHeight, wallDepth - .35], `${side < 0 ? 'West' : 'East'} upper wall vertical reveal`);
  }

  // At +Z the end is a luminous entry/transom, with its pedestrian opening
  // above the clear ground route.  There is no solid cross-wall at floor level.
  addBox(group, materials.plasterLight, [0, 4.10, FRONT_Z - .10, 29.70, .36, .28], 'Front entry lintel');
  addBox(group, materials.darkBronze, [0, 3.82, FRONT_Z - .255, 29.72, .08, .12], 'Front entry shadow reveal');
  addBox(group, materials.glass, [0, 4.38, FRONT_Z - .25, 21.55, .36, .026], 'Front entry transparent transom');
  const entryFrames: BoxSpec[] = [];
  for (let index = -9; index <= 9; index += 1) {
    entryFrames.push([index * 1.12, 4.38, FRONT_Z - .285, .034, .40, .07]);
  }
  addInstancedBoxes(group, materials.champagne, 'Front entry transom mullions', entryFrames);
  addBox(group, materials.cove, [0, 3.88, FRONT_Z - .34, 21.10, .036, .040], 'Front entry warm reveal');
}

function addPedestrianTermini(group: Group, materials: AtriumMaterials): void {
  // The recessed vestibules preserve the depth of the sightline past the glazed boundary.
  for (const [z, direction, label] of [[FRONT_Z + .17, 1, 'Front'], [REAR_Z - .17, -1, 'Rear']] as const) {
    const rear = direction < 0;
    const insideFace = z - direction * .14;
    for (const side of [-1, 1]) {
      const entranceWallHeight = rear ? 4.96 - ATRIUM_TENANT_COMMON.soffit : 4.96;
      const entranceWallY = rear ? ATRIUM_TENANT_COMMON.soffit + entranceWallHeight * .5 : 2.48;
      addBox(group, materials.plaster, [side * 9.93, entranceWallY, z, 10.14, entranceWallHeight, .24], `${label} stone entrance wall`);
      const sideWallHeight = rear ? 4.25 - ATRIUM_TENANT_COMMON.soffit : 4.25;
      const sideWallY = rear ? ATRIUM_TENANT_COMMON.soffit + sideWallHeight * .5 : 2.13;
      addBox(group, materials.plaster, [side * 4.83, sideWallY, z + direction * 5.1, .22, sideWallHeight, 10.2],
        `${label} vestibule side wall`);
      if (!rear) {
        addBox(group, materials.cove, [side * 4.48, 3.84, z + direction * 5.1, .10, .072, 10.1],
          `${label} vestibule indirect lighting`);
      }
    }
    if (rear) {
      // F1/F2 own the two rear sightline rectangles.  Split the old centre
      // vestibule slabs at those rectangles so the authored FL+0 floor and
      // soffit continuation meet it without coplanar duplicate faces.
      const oldCenterS = -(z + direction * 5.1);
      const oldStartS = oldCenterS - 5.15;
      const oldEndS = oldCenterS + 5.15;
      const f1 = ATRIUM_TENANT_COMMON.rearReveals.find(reveal => reveal.id === 'F1');
      const f2 = ATRIUM_TENANT_COMMON.rearReveals.find(reveal => reveal.id === 'F2');
      const firstBreak = f1?.x[1] ?? -4.3;
      const secondBreak = f2?.x[0] ?? -1.16;
      const f1Plane = ATRIUM_TENANTS.find(bay => bay.id === 'F1')?.plane ?? f1?.s[1] ?? oldStartS;
      const f2Plane = ATRIUM_TENANTS.find(bay => bay.id === 'F2')?.plane ?? f2?.s[1] ?? oldStartS;
      const slabRanges: readonly (readonly [number, number, number])[] = [
        [-4.85, firstBreak, f1Plane],
        [firstBreak, secondBreak, oldStartS],
        [secondBreak, 4.85, f2Plane],
      ];
      for (const [x0, x1, startS] of slabRanges) {
        const clippedStart = Math.max(oldStartS, Math.min(oldEndS, startS));
        if (x1 <= x0 || oldEndS <= clippedStart) continue;
        const depth = oldEndS - clippedStart;
        const centerS = (clippedStart + oldEndS) * .5;
        addBox(group, materials.limestone, [(x0 + x1) * .5, -.052, -centerS, x1 - x0, .10, depth],
          `${label} vestibule floor split`);
        addBox(group, materials.ceiling, [(x0 + x1) * .5, 4.21, -centerS, x1 - x0, .25, depth],
          `${label} vestibule ceiling split`);
      }
    } else {
      addBox(group, materials.limestone, [0, -.052, z + direction * 5.1, 9.70, .10, 10.3], `${label} vestibule floor`);
      addBox(group, materials.ceiling, [0, 4.21, z + direction * 5.1, 9.68, .25, 10.3], `${label} vestibule ceiling`);
    }
    addBox(group, materials.plaster, [0, 2.14, z + direction * 10.2, 9.7, 4.27, .19], `${label} vestibule far wall`);
    addBox(group, materials.plasterLight, [0, 2.14, z + direction * 10.09, 4.28, 3.62, .09], `${label} pale entry portal`);
    if (!rear) {
      addBox(group, materials.glass, [0, 2.28, insideFace - direction * .052, 8.42, 4.16, .026],
        `${label} translucent terminus glazing`);
      addBox(group, materials.limestone, [-4.72, 2.48, insideFace, .42, 4.78, .19], `${label} terminus west pier`);
      addBox(group, materials.limestone, [4.72, 2.48, insideFace, .42, 4.78, .19], `${label} terminus east pier`);
    }
    addBox(group, materials.plasterLight, [0, 4.93, insideFace, 10.28, .22, .22], `${label} terminus pale lintel`);
    addBox(group, materials.cove, [0, 4.78, insideFace - direction * .025, 7.42, .038, .042], `${label} terminus warm cove`);
    if (!rear) {
      const mullions: BoxSpec[] = [];
      for (const x of [-3.15, -1.05, 1.05, 3.15]) {
        mullions.push([x, 2.55, insideFace - direction * .068, .045, 3.82, .052]);
      }
      addInstancedBoxes(group, materials.champagne, `${label} terminus vertical mullions`, mullions);
    }
    for (const level of ATRIUM_LEVELS) {
      addBox(group, materials.plaster, [0, level + 2.04, z, 29.85, 4.42, .21], `${label} level return wall`);
      addBox(group, materials.bronze, [0, level + .28, insideFace, 22.65, .55, .11], `${label} horizontal return fascia`);
      addBox(group, materials.plasterLight, [0, level + 2.28, insideFace, 17.75, 2.63, .13], `${label} return wall panel`);
      for (const x of [-7.0, -3.5, 0, 3.5, 7.0]) {
        addBox(group, materials.limestone, [x, level + 2.22, insideFace - direction * .12, .14, 2.46, .12],
          `${label} return wall joints`);
      }
    }

    if (rear) {
      const groundTop = ATRIUM_TENANT_COMMON.soffit;
      const f1 = ATRIUM_TENANT_COMMON.rearReveals.find(reveal => reveal.id === 'F1');
      const f2 = ATRIUM_TENANT_COMMON.rearReveals.find(reveal => reveal.id === 'F2');
      if (f1 && f2) {
        // Close only the old terminus portions outside the two authored
        // rectangles. The openings remain clear from FL+0 to their recorded
        // head heights; the centre interval is a stone sleeve, not an exterior
        // view into the vestibule.
        addBox(group, materials.limestone, [(-15 + f1.x[0]) * .5, groundTop * .5, z,
          f1.x[0] + 15, groundTop, .24], 'Rear west ground stone return outside F1');
        addBox(group, materials.limestone, [(f2.x[1] + 15) * .5, groundTop * .5, z,
          15 - f2.x[1], groundTop, .24], 'Rear east ground stone return outside F2');
        const centreWidth = f2.x[0] - f1.x[1];
        if (centreWidth > 0) {
          const centreS = Math.min(f1.floorStartS, f2.floorStartS) + .38;
          addBox(group, materials.limestone, [(f1.x[1] + f2.x[0]) * .5, groundTop * .5, -centreS,
            centreWidth, groundTop, .76], 'Rear F1-F2 central stone sleeve wall');
        }
      }
    }
  }
}

function addRearTenantOpenings(group: Group, materials: AtriumMaterials): void {
  const ceilingY = ATRIUM_TENANT_COMMON.soffit + .08;
  for (const reveal of ATRIUM_TENANT_COMMON.rearReveals) {
    const bay = ATRIUM_TENANTS.find(candidate => candidate.id === reveal.id && candidate.side === 'rear');
    if (!bay) continue;
    const [x0, x1] = reveal.x;
    const floorStart = reveal.floorStartS;
    const plane = bay.plane ?? reveal.s[1];
    const openingDepth = plane - floorStart;
    if (openingDepth <= 0 || x1 <= x0) continue;
    const centerX = (x0 + x1) * .5;
    const frontZ = -floorStart;
    const depthCenterZ = -(floorStart + plane) * .5;
    const width = x1 - x0;
    const head = reveal.head;
    addBox(group, materials.limestone, [centerX, -.052, depthCenterZ, width, .10, openingDepth],
      `${reveal.id} FL+0 connected rear tenant floor`);
    addBox(group, materials.ceiling, [centerX, ceilingY, depthCenterZ, width, .16, openingDepth],
      `${reveal.id} rear tenant ceiling continuation`);

    // A short jamb/header assembly leaves the common floor sightline open while
    // retaining the stone sleeve at the old terminus.
    const sleeveDepth = Math.min(.72, openingDepth * .45);
    const sleeveCenterZ = -(floorStart + sleeveDepth * .5);
    addBox(group, materials.limestone, [x0 - .09, head * .5, sleeveCenterZ, .18, head, sleeveDepth],
      `${reveal.id} short west limestone sleeve`);
    addBox(group, materials.limestone, [x1 + .09, head * .5, sleeveCenterZ, .18, head, sleeveDepth],
      `${reveal.id} short east limestone sleeve`);
    addBox(group, materials.plasterLight, [centerX, head + .06, frontZ + .02, width + .36, .12, .18],
      `${reveal.id} rear reveal head +${reveal.head.toFixed(2)}`);
    addBox(group, materials.champagne, [x0, head * .5, frontZ + .025, .035, head, .045],
      `${reveal.id} rear reveal west glass jamb`);
    addBox(group, materials.champagne, [x1, head * .5, frontZ + .025, .035, head, .045],
      `${reveal.id} rear reveal east glass jamb`);
  }

}

function addRecessedSpots(group: Group, materials: AtriumMaterials): void {
  const spots: BoxSpec[] = [];
  const vents: BoxSpec[] = [];
  for (const [levelIndex, floor] of ATRIUM_LEVELS.entries()) {
    for (const side of [-1, 1] as const) {
      for (let index = 0; index < 12; index += 1) {
        const z = GALLERY_FRONT[levelIndex] - 2.2 - index * 4.55;
        const edge = levelIndex === 0 ? atriumFirstLevelInnerEdge(z, side) : side * INNER_EDGE;
        const x = edge + side * (levelIndex === 0 ? 2.57 : 2.13);
        spots.push([x, floor - .505, z, .12, .024, .12]);
        spots.push([x + side * .16, floor - .505, z - .20, .12, .024, .12]);
        if (levelIndex === 0) {
          for (const offset of [-.071, -.035, 0, .035, .071]) {
            vents.push([x + side * (.38 + offset), floor - .495, z - 1.55, .014, .011, 1.73]);
          }
        }
      }
    }
  }
  addInstancedBoxes(group, materials.bronze, 'Fine soffit return ventilation slots', vents);
  addInstancedBoxes(group, materials.darkBronze, 'Repeated recessed spot housings', spots);
  const diffusers = new InstancedMesh(new CylinderGeometry(.045, .045, .009, 10), materials.spot, spots.length);
  const transform = new Object3D();
  for (const [index, [x, y, z]] of spots.entries()) {
    transform.position.set(x, y - .027, z);
    transform.updateMatrix();
    diffusers.setMatrixAt(index, transform.matrix);
  }
  diffusers.name = 'Repeated recessed spot diffusers';
  group.add(diffusers);
}

function addArchitecturalScreen(group: Group, materials: AtriumMaterials): void {
  const x = 14.67;
  const y = 2.55;
  const z = -22.2;
  addBox(group, materials.darkBronze, [x, y, z, .07, 1.82, 1.12], 'Small transparent screen frame');
  addBox(group, materials.screen, [x - .045, y, z, .018, 1.55, .91], 'Small transparent architectural screen');
  addBox(group, materials.blueScreen, [x - .057, y, z, .008, 1.25, .72], 'Small screen soft blue glow');
  for (const yOffset of [-.57, -.19, .19, .57]) {
    addBox(group, materials.champagne, [x - .068, y + yOffset, z, .024, .025, .73], 'Small screen mullion');
  }
}

function addColumnDetails(group: Group, materials: AtriumMaterials): void {
  const groundTop = ATRIUM_TENANT_COMMON.soffit;
  const upperHeight = 16.72 - groundTop;
  const upperCenter = groundTop + upperHeight * .5;
  for (const side of [-1, 1]) {
    for (const z of [-5.4, -17.0, -29.0, -41.0]) {
      const x = side * 13.55;
      // These shafts belong to the upper gallery composition. Their former
      // full-height ground portions crossed tenant rooms and are intentionally
      // omitted; the relocated L1/L2 piers are authored from the JSON above.
      addBox(group, materials.limestone, [x, upperCenter, z, .66, upperHeight, .72], 'Architectural upper side column shaft');
      addBox(group, materials.plasterLight, [x, 16.83, z, 1.02, .28, 1.08], 'Architectural side column capital');
      for (const y of [4.22, 8.82, 13.22]) {
        addBox(group, materials.bronzeLight, [x, y, z, .82, .10, .91], 'Architectural side column trim');
      }
      const insetHeight = 15.52 - groundTop;
      addBox(group, materials.darkBronze, [side * (13.18), groundTop + insetHeight * .5, z, .038, insetHeight, .19], 'Architectural upper side column inset');
    }
  }
}

function addUpperShadowGaps(group: Group, materials: AtriumMaterials): void {
  for (const [index, floor] of ATRIUM_LEVELS.entries()) {
    for (const side of [-1, 1]) {
      const front = GALLERY_FRONT[index];
      const z = (front + REAR_Z) * .5;
      addBox(group, materials.darkBronze, [side * 13.12, floor - .49, z, .055, .018, Math.abs(front - REAR_Z) - .16],
        `Level ${floor.toFixed(2)} narrow ceiling shadow gap`);
    }
  }
}

export function buildAtriumShell(root: Group, stoneMap: Texture | null): LightingTargets {
  const group = new Group();
  group.name = 'Commercial atrium architectural shell';
  root.add(group);
  const materials = makeMaterials();
  materials.limestone.map = stoneMap;
  if (stoneMap) materials.limestone.color.setHex(0xddd5c7);

  addOuterStructure(group, materials);
  addPedestrianTermini(group, materials);
  addRearTenantOpenings(group, materials);
  addColumnDetails(group, materials);
  for (const [index, floor] of ATRIUM_LEVELS.entries()) {
    for (const side of [-1, 1]) addUpperGallery(group, materials, side, index, floor, GALLERY_FRONT[index], REAR_Z);
  }
  addRearBridges(group, materials);
  addUpperShadowGaps(group, materials);
  addRecessedSpots(group, materials);
  addArchitecturalScreen(group, materials);

  const lighting: LightingTargets = {
    setLighting(artificialOn, time) {
      const night = time === 'night';
      const fixtureColor = artificialOn
        ? night ? 0xffcf9a : 0xffe4bf
        : 0x4b4139;
      const spotColor = artificialOn
        ? night ? 0xffad67 : 0xffd8a2
        : 0x51463d;
      materials.cove.color.setHex(fixtureColor);
      materials.coveReturn.emissive.setHex(night ? 0xffc797 : 0xffebd2);
      materials.coveReturn.emissiveIntensity = artificialOn ? (night ? .98 : 1.20) : 0;
      materials.pierWash.opacity = artificialOn ? (night ? .68 : .78) : 0;
      materials.spot.color.setHex(spotColor);
      materials.displayWarm.opacity = artificialOn ? (night ? .72 : .78) : .18;
      materials.displayCool.opacity = artificialOn ? (night ? .52 : .65) : .16;
      materials.displayNeutral.opacity = artificialOn ? (night ? .60 : .70) : .17;
      // MeshBasicMaterial carries the architectural glow without introducing
      // dynamic Three.js Lights; surfaces still respond to the world's lights.
      materials.blueScreen.opacity = artificialOn ? (night ? .72 : .56) : .20;

    },
  };
  lighting.setLighting(true, 'day');
  return lighting;
}
