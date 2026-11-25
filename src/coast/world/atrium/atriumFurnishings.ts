import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededDetail } from '../overlook/overlookModel';
import {
  ATRIUM_CAFE,
  ATRIUM_CAFE_CHAIRS,
  ATRIUM_CAFE_COUNTER,
  ATRIUM_CAFE_PLANTERS,
  ATRIUM_CAFE_TABLES,
  ATRIUM_LOUNGE,
  ATRIUM_SCULPTURE,
  ATRIUM_SOFA,
} from './atriumLayout';

type Point3 = readonly [x: number, y: number, z: number];

interface EmissiveControl {
  readonly material: THREE.MeshStandardMaterial;
  readonly artificial: number;
  readonly daylight: number;
}
interface AtriumFurnishMaterials {
  readonly sofa: THREE.MeshStandardMaterial;
  readonly sofaShadow: THREE.MeshStandardMaterial;
  readonly sofaFrame: THREE.MeshStandardMaterial;
  readonly seam: THREE.MeshStandardMaterial;
  readonly rug: THREE.MeshStandardMaterial;
  readonly rugBorder: THREE.MeshStandardMaterial;
  readonly stone: THREE.MeshStandardMaterial;
  readonly stoneEdge: THREE.MeshStandardMaterial;
  readonly darkMetal: THREE.MeshStandardMaterial;
  readonly brass: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshPhysicalMaterial;
  readonly porcelain: THREE.MeshStandardMaterial;
  readonly wicker: THREE.MeshStandardMaterial;
  readonly wickerBinding: THREE.MeshStandardMaterial;
  readonly planter: THREE.MeshStandardMaterial;
  readonly soil: THREE.MeshStandardMaterial;
  readonly leaves: THREE.MeshStandardMaterial;
  readonly petiole: THREE.MeshStandardMaterial;
  readonly ivory: THREE.MeshStandardMaterial;
  readonly ramification: THREE.MeshStandardMaterial;
  readonly bulbs: readonly THREE.MeshStandardMaterial[];
  readonly amber: THREE.MeshStandardMaterial;
  readonly controls: EmissiveControl[];
}

const SOFA_SEAT_DEPTH = .67;
const SOFA_WIDTH = ATRIUM_SOFA.width;
const SOFA_FRONT_Z = ATRIUM_SOFA.z;
const SOFA_SEAT_Z = SOFA_FRONT_Z - .23;
const SOFA_BACK_Z = SOFA_FRONT_Z - .72;

// Navigation stays in atriumNavigation.ts. Keep the seat center open for the requested
// seated start and use only these physical rear/arm extents as furniture obstacles:
// back x=[-5.10,-0.30], z=[-30.62,-30.18]; arms x=[-5.10,-4.78] and
// [-0.62,-0.30], z=[-30.30,-29.34]. The rug has no collider; display plinths are
// separate optional obstacles at (-4.72,-34.18) 1.22x.92 and (.34,-34.25) 1.34x.82.

function material(
  name: string,
  color: number,
  roughness: number,
  metalness = 0,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, color, roughness, metalness });
}

function weaveTexture(coarse: boolean): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const random = seededDetail(coarse ? 179 : 271);
  const thread = coarse ? 8 : 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cross = (Math.floor(x / thread) + Math.floor(y / thread)) % 2 === 0;
      const across = cross ? x : y;
      const along = cross ? y : x;
      const strand = Math.sin(Math.PI * ((across % thread) + .5) / thread);
      const fiber = Math.cos(along * 2 * Math.PI / (2 * thread));
      const value = coarse
        ? 154 + 79 * strand + 7 * fiber + 9 * random()
        : 216 + 25 * strand + 4 * fiber + 10 * random();
      const index = (y * size + x) * 4;
      data.set([value, value, value, 255], index);
    }
  }
  const weave = new THREE.DataTexture(data, size, size);
  weave.colorSpace = THREE.SRGBColorSpace;
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.magFilter = THREE.LinearFilter;
  weave.minFilter = THREE.LinearMipmapLinearFilter;
  weave.generateMipmaps = true;
  weave.anisotropy = 4;
  weave.needsUpdate = true;
  return weave;
}

