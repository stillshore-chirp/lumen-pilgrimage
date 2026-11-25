import {
  BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Mesh,
  MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, type Texture,
} from 'three';
import {
  ATRIUM_BOUNDS, ATRIUM_FIRST_BRIDGE, ATRIUM_FIRST_LEVEL_FORECOURT, ATRIUM_GALLERY_EDGE, ATRIUM_GALLERY_FRONTS,
  ATRIUM_LEVELS, ATRIUM_REAR_GALLERY, ATRIUM_STAIR_WEST_LINK, ATRIUM_UPPER_LANDING, ATRIUM_UPPER_STAIR,
  atriumFirstLevelInnerEdge,
} from './atriumLayout';

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
  bronze: MeshStandardMaterial;
  bronzeLight: MeshStandardMaterial;
  darkBronze: MeshStandardMaterial;
  champagne: MeshStandardMaterial;
  glass: MeshPhysicalMaterial;
  screen: MeshPhysicalMaterial;
  cove: MeshBasicMaterial;
  soffitWash: MeshBasicMaterial;
  soffitWashSoft: MeshBasicMaterial;
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
function makeMaterials(): AtriumMaterials {
  const solid = (name: string, color: number, roughness: number, metalness = 0): MeshStandardMaterial =>
    new MeshStandardMaterial({ name, color, roughness, metalness });
  const glass = (name: string, color: number, opacity: number, roughness: number): MeshPhysicalMaterial =>
    new MeshPhysicalMaterial({
      name, color, opacity, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true,
      roughness, metalness: 0.08, ior: 1.48, specularIntensity: 0.42,
    });
  return {
    ceiling: solid('Commercial atrium microtextured ceiling', 0xf0e6d8, .91),
    limestone: solid('Warm honed limestone atrium stone', 0xbba890, .77),
    plaster: solid('Warm mineral atrium plaster', 0xd9c6ae, .84),
    plasterLight: solid('Cream limestone light reveals', 0xefe1cc, .74),
    bronze: solid('Ribbed dark bronze fascia', 0x4c3930, .49, .48),
    bronzeLight: solid('Warm bronze fascia highlights', 0x755846, .43, .42),
    darkBronze: solid('Shadow gap dark bronze', 0x272324, .52, .36),
    champagne: solid('Pale champagne titanium slim profiles', 0xbab4a8, .38, .58),
    glass: glass('Low reflection upper gallery glazing', 0x9ab5b6, .15, .19),
    screen: glass('Transparent architectural screen', 0x74c0d9, .33, .13),
    cove: new MeshBasicMaterial({ name: 'Warm concealed cove diffuser', color: 0xffc27f, toneMapped: false }),
    soffitWash: new MeshBasicMaterial({ name: 'Pale warm soffit indirect wash', color: 0xffd7ac,
      transparent: true, opacity: .62, depthWrite: false, toneMapped: false }),
    soffitWashSoft: new MeshBasicMaterial({ name: 'Soft warm soffit gradient wash', color: 0xffead0,
      transparent: true, opacity: .24, depthWrite: false, toneMapped: false }),
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

function addInstancedBoxes(group: Group, material: MeshStandardMaterial, name: string,
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
  mesh.castShadow = true;
  mesh.receiveShadow = true;
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
    addEdgeRibbon(group, materials.darkBronze, segment, floor - .425, .070, .18,
      `Level 4.55 lower brown metal reveal ${index + 1}`);
    addEdgeRibbon(group, materials.darkBronze, segment, floor + 1.105, .070, .18,
      `Level 4.55 upper brown metal reveal ${index + 1}`);
    addEdgeRibbon(group, materials.cove, segment, floor - .515, .030, .085,
      `Level 4.55 continuous warm cove ${index + 1}`);
    addEdgeRibbon(group, materials.soffitWash, segment, floor - .545, .020, .115,
      `Level 4.55 pale cove wash ${index + 1}`);
  }

  const ribs: BoxSpec[] = [];
  for (const segment of segments) {
    const [[startX, startZ], [endX, endZ]] = segment;
    const dx = endX - startX, dz = endZ - startZ;
    const length = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    const count = Math.ceil(length / .34);
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const x = startX + dx * t - side * .092;
      const z = startZ + dz * t;
      ribs.push([x, floor + .34, z, .055, 1.46, .050, yaw]);
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
  const depth = Math.abs(front - back) + .12;
  const edgeX = side * (INNER_EDGE + .065);
  addBox(group, materials.plasterLight, [side * (INNER_EDGE + .01), level - .047, centerZ, .12, .09, depth + .10],
    `Level ${level.toFixed(2)} cream soffit return`);
  addBox(group, materials.cove, [side * (INNER_EDGE + .16), level - .48, centerZ, .13, .08, depth - .04],
    `Level ${level.toFixed(2)} concealed cove`);
  // A broad cream soffit wash keeps the underside legible from the ground. The
  // two overlapping strips fade toward the outer shop side while the dark
  // bronze remains limited to the narrow edge fascia above.
  addBox(group, materials.soffitWash, [side * (INNER_EDGE + .76), level - .498, centerZ,
    1.12, .015, depth - .14], `Level ${level.toFixed(2)} pale inner soffit wash`);
  addBox(group, materials.soffitWashSoft, [side * (INNER_EDGE + 1.75), level - .497, centerZ,
    .90, .014, depth - .20], `Level ${level.toFixed(2)} soft outer soffit gradient`);

  const fins: BoxSpec[] = [];
  for (const [start, end] of galleryRailRuns(side, level, front, back)) {
    const length = Math.abs(start - end);
    addBox(group, materials.darkBronze, [edgeX, level + .34, (start + end) * .5, .16, .68, length],
      `Level ${level.toFixed(2)} inner shadow fascia`);
    const count = Math.ceil(length / .32);
    for (let index = 0; index <= count; index += 1) {
      const z = start + (end - start) * index / count;
      fins.push([side * (INNER_EDGE + .15), level + .34, z, .075, .76, .050]);
    }
  }
  addInstancedBoxes(group, materials.bronze, `Level ${level.toFixed(2)} repeated bronze ribs`, fins);
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

  // Repeated upper shop fronts, set behind the guard line so the balcony reads
  // as a real circulation band rather than a floating ribbon.
  const bays = Math.ceil(depth / 3.05);
  const bayDepth = depth / bays;
  const bayGlass: BoxSpec[] = [];
  const bayFrames: BoxSpec[] = [];
  for (let index = 0; index < bays; index += 1) {
    const z = front - bayDepth * (index + .5);
    const display = [materials.displayWarm, materials.displayCool, materials.displayNeutral][index % 3];
    bayGlass.push([side * 14.60, roomBottom + roomHeight * .54, z, .030, roomHeight * .57, bayDepth - .12]);
    bayFrames.push([side * 14.46, roomBottom + roomHeight * .54, z - bayDepth * .5 + .07, .095, roomHeight * .67, .095]);
    bayFrames.push([side * 14.46, roomBottom + roomHeight * .54, z + bayDepth * .5 - .07, .095, roomHeight * .67, .095]);
    addBox(group, materials.darkBronze, [side * 14.72, roomBottom + roomHeight * .45, z,
      .08, roomHeight * .80, bayDepth - .24], `Level ${floor.toFixed(2)} recessed shop bay`);
    addBox(group, display, [side * 14.55, roomBottom + roomHeight * .48, z,
      .035, roomHeight * .43, bayDepth - .34], `Level ${floor.toFixed(2)} varied luminous display panel`);
    addBox(group, display, [side * 14.52, upper - .56, z, .027, .050, bayDepth - .45],
      `Level ${floor.toFixed(2)} varied display header strip`);
    addBox(group, materials.plasterLight, [side * 14.52, upper - .32, z, .12, .10, bayDepth - .16],
      `Level ${floor.toFixed(2)} shop bay cove`);
  }
  const glassMesh = addInstancedBoxes(group, materials.glass, `Level ${floor.toFixed(2)} upper shop glazing`, bayGlass);
  glassMesh.castShadow = false;
  addInstancedBoxes(group, materials.champagne, `Level ${floor.toFixed(2)} shop mullions`, bayFrames);

  // An architectural pier rhythm at the outer edge carries the repeated slabs.
  const piers: BoxSpec[] = [];
  for (let index = 0; index <= bays; index += 1) {
    const z = front - bayDepth * index;
    piers.push([side * 14.31, roomBottom + roomHeight * .5, z, .34, roomHeight + .04, .15]);
  }
  addInstancedBoxes(group, materials.plasterLight, `Level ${floor.toFixed(2)} upper volume piers`, piers);
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
  area: { minX: number; maxX: number; minZ: number; maxZ: number }, label: string, hasParapet = true): void {
  const { minX, maxX, minZ, maxZ } = area;
  const x = (minX + maxX) * .5, z = (minZ + maxZ) * .5;
  const width = maxX - minX, depth = maxZ - minZ;
  addBox(group, materials.plasterLight, [x, floor - .253, z, width, .478, depth], `${label} deep cream soffit`);
  addBox(group, materials.limestone, [x, floor - .041, z, width + .015, .070, depth + .015], `${label} limestone deck`);
  const fasciaY = hasParapet ? floor + .19 : floor - .197;
  addBox(group, materials.bronze, [x, fasciaY, maxZ - .035, width, .38, .095], `${label} near fascia`);
  addBox(group, materials.cove, [x, floor - .455, maxZ - .14, width - .07, .071, .105], `${label} warm cove`);
}

function addRearBridges(group: Group, materials: AtriumMaterials): void {
  addCrossDeck(group, materials, ATRIUM_LEVELS[0], ATRIUM_FIRST_BRIDGE, 'First gallery projecting return');
  addCrossRail(group, materials, ATRIUM_FIRST_BRIDGE.minX, ATRIUM_FIRST_BRIDGE.maxX - .15,
    ATRIUM_FIRST_BRIDGE.maxZ - .035, ATRIUM_LEVELS[0]);
  addCrossDeck(group, materials, ATRIUM_LEVELS[1], ATRIUM_STAIR_WEST_LINK, 'West curved stair receiving wing', false);
  addCrossDeck(group, materials, ATRIUM_LEVELS[2], ATRIUM_UPPER_LANDING, 'Upper diagonal stair head');
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

function addOuterStructure(group: Group, materials: AtriumMaterials): void {
  const wallDepth = Math.abs(FRONT_Z - REAR_Z) + .3;
  const wallCenter = (FRONT_Z + REAR_Z) * .5;
  for (const side of [-1, 1]) {
    addBox(group, materials.plaster, [side * (OUTER_EDGE - .12), 8.52, wallCenter, .26, 17.04, wallDepth],
      `${side < 0 ? 'West' : 'East'} outer atrium wall`);
    // The lower route remains open.  Piers stop at the outer shop depth and
    // never enter the walk bounds at abs(x) < 11.05.
    const pierBoxes: BoxSpec[] = [];
    for (let index = 0; index <= 4; index += 1) {
      const z = FRONT_Z - index * (Math.abs(FRONT_Z - REAR_Z) / 4);
      pierBoxes.push([side * 14.54, 8.45, z, .42, 16.90, .48]);
      for (const y of [4.28, 8.88, 13.28]) {
        pierBoxes.push([side * 14.48, y, z, .58, .16, .66]);
      }
    }
    addInstancedBoxes(group, materials.plasterLight, `${side < 0 ? 'West' : 'East'} outer column details`, pierBoxes);
    addBox(group, materials.darkBronze, [side * (OUTER_EDGE - .245), 8.48, wallCenter, .035, 16.25, wallDepth - .35],
      `${side < 0 ? 'West' : 'East'} outer wall vertical reveal`);
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
    const insideFace = z - direction * .14;
    for (const side of [-1, 1]) {
      addBox(group, materials.plaster, [side * 9.93, 2.48, z, 10.14, 4.96, .24], `${label} stone entrance wall`);
      addBox(group, materials.plaster, [side * 4.83, 2.13, z + direction * 5.1, .22, 4.25, 10.2],
        `${label} vestibule side wall`);
      addBox(group, materials.cove, [side * 4.48, 3.84, z + direction * 5.1, .10, .072, 10.1],
        `${label} vestibule indirect lighting`);
    }
    addBox(group, materials.limestone, [0, -.052, z + direction * 5.1, 9.70, .10, 10.3], `${label} vestibule floor`);
    addBox(group, materials.ceiling, [0, 4.21, z + direction * 5.1, 9.68, .25, 10.3], `${label} vestibule ceiling`);
    addBox(group, materials.plaster, [0, 2.14, z + direction * 10.2, 9.7, 4.27, .19], `${label} vestibule far wall`);
    addBox(group, materials.plasterLight, [0, 2.14, z + direction * 10.09, 4.28, 3.62, .09], `${label} pale entry portal`);
    addBox(group, materials.glass, [0, 2.28, insideFace - direction * .052, 8.42, 4.16, .026],
      `${label} translucent terminus glazing`);
    addBox(group, materials.limestone, [-4.72, 2.48, insideFace, .42, 4.78, .19], `${label} terminus west pier`);
    addBox(group, materials.limestone, [4.72, 2.48, insideFace, .42, 4.78, .19], `${label} terminus east pier`);
    addBox(group, materials.plasterLight, [0, 4.93, insideFace, 10.28, .22, .22], `${label} terminus pale lintel`);
    addBox(group, materials.cove, [0, 4.78, insideFace - direction * .025, 7.42, .038, .042], `${label} terminus warm cove`);
    const mullions: BoxSpec[] = [];
    for (const x of [-3.15, -1.05, 1.05, 3.15]) {
      mullions.push([x, 2.55, insideFace - direction * .068, .045, 3.82, .052]);
    }
    addInstancedBoxes(group, materials.champagne, `${label} terminus vertical mullions`, mullions);
    for (const level of ATRIUM_LEVELS) {
      addBox(group, materials.plaster, [0, level + 2.04, z, 29.85, 4.42, .21], `${label} level return wall`);
      addBox(group, materials.bronze, [0, level + .28, insideFace, 22.65, .55, .11], `${label} horizontal return fascia`);
      addBox(group, materials.plasterLight, [0, level + 2.28, insideFace, 17.75, 2.63, .13], `${label} return wall panel`);
      for (const x of [-7.0, -3.5, 0, 3.5, 7.0]) {
        addBox(group, materials.limestone, [x, level + 2.22, insideFace - direction * .12, .14, 2.46, .12],
          `${label} return wall joints`);
      }
    }
  }
}

function addRecessedSpots(group: Group, materials: AtriumMaterials): void {
  const spots: BoxSpec[] = [];
  const levels = ATRIUM_LEVELS.map(floor => floor - .53);
  for (const y of levels) {
    for (const side of [-1, 1]) {
      for (let index = 0; index < 10; index += 1) {
        const z = FRONT_Z - 2.2 - index * 4.55;
        spots.push([side * (INNER_EDGE + 1.18), y, z, .13, .030, .13]);
      }
    }
  }
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
  for (const side of [-1, 1]) {
    for (const z of [-5.4, -17.0, -29.0, -41.0]) {
      const x = side * 13.55;
      addBox(group, materials.limestone, [x, 8.45, z, .66, 16.72, .72], 'Architectural side column shaft');
      addBox(group, materials.plasterLight, [x, .34, z, .92, .68, .98], 'Architectural side column base');
      addBox(group, materials.plasterLight, [x, 16.83, z, 1.02, .28, 1.08], 'Architectural side column capital');
      for (const y of [4.22, 8.82, 13.22]) {
        addBox(group, materials.bronzeLight, [x, y, z, .82, .10, .91], 'Architectural side column trim');
      }
      addBox(group, materials.darkBronze, [side * (13.18), 8.55, z, .038, 15.52, .19], 'Architectural side column inset');
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
      const washColor = artificialOn
        ? night ? 0xffb67e : 0xffd7ad
        : 0x67584c;
      materials.cove.color.setHex(fixtureColor);
      materials.soffitWash.color.setHex(washColor);
      materials.soffitWashSoft.color.setHex(artificialOn ? 0xffead0 : 0x756456);
      materials.soffitWash.opacity = artificialOn ? (night ? .50 : .62) : .10;
      materials.soffitWashSoft.opacity = artificialOn ? (night ? .16 : .24) : .045;
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
