import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, DoubleSide, Float32BufferAttribute,
  Group, InstancedMesh, Material, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, Object3D, Path, Shape, ShapeGeometry, TubeGeometry, Vector3,
} from 'three';
import {
  ATRIUM_BOUNDS, ATRIUM_ELEVATOR, ATRIUM_GALLERY_EDGE, ATRIUM_SKYLIGHT,
} from './atriumLayout';

/**
 * Roof, aperture and lift geometry share one coordinate contract. The roof is
 * intentionally a separate owner from side galleries and the ground stair: it
 * can be replaced while keeping the walkable floors and collision layout stable.
 */

type BoxSpec = readonly [
  x: number, y: number, z: number, width: number, height: number, depth: number, yaw?: number,
];

type RoofMaterials = {
  ceiling: MeshStandardMaterial;
  ivory: MeshStandardMaterial;
  rimShadow: MeshStandardMaterial;
  blueWall: MeshStandardMaterial;
  blueWallAlt: MeshStandardMaterial;
  blueGasket: MeshStandardMaterial;
  skyPlate: MeshBasicMaterial;
  gridBlue: MeshBasicMaterial;
  gridWhite: MeshBasicMaterial;
  diffuser: MeshBasicMaterial;
  diffuserSoft: MeshBasicMaterial;
  fixture: MeshBasicMaterial;
  shaftGlass: MeshPhysicalMaterial;
  shaftCrown: MeshPhysicalMaterial;
  shaftRib: MeshStandardMaterial;
  shaftTop: MeshStandardMaterial;
  shaftCore: MeshStandardMaterial;
  shaftFloor: MeshPhysicalMaterial;
  shaftFloorAlt: MeshPhysicalMaterial;
  shaftReflection: MeshBasicMaterial;
};

const BOUNDS = ATRIUM_BOUNDS;
const SKYLIGHT = ATRIUM_SKYLIGHT;
const SKYLIGHT_YAW = SKYLIGHT.yaw;
const CEILING_Y = SKYLIGHT.y;
const OUTER_EDGE = 15;
const WALL_BOTTOM = CEILING_Y + .015;
const WALL_TOP = CEILING_Y + 3.82;
const ELEVATOR_TOP = 24.3;
const ELEVATOR_BOTTOM = 0;
const ELEVATOR_CROWN = 18.55;

function makeMaterials(): RoofMaterials {
  const standard = (name: string, color: number, roughness: number, metalness = 0): MeshStandardMaterial =>
    new MeshStandardMaterial({ name, color, roughness, metalness });
  const glass = (name: string, color: number, opacity: number): MeshPhysicalMaterial =>
    new MeshPhysicalMaterial({
      name, color, roughness: .16, metalness: .08, opacity, transparent: true,
      depthWrite: false, side: DoubleSide, forceSinglePass: true, specularIntensity: .38,
    });
  return {
    ceiling: standard('Atrium roof continuous ivory underside', 0xf0e5d5, .89),
    ivory: standard('Broad warm ivory aperture blade', 0xe7d5ba, .69),
    rimShadow: standard('Aperture bronze shadow reveal', 0x433b36, .53, .25),
    blueWall: standard('Deep blue curved aperture wall', 0x527ca0, .57, .07),
    blueWallAlt: standard('Alternating blue aperture wall panel', 0x5986ad, .48, .09),
    blueGasket: standard('Dark blue aperture gaskets', 0x101e29, .50, .34),
    skyPlate: new MeshBasicMaterial({ name: 'Blue-white roof panel plate', color: 0x5da8cf,
      transparent: true, opacity: .72, depthWrite: false, toneMapped: false, side: DoubleSide }),
    gridBlue: new MeshBasicMaterial({ name: 'Dark blue roof grid mullions', color: 0x193e57,
      toneMapped: false }),
    gridWhite: new MeshBasicMaterial({ name: 'Blue-white roof light squares', color: 0xe4f6ff, toneMapped: false }),
    diffuser: new MeshBasicMaterial({ name: 'Warm broad aperture diffuser', color: 0xffc889,
      transparent: true, opacity: .98, depthWrite: false, toneMapped: false }),
    diffuserSoft: new MeshBasicMaterial({ name: 'Warm aperture secondary diffuser', color: 0xffdfb5,
      transparent: true, opacity: .72, depthWrite: false, toneMapped: false }),
    fixture: new MeshBasicMaterial({ name: 'Recessed ivory ceiling fixture', color: 0xffedce, toneMapped: false }),
    shaftGlass: glass('Blue-gray lift shaft controlled glass', 0x7d9ba0, .24),
    shaftCrown: glass('Cool skylight glazing above the elevator', 0x478db5, .31),
    shaftRib: standard('Lift shaft dark vertical ribs', 0x1b2c34, .42, .32),
    shaftTop: standard('Lift shaft pale structural cap', 0xb9b8ae, .52, .30),
    shaftCore: standard('Lift shaft partial blue-gray core', 0x4a5b61, .66, .20),
    shaftFloor: glass('Lift shaft varied reflective floor', 0xa0b2ad, .38),
    shaftFloorAlt: glass('Lift shaft alternate reflective floor', 0x6f8d92, .33),
    shaftReflection: new MeshBasicMaterial({ name: 'Lift shaft interior reflection streak', color: 0xc7e4df,
      transparent: true, opacity: .24, depthWrite: false, toneMapped: false }),
  };
}