function createMaterials(): AtriumFurnishMaterials {
  const controls: EmissiveControl[] = [];
  const ivory = material('Atrium sculpture satin silver stems', 0xc8c7c3, .36, .52);
  ivory.emissive.setHex(0xffe8c6);
  controls.push({ material: ivory, artificial: .22, daylight: .015 });

  const amber = material('Atrium cafe warm trim', 0xffb86f, .42, .06);
  amber.emissive.setHex(0xffa34b);
  controls.push({ material: amber, artificial: .92, daylight: .07 });

  const ramification = material('Atrium sculpture pale silver twigs', 0xe0dbd0, .41, .25);
  ramification.emissive.setHex(0xffeed8);
  controls.push({ material: ramification, artificial: .39, daylight: .028 });

  const bulbs = [
    { tint: 0xffb67e, intensity: 2.2 },
    { tint: 0xffdaa5, intensity: 3.9 },
    { tint: 0xfff0ce, intensity: 6.2 },
  ].map(({ tint, intensity }) => {
    const bulb = material('Atrium sculpture warm pin lights', 0xbc9d81, .32);
    bulb.emissive.setHex(tint);
    controls.push({ material: bulb, artificial: intensity, daylight: 0 });
    return bulb;
  });
  const upholstery = weaveTexture(false);
  const sofa = new THREE.MeshStandardMaterial({
    name: 'Greige basket-weave upholstery', color: 0xaaa191, roughness: .92,
    map: upholstery, bumpMap: upholstery, bumpScale: .0014,
  });
  const caning = weaveTexture(true);

  return {
    sofa,
    sofaShadow: material('Sofa recessed upholstery', 0x71695e, .91),
    sofaFrame: material('Sofa dark bronze frame', 0x4a4135, .41, .49),
    seam: material('Sofa greige welt cord', 0x82776a, .93),
    rug: new THREE.MeshStandardMaterial({
      name: 'Low-pile greige lounge rug', color: 0xada18d, roughness: .98,
      map: upholstery, bumpMap: upholstery, bumpScale: .0009,
    }),
    rugBorder: material('Lounge rug stitched border', 0x908171, .93),
    stone: material('Atrium limestone display stone', 0xc8c1b5, .78),
    stoneEdge: material('Atrium display warm edge', 0x9a7e60, .47, .38),
    darkMetal: material('Cafe charcoal metal', 0x282a29, .48, .43),
    brass: material('Cafe aged brass', 0xb69061, .42, .59),
    glass: new THREE.MeshPhysicalMaterial({
      name: 'Cafe lightly smoked glass', color: 0x76827f, roughness: .14, metalness: .08,
      transparent: true, opacity: .42,
    }),
    porcelain: material('Warm white table porcelain', 0xe6ddd0, .32),
    wicker: new THREE.MeshStandardMaterial({
      name: 'Over-under cane weave', color: 0x95714d, roughness: .81, side: THREE.DoubleSide,
      map: caning, bumpMap: caning, bumpScale: .0018,
    }),
    wickerBinding: material('Basket chair bound edges', 0x906b49, .77),
    planter: material('Dark glazed ceramic planter', 0x3a3428, .53),
    soil: material('Planter soil', 0x302a24, 1),
    leaves: new THREE.MeshStandardMaterial({
      name: 'Broad tropical foliage', color: 0x45623a, roughness: .57,
      side: THREE.DoubleSide, vertexColors: true,
    }),
    petiole: material('Planter olive green stems', 0x526143, .85),
    ivory,
    ramification,
    bulbs,
    amber,
    controls,
  };
}

function placeMesh<T extends THREE.Mesh>(
  parent: THREE.Object3D,
  mesh: T,
  name: string,
  position: Point3,
  rotation: Point3 = [0, 0, 0],
): T {
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function roundedBox(
  parent: THREE.Object3D,
  name: string,
  material: THREE.Material,
  width: number,
  height: number,
  depth: number,
  position: Point3,
  radius = .04,
  rotation: Point3 = [0, 0, 0],
): THREE.Mesh {
  const geometry = new RoundedBoxGeometry(width, height, depth, 3, radius);
  return placeMesh(parent, new THREE.Mesh(geometry, material), name, position, rotation);
}

function box(
  parent: THREE.Object3D,
  name: string,
  material: THREE.Material,
  width: number,
  height: number,
  depth: number,
  position: Point3,
  rotation: Point3 = [0, 0, 0],
): THREE.Mesh {
  return placeMesh(parent, new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material),
    name, position, rotation);
}

function cylinder(
  parent: THREE.Object3D,
  name: string,
  material: THREE.Material,
  radius: number,
  height: number,
  position: Point3,
  radialSegments = 32,
  scaleX = 1,
  scaleZ = 1,
): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, radialSegments);
  geometry.scale(scaleX, 1, scaleZ);
  return placeMesh(parent, new THREE.Mesh(geometry, material), name, position);
}

function oval(
  parent: THREE.Object3D,
  name: string,
  material: THREE.Material,
  width: number,
  height: number,
  depth: number,
  position: Point3,
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1, 24, 12);
  geometry.scale(width / 2, height / 2, depth / 2);
  return placeMesh(parent, new THREE.Mesh(geometry, material), name, position);
}

function tube(
  parent: THREE.Object3D,
  name: string,
  material: THREE.Material,
  points: readonly Point3[],
  radius: number,
  closed = false,
  tubularSegments = Math.max(12, points.length * 3),
  castShadow = true,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)), closed);
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, radius < .009 ? 6 : 10, closed);
  const mesh = placeMesh(parent, new THREE.Mesh(geometry, material), name, [0, 0, 0]);
  mesh.castShadow = castShadow;
  if (!castShadow) mesh.receiveShadow = false;
  return mesh;
}

