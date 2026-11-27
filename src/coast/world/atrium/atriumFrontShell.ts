import {
  BoxGeometry, DoubleSide, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial,
  type Material, type Texture,
} from 'three';
import { ATRIUM_BOUNDS, ATRIUM_GALLERY_EDGE, ATRIUM_GALLERY_FRONTS } from './atriumLayout';
import {
  ATRIUM_FRONT_GARDEN as GARDEN, ATRIUM_FRONT_GLAZING as GLAZING,
  ATRIUM_FRONT_LIGHTING as LIGHTING, ATRIUM_FRONT_STRUCTURE as STRUCTURE,
  ATRIUM_FRONT_CENTRAL_JOINERY as JOINERY, ATRIUM_FRONT_END_BAYS,
  ATRIUM_FRONT_TENANTS, ATRIUM_FRONT_UPPER_BOUNDS as UPPER,
  ATRIUM_FRONT_UPPER_ROOMS, type AtriumFrontRect, type AtriumFrontSpan, type AtriumFrontTenant,
  atriumFrontClearIntervals, atriumFrontWindowMullions,
} from './atriumFrontPlan';

export type AtriumFrontSurface = Readonly<{ mesh: Mesh; material: MeshStandardMaterial }>;
export type AtriumFrontSurfaces = Readonly<{
  shellGroup: Group;
  floorMeshes: readonly Mesh[];
  ceilingMeshes: readonly Mesh[];
  revealMeshes: readonly Mesh[];
  gardenBackWall: AtriumFrontSurface;
  endBayBackWalls: Readonly<Record<'W' | 'E', AtriumFrontSurface>>;
  tenantBackWalls: Readonly<Record<'W' | 'E', AtriumFrontSurface>>;
  upperBackWalls: Readonly<Record<'reading' | 'gallery' | 'salon', AtriumFrontSurface>>;
}>;

// The shell owns these scene-attached surfaces; the interiors own their local illumination.
const surfaceRegistry = new WeakMap<Group, AtriumFrontSurfaces>();
export function getAtriumFrontSurfaces(root: Group): AtriumFrontSurfaces | undefined {
  return surfaceRegistry.get(root);
}

type BoxSpec = readonly [x: number, y: number, z: number, width: number, height: number, depth: number];