function addBox(parent: Group, material: Material, [x, y, z, width, height, depth, yaw = 0]: BoxSpec,
  name: string, castShadow = true, receiveShadow = true): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);
  return mesh;
}

function addInstancedBoxes(parent: Group, material: Material, name: string,
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
  parent.add(mesh);
  return mesh;
}

function ellipsePoint(centerX: number, centerZ: number, radiusX: number, radiusZ: number,
  yaw: number, angle: number): { x: number; z: number } {
  const localX = radiusX * Math.cos(angle);
  const localZ = radiusZ * Math.sin(angle);
  return {
    x: centerX + localX * Math.cos(yaw) + localZ * Math.sin(yaw),
    z: centerZ - localX * Math.sin(yaw) + localZ * Math.cos(yaw),
  };
}

function apertureChord(fixed: number, alongX: boolean, radiusX: number, radiusZ: number): [number, number] | undefined {
  const sin = Math.sin(SKYLIGHT_YAW);
  const cos = Math.cos(SKYLIGHT_YAW);
  const offset = fixed - (alongX ? SKYLIGHT.z : SKYLIGHT.x);
  const a = (alongX ? cos : -sin) / radiusX;
  const b = (alongX ? sin : cos) / radiusZ;
  const c = offset * (alongX ? -sin : cos) / radiusX;
  const d = offset * (alongX ? cos : sin) / radiusZ;
  const square = a * a + b * b;
  const mixed = a * c + b * d;
  const discriminant = mixed * mixed - square * (c * c + d * d - 1);
  if (discriminant <= 0) return;
  const middle = (alongX ? SKYLIGHT.x : SKYLIGHT.z) - mixed / square;
  const half = Math.sqrt(discriminant) / square;
  return [middle - half, middle + half];
}