function horizontalRing(
  parent: THREE.Object3D,
  name: string,
  material: THREE.Material,
  radius: number,
  tubeRadius: number,
  position: Point3,
  scaleX = 1,
  scaleZ = 1,
): THREE.Mesh {
  const geometry = new THREE.TorusGeometry(radius, tubeRadius, 8, 48);
  geometry.rotateX(Math.PI / 2);
  geometry.scale(scaleX, 1, scaleZ);
  return placeMesh(parent, new THREE.Mesh(geometry, material), name, position);
}

function upholsteredBox(
  parent: THREE.Object3D,
  name: string,
  finish: THREE.Material,
  width: number,
  height: number,
  depth: number,
  position: Point3,
  radius: number,
  rotation?: Point3,
): void {
  const cushion = roundedBox(parent, name, finish, width, height, depth, position, radius, rotation);
  const uv = cushion.geometry.getAttribute('uv');
  const faces = [[depth, height], [depth, height], [width, depth], [width, depth],
    [width, height], [width, height]];
  // Keep the thread pitch consistent across short vertical panels and the broader seat.
  for (const [face, { start, count }] of cushion.geometry.groups.entries()) {
    const [u, v] = faces[face];
    for (let index = start; index < start + count; index += 1) {
      uv.setXY(index, uv.getX(index) * u / .066, uv.getY(index) * v / .066);
    }
  }
}

function addSofa(parent: THREE.Group, materials: AtriumFurnishMaterials): void {
  const sofa = new THREE.Group();
  sofa.name = 'Central modular greige sofa';
  sofa.position.set(ATRIUM_SOFA.x, 0, 0);
  parent.add(sofa);

  const frameZ = SOFA_FRONT_Z - .25;
  roundedBox(sofa, 'Sofa inset dark bronze perimeter frame', materials.sofaFrame, SOFA_WIDTH - .18, .065, .81,
    [0, .233, frameZ], .023);
  roundedBox(sofa, 'Sofa shallow upholstered platform', materials.sofaShadow, SOFA_WIDTH + .02, .171, .90,
    [0, .342, frameZ], .062);
  upholsteredBox(sofa, 'Sofa tailored apron', materials.sofa, SOFA_WIDTH - .15, .086, .075,
    [0, .368, frameZ + .427], .031);
  roundedBox(sofa, 'Sofa rear upholstered rail', materials.sofaShadow, SOFA_WIDTH - .04, .32, .20,
    [0, .574, SOFA_BACK_Z + .025], .065);

  const gap = .024;
  const widths = [1.47, 1.53, SOFA_WIDTH - 1.47 - 1.53 - gap * 2];
  let edge = -SOFA_WIDTH / 2;
  for (const [index, width] of widths.entries()) {
    const seatX = edge + width / 2;
    const seatWidth = width - .012;
    upholsteredBox(sofa, 'Sofa rounded seat cushion', materials.sofa, seatWidth, .22, SOFA_SEAT_DEPTH,
      [seatX, .504, SOFA_SEAT_Z], .108);
    const cornerX = seatWidth / 2 - .108;
    const cushionFront = SOFA_SEAT_Z + SOFA_SEAT_DEPTH / 2;
    tube(sofa, 'Sofa seat welt cord', materials.seam, [
      [seatX - cornerX - .077, .48, cushionFront - .035],
      [seatX - cornerX, .48, cushionFront + .002],
      [seatX - cornerX * .81, .48, cushionFront + .002],
      [seatX + cornerX * .81, .48, cushionFront + .002],
      [seatX + cornerX, .48, cushionFront + .002],
      [seatX + cornerX + .077, .48, cushionFront - .035],
    ], .0036, false, 16, false);

    const backTilt = [0.11, 0.13, 0.12][index];
    upholsteredBox(sofa, 'Sofa gently reclined back cushion', materials.sofa, width - .032, .51, .27,
      [seatX, .815, SOFA_BACK_Z + .052], .109, [-backTilt, 0, 0]);
    edge += width + gap;
  }

  for (const side of [-1, 1]) {
    const armX = side * (SOFA_WIDTH / 2 - .126);
    upholsteredBox(sofa, 'Sofa padded arm', materials.sofa, .30, .51, .90,
      [armX, .603, frameZ - .044], .109, [0, 0, side * .010]);
  }

  const legs = new THREE.InstancedMesh(new THREE.CylinderGeometry(.026, .020, .197, 8), materials.sofaFrame, 6);
  legs.name = 'Sofa inset, floor-standing bronze feet';
  const transform = new THREE.Object3D();
  const end = SOFA_WIDTH / 2 - .26;
  for (const [index, position] of ([[-end, .133, .335], [0, .133, .335], [end, .133, .335],
    [-end, .133, -.335], [0, .133, -.335], [end, .133, -.335]] as const).entries()) {
    const [x, y, z] = position;
    transform.position.set(x, y, frameZ + z);
    transform.updateMatrix();
    legs.setMatrixAt(index, transform.matrix);
  }
  legs.instanceMatrix.needsUpdate = true;
  legs.castShadow = true;
  legs.receiveShadow = true;
  sofa.add(legs);

  upholsteredBox(sofa, 'Sofa loose left lumbar cushion', materials.sofa, .50, .284, .145,
    [-1.47, .741, SOFA_FRONT_Z - .429], .070, [-.20, -.06, -.16]);
  upholsteredBox(sofa, 'Sofa loose right lumbar cushion', materials.sofa, .53, .287, .15,
    [1.34, .749, SOFA_FRONT_Z - .428], .070, [-.19, .045, .095]);
}

