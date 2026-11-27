import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, DataTexture, DoubleSide, Float32BufferAttribute,
  Group, InstancedMesh, LinearFilter, Material, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
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
  gridSky: MeshBasicMaterial;
  fixture: MeshBasicMaterial;
  shaftGlass: MeshPhysicalMaterial;
  shaftCrown: MeshPhysicalMaterial;
  shaftRib: MeshStandardMaterial;
  shaftTop: MeshStandardMaterial;
  shaftCore: MeshStandardMaterial;
  shaftFloor: MeshPhysicalMaterial;
  shaftFloorAlt: MeshPhysicalMaterial;
  shaftReflection: MeshBasicMaterial;
  shaftSkyReflection: MeshBasicMaterial;
};

const BOUNDS = ATRIUM_BOUNDS;
const SKYLIGHT = ATRIUM_SKYLIGHT;
const SKYLIGHT_YAW = SKYLIGHT.yaw;
const CEILING_Y = SKYLIGHT.y;
const OUTER_EDGE = 15;
const WALL_BOTTOM = CEILING_Y + .015;
const WALL_TOP = CEILING_Y + 5.07;
const GRID_Y = CEILING_Y + 8.62;
const WALL_INSET = SKYLIGHT.wallInset;
const ELEVATOR_TOP = 24.82;
const ELEVATOR_BOTTOM = 0;
const ELEVATOR_CROWN = 21.66;

// The underside rolls around two coves before reaching the blue glazing curb.
// Each row gives the opening offset, vertical offset and received cove light.
const APRON_PROFILE = [
  [.68, .008, 0], [.63, -.05, .12], [.55, -.12, .94], [.465, -.18, 1], [.38, -.224, .47],
  [.28, -.25, .15], [.14, -.276, .06], [.015, -.286, .055], [-.085, -.282, .14],
  [-.16, -.261, .51], [-.218, -.227, .95], [-.277, -.197, .92], [-.35, -.164, .36],
  [-.48, -.119, .21], [-.60, -.052, .08], [-WALL_INSET, .032, .02],
] as const;