function createRotatedEllipseRingGeometry(centerX: number, centerZ: number, outerX: number, outerZ: number,
  innerX: number, innerZ: number, yaw: number, y: number, thickness: number, segments = 144): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const top = y + thickness * .5;
  const bottom = y - thickness * .5;
  for (let index = 0; index < segments; index += 1) {
    const angle = index * Math.PI * 2 / segments;
    const nextAngle = (index + 1) * Math.PI * 2 / segments;
    const outer = ellipsePoint(centerX, centerZ, outerX, outerZ, yaw, angle);
    const inner = ellipsePoint(centerX, centerZ, innerX, innerZ, yaw, angle);
    const nextOuter = ellipsePoint(centerX, centerZ, outerX, outerZ, yaw, nextAngle);
    const nextInner = ellipsePoint(centerX, centerZ, innerX, innerZ, yaw, nextAngle);
    const base = positions.length / 3;
    positions.push(
      outer.x, top, outer.z, inner.x, top, inner.z,
      outer.x, bottom, outer.z, inner.x, bottom, inner.z,
      nextOuter.x, top, nextOuter.z, nextInner.x, top, nextInner.z,
      nextOuter.x, bottom, nextOuter.z, nextInner.x, bottom, nextInner.z,
    );
    indices.push(
      base, base + 1, base + 5, base, base + 5, base + 4,
      base + 2, base + 6, base + 7, base + 2, base + 7, base + 3,
      base, base + 4, base + 6, base, base + 6, base + 2,
      base + 1, base + 3, base + 7, base + 1, base + 7, base + 5,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createRotatedEllipseDiskGeometry(centerX: number, centerZ: number, radiusX: number, radiusZ: number,
  yaw: number, y: number, segments = 144): BufferGeometry {
  const positions = [centerX, y, centerZ];
  const indices: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const point = ellipsePoint(centerX, centerZ, radiusX, radiusZ, yaw, index * Math.PI * 2 / segments);
    positions.push(point.x, y, point.z);
  }
  for (let index = 0; index < segments; index += 1) indices.push(0, index + 1, (index + 1) % segments + 1);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createCeilingFieldGeometry(centerX: number, centerZ: number, radiusX: number, radiusZ: number,
  yaw: number, y: number): BufferGeometry {
  // Shape coordinates use world z directly. The outer contour is CCW and the
  // elliptical hole is clockwise; rotating +PI/2 turns +Z into the underside
  // normal (-Y) while preserving the requested world orientation.
  const shape = new Shape();
  shape.moveTo(-OUTER_EDGE, BOUNDS.minZ);
  shape.lineTo(OUTER_EDGE, BOUNDS.minZ);
  shape.lineTo(OUTER_EDGE, BOUNDS.maxZ);
  shape.lineTo(-OUTER_EDGE, BOUNDS.maxZ);
  shape.closePath();
  const hole = new Path();
  const segments = 192;
  for (let index = 0; index <= segments; index += 1) {
    const angle = -index * Math.PI * 2 / segments;
    const point = ellipsePoint(centerX, centerZ, radiusX, radiusZ, yaw, angle);
    if (index === 0) hole.moveTo(point.x, point.z);
    else hole.lineTo(point.x, point.z);
  }
  hole.closePath();
  shape.holes.push(hole);
  const geometry = new ShapeGeometry(shape, 1);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

function createCurvedWallGeometry(centerX: number, centerZ: number, radiusX: number, radiusZ: number,
  yaw: number, topY: number, bottomY: number, start: number, end: number, segments: number): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = start; index < end; index += 1) {
    const angle = index * Math.PI * 2 / segments;
    const nextAngle = (index + 1) * Math.PI * 2 / segments;
    const top = ellipsePoint(centerX, centerZ, radiusX, radiusZ, yaw, angle);
    const nextTop = ellipsePoint(centerX, centerZ, radiusX, radiusZ, yaw, nextAngle);
    const base = positions.length / 3;
    positions.push(top.x, topY, top.z, top.x, bottomY, top.z,
      nextTop.x, topY, nextTop.z, nextTop.x, bottomY, nextTop.z);
    indices.push(base, base + 3, base + 2, base, base + 1, base + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ellipseCurve(centerX: number, centerZ: number, radiusX: number, radiusZ: number,
  yaw: number, y: number, segments = 144): CatmullRomCurve3 {
  const points: Vector3[] = [];
  for (let index = 0; index < segments; index += 1) {
    const point = ellipsePoint(centerX, centerZ, radiusX, radiusZ, yaw, index * Math.PI * 2 / segments);
    points.push(new Vector3(point.x, y, point.z));
  }
  return new CatmullRomCurve3(points, true, 'centripetal');
}

function addEllipseGasket(parent: Group, material: Material, centerX: number, centerZ: number,
  radiusX: number, radiusZ: number, yaw: number, y: number, radius: number, name: string): Mesh {
  const geometry = new TubeGeometry(ellipseCurve(centerX, centerZ, radiusX, radiusZ, yaw, y), 144, radius, 7, true);
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createShaftWallGeometry(footprint: readonly [number, number][], bottomY: number, topY: number): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < footprint.length; index += 1) {
    const [x1, z1] = footprint[index];
    const [x2, z2] = footprint[(index + 1) % footprint.length];
    const base = positions.length / 3;
    positions.push(x1, bottomY, z1, x2, bottomY, z2, x2, topY, z2, x1, topY, z1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function beam(parent: Group, material: Material, start: readonly [number, number], end: readonly [number, number],
  y: number, thickness: number, name: string): void {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dz, dx);
  addBox(parent, material, [(start[0] + end[0]) * .5, y, (start[1] + end[1]) * .5,
    length, thickness, thickness, yaw], name);
}

function addAperture(parent: Group, materials: RoofMaterials): void {
  const centerX = SKYLIGHT.x;
  const centerZ = SKYLIGHT.z;
  const radiusX = SKYLIGHT.radiusX;
  const radiusZ = SKYLIGHT.radiusZ;
  const outerX = radiusX + .88;
  const outerZ = radiusZ + .88;
  const field = new Mesh(createCeilingFieldGeometry(centerX, centerZ, radiusX + .16, radiusZ + .16,
    SKYLIGHT_YAW, CEILING_Y), materials.ceiling);
  field.name = 'Continuous roof underside with rotated true ellipse opening';
  field.receiveShadow = true;
  parent.add(field);

  const blade = new Mesh(createRotatedEllipseRingGeometry(centerX, centerZ, outerX, outerZ,
    radiusX + .16, radiusZ + .16, SKYLIGHT_YAW, CEILING_Y - .10, .38), materials.ivory);
  blade.name = 'Broad warm ivory aperture blade';
  parent.add(blade);
  const bladeShadow = new Mesh(createRotatedEllipseRingGeometry(centerX, centerZ, radiusX + .28, radiusZ + .28,
    radiusX + .18, radiusZ + .18, SKYLIGHT_YAW, CEILING_Y - .31, .12), materials.rimShadow);
  bladeShadow.name = 'Deep aperture blade shadow reveal';
  parent.add(bladeShadow);
  addEllipseGasket(parent, materials.diffuser, centerX, centerZ, radiusX + .26, radiusZ + .26,
    SKYLIGHT_YAW, CEILING_Y - .30, .074, 'Continuous warm inner aperture diffuser');
  addEllipseGasket(parent, materials.diffuserSoft, centerX, centerZ, outerX - .18, outerZ - .18,
    SKYLIGHT_YAW, CEILING_Y - .42, .066, 'Continuous warm secondary aperture diffuser');

  const wallSegments = 144;
  for (const [start, end, material, label] of [
    [0, 72, materials.blueWall, 'deep blue aperture wall A'],
    [72, 144, materials.blueWallAlt, 'deep blue aperture wall B'],
  ] as const) {
    const wall = new Mesh(createCurvedWallGeometry(centerX, centerZ, radiusX - .20, radiusZ - .20,
      SKYLIGHT_YAW, WALL_TOP, WALL_BOTTOM, start, end, wallSegments), material);
    wall.name = label;
    wall.castShadow = true;
    wall.receiveShadow = true;
    parent.add(wall);
  }
  addEllipseGasket(parent, materials.blueGasket, centerX, centerZ, radiusX - .20, radiusZ - .20,
    SKYLIGHT_YAW, WALL_TOP + .01, .050, 'Dark blue upper aperture gasket');
  addEllipseGasket(parent, materials.blueGasket, centerX, centerZ, radiusX - .20, radiusZ - .20,
    SKYLIGHT_YAW, WALL_BOTTOM - .01, .035, 'Dark blue lower aperture gasket');
  addEllipseGasket(parent, materials.blueGasket, centerX, centerZ, radiusX - .225, radiusZ - .225,
    SKYLIGHT_YAW, WALL_BOTTOM + .88, .019, 'Curved aperture wall panel joint');
  const ribs: BoxSpec[] = [];
  for (let index = 0; index < wallSegments; index += 6) {
    const point = ellipsePoint(centerX, centerZ, radiusX - .215, radiusZ - .215,
      SKYLIGHT_YAW, index * Math.PI * 2 / wallSegments);
    ribs.push([point.x, (WALL_TOP + WALL_BOTTOM) * .5, point.z, .054, WALL_TOP - WALL_BOTTOM, .054]);
  }
  addInstancedBoxes(parent, materials.blueGasket, 'Repeated dark blue aperture wall gaskets', ribs);

  const vents: BoxSpec[] = [];
  for (let index = 2; index < 30; index++) {
    const angle = index * Math.PI * 2 / 30;
    const point = ellipsePoint(centerX, centerZ, radiusX - .24, radiusZ - .24, SKYLIGHT_YAW, angle);
    const tangentX = -Math.sin(angle) * radiusX;
    const tangentZ = Math.cos(angle) * radiusZ;
    const yaw = SKYLIGHT_YAW - Math.atan2(tangentZ, tangentX);
    vents.push([point.x, WALL_BOTTOM + 1.49, point.z, .26, .22, .045, yaw]);
  }
  addInstancedBoxes(parent, materials.blueGasket, 'Glazing curb ventilation grilles', vents);

  addHighPanelGrid(parent, materials);
}

function addHighPanelGrid(parent: Group, materials: RoofMaterials): void {
  const centerX = SKYLIGHT.x;
  const centerZ = SKYLIGHT.z;
  const gridRadiusX = SKYLIGHT.radiusX - .48;
  const gridRadiusZ = SKYLIGHT.radiusZ - .48;
  const gridY = WALL_TOP + .18;
  const plate = new Mesh(createRotatedEllipseDiskGeometry(centerX, centerZ, gridRadiusX, gridRadiusZ,
    SKYLIGHT_YAW, gridY + .38), materials.skyPlate);
  plate.name = 'High blue roof glazing behind panel grid';
  plate.castShadow = false;
  parent.add(plate);

  const bright: BoxSpec[] = [];
  const bars: BoxSpec[] = [];
  const cellX = 1.50;
  const cellZ = 1.86;
  for (let row = -8; row <= 8; row++) {
    const z = centerZ + row * cellZ;
    const span = apertureChord(z, true, gridRadiusX, gridRadiusZ);
    if (span) bars.push([(span[0] + span[1]) * .5, gridY - .08, z, span[1] - span[0], .13, .17]);
    const north = apertureChord(z + .14, true, gridRadiusX, gridRadiusZ);
    const south = apertureChord(z + cellZ - .14, true, gridRadiusX, gridRadiusZ);
    if (!north || !south) continue;
    for (let column = -7; column <= 6; column++) {
      const x = centerX + (column + .5) * cellX;
      const half = cellX * .5 - .115;
      if (x - half < Math.max(north[0], south[0]) || x + half > Math.min(north[1], south[1])) continue;
      if ((row + 8) % 4 === 2 && (column + 8) % 3 !== 1) continue;
      bright.push([x, gridY, z + cellZ * .5, half * 2, .035, cellZ - .28]);
    }
  }
  for (let column = -7; column <= 7; column++) {
    const x = centerX + column * cellX;
    const span = apertureChord(x, false, gridRadiusX, gridRadiusZ);
    if (span) bars.push([x, gridY - .078, (span[0] + span[1]) * .5, .15, .13, span[1] - span[0]]);
  }
  addInstancedBoxes(parent, materials.gridWhite, 'Blue-white square roof light panels', bright);
  addInstancedBoxes(parent, materials.gridBlue, 'Dark blue high roof panel grid mullions', bars);
}

function addCeilingSlots(parent: Group, materials: RoofMaterials): void {
  const rails: BoxSpec[] = [];
  const lights: BoxSpec[] = [];
  const width = ATRIUM_GALLERY_EDGE;
  for (let z = -11; z >= -58; z -= 3.7) {
    const cut = apertureChord(z, true, SKYLIGHT.radiusX + 1.1, SKYLIGHT.radiusZ + 1.1);
    const spans = cut ? [[-width, Math.min(cut[0], width)], [Math.max(cut[1], -width), width]] : [[-width, width]];
    for (const [left, right] of spans) {
      if (right - left < .44) continue;
      rails.push([(left + right) * .5, CEILING_Y - .016, z, right - left, .055, .15]);
      for (let x = left + .38; x < right - .18; x += 2.06) {
        lights.push([x, CEILING_Y - .050, z, .088, .025, .098]);
        if (x + .16 < right - .07) lights.push([x + .16, CEILING_Y - .050, z, .088, .025, .098]);
      }
    }
  }
  addInstancedBoxes(parent, materials.rimShadow, 'Recessed transverse lighting slots', rails);
  addInstancedBoxes(parent, materials.fixture, 'Warm paired downlights in the ceiling slots', lights);
}

function addElevator(parent: Group, materials: RoofMaterials): void {
  const minX = ATRIUM_ELEVATOR.minX;
  const maxX = ATRIUM_ELEVATOR.maxX;
  const minZ = ATRIUM_ELEVATOR.minZ;
  const maxZ = ATRIUM_ELEVATOR.maxZ;
  const centerX = (minX + maxX) * .5;
  const centerZ = (minZ + maxZ) * .5;
  const footprint: readonly [number, number][] = [
    [minX + .83, minZ], [maxX - .83, minZ], [maxX, minZ + .83], [maxX, maxZ - .83],
    [maxX - .83, maxZ], [minX + .83, maxZ], [minX, maxZ - .83], [minX, minZ + .83],
  ];
  for (const [bottom, top, glass] of [
    [ELEVATOR_BOTTOM, ELEVATOR_CROWN, materials.shaftGlass],
    [ELEVATOR_CROWN, ELEVATOR_TOP, materials.shaftCrown],
  ] as const) {
    const wall = new Mesh(createShaftWallGeometry(footprint, bottom, top), glass);
    wall.name = glass.name;
    parent.add(wall);
  }
  const ribs: BoxSpec[] = [];
  for (const [x, z] of footprint) ribs.push([x, (ELEVATOR_BOTTOM + ELEVATOR_TOP) * .5, z, .075, ELEVATOR_TOP, .075]);
  for (let index = 0; index < footprint.length; index += 1) {
    const [x1, z1] = footprint[index];
    const [x2, z2] = footprint[(index + 1) % footprint.length];
    const length = Math.hypot(x2 - x1, z2 - z1);
    const subdivisions = Math.max(1, Math.ceil(length / 1.45));
    for (let part = 1; part < subdivisions; part += 1) {
      const t = part / subdivisions;
      ribs.push([x1 + (x2 - x1) * t, (ELEVATOR_BOTTOM + ELEVATOR_TOP) * .5,
        z1 + (z2 - z1) * t, .050, ELEVATOR_TOP - .1, .050]);
    }
  }
  addInstancedBoxes(parent, materials.shaftRib, 'Lift shaft thin dark vertical ribs', ribs);

  for (const y of [4.55, 9.15, 13.55, 17.10, ELEVATOR_CROWN]) {
    for (let index = 0; index < footprint.length; index += 1) {
      beam(parent, materials.shaftRib, footprint[index], footprint[(index + 1) % footprint.length], y, .060,
        'Lift shaft solid horizontal structural rail');
    }
  }
  for (const y of [4.55, 9.15, 13.55, 17.10]) {
    addBox(parent, y % 9.1 < 5 ? materials.shaftFloor : materials.shaftFloorAlt,
      [centerX, y, centerZ, maxX - minX - .16, .070, maxZ - minZ - .16],
      'Lift shaft varied interior floor reflection', false, false);
    addBox(parent, materials.shaftReflection, [centerX - .65, y + .039, centerZ + .15,
      Math.max(.2, maxX - minX - 1.35), .012, .030], 'Lift shaft pale interior reflection streak', false, false);
    addBox(parent, materials.shaftReflection, [centerX + .12, y - .23, maxZ + .014,
      maxX - minX - 1.95, .058, .025], 'Lift glazing reflection of the gallery cove', false, false);
  }

  // The rear/right service core is opaque only in part of the shaft. It gives
  // the glass depth without turning the whole cabin into a dark rectangle.
  addBox(parent, materials.shaftCore, [maxX - .88, 9.65, minZ + .52, 1.42, 14.55, .72],
    'Lift shaft partial opaque service core');
  addBox(parent, materials.shaftTop, [centerX, ELEVATOR_TOP - .10, centerZ,
    maxX - minX + .12, .20, maxZ - minZ + .12], 'Lift shaft pale structural top rail');
  addBox(parent, materials.skyPlate, [centerX, ELEVATOR_TOP - .005, centerZ,
    maxX - minX - .28, .018, maxZ - minZ - .28], 'Lift shaft blue-white top light panel', false, false);
}

export function buildAtriumRoof(root: Group): { setLighting(on: boolean, time: 'day' | 'night'): void } {
  const group = new Group();
  group.name = 'Commercial atrium offset roof aperture and lift shaft';
  root.add(group);
  const materials = makeMaterials();
  addAperture(group, materials);
  addCeilingSlots(group, materials);
  addElevator(group, materials);

  const result = {
    setLighting(on: boolean, time: 'day' | 'night') {
      const night = time === 'night';
      materials.diffuser.color.setHex(on ? (night ? 0xffbd8a : 0xffead1) : 0x65554a);
      materials.diffuserSoft.color.setHex(on ? (night ? 0xffbb88 : 0xffdcb4) : 0x756557);
      materials.diffuser.opacity = on ? (night ? .78 : .98) : .08;
      materials.diffuserSoft.opacity = on ? (night ? .42 : .72) : .05;
      materials.skyPlate.color.setHex(night ? 0x173d60 : 0x61afd9);
      materials.skyPlate.opacity = night ? .46 : .74;
      materials.gridWhite.color.setHex(night ? 0x397b9e : 0xd7f1ff);
      materials.fixture.color.setHex(on ? (night ? 0xffd0a3 : 0xffedce) : 0x2d2723);
      materials.shaftGlass.color.setHex(night ? 0x3d5c67 : 0x7d9ba0);
      materials.shaftCrown.color.setHex(night ? 0x274b61 : 0x478db5);
      materials.shaftGlass.opacity = on ? (night ? .18 : .24) : .12;
      materials.shaftReflection.opacity = on ? (night ? .12 : .24) : .05;
    },
  };
  result.setLighting(true, 'day');
  return result;
}