function addLoungeRugAndTables(parent: THREE.Group, materials: AtriumFurnishMaterials): void {
  const lounge = new THREE.Group();
  lounge.name = 'Low oval lounge rug and tables';
  lounge.position.set(ATRIUM_LOUNGE.x, 0, ATRIUM_LOUNGE.z);
  parent.add(lounge);

  const rug = cylinder(lounge, 'Lounge rug low pile', materials.rug, 1, .028, [0, .018, 0], 64,
    ATRIUM_LOUNGE.radiusX, ATRIUM_LOUNGE.radiusZ);
  const rugUv = rug.geometry.getAttribute('uv');
  for (let index = 0; index < rugUv.count; index += 1) {
    rugUv.setXY(index, 96 * rugUv.getX(index), 66 * rugUv.getY(index));
  }
  horizontalRing(lounge, 'Lounge rug stitched edge', materials.rugBorder, .991, .0014,
    [0, .032, 0], ATRIUM_LOUNGE.radiusX, ATRIUM_LOUNGE.radiusZ);

  const tablePositions = [
    { x: -.75, z: -.06, width: 1.22, depth: .63, height: .36 },
    { x: -3.80, z: .36, width: 1.02, depth: .54, height: .31 },
  ] as const;
  for (const [index, table] of tablePositions.entries()) {
    roundedBox(lounge, `Lounge table ${index + 1} stone top`, materials.stone, table.width, .075, table.depth,
      [table.x, table.height, table.z], .055, [0, index * .14 - .07, 0]);
    cylinder(lounge, `Lounge table ${index + 1} pedestal`, materials.stoneEdge, .17, table.height - .055,
      [table.x, table.height / 2, table.z], 24, 1.05, .78);
    horizontalRing(lounge, `Lounge table ${index + 1} inset trim`, materials.stoneEdge, .80, .009,
      [table.x, table.height + .041, table.z], table.width / 1.6, table.depth / 1.65);
  }
  oval(lounge, 'Lounge table ceramic vessel', materials.porcelain, .23, .16, .18,
    [-.75, .48, -.06]);
  cylinder(lounge, 'Lounge table smoked glass tray', materials.glass, .28, .008,
    [-3.80, .355, .36], 32, 1.32, .67);
}

function addDisplayIslands(parent: THREE.Group, materials: AtriumFurnishMaterials): void {
  const displays = new THREE.Group();
  displays.name = 'Nearby display islands';
  parent.add(displays);
  const islands = [
    { x: -4.72, z: -34.18, width: 1.22, depth: .92, yaw: -.08 },
    { x: .34, z: -34.25, width: 1.34, depth: .82, yaw: .14 },
  ] as const;
  for (const [index, island] of islands.entries()) {
    roundedBox(displays, `Display island ${index + 1} base`, materials.stone, island.width, .58, island.depth,
      [island.x, .31, island.z], .085, [0, island.yaw, 0]);
    roundedBox(displays, `Display island ${index + 1} warm reveal`, materials.stoneEdge, island.width - .10, .025,
      island.depth - .10, [island.x, .618, island.z], .015, [0, island.yaw, 0]);
    const glass = cylinder(displays, `Display island ${index + 1} glass dome`, materials.glass, .30, .36,
      [island.x, .81, island.z], 32, island.width / .70, island.depth / .67);
    glass.scale.y = .64;
    oval(displays, `Display island ${index + 1} porcelain object`, materials.porcelain, .29, .34, .20,
      [island.x, .76, island.z]);
    horizontalRing(displays, `Display island ${index + 1} brass inset`, materials.brass, .28, .008,
      [island.x, .64, island.z], island.width / .78, island.depth / .72);
  }
}