export function buildAtriumFrontShell(root: Group, stoneMap: Texture | null): void {
  const group = new Group();
  group.name = 'Atrium front commons complete architectural shell';
  root.add(group);
  const unitBox = new BoxGeometry(1, 1, 1);
  const floorMeshes: Mesh[] = [];
  const ceilingMeshes: Mesh[] = [];
  const revealMeshes: Mesh[] = [];
  const finish = (name: string, color: number, roughness: number, metalness = 0): MeshStandardMaterial =>
    new MeshStandardMaterial({ name, color, roughness, metalness });
  const stone = finish('Front commons warm grey honed stone', 0xd2c8b8, .65);
  stone.map = stoneMap;
  const stoneFloor = finish('Front commons low sheen stone floor', 0xc8c1b3, .57);
  stoneFloor.map = stoneMap;
  const plaster = finish('Front commons matte mineral plaster', 0xd8d2c4, .80);
  const ceiling = finish('Front commons closed ivory ceiling', 0xe6e1d7, .90);
  const bronze = finish('Front commons dark brown narrow metal', 0x4c443b, .44, .46);
  const fascia = finish('Front commons muted bronze floor edge', 0x897966, .52, .32);
  const shadow = finish('Front commons narrow dark construction reveal', 0x3c3831, .83);
  const wood = finish('Front commons warm oak entry reveal', 0x8d7658, .67);
  const marks = finish('Front commons glass recognition marks', 0xc7c8be, .69);
  const glass = new MeshPhysicalMaterial({
    name: 'Front commons 14 mm low iron fixed glazing', color: 0xc3cec8,
    transparent: true, opacity: .105, depthWrite: false, side: DoubleSide, forceSinglePass: true,
    roughness: .075, metalness: .02, ior: 1.48, specularIntensity: .6,
  });

  function box(material: Material, values: BoxSpec, name: string): Mesh {
    const [x, y, z, width, height, depth] = values;
    const mesh = new Mesh(unitBox, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    mesh.castShadow = !material.transparent;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function plate(material: Material, rect: AtriumFrontRect, bottom: number, top: number, name: string,
    role?: 'floor' | 'ceiling'): Mesh {
    const mesh = box(material, [(rect.minX + rect.maxX) * .5, (bottom + top) * .5,
      (rect.minZ + rect.maxZ) * .5, rect.maxX - rect.minX, top - bottom, rect.maxZ - rect.minZ], name);
    if (role === 'floor') floorMeshes.push(mesh);
    if (role === 'ceiling') ceilingMeshes.push(mesh);
    return mesh;
  }

  function plateAround(material: Material, rect: AtriumFrontRect, cuts: readonly AtriumFrontRect[],
    bottom: number, top: number, name: string, role?: 'floor' | 'ceiling'): void {
    const xs = [...new Set([rect.minX, rect.maxX, ...cuts.flatMap(cut => [cut.minX, cut.maxX])])]
      .filter(x => x >= rect.minX && x <= rect.maxX).sort((a, b) => a - b);
    const zs = [...new Set([rect.minZ, rect.maxZ, ...cuts.flatMap(cut => [cut.minZ, cut.maxZ])])]
      .filter(z => z >= rect.minZ && z <= rect.maxZ).sort((a, b) => a - b);
    for (let xIndex = 1; xIndex < xs.length; xIndex += 1) {
      for (let zIndex = 1; zIndex < zs.length; zIndex += 1) {
        const minX = xs[xIndex - 1], maxX = xs[xIndex];
        const minZ = zs[zIndex - 1], maxZ = zs[zIndex];
        const x = (minX + maxX) * .5, z = (minZ + maxZ) * .5;
        if (cuts.some(cut => x > cut.minX && x < cut.maxX && z > cut.minZ && z < cut.maxZ)) continue;
        plate(material, { minX, maxX, minZ, maxZ }, bottom, top, name, role);
      }
    }
  }

  function zWindow(x: AtriumFrontSpan, y: AtriumFrontSpan, floorY: number, label: string): void {
    const [x0, x1] = x, [y0, y1] = y;
    const width = x1 - x0, height = y1 - y0;
    const frameZ = GLAZING.faceZ + GLAZING.frameDepth * .5;
    const bars = atriumFrontWindowMullions(x);
    const panes = atriumFrontClearIntervals(x, bars);
    const paneBottom = y0 + GLAZING.frameWidth * .5;
    const paneTop = y1 - GLAZING.frameWidth * .5;
    for (const [left, right] of panes) {
      box(glass, [(left + right) * .5, (paneBottom + paneTop) * .5, GLAZING.centerZ,
        right - left, paneTop - paneBottom, GLAZING.thickness], `${label} closed glazing face z3.040 clear pane`);
    }
    for (const xx of [x0, x1]) box(bronze, [xx, (y0 + y1) * .5, frameZ,
      GLAZING.frameWidth, height + GLAZING.frameWidth, GLAZING.frameDepth], `${label} supported glass jamb`);
    for (const yy of [y0, y1]) box(bronze, [(x0 + x1) * .5, yy, frameZ,
      width, GLAZING.frameWidth, GLAZING.frameDepth], `${label} glass head and sill`);
    for (const { position, width: barWidth } of bars.slice(1, -1)) {
      box(bronze, [position, (y0 + y1) * .5, frameZ,
        barWidth, height, GLAZING.frameDepth], `${label} slim glass mullion`);
    }
    for (const [left, right] of panes) {
      const xx = (left + right) * .5;
      for (const yy of [.90, 1.45]) box(marks, [xx, floorY + yy, GLAZING.faceZ - .001,
        .13, .014, .002], `${label} fixed glass recognition dash`);
    }
  }

  // Ground garden is a complete closed room, never a passage to unfinished scenery.
  const gardenRect = { ...GARDEN.bounds, minZ: ATRIUM_BOUNDS.maxZ };
  plate(stoneFloor, gardenRect, -.105, 0, 'Front garden continuous FL0 floor', 'floor');
  for (const side of [-1, 1]) {
    box(stone, [side * (4.72 + GARDEN.wallDepth * .5), GARDEN.ceilingY * .5,
      (GARDEN.bounds.minZ + GARDEN.bounds.maxZ + GARDEN.wallDepth) * .5,
      GARDEN.wallDepth, GARDEN.ceilingY, GARDEN.bounds.maxZ - GARDEN.bounds.minZ + GARDEN.wallDepth],
    'Front garden closed side wall');
    box(stone, [side * 4.80, .07, 8.18, .05, .14, 10.0], 'Front garden continuous stone skirting');
  }
  const gardenBackMaterial = finish('Front garden actual lit plaster back wall', 0xd8d2c4, .80);
  const gardenBackWall = box(gardenBackMaterial, [0, GARDEN.ceilingY * .5,
    GARDEN.backWallZ + GARDEN.wallDepth * .5, 9.84, GARDEN.ceilingY, GARDEN.wallDepth],
  'Front garden back wall finished face z13.270');
  box(stone, [0, .06, 13.25, 9.44, .12, .04], 'Front garden back wall skirting');
  zWindow(GLAZING.gardenX, GLAZING.gardenY, 0, 'Front garden');
  box(stone, [0, .06, (GLAZING.faceZ + GLAZING.insideZ) * .5, 8.96, .12,
    GLAZING.insideZ - GLAZING.faceZ], 'Front garden solid glass base reveal');
  box(ceiling, [0, (3.92 + GARDEN.ceilingY) * .5, 3.11, 8.96, GARDEN.ceilingY - 3.92, .14],
    'Front garden closed window head');
  for (const side of [-1, 1]) {
    revealMeshes.push(box(stone, [side * 4.60, 2.04, 3.11, .24, 4.08, .14], 'Front garden deep stone glass reveal'));
    const bay = ATRIUM_FRONT_END_BAYS[side < 0 ? 0 : 1];
    const shoulderSpans: readonly AtriumFrontSpan[] = side < 0
      ? [[-14.85, bay.x[0]], [bay.x[1], -4.86]] : [[4.86, bay.x[0]], [bay.x[1], 14.85]];
    for (const [left, right] of shoulderSpans) {
      box(stone, [(left + right) * .5, 2.03, 3.18, right - left, 4.06, .28], 'Front ground stone shoulder outside display');
      if (right - left > 1) box(shadow, [(left + right) * .5, 2.0, 3.034,
        .006, 3.82, .006], 'Front stone shoulder construction joint');
    }
    box(stone, [(bay.x[0] + bay.x[1]) * .5, bay.glassY[0] * .5, 3.18,
      bay.x[1] - bay.x[0], bay.glassY[0], .28], 'Front end display solid stone window base');
    box(stone, [(bay.x[0] + bay.x[1]) * .5, (bay.glassY[1] + 4.06) * .5, 3.18,
      bay.x[1] - bay.x[0], 4.06 - bay.glassY[1], .28], 'Front end display closed stone head');
  }

  // The service door is visibly closed and inset in the side wall, not an invented guest exit.
  const doorZ = (GARDEN.serviceDoor.z[0] + GARDEN.serviceDoor.z[1]) * .5;
  box(shadow, [4.715, 1.165, doorZ, .008, 2.33, 1.03], 'Front garden closed service door dark joint');
  box(stone, [4.707, 1.15, doorZ, .010, 2.30, 1.00], 'Front garden flush stone service door');
  box(bronze, [4.680, 1.04, doorZ + .36, .035, .15, .025], 'Front garden service door small handle');

  const g4 = LIGHTING.gardenGrowing;
  const gardenCeilingRect = { minX: -4.72, maxX: 4.72, minZ: UPPER.maxZ, maxZ: 13.47 };
  const gardenCuts: AtriumFrontRect[] = LIGHTING.gardenWallWash.x.map(x => ({
    minX: x - .075, maxX: x + .075, minZ: LIGHTING.gardenWallWash.z - .055, maxZ: LIGHTING.gardenWallWash.z + .055,
  }));
  gardenCuts.push({ minX: g4.x - g4.width * .5, maxX: g4.x + g4.width * .5,
    minZ: g4.z - g4.depth * .5, maxZ: g4.z + g4.depth * .5 });
  plateAround(ceiling, gardenCeilingRect, gardenCuts, GARDEN.ceilingY, 4.23, 'Front garden ceiling around recessed equipment', 'ceiling');
  plate(ceiling, gardenCeilingRect, 4.23, GARDEN.ceilingY + GARDEN.ceilingDepth, 'Front garden closed equipment roof cap');

  function tenantShell(tenant: AtriumFrontTenant): AtriumFrontSurface {
    const { side, faceX, depth, ceilingY, z: [minZ, maxZ] } = tenant;
    const outerX = faceX + side * depth;
    const centerX = (faceX + outerX) * .5;
    const rect = { minX: Math.min(faceX, outerX), maxX: Math.max(faceX, outerX), minZ, maxZ };
    plate(stoneFloor, rect, -.105, 0, `${tenant.id} front tenant supported stone floor`, 'floor');
    plate(ceiling, { ...rect, minZ: minZ - .18, maxZ: maxZ + .18 }, ceilingY, ceilingY + .18,
      `${tenant.id} front tenant full ceiling`, 'ceiling');
    for (const zz of [minZ - .09, maxZ + .09]) {
      box(tenant.id === 'W' ? wood : plaster, [centerX, ceilingY * .5, zz, depth + .20, ceilingY, .18],
        `${tenant.id} front tenant closed side return`);
    }
    const backMaterial = finish(`${tenant.id} front tenant actual recessed back wall`, tenant.id === 'W' ? 0xb7a58b : 0xc9c6ba, .78);
    const backMesh = box(backMaterial, [outerX + side * .1, ceilingY * .5, (minZ + maxZ) * .5,
      .20, ceilingY, maxZ - minZ + .36], `${tenant.id} front tenant opaque back wall`);
    const frameX = faceX + side * .035;
    const glassX = faceX + side * GLAZING.thickness * .5;
    const top = 3.08;
    for (const yy of [.10, top]) box(bronze, [frameX, yy, (minZ + maxZ) * .5,
      .070, .045, maxZ - minZ + .04], `${tenant.id} shopfront supported head and sill`);
    const entryStartZ = minZ + tenant.entryU[0], entryEndZ = minZ + tenant.entryU[1];
    const frames = new Set([minZ, maxZ, entryStartZ, entryEndZ, (entryStartZ + entryEndZ) * .5]);
    for (let zz = minZ + 2.2; zz < maxZ - .5; zz += 2.2) {
      if (zz < entryStartZ - .18 || zz > entryEndZ + .18) frames.add(zz);
    }
    const clearPanes = atriumFrontClearIntervals(tenant.z,
      [...frames].map(position => ({ position, width: GLAZING.frameWidth })));
    const paneBottom = .10 + GLAZING.frameWidth * .5;
    const paneTop = top - GLAZING.frameWidth * .5;
    for (const [start, end] of clearPanes) box(glass, [glassX, (paneBottom + paneTop) * .5,
      (start + end) * .5, GLAZING.thickness, paneTop - paneBottom, end - start],
    `${tenant.id} closed external glass shopfront clear pane`);
    for (const zz of frames) box(bronze, [frameX, (top + .10) * .5, zz, .070, top - .10, .045],
      `${tenant.id} shopfront closed glazing mullion`);
    box(tenant.id === 'W' ? wood : stone, [faceX + side * .07, (3.08 + ceilingY) * .5, (minZ + maxZ) * .5,
      .14, ceilingY - 3.08, maxZ - minZ], `${tenant.id} deep closed shopfront head`);
    const innerX = faceX + side * tenant.entryRecess;
    for (const zz of [entryStartZ, entryEndZ]) {
      revealMeshes.push(box(tenant.id === 'W' ? wood : stone, [innerX, tenant.entryHeight * .5, zz,
        .12, tenant.entryHeight, .17], `${tenant.id} internally recessed entrance jamb`));
    }
    revealMeshes.push(box(tenant.id === 'W' ? wood : stone, [innerX, tenant.entryHeight + .08,
      (entryStartZ + entryEndZ) * .5, .14, .16, entryEndZ - entryStartZ + .17], `${tenant.id} internally recessed entrance head`));
    box(stone, [faceX + side * .08, .025, (entryStartZ + entryEndZ) * .5,
      .16, .050, entryEndZ - entryStartZ], `${tenant.id} flush closed entrance threshold`);
    for (const zz of [entryStartZ + .82, entryEndZ - .82]) {
      box(bronze, [faceX - side * .006, 1.05, zz, .012, .22, .025], `${tenant.id} closed sliding entrance handle`);
    }
    for (let zz = minZ + 1.05; zz < maxZ; zz += 2.2) {
      for (const yy of [.90, 1.45]) box(marks, [faceX - side * .001, yy, zz, .002, .014, .13],
        `${tenant.id} shop glass recognition mark`);
    }
    // The room, head and facade are closed above and below; no inherited backing wall crosses the interior.
    box(stone, [outerX - side * .015, .065, (minZ + maxZ) * .5, .04, .13, maxZ - minZ],
      `${tenant.id} continuous rear skirting`);
    return { mesh: backMesh, material: backMaterial };
  }

  const westBack = tenantShell(ATRIUM_FRONT_TENANTS[0]);
  const eastBack = tenantShell(ATRIUM_FRONT_TENANTS[1]);
  const endBacks: Partial<Record<'W' | 'E', AtriumFrontSurface>> = {};
  for (const bay of ATRIUM_FRONT_END_BAYS) {
    const [left, right] = bay.x;
    const rect = { minX: left, maxX: right, minZ: ATRIUM_BOUNDS.maxZ, maxZ: bay.backZ };
    plate(stoneFloor, rect, -.105, bay.floorY, `${bay.id} end display continuous finished floor`, 'floor');
    const displayCeiling = finish(`${bay.id} end display muted ceiling`, bay.id === 'W' ? 0x9f9687 : 0xa4a297, .89);
    plate(displayCeiling, { ...rect, minZ: bay.frontZ, maxZ: bay.backZ + .20 }, bay.ceilingY,
      bay.ceilingY + .18, `${bay.id} end display closed ceiling`, 'ceiling');
    for (const xx of [left - .09, right + .09]) {
      const sideMesh = box(bay.id === 'W' ? wood : plaster, [xx, bay.ceilingY * .5,
        (bay.frontZ + bay.backZ) * .5, .18, bay.ceilingY, bay.backZ - bay.frontZ + .20],
      `${bay.id} end display closed deep side wall`);
      revealMeshes.push(sideMesh);
    }
    const backMaterial = finish(`${bay.id} end display actual recessed back wall`, bay.id === 'W' ? 0x8f7a5c : 0x8f8d7d, .80);
    const backMesh = box(backMaterial, [(left + right) * .5, bay.ceilingY * .5, bay.backZ + .10,
      right - left + .36, bay.ceilingY, .20], `${bay.id} end display closed back wall`);
    endBacks[bay.id] = { mesh: backMesh, material: backMaterial };
    for (const span of bay.glassX) zWindow(span, bay.glassY, bay.floorY, `Front ${bay.id} document display`);
    for (const xx of [left - .06, right + .06]) revealMeshes.push(box(stone, [xx,
      (bay.glassY[0] + bay.glassY[1]) * .5, (GLAZING.frameBackZ + bay.frontZ) * .5,
      .12, bay.glassY[1] - bay.glassY[0], bay.frontZ - GLAZING.frameBackZ], `${bay.id} end display deep stone jamb`));
    revealMeshes.push(box(stone, [(left + right) * .5, bay.glassY[1] + .065,
      (GLAZING.frameBackZ + bay.frontZ) * .5, right - left, .13,
      bay.frontZ - GLAZING.frameBackZ], `${bay.id} end display deep stone lintel`));
    box(stone, [(left + right) * .5, bay.glassY[0] * .5,
      (GLAZING.faceZ + bay.frontZ) * .5, right - left, bay.glassY[0], bay.frontZ - GLAZING.faceZ],
    `${bay.id} end display supported solid sill`);
  }
  const upperBack: Partial<Record<'reading' | 'gallery' | 'salon', AtriumFrontSurface>> = {};
  for (const room of ATRIUM_FRONT_UPPER_ROOMS) {
    const { floorY, ceilingY, glassY, id } = room;
    const bottom = floorY - STRUCTURE.floorPlateDepth;
    if (id === 'reading') {
      const cut = LIGHTING.gardenViewing.recess;
      plateAround(stone, UPPER, [cut], bottom, cut.maxY, `${id} floor plate around non-beam equipment recess`);
      plate(stone, UPPER, cut.maxY, floorY - .02, `${id} closed top of equipment recess`);
      plateAround(ceiling, UPPER, [cut], bottom - STRUCTURE.ceilingFinishDepth, bottom,
        'Front garden ceiling finish under reading room', 'ceiling');
    } else {
      plate(stone, UPPER, bottom, floorY - .02, `${id} complete structural floor plate`);
      plate(ceiling, UPPER, bottom - STRUCTURE.ceilingFinishDepth, bottom, `${id} underside ceiling finish`, 'ceiling');
    }
    plate(stoneFloor, UPPER, floorY - .02, floorY, `${id} continuous finished room floor`, 'floor');
    const roomCeiling = finish(`${id} recessed muted interior ceiling`,
      id === 'reading' ? 0x8f897b : id === 'gallery' ? 0x817e74 : 0x7d776c, .90);
    plate(roomCeiling, { ...UPPER, maxZ: UPPER.maxZ + .20 }, ceilingY, ceilingY + .12,
      `${id} closed room ceiling`, 'ceiling');
    const rearMaterial = finish(`${id} front commons actual room back wall`,
      id === 'reading' ? 0xafa38d : id === 'gallery' ? 0x77746b : 0x878073, .79);
    const rearMesh = box(rearMaterial, [0, (floorY + ceilingY) * .5, UPPER.maxZ + .10,
      UPPER.maxX - UPPER.minX + .36, ceilingY - floorY, .20], `${id} closed back wall`);
    upperBack[id] = { mesh: rearMesh, material: rearMaterial };
    for (const xx of [-8.94, 8.94]) box(plaster, [xx, (floorY + ceilingY) * .5,
      (UPPER.minZ + UPPER.maxZ) * .5, .18, ceilingY - floorY, UPPER.maxZ - UPPER.minZ + .20], `${id} full side return`);
    for (const bay of GLAZING.upperBays) zWindow(bay, glassY, floorY, `${id} fixed glazed bay`);
    box(stone, [0, floorY + .075, 3.11, 17.70, .15, .14], `${id} supported continuous window plinth`);
    box(plaster, [0, (glassY[1] + ceilingY) * .5, 3.11, 17.70, ceilingY - glassY[1], .14], `${id} closed window header`);
    const soffit = JOINERY.soffits.find(entry => entry.room === id);
    if (soffit) {
      const headMaterial = finish(`${id} deep interior head`, id === 'gallery' ? 0x77746b : 0x6e6251, .78);
      plate(headMaterial, soffit.bounds, floorY + soffit.bottom, ceilingY, `${id} closed deep interior head`, 'ceiling');
    }
    if (id === 'salon') {
      // Leave an actual air gap behind the 14 mm glass, rather than another coplanar surface.
      const sill = JOINERY.salonSill;
      plate(wood, sill, floorY, floorY + sill.height,
        'salon closed timber base behind fixed glazing');
    }
    box(fascia, [0, floorY - STRUCTURE.fasciaDepth * .5, 3.10, 29.90,
      STRUCTURE.fasciaDepth, .16], `${id} 490 mm fascia independently of 440 mm floor plate`);
    box(shadow, [0, floorY - .027, 3.015, 18.26, .025, .018], `${id} thin floor edge joint`);
    const roomIndex = ATRIUM_FRONT_UPPER_ROOMS.indexOf(room);
    const aboveFloor = ATRIUM_FRONT_UPPER_ROOMS[roomIndex + 1]?.floorY ?? STRUCTURE.topY;
    box(plaster, [0, (ceilingY + aboveFloor) * .5, 3.18, 29.90, aboveFloor - ceilingY, .28],
      `${id} closed interstorey strip above room ceiling`);
    for (const side of [-1, 1]) {
      box(stone, [side * 11.99, (floorY + ceilingY) * .5, 3.18, 5.94, ceilingY - floorY, .28],
        `${id} closed lateral end return`);
      const oldFront = ATRIUM_GALLERY_FRONTS[ATRIUM_FRONT_UPPER_ROOMS.indexOf(room)];
      const extension = { minX: side < 0 ? -14.85 : ATRIUM_GALLERY_EDGE,
        maxX: side < 0 ? -ATRIUM_GALLERY_EDGE : 14.85, minZ: oldFront, maxZ: UPPER.minZ };
      plate(stone, extension, floorY - .44, floorY, `${id} private floor continuation behind visible end guard`);
      const guardZ = oldFront - .025;
      const minX = side < 0 ? -14.83 : ATRIUM_GALLERY_EDGE;
      const maxX = side < 0 ? -ATRIUM_GALLERY_EDGE : 14.83;
      box(glass, [(minX + maxX) * .5, floorY + .65, guardZ, maxX - minX, 1.16, .014],
        `${id} visible gallery end guard at existing support limit`);
      box(bronze, [(minX + maxX) * .5, floorY + 1.25, guardZ, maxX - minX, .05, .07],
        `${id} gallery end continuous handrail`);
      for (let xx = minX; xx <= maxX + .001; xx += (maxX - minX) / 5) {
        box(bronze, [xx, floorY + .63, guardZ, .04, 1.24, .055], `${id} end guard supporting post`);
      }
    }
  }
  for (const x of STRUCTURE.supportX) {
    for (const z of [STRUCTURE.frontSupportZ, STRUCTURE.rearSupportZ]) {
      box(stone, [x, STRUCTURE.topY * .5, z, STRUCTURE.supportWidth, STRUCTURE.topY, STRUCTURE.supportDepth],
        'Front commons continuous load path pier');
      for (const { floorY } of ATRIUM_FRONT_UPPER_ROOMS) box(fascia, [x, floorY - .03, z,
        .34, .06, .49], 'Front commons pier floor junction');
    }
  }
  box(stone, [0, 17.075, 3.18, 29.90, .15, .30], 'Front commons fully closed top lintel');
  // Top and side closures cover the original end, including the space above the highest room.
  box(plaster, [0, 17.00, 5.48, 18.10, .10, 4.80], 'Front commons top room closed roof');

  const reading = upperBack.reading, gallery = upperBack.gallery, salon = upperBack.salon;
  const endW = endBacks.W, endE = endBacks.E;
  if (!reading || !gallery || !salon || !endW || !endE) throw new Error('Front commons room surfaces were not built');
  surfaceRegistry.set(root, {
    shellGroup: group, floorMeshes, ceilingMeshes, revealMeshes,
    gardenBackWall: { mesh: gardenBackWall, material: gardenBackMaterial },
    endBayBackWalls: { W: endW, E: endE },
    tenantBackWalls: { W: westBack, E: eastBack },
    upperBackWalls: { reading, gallery, salon },
  });
}