function makeMaterials(): RoofMaterials {
  const standard = (name: string, color: number, roughness: number, metalness = 0): MeshStandardMaterial =>
    new MeshStandardMaterial({ name, color, roughness, metalness });
  const glass = (name: string, color: number, opacity: number): MeshPhysicalMaterial =>
    new MeshPhysicalMaterial({
      name, color, roughness: .12, metalness: .07, opacity, transparent: true,
      depthWrite: false, side: DoubleSide, forceSinglePass: true, specularIntensity: .72,
    });
  const apronFalloff = new DataTexture(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1);
  apronFalloff.name = 'Apron reflected-light intensity';
  apronFalloff.magFilter = apronFalloff.minFilter = LinearFilter;
  apronFalloff.needsUpdate = true;
  return {
    ceiling: standard('Atrium roof continuous ivory underside', 0xf0e5d5, .89),
    ivory: new MeshStandardMaterial({ name: 'Rounded ivory skylight apron', color: 0xe5d5bd,
      roughness: .72, emissive: 0xffe4c3, emissiveMap: apronFalloff }),
    rimShadow: standard('Aperture bronze shadow reveal', 0x433b36, .53, .25),
    blueWall: standard('Deep blue curved aperture wall', 0x5b80a1, .62, .06),
    blueWallAlt: standard('Alternating blue aperture wall panel', 0x6086a9, .58, .08),
    blueGasket: standard('Dark blue aperture gaskets', 0x101e29, .50, .34),
    skyPlate: new MeshBasicMaterial({ name: 'Blue-white roof panel plate', color: 0x5da8cf,
      transparent: true, opacity: .72, depthWrite: false, toneMapped: false, side: DoubleSide }),
    gridBlue: new MeshBasicMaterial({ name: 'Dark blue roof grid mullions', color: 0x203b50,
      toneMapped: false }),
    gridWhite: new MeshBasicMaterial({ name: 'Pale skylight panes', color: 0xdaefff, toneMapped: false }),
    gridSky: new MeshBasicMaterial({ name: 'Blue skylight panes in shade', color: 0x638eac, toneMapped: false }),
    fixture: new MeshBasicMaterial({ name: 'Recessed ivory ceiling fixture', color: 0xffedce, toneMapped: false }),
    shaftGlass: glass('Warm gray lift shaft glazing', 0xa39e8b, .25),
    shaftCrown: glass('Cool skylight glazing above the elevator', 0x5289b0, .28),
    shaftRib: standard('Lift shaft reflecting bronze ribs', 0x35434a, .29, .54),
    shaftTop: standard('Lift shaft brushed structural cap', 0x9c988a, .40, .45),
    shaftCore: standard('Lift shaft partial blue-gray core', 0x645e53, .61, .19),
    shaftFloor: glass('Lift shaft varied reflective floor', 0xa0b2ad, .38),
    shaftFloorAlt: glass('Lift shaft alternate reflective floor', 0x6f8d92, .33),
    shaftReflection: new MeshBasicMaterial({ name: 'Lift shaft warm reflection streak', color: 0xffe3b5,
      transparent: true, opacity: .24, depthWrite: false, toneMapped: false }),
    shaftSkyReflection: new MeshBasicMaterial({ name: 'Cool skylight reflected in the lift crown', color: 0xa6d6f3,
      transparent: true, opacity: .31, depthWrite: false, toneMapped: false }),
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
  mesh.castShadow = mesh.receiveShadow = !material.transparent && !(material instanceof MeshBasicMaterial);
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

function createApronGeometry(): BufferGeometry {
  const segments = 192;
  const positions: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  for (const [row, [offset, height, light]] of APRON_PROFILE.entries()) {
    for (let index = 0; index < segments; index += 1) {
      const point = ellipsePoint(SKYLIGHT.x, SKYLIGHT.z, SKYLIGHT.radiusX + offset, SKYLIGHT.radiusZ + offset,
        SKYLIGHT_YAW, index * Math.PI * 2 / segments);
      positions.push(point.x, CEILING_Y + height, point.z);
      uv.push(.25 + .5 * light, .5);
      if (row === 0) continue;
      const a = (row - 1) * segments + index;
      const b = (row - 1) * segments + (index + 1) % segments;
      indices.push(a, b, b + segments, a, b + segments, a + segments);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
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
  const radiusX = SKYLIGHT.radiusX - WALL_INSET;
  const radiusZ = SKYLIGHT.radiusZ - WALL_INSET;
  const field = new Mesh(createCeilingFieldGeometry(centerX, centerZ, SKYLIGHT.radiusX + .66, SKYLIGHT.radiusZ + .66,
    SKYLIGHT_YAW, CEILING_Y), materials.ceiling);
  field.name = 'Continuous roof underside with rotated true ellipse opening';
  field.receiveShadow = true;
  parent.add(field);

  const apron = new Mesh(createApronGeometry(), materials.ivory);
  apron.name = 'Wide rounded ivory apron around the skylight';
  apron.receiveShadow = true;
  parent.add(apron);

  const wallSegments = 144;
  for (const [start, end, material, label] of [
    [0, 72, materials.blueWall, 'deep blue aperture wall A'],
    [72, 144, materials.blueWallAlt, 'deep blue aperture wall B'],
  ] as const) {
    const wall = new Mesh(createCurvedWallGeometry(centerX, centerZ, radiusX, radiusZ,
      SKYLIGHT_YAW, WALL_TOP, WALL_BOTTOM, start, end, wallSegments), material);
    wall.name = label;
    wall.castShadow = true;
    wall.receiveShadow = true;
    parent.add(wall);
  }
  addEllipseGasket(parent, materials.blueGasket, centerX, centerZ, radiusX, radiusZ,
    SKYLIGHT_YAW, WALL_TOP + .01, .050, 'Dark blue upper aperture gasket');
  addEllipseGasket(parent, materials.blueGasket, centerX, centerZ, radiusX - .018, radiusZ - .018,
    SKYLIGHT_YAW, WALL_BOTTOM + 1.20, .014, 'Curved aperture wall panel joint');
  const ribs: BoxSpec[] = [];
  for (let index = 0; index < wallSegments; index += 6) {
    const point = ellipsePoint(centerX, centerZ, radiusX - .018, radiusZ - .018,
      SKYLIGHT_YAW, index * Math.PI * 2 / wallSegments);
    ribs.push([point.x, (WALL_TOP + WALL_BOTTOM) * .5, point.z, .029, WALL_TOP - WALL_BOTTOM, .029]);
  }
  addInstancedBoxes(parent, materials.blueGasket, 'Repeated dark blue aperture wall gaskets', ribs);

  const vents: BoxSpec[] = [];
  for (let index = 2; index < 30; index++) {
    const angle = index * Math.PI * 2 / 30;
    const point = ellipsePoint(centerX, centerZ, radiusX - .022, radiusZ - .022, SKYLIGHT_YAW, angle);
    const tangentX = -Math.sin(angle) * radiusX;
    const tangentZ = Math.cos(angle) * radiusZ;
    const yaw = SKYLIGHT_YAW - Math.atan2(tangentZ, tangentX);
    vents.push([point.x, WALL_BOTTOM + 1.84, point.z, .17, .18, .028, yaw]);
  }
  addInstancedBoxes(parent, materials.blueGasket, 'Glazing curb ventilation grilles', vents);

  addClerestory(parent, materials, radiusX, radiusZ);
  addHighPanelGrid(parent, materials);
}

function addClerestory(parent: Group, materials: RoofMaterials, radiusX: number, radiusZ: number): void {
  const bays = 48;
  const rows = 5;
  const spacing = (GRID_Y - WALL_TOP) / rows;
  const panes: BoxSpec[] = [];
  const brightPanes: BoxSpec[] = [];
  const mullions: BoxSpec[] = [];
  for (let index = 0; index < bays; index += 1) {
    const start = ellipsePoint(SKYLIGHT.x, SKYLIGHT.z, radiusX, radiusZ, SKYLIGHT_YAW, index * Math.PI * 2 / bays);
    const end = ellipsePoint(SKYLIGHT.x, SKYLIGHT.z, radiusX, radiusZ, SKYLIGHT_YAW, (index + 1) * Math.PI * 2 / bays);
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const x = (start.x + end.x) * .5;
    const z = (start.z + end.z) * .5;
    const width = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    mullions.push([start.x, (GRID_Y + WALL_TOP) * .5, start.z, .11, GRID_Y - WALL_TOP, .11, yaw]);
    for (let row = 0; row < rows; row += 1) {
      const y = WALL_TOP + (row + .5) * spacing;
      const destination = (row === 1 || row === 3 || row === 4 && index % 3 !== 2) ? brightPanes : panes;
      destination.push([x, y, z, width - .064, spacing - .114, .027, yaw]);
      mullions.push([x, y + spacing * .5, z, width, .117, .105, yaw]);
    }
  }
  addInstancedBoxes(parent, materials.gridBlue, 'Curved clerestory sash behind the lift crown', mullions);
  addInstancedBoxes(parent, materials.gridSky, 'Shaded clerestory panes', panes);
  addInstancedBoxes(parent, materials.gridWhite, 'Bright clerestory panes', brightPanes);
}

function addHighPanelGrid(parent: Group, materials: RoofMaterials): void {
  const centerX = SKYLIGHT.x;
  const centerZ = SKYLIGHT.z;
  const gridRadiusX = SKYLIGHT.radiusX - WALL_INSET + .06;
  const gridRadiusZ = SKYLIGHT.radiusZ - WALL_INSET + .06;
  const plate = new Mesh(createRotatedEllipseDiskGeometry(centerX, centerZ, gridRadiusX, gridRadiusZ,
    SKYLIGHT_YAW, GRID_Y + .07), materials.skyPlate);
  plate.name = 'High blue roof glazing behind panel grid';
  plate.castShadow = false;
  parent.add(plate);

  const bright: BoxSpec[] = [];
  const bars: BoxSpec[] = [];
  const cellX = 1.38;
  const cellZ = 1.86;
  for (let row = -8; row <= 8; row++) {
    const z = centerZ + row * cellZ;
    const span = apertureChord(z, true, gridRadiusX, gridRadiusZ);
    if (span) bars.push([(span[0] + span[1]) * .5, GRID_Y - .038, z, span[1] - span[0], .088, .125]);
    const north = apertureChord(z + .14, true, gridRadiusX, gridRadiusZ);
    const south = apertureChord(z + cellZ - .14, true, gridRadiusX, gridRadiusZ);
    if (!north || !south) continue;
    for (let column = -7; column <= 6; column++) {
      const x = centerX + (column + .5) * cellX;
      const half = cellX * .5 - .115;
      if (x - half < Math.max(north[0], south[0]) || x + half > Math.min(north[1], south[1])) continue;
      if ((row + 8) % 3 === 1 || (column + 8) % 5 === 1) continue;
      bright.push([x, GRID_Y, z + cellZ * .5, half * 2, .026, cellZ - .23]);
    }
  }
  for (let column = -7; column <= 7; column++) {
    const x = centerX + column * cellX;
    const span = apertureChord(x, false, gridRadiusX, gridRadiusZ);
    if (span) bars.push([x, GRID_Y - .04, (span[0] + span[1]) * .5, .103, .088, span[1] - span[0]]);
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
      beam(parent, materials.shaftRib, footprint[index], footprint[(index + 1) % footprint.length], y,
        y === ELEVATOR_CROWN ? .109 : .072,
        'Lift shaft solid horizontal structural rail');
    }
  }
  const warmReflections: BoxSpec[] = [];
  const crownReflections: BoxSpec[] = [];
  for (const [index, y] of [4.55, 9.15, 13.55, 17.10, ELEVATOR_CROWN].entries()) {
    addBox(parent, y % 9.1 < 5 ? materials.shaftFloor : materials.shaftFloorAlt,
      [centerX, y, centerZ, maxX - minX - .16, .070, maxZ - minZ - .16],
      'Lift shaft varied interior floor reflection', false, false);
    const offset = index % 2 === 0 ? .31 : -.38;
    warmReflections.push([centerX + offset, y - .09, maxZ + .019, 4.19, .084, .019]);
    warmReflections.push([centerX + offset + 1.36, y + .034, maxZ + .017, 1.34, .040, .013]);
    warmReflections.push([minX - .017, y + .09, centerZ - offset, .014, .066, 2.32]);
    if (index > 0) {
      warmReflections.push([centerX + 1.31 - offset, y - .81, maxZ + .014, .074, 1.23, .012]);
      warmReflections.push([minX - .014, y - .84, centerZ + .78 + offset, .013, 1.11, .047]);
    }
  }
  for (const [index, x] of [2.46, 3.19, 4.41, 5.63, 6.84, 7.21].entries()) {
    const height = 2.13 + (index % 3) * .22;
    const bottom = ELEVATOR_CROWN + .22 + (index % 2) * .24;
    crownReflections.push([x, bottom + height * .5, maxZ + .014, .078, height, .014]);
    crownReflections.push([x + .15, bottom + height * .62, maxZ + .013, .147, .091, .011]);
  }
  for (const z of [maxZ - .96, maxZ - 1.82, maxZ - 2.94, maxZ - 3.85]) {
    crownReflections.push([minX - .015, (ELEVATOR_CROWN + ELEVATOR_TOP) * .5, z, .015, 2.68, .088]);
  }
  addInstancedBoxes(parent, materials.shaftReflection, 'Warm gallery reflections on the lift glazing', warmReflections);
  addInstancedBoxes(parent, materials.shaftSkyReflection, 'Skylight reflections on the glazed lift crown', crownReflections);

  // The rear/right service core is opaque only in part of the shaft. It gives
  // the glass depth without turning the whole cabin into a dark rectangle.
  addBox(parent, materials.shaftCore, [maxX - .88, 10.45, minZ + .51, 1.42, 18.72, .72],
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
      materials.ivory.emissive.setHex(night ? 0xffc699 : 0xffe6c9);
      materials.ivory.emissiveIntensity = on ? (night ? .94 : 1.22) : 0;
      materials.skyPlate.color.setHex(night ? 0x173d60 : 0x61afd9);
      materials.skyPlate.opacity = night ? .46 : .74;
      materials.gridWhite.color.setHex(night ? 0x397391 : 0xe4f6ff);
      materials.gridSky.color.setHex(night ? 0x173b54 : 0x688cad);
      materials.fixture.color.setHex(on ? (night ? 0xffd0a3 : 0xffedce) : 0x2d2723);
      materials.shaftGlass.color.setHex(night ? 0x4f6669 : 0xa39e8b);
      materials.shaftCrown.color.setHex(night ? 0x274b61 : 0x5289b0);
      materials.shaftCrown.emissive.setHex(night ? 0x1d4969 : 0x4386b5);
      materials.shaftCrown.emissiveIntensity = night ? .17 : .68;
      materials.shaftCrown.opacity = night ? .38 : .55;
      materials.shaftGlass.opacity = night ? .21 : .29;
      materials.shaftReflection.opacity = on ? (night ? .35 : .57) : 0;
      materials.shaftSkyReflection.opacity = night ? .13 : .48;
    },
  };
  result.setLighting(true, 'day');
  return result;
}