function taperedTube(
  curve: THREE.CatmullRomCurve3, radius: number, tipRadius: number, segments: number, sides: number,
): THREE.BufferGeometry {
  const geometry = new THREE.TubeGeometry(curve, segments, radius, sides, false);
  const vertices = geometry.getAttribute('position');
  const point = new THREE.Vector3();
  for (let ring = 1; ring <= segments; ring += 1) {
    const t = ring / segments;
    const center = curve.getPointAt(t);
    const scale = THREE.MathUtils.lerp(1, tipRadius / radius, t);
    for (let side = 0; side <= sides; side += 1) {
      const index = ring * (sides + 1) + side;
      point.fromBufferAttribute(vertices, index).sub(center).multiplyScalar(scale).add(center);
      vertices.setXYZ(index, point.x, point.y, point.z);
    }
  }
  return geometry;
}

function addSculpture(parent: THREE.Group, materials: AtriumFurnishMaterials): void {
  const sculpture = new THREE.Group();
  sculpture.name = 'Luminous silver branching sculpture';
  sculpture.position.set(ATRIUM_SCULPTURE.x, 0, ATRIUM_SCULPTURE.z);
  parent.add(sculpture);

  cylinder(sculpture, 'Sculpture limestone plinth', materials.stone, ATRIUM_SCULPTURE.radius, .24,
    [0, .12, 0], 48);
  horizontalRing(sculpture, 'Sculpture plinth brass inset', materials.stoneEdge, ATRIUM_SCULPTURE.radius * .82,
    .012, [0, .245, 0]);

  const stems: THREE.BufferGeometry[] = [];
  const twigs: THREE.BufferGeometry[] = [];
  const lights: { center: THREE.Vector3; radius: number }[][] = [[], [], []];
  const random = seededDetail(2209);
  const curve = (points: readonly Point3[]): THREE.CatmullRomCurve3 =>
    new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));

  // Each light is mounted along a branch. Varied intensity leaves warm half-lit spaces
  // in the crown and keeps the strongest highlights small.
  const branchWithLights = (parts: THREE.BufferGeometry[], path: THREE.CatmullRomCurve3,
    baseRadius: number, tipRadius: number, segments: number, sides: number, count: number): void => {
    parts.push(taperedTube(path, baseRadius, tipRadius, segments, sides));
    const side = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3(1, 0, 0);
    for (let index = 0; index < count; index += 1) {
      const t = .10 + .89 * (index + .21 + .55 * random()) / count;
      const brightness = random();
      const tier = brightness < .25 ? 0 : brightness < .88 ? 1 : 2;
      const radius = .012 + .019 * random() ** 1.5 + (tier === 2 ? .004 : 0);
      const tangent = path.getTangentAt(t);
      side.crossVectors(tangent, Math.abs(tangent.y) > .92 ? right : up).normalize();
      side.applyAxisAngle(tangent, index * 2.399963 + brightness * 2 * Math.PI);
      const branchRadius = THREE.MathUtils.lerp(baseRadius, tipRadius, t);
      lights[tier].push({ center: path.getPointAt(t).addScaledVector(side, branchRadius), radius });
    }
  };

  const trunks = [
    curve([[-.118, .24, .055], [-.14, 1.14, .027], [-.22, 2.20, .075], [-.13, 3.18, .042],
      [.06, 4.26, .105], [.27, 5.22, .192]]),
    curve([[.080, .24, -.075], [.075, 1.06, -.11], [.21, 2.11, -.08], [.16, 3.30, -.015],
      [.05, 4.36, -.09], [-.09, ATRIUM_SCULPTURE.height, -.17]]),
    curve([[.015, .24, .128], [.028, 1.27, .17], [.11, 2.05, .28], [-.071, 3.14, .30],
      [-.28, 4.10, .25], [-.56, 4.87, .15]]),
  ];
  for (const [index, trunk] of trunks.entries()) {
    branchWithLights(stems, trunk, [.051, .041, .027][index], .0032, 28, 8, 12);
  }

  const crownPoint = (root: THREE.Vector3, azimuth: number, distance: number, rise: number): THREE.Vector3 =>
    new THREE.Vector3(root.x + Math.cos(azimuth) * distance,
      Math.min(root.y + rise, ATRIUM_SCULPTURE.height - .045),
      root.z + Math.sin(azimuth) * distance * .68);

  const limbCount = 26;
  for (let index = 0; index < limbCount; index += 1) {
    const height = index / (limbCount - 1);
    const trunk = trunks[index % trunks.length];
    const start = trunk.getPointAt(.15 + .72 * height + (random() - .5) * .032);
    const direction = index * 2.399963 + (random() - .5) * .51;
    const crownRadius = .33 + 1.53 * Math.sin(Math.PI * (.06 + height * .88)) ** .65;
    const clearHeadroom = THREE.MathUtils.smoothstep(start.y, 1.05, 2.15);
    const reach = THREE.MathUtils.lerp(.36, crownRadius, clearHeadroom) * (.78 + .32 * random());
    const lift = .20 + .48 * random();
    const limb = new THREE.CatmullRomCurve3([
      start,
      crownPoint(start, direction - .13, reach * .27, lift * .39),
      crownPoint(start, direction + .14 * (random() - .5), reach * .66, lift * .71),
      crownPoint(start, direction + .38 * (random() - .5), reach, lift),
    ]);
    branchWithLights(stems, limb, .015 + .006 * Math.sin(index * .82), .003, 10, 6, 4 + Math.round(reach * 2));

    const twigCount = index < 5 ? 3 : 5;
    for (let twigIndex = 0; twigIndex < twigCount; twigIndex += 1) {
      const junction = limb.getPointAt(.28 + .63 * (twigIndex + random() * .65) / twigCount);
      const outward = direction + (twigIndex % 2 === 0 ? 1 : -1) * (.37 + .83 * random());
      const distance = (.24 + .35 * random()) * (.48 + .52 * clearHeadroom);
      const rise = .11 + .34 * random();
      const twig = new THREE.CatmullRomCurve3([
        junction,
        crownPoint(junction, outward - .14, distance * .46, rise * .30),
        crownPoint(junction, outward + .16, distance, rise),
      ]);
      branchWithLights(twigs, twig, .007 + .002 * random(), .0019, 6, 5, 2 + Math.round(distance * 3));

      const fork = twig.getPointAt(.45 + .30 * random());
      const forkDirection = outward + (twigIndex % 2 === 0 ? -.72 : .81) + (random() - .5) * .34;
      const forkLength = (.12 + .23 * random()) * (.50 + .50 * clearHeadroom);
      const tip = new THREE.CatmullRomCurve3([
        fork,
        crownPoint(fork, forkDirection, forkLength * .52, .055 + .09 * random()),
        crownPoint(fork, forkDirection + .24, forkLength, .13 + .19 * random()),
      ]);
      branchWithLights(twigs, tip, .0036, .0011, 4, 4, 1 + Math.round(forkLength * 3));
    }
  }

  // The intersecting stems and filigree stay in two opaque draws, even in the floor reflection.
  for (const [parts, finish] of [[stems, materials.ivory], [twigs, materials.ramification]] as const) {
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, finish);
    mesh.name = finish.name;
    sculpture.add(mesh);
  }

  const geometry = new THREE.IcosahedronGeometry(1);
  const transform = new THREE.Object3D();
  for (const [tier, pins] of lights.entries()) {
    const bulbs = new THREE.InstancedMesh(geometry, materials.bulbs[tier], pins.length);
    bulbs.name = 'Sculpture branch-mounted pin lights';
    pins.forEach(({ center, radius }, index) => {
      transform.position.copy(center);
      transform.scale.setScalar(radius);
      transform.updateMatrix();
      bulbs.setMatrixAt(index, transform.matrix);
    });
    bulbs.instanceMatrix.needsUpdate = true;
    sculpture.add(bulbs);
  }
}

function addCafeCounter(parent: THREE.Group, materials: AtriumFurnishMaterials): void {
  const cafe = new THREE.Group();
  cafe.name = 'Right-side cafe counter and service island';
  parent.add(cafe);

  const { x: counterX, z: counterZ, width, depth } = ATRIUM_CAFE_COUNTER;
  roundedBox(cafe, 'Cafe lower cabinetry', materials.darkMetal, 2.82, .88, .58,
    [counterX, .46, counterZ], .035);
  roundedBox(cafe, 'Cafe warm porcelain counter', materials.porcelain, width, .13, depth,
    [counterX, .96, counterZ + .03], .052);
  box(cafe, 'Cafe brass service rail', materials.brass, 2.62, .034, .045,
    [counterX, .80, counterZ + .37]);
  box(cafe, 'Cafe under-counter warm reveal', materials.amber, 2.48, .025, .023,
    [counterX, .73, counterZ + .313]);
  for (const x of [-.52, .19, .90]) {
    roundedBox(cafe, 'Cafe cabinet front', materials.sofaShadow, .57, .61, .025,
      [x, .43, counterZ + .30], .018);
    box(cafe, 'Cafe cabinet handle', materials.brass, .21, .014, .018,
      [x, .51, counterZ + .322]);
  }
  // A pair of shallow vessels and a small machine ground the counter at human scale.
  cylinder(cafe, 'Cafe porcelain canister', materials.porcelain, .14, .19,
    [-.37, 1.12, counterZ + .04], 24);
  cylinder(cafe, 'Cafe dark coffee machine', materials.darkMetal, .19, .28,
    [.26, 1.16, counterZ + .05], 24);
  box(cafe, 'Cafe coffee machine brass face', materials.brass, .20, .13, .012,
    [.26, 1.17, counterZ + .245], [0, 0, 0]);
}

function addCafeTable(parent: THREE.Group, materials: AtriumFurnishMaterials,
  name: string, x: number, z: number, width: number, depth: number): void {
  const table = new THREE.Group();
  table.name = name;
  table.position.set(x, 0, z);
  parent.add(table);
  const topY = .76;
  cylinder(table, `${name} porcelain top`, materials.porcelain, .5, .072, [0, topY, 0], 36,
    width / 1.0, depth / 1.0);
  horizontalRing(table, `${name} inset brass rim`, materials.brass, .485, .006, [0, topY + .036, 0],
    width, depth);
  cylinder(table, `${name} pedestal`, materials.darkMetal, .13, topY - .07, [0, (topY - .07) / 2, 0], 24);
  cylinder(table, `${name} foot`, materials.brass, .31, .032, [0, .045, 0], 32, width / .92, depth / .92);
  cylinder(table, `${name} porcelain centerpiece`, materials.porcelain, .095, .13,
    [.04, .865, -.02], 24);
  cylinder(table, `${name} center trim`, materials.amber, .098, .010,
    [.04, .931, -.02], 24);
}

function addWickerChair(parent: THREE.Group, materials: AtriumFurnishMaterials,
  name: string, x: number, z: number, yaw: number): void {
  const chair = new THREE.Group();
  chair.name = name;
  chair.position.set(x, 0, z);
  chair.rotation.y = yaw;
  parent.add(chair);

  const basketPoint = (u: number, height: number): Point3 => {
    const angle = (2 * u - 1) * 1.46;
    const rim = .973 - .235 * (Math.abs(angle) / 1.46) ** 1.7;
    return [
      (.257 + .088 * height) * Math.sin(angle),
      THREE.MathUtils.lerp(.443, rim, height),
      .012 - (.238 + .075 * height) * Math.cos(angle),
    ];
  };

  const columns = 28;
  const rows = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    const height = row / rows;
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const point = basketPoint(u, height);
      positions.push(...point);
      uvs.push(16 * u, (point[1] - .443) * 18);
      if (row === rows || column === columns) continue;
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const cane = new THREE.BufferGeometry();
  cane.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  cane.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  cane.setIndex(indices);
  cane.computeVertexNormals();
  placeMesh(chair, new THREE.Mesh(cane, materials.wicker), 'Cafe curved cane back and arms', [0, 0, 0]);
  for (const height of [0, 1]) {
    const rim = Array.from({ length: 13 }, (_, index) => basketPoint(index / 12, height));
    tube(chair, 'Cafe bound cane rim', materials.wickerBinding, rim, .014, false, 24);
  }
  for (const side of [0, 1]) {
    const arm = [basketPoint(side, 0), basketPoint(side, .5), basketPoint(side, 1)];
    tube(chair, 'Cafe bound arm end', materials.wickerBinding, arm, .014, false, 10);
  }

  upholsteredBox(chair, 'Cafe upholstered seat pad', materials.sofa, .513, .103, .505,
    [0, .472, .025], .051);
  tube(chair, 'Cafe seat support ring', materials.darkMetal,
    [[-.23, .409, -.18], [-.24, .408, .19], [.24, .408, .19], [.23, .409, -.18]],
    .013, true, 16);
  for (const [legX, legZ] of [[-.20, -.177], [.20, -.177], [-.20, .19], [.20, .19]] as const) {
    tube(chair, 'Cafe fine splayed metal leg', materials.darkMetal, [
      [legX, .434, legZ], [legX * 1.19, .014, legZ * 1.19],
    ], .014, false, 4);
  }
}

function leafBlade(): THREE.BufferGeometry {
  const rows = 10;
  const columns = 6;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    const along = row / rows;
    const span = Math.max(.006, Math.sin(Math.PI * along) ** .88 * (1.15 - .34 * along));
    for (let column = 0; column <= columns; column += 1) {
      const across = column / columns * 2 - 1;
      const fold = (1 - Math.abs(across)) * .17 * span;
      const bend = .44 * along ** 2 - .74 * along ** 4;
      positions.push(.50 * across * span, along, fold + bend);
      const midrib = 1 - Math.min(1, Math.abs(across) * 3);
      const tint = .74 + .14 * (1 - Math.abs(across)) + .055 * across;
      colors.push(tint + .09 * midrib, tint + .11 * midrib, tint + .05 * midrib);
      if (row === rows || column === columns) continue;
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addCafePlanter(parent: THREE.Group, materials: AtriumFurnishMaterials,
  name: string, x: number, z: number, scale: number, geometry: THREE.BufferGeometry): void {
  const planter = new THREE.Group();
  planter.name = name;
  planter.position.set(x, 0, z);
  parent.add(planter);

  const vessel = new THREE.CylinderGeometry(.386, .287, .70, 36);
  vessel.scale(1, 1, .89);
  placeMesh(planter, new THREE.Mesh(vessel, materials.planter), 'Cafe glazed tapered vessel', [0, .35, 0]);
  cylinder(planter, 'Cafe dark potting soil', materials.soil, .345, .018, [0, .704, 0], 32, 1, .89);
  horizontalRing(planter, 'Cafe turned ceramic lip', materials.planter, .362, .024, [0, .714, 0], 1, .89);

  const layers = [
    { count: 6, y: 1.24, spread: .18, length: .49, width: .236, rise: .48 },
    { count: 8, y: 1.72, spread: .29, length: .76, width: .315, rise: .52 },
    { count: 7, y: 2.27, spread: .29, length: .76, width: .304, rise: .94 },
  ];
  const leaves = new THREE.InstancedMesh(geometry, materials.leaves,
    layers.reduce((count, layer) => count + layer.count, 0));
  leaves.name = 'Cafe staggered cupped leaf blades';
  const random = seededDetail(Math.round(scale * 1000));
  const transform = new THREE.Object3D();
  const basis = new THREE.Matrix4();
  const across = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const color = new THREE.Color();
  let index = 0;
  for (const [layerIndex, layer] of layers.entries()) {
    for (let offset = 0; offset < layer.count; offset += 1) {
      const turn = offset * 2 * Math.PI / layer.count + layerIndex * 1.34 + (random() - .5) * .46;
      const nx = Math.cos(turn);
      const nz = Math.sin(turn);
      const baseX = (random() - .5) * .13;
      const baseZ = (random() - .5) * .13;
      const y = layer.y * scale + (random() - .38) * .40;
      const tipX = baseX + nx * layer.spread * (.68 + .5 * random());
      const tipZ = baseZ + nz * layer.spread * (.68 + .5 * random());
      tube(planter, 'Cafe rising petiole', materials.petiole, [
        [baseX, .711, baseZ],
        [baseX + (tipX - baseX) * .36, .711 + (y - .711) * .57, baseZ + (tipZ - baseZ) * .34],
        [tipX, y, tipZ],
      ], .008 + random() * .006, false, 6, false);

      across.set(-nz, 0, nx);
      direction.set(nx * (.55 + .34 * random()), layer.rise + .28 * random(),
        nz * (.58 + .30 * random())).normalize();
      // Orthogonalize the blade across its cupped surface before instancing.
      normal.crossVectors(across, direction).normalize();
      across.crossVectors(direction, normal).normalize();
      basis.makeBasis(across, direction, normal);
      transform.position.set(tipX, y, tipZ);
      transform.quaternion.setFromRotationMatrix(basis);
      const length = layer.length * scale * (.84 + .31 * random());
      const width = layer.width * scale * (.81 + .36 * random());
      transform.scale.set(width, length, .21 * length);
      transform.updateMatrix();
      leaves.setMatrixAt(index, transform.matrix);
      color.setRGB(.66 + .31 * random(), .76 + .24 * random(), .56 + .27 * random());
      leaves.setColorAt(index, color);
      index += 1;
    }
  }
  leaves.instanceMatrix.needsUpdate = true;
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  planter.add(leaves);
}

function addCafe(parent: THREE.Group, materials: AtriumFurnishMaterials): void {
  const cafe = new THREE.Group();
  cafe.name = 'Right-side cafe seating and planters';
  cafe.position.set(ATRIUM_CAFE.x, 0, ATRIUM_CAFE.z);
  parent.add(cafe);
  addCafeCounter(cafe, materials);

  ATRIUM_CAFE_TABLES.forEach(({ x, z, width, depth }, index) =>
    addCafeTable(cafe, materials, `Cafe table ${index + 1}`, x, z, width, depth));
  ATRIUM_CAFE_CHAIRS.forEach(({ x, z, yaw }, index) =>
    addWickerChair(cafe, materials, `Cafe chair ${index + 1}`, x, z, yaw));
  const leafGeometry = leafBlade();
  ATRIUM_CAFE_PLANTERS.forEach(({ x, z, scale }, index) =>
    addCafePlanter(cafe, materials, `Cafe tall planter ${index + 1}`, x, z, scale, leafGeometry));
}

/** Build the human-scale furnishings inside the commercial atrium.
 *
 * This group owns only meshes and materials. The world owns the returned lighting switch;
 * scene teardown can therefore release the drawables with the shared recursive disposer.
 */
export function buildAtriumFurnishings(root: THREE.Group): { setLighting(artificialOn: boolean): void } {
  const furnishings = new THREE.Group();
  furnishings.name = 'Atrium furnishings and scale accents';
  root.add(furnishings);
  const materials = createMaterials();
  addSofa(furnishings, materials);
  addLoungeRugAndTables(furnishings, materials);
  addDisplayIslands(furnishings, materials);
  addSculpture(furnishings, materials);
  addCafe(furnishings, materials);

  const setLighting = (artificialOn: boolean): void => {
    for (const control of materials.controls) {
      control.material.emissiveIntensity = artificialOn ? control.artificial : control.daylight;
      control.material.needsUpdate = true;
    }
  };
  setLighting(false);
  return { setLighting };
}
