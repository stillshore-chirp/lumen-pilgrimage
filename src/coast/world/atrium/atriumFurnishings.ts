import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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
  readonly wickerDark: THREE.MeshStandardMaterial;
  readonly planter: THREE.MeshStandardMaterial;
  readonly soil: THREE.MeshStandardMaterial;
  readonly leaves: THREE.MeshStandardMaterial;
  readonly ivory: THREE.MeshStandardMaterial;
  readonly ramification: THREE.MeshStandardMaterial;
  readonly bulb: THREE.MeshStandardMaterial;
  readonly amber: THREE.MeshStandardMaterial;
  readonly controls: EmissiveControl[];
}

const SOFA_DEPTH = 1.08;
const SOFA_SEAT_DEPTH = .67;
const SOFA_BACK_DEPTH = .27;
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

function createMaterials(): AtriumFurnishMaterials {
  const controls: EmissiveControl[] = [];
  const ivory = material('Atrium sculpture ivory', 0xe7ddce, .52, .03);
  ivory.emissive.setHex(0xffe8c6);
  controls.push({ material: ivory, artificial: .62, daylight: .09 });

  const amber = material('Atrium cafe warm trim', 0xffb86f, .42, .06);
  amber.emissive.setHex(0xffa34b);
  controls.push({ material: amber, artificial: .92, daylight: .07 });

  const ramification = material('Atrium sculpture silver ramification', 0xd9d8d4, .38, .16);
  ramification.emissive.setHex(0xffeed8);
  controls.push({ material: ramification, artificial: .76, daylight: .10 });

  const bulb = material('Atrium sculpture warm pin lights', 0xffd59b, .30, .04);
  bulb.emissive.setHex(0xff9b4b);
  controls.push({ material: bulb, artificial: 2.10, daylight: .08 });

  return {
    sofa: material('Greige upholstered sofa', 0x9a968d, .96),
    sofaShadow: material('Sofa inset and seam shadow', 0x68655f, .88),
    sofaFrame: material('Sofa charcoal oak frame', 0x3e3d39, .62, .05),
    seam: material('Sofa double piping', 0x5d5b55, .82),
    rug: material('Low-pile greige lounge rug', 0x908b82, .98),
    rugBorder: material('Lounge rug stitched border', 0x6e6a62, .93),
    stone: material('Atrium limestone display stone', 0xc8c1b5, .78),
    stoneEdge: material('Atrium display warm edge', 0x9a7e60, .47, .38),
    darkMetal: material('Cafe charcoal metal', 0x282a29, .48, .43),
    brass: material('Cafe aged brass', 0xb69061, .42, .59),
    glass: new THREE.MeshPhysicalMaterial({
      name: 'Cafe lightly smoked glass', color: 0x76827f, roughness: .14, metalness: .08,
      transparent: true, opacity: .42,
    }),
    porcelain: material('Warm white table porcelain', 0xe6ddd0, .32),
    wicker: material('Natural wicker loop chair', 0xb3895d, .86),
    wickerDark: material('Wicker chair shadow weave', 0x6d4f38, .92),
    planter: material('Tall planter clay', 0x776958, .89),
    soil: material('Planter soil', 0x302a24, 1),
    leaves: material('Planter olive foliage', 0x4d5c4a, .96),
    ivory,
    ramification,
    bulb,
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
  // TorusGeometry starts in the XY plane; after the quarter-turn its local Y is world Z.
  geometry.scale(scaleX, scaleZ, 1);
  return placeMesh(parent, new THREE.Mesh(geometry, material), name, position);
}

function registerEmissive(materials: AtriumFurnishMaterials, material: THREE.MeshStandardMaterial): void {
  if (!materials.controls.some(control => control.material === material)) {
    materials.controls.push({ material, artificial: material.emissiveIntensity, daylight: 0 });
  }
}

function addSofa(parent: THREE.Group, materials: AtriumFurnishMaterials): void {
  const sofa = new THREE.Group();
  sofa.name = 'Central modular greige sofa';
  sofa.position.set(ATRIUM_SOFA.x, 0, 0);
  parent.add(sofa);

  roundedBox(sofa, 'Sofa lower shadow plinth', materials.sofaFrame, SOFA_WIDTH + .12, .18, SOFA_DEPTH,
    [0, .20, SOFA_FRONT_Z], .075);
  roundedBox(sofa, 'Sofa front apron', materials.sofaShadow, SOFA_WIDTH - .10, .19, .16,
    [0, .37, SOFA_FRONT_Z + .02], .045);
  roundedBox(sofa, 'Sofa rear rail', materials.sofaFrame, SOFA_WIDTH + .03, .13, .20,
    [0, .64, SOFA_BACK_Z - .10], .035);

  const moduleGap = .026;
  const moduleWidths = [1.49, 1.49, SOFA_WIDTH - 2 * 1.49 - moduleGap * 2];
  let moduleX = -SOFA_WIDTH / 2 + moduleWidths[0] / 2;
  for (const [index, width] of moduleWidths.entries()) {
    const lean = index === 0 ? -.007 : index === 2 ? .007 : 0;
    roundedBox(sofa, `Sofa contoured seat ${index + 1}`, materials.sofa, width - .012, .24, SOFA_SEAT_DEPTH,
      [moduleX, .50, SOFA_SEAT_Z], .10, [0, 0, lean]);
    // Two narrow insets preserve the visual split between sewn modules at the front edge.
    roundedBox(sofa, `Sofa seat shadow ${index + 1}`, materials.sofaShadow, width - .05, .022, .055,
      [moduleX, .626, SOFA_FRONT_Z - .026], .018);
    moduleX += width / 2 + moduleGap + (index < moduleWidths.length - 1 ? moduleWidths[index + 1] / 2 : 0);
  }

  const backWidths = moduleWidths.map(width => width - .025);
  moduleX = -SOFA_WIDTH / 2 + backWidths[0] / 2;
  for (const [index, width] of backWidths.entries()) {
    roundedBox(sofa, `Sofa back cushion ${index + 1}`, materials.sofa, width, .57, SOFA_BACK_DEPTH,
      [moduleX, .94, SOFA_BACK_Z], .11, [0, 0, index === 0 ? -.009 : index === 2 ? .009 : 0]);
    tube(sofa, `Sofa back seam ${index + 1}`, materials.seam, [
      [moduleX - width / 2 + .075, .69, SOFA_FRONT_Z - .112],
      [moduleX + width / 2 - .075, .69, SOFA_FRONT_Z - .112],
    ], .007, false, 16);
    moduleX += width / 2 + moduleGap + (index < backWidths.length - 1 ? backWidths[index + 1] / 2 : 0);
  }

  // Low broad arms keep the 4.55 m silhouette while leaving a clear central exit from the cushion.
  for (const side of [-1, 1]) {
    const armX = side * (SOFA_WIDTH / 2 - .115);
    roundedBox(sofa, `Sofa ${side < 0 ? 'left' : 'right'} beveled arm`, materials.sofa, .31, .58, .88,
      [armX, .64, SOFA_FRONT_Z - .34], .095, [0, 0, side * .012]);
    roundedBox(sofa, `Sofa ${side < 0 ? 'left' : 'right'} arm cap`, materials.sofaShadow, .26, .046, .74,
      [armX, .944, SOFA_FRONT_Z - .34], .018, [0, 0, side * .012]);
  }

  const legGeometry = new THREE.CylinderGeometry(.045, .056, .17, 10);
  const legs = new THREE.InstancedMesh(legGeometry, materials.sofaFrame, 4);
  legs.name = 'Sofa four inset feet';
  const legTransform = new THREE.Object3D();
  for (const [index, [x, z]] of ([
    [-SOFA_WIDTH / 2 + .29, SOFA_FRONT_Z - .16],
    [SOFA_WIDTH / 2 - .29, SOFA_FRONT_Z - .16],
    [-SOFA_WIDTH / 2 + .29, SOFA_BACK_Z - .38],
    [SOFA_WIDTH / 2 - .29, SOFA_BACK_Z - .38],
  ] as const).entries()) {
    legTransform.position.set(x, .105, z);
    legTransform.updateMatrix();
    legs.setMatrixAt(index, legTransform.matrix);
  }
  legs.instanceMatrix.needsUpdate = true;
  legs.castShadow = true;
  legs.receiveShadow = true;
  sofa.add(legs);

  // Two small lumbar cushions soften the otherwise architectural modular geometry.
  roundedBox(sofa, 'Sofa left lumbar cushion', materials.sofaShadow, .69, .25, .16,
    [-1.16, .84, SOFA_FRONT_Z - .17], .065, [0, 0, -.06]);
  roundedBox(sofa, 'Sofa right lumbar cushion', materials.sofaShadow, .69, .25, .16,
    [.94, .84, SOFA_FRONT_Z - .17], .065, [0, 0, .06]);
}

function addLoungeRugAndTables(parent: THREE.Group, materials: AtriumFurnishMaterials): void {
  const lounge = new THREE.Group();
  lounge.name = 'Low oval lounge rug and tables';
  lounge.position.set(ATRIUM_LOUNGE.x, 0, ATRIUM_LOUNGE.z);
  parent.add(lounge);

  cylinder(lounge, 'Lounge rug low pile', materials.rug, 1, .028, [0, .018, 0], 64,
    ATRIUM_LOUNGE.radiusX, ATRIUM_LOUNGE.radiusZ);
  horizontalRing(lounge, 'Lounge rug outer stitched edge', materials.rugBorder, .96, .019,
    [0, .038, 0], ATRIUM_LOUNGE.radiusX, ATRIUM_LOUNGE.radiusZ);
  horizontalRing(lounge, 'Lounge rug inner stitched edge', materials.rugBorder, .68, .011,
    [0, .041, 0], ATRIUM_LOUNGE.radiusX, ATRIUM_LOUNGE.radiusZ);

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

function addSculpture(parent: THREE.Group, materials: AtriumFurnishMaterials): void {
  const sculpture = new THREE.Group();
  sculpture.name = 'Luminous ivory interlaced branching sculpture';
  sculpture.position.set(ATRIUM_SCULPTURE.x, 0, ATRIUM_SCULPTURE.z);
  parent.add(sculpture);
  registerEmissive(materials, materials.ivory);

  cylinder(sculpture, 'Sculpture limestone plinth', materials.stone, ATRIUM_SCULPTURE.radius, .24,
    [0, .12, 0], 48);
  horizontalRing(sculpture, 'Sculpture plinth brass inset', materials.stoneEdge, ATRIUM_SCULPTURE.radius * .82,
    .012, [0, .245, 0]);

  const branch = (name: string, points: readonly Point3[], radius: number): void => {
    tube(sculpture, name, materials.ivory, points, radius, false, Math.max(18, points.length * 5), false);
  };
  branch('Sculpture central rising stem', [
    [0, .24, 0], [.06, 1.08, -.02], [-.10, 2.05, .04], [.14, 2.95, .02], [-.02, 3.90, .01],
    [.10, 4.72, -.02], [0, ATRIUM_SCULPTURE.height, 0],
  ], .029);
  branch('Sculpture left outer sweep', [
    [-.02, .86, 0], [-.38, 1.55, -.02], [-.62, 2.31, .04], [-.86, 2.98, -.04], [-1.02, 3.59, .08],
  ], .019);
  branch('Sculpture left high returning sweep', [
    [-.09, 2.16, .03], [-.52, 2.70, .18], [-.84, 3.42, .24], [-.39, 4.10, .18], [-.02, 4.46, .05],
  ], .016);
  branch('Sculpture right outer sweep', [
    [.02, .67, .01], [.38, 1.31, -.04], [.62, 2.04, -.12], [.86, 2.68, -.04], [1.02, 3.31, .09],
  ], .019);
  branch('Sculpture right high returning sweep', [
    [.11, 2.55, -.05], [.52, 3.00, .12], [.84, 3.70, .19], [.41, 4.33, .13], [.06, 4.69, .04],
  ], .016);
  branch('Sculpture front interlace', [
    [-.14, 1.48, .10], [.24, 2.11, .28], [.36, 2.86, .24], [-.16, 3.49, .22], [-.39, 4.00, .09],
  ], .013);
  branch('Sculpture rear interlace', [
    [.15, 1.18, -.08], [-.26, 1.90, -.22], [-.30, 2.65, -.26], [.25, 3.30, -.22], [.48, 3.98, -.04],
  ], .013);

  // Fine ramification fills the canopy while keeping the roots deliberately sparse.
  const fineBranch = (name: string, points: readonly Point3[], radius: number): void => {
    tube(sculpture, name, materials.ramification, points, radius, false, Math.max(14, points.length * 4), false);
  };
  const finePaths: readonly (readonly Point3[])[] = [
    [[-.04, 1.03, .02], [-.32, 1.41, .12], [-.68, 1.72, .10], [-1.04, 1.95, .04]],
    [[.02, 1.16, -.02], [.35, 1.50, -.12], [.72, 1.75, -.16], [1.05, 2.06, -.08]],
    [[-.10, 1.74, .02], [-.43, 2.02, .13], [-.76, 2.30, .17], [-1.12, 2.42, .10]],
    [[.12, 1.92, .01], [.46, 2.21, -.11], [.77, 2.46, -.18], [1.12, 2.64, -.05]],
    [[-.10, 2.36, .03], [-.38, 2.63, .21], [-.72, 2.86, .27], [-1.06, 2.94, .16]],
    [[.13, 2.61, -.03], [.45, 2.88, .13], [.80, 3.12, .18], [1.08, 3.22, .09]],
    [[-.08, 2.91, .02], [-.34, 3.18, -.10], [-.57, 3.52, -.04], [-.92, 3.67, .08]],
    [[.13, 3.17, .02], [.40, 3.39, -.13], [.68, 3.68, -.16], [.98, 3.82, -.04]],
    [[-.04, 3.52, .00], [-.32, 3.78, .16], [-.57, 4.04, .17], [-.87, 4.17, .07]],
    [[.08, 3.77, -.01], [.35, 4.00, -.15], [.66, 4.22, -.12], [.94, 4.38, -.02]],
    [[-.03, 4.08, .01], [-.29, 4.34, .11], [-.56, 4.57, .14], [-.83, 4.76, .07]],
    [[.06, 4.28, .00], [.30, 4.51, -.13], [.58, 4.73, -.11], [.82, 4.94, -.02]],
    [[-.02, 4.53, .02], [-.22, 4.75, .13], [-.43, 4.97, .11], [-.60, 5.18, .04]],
    [[.03, 4.67, -.01], [.21, 4.84, -.12], [.42, 5.02, -.10], [.61, 5.17, -.02]],
    [[-.18, 1.42, -.09], [-.40, 1.72, -.22], [-.64, 1.88, -.25], [-.82, 2.10, -.18]],
    [[.18, 1.56, .08], [.43, 1.86, .21], [.66, 2.04, .23], [.85, 2.28, .15]],
    [[-.22, 2.55, .10], [-.49, 2.79, .27], [-.72, 3.04, .25], [-.89, 3.28, .15]],
    [[.21, 2.75, -.10], [.49, 3.03, -.25], [.73, 3.27, -.24], [.92, 3.49, -.13]],
  ];
  finePaths.forEach((points, index) => fineBranch(`Sculpture fine ivory twig ${index + 1}`, points, index < 4 ? .009 : .006));

  // Replace the two smooth crown loops with irregular fork families. Each side has six
  // small leading twigs and six secondary forks; short paths keep the mesh bounded while
  // the varied offsets prevent a mirrored oval silhouette at the entrance camera.
  const crownTipPoints: Point3[] = [];
  for (const side of [-1, 1] as const) {
    for (let level = 0; level < 6; level += 1) {
      const phase = level * 1.17 + (side < 0 ? .22 : 1.03);
      const y = 2.62 + level * .39 + .06 * Math.sin(phase * 1.8);
      const z = .16 * Math.sin(phase);
      const midX = side * (.23 + (level % 2) * .055);
      const endX = side * (.53 + (level % 3) * .075);
      const tipX = side * (.77 + (level % 2) * .13);
      const tipY = Math.min(5.31, y + .70 + .05 * Math.cos(phase));
      const lead: readonly Point3[] = [
        [side * .055, y - .18, z * .55],
        [midX, y + .16, z + .07 * Math.cos(phase * 1.4)],
        [endX, y + .43, z - .08 * Math.sin(phase)],
        [tipX, tipY, z + .10 * Math.cos(phase * .7)],
      ];
      fineBranch(`Sculpture organic crown lead ${side < 0 ? 'left' : 'right'} ${level + 1}`, lead, .0063);
      crownTipPoints.push(lead[lead.length - 1]);

      const forkStart = lead[1];
      const forkTipX = side * (.87 + (level % 3) * .065);
      const forkTipY = Math.min(5.34, y + .47 + .09 * Math.sin(phase + 1.2));
      const fork: readonly Point3[] = [
        forkStart,
        [side * (.43 + (level % 2) * .06), y + .28, z + .14 * Math.sin(phase + 1.1)],
        [side * (.65 + (level % 3) * .06), y + .42, z + .17 * Math.cos(phase)],
        [forkTipX, forkTipY, z - .13 * Math.sin(phase * .9)],
      ];
      fineBranch(`Sculpture organic crown fork ${side < 0 ? 'left' : 'right'} ${level + 1}`, fork, .0048);
      crownTipPoints.push(fork[fork.length - 1]);
    }
  }

  const tipGeometry = new THREE.SphereGeometry(1, 8, 6);
  const tips = new THREE.InstancedMesh(tipGeometry, materials.ivory, 10 + crownTipPoints.length);
  tips.name = 'Sculpture repeated luminous branch tips';
  const transform = new THREE.Object3D();
  const tipPoints: readonly Point3[] = [
    [-1.02, 3.59, .08], [-.39, 4.10, .18], [1.02, 3.31, .09], [.41, 4.33, .13],
    [-.36, 5.14, .07], [.47, 5.08, -.02], [.10, 4.72, -.02], [-.02, 4.46, .05],
    [.48, 3.98, -.04], [-.39, 4.00, .09],
    ...crownTipPoints,
  ];
  tipPoints.forEach(([x, y, z], index) => {
    transform.position.set(x, y, z);
    const size = index < 4 ? .056 : .044;
    transform.scale.set(size, size, size);
    transform.updateMatrix();
    tips.setMatrixAt(index, transform.matrix);
  });
  tips.instanceMatrix.needsUpdate = true;
  tips.castShadow = true;
  tips.receiveShadow = true;
  sculpture.add(tips);

  // Forty small warm points are instanced once so the canopy reads as an airy luminous mass
  // from the entrance camera without adding a point-light per ornament.
  const bulbCount = 40;
  const bulbGeometry = new THREE.SphereGeometry(1, 8, 6);
  const bulbs = new THREE.InstancedMesh(bulbGeometry, materials.bulb, bulbCount);
  bulbs.name = 'Sculpture forty warm pin lights';
  const capGeometry = new THREE.CylinderGeometry(.65, .82, 1, 6);
  const caps = new THREE.InstancedMesh(capGeometry, materials.ramification, bulbCount);
  caps.name = 'Sculpture forty silver bulb caps';
  const bulbTransform = new THREE.Object3D();
  const capTransform = new THREE.Object3D();
  for (let index = 0; index < bulbCount; index += 1) {
    const level = index / (bulbCount - 1);
    const angle = index * 2.399963;
    const spread = .14 + .91 * Math.sin(Math.PI * Math.min(1, level * 1.06)) ** .68;
    const x = Math.cos(angle) * spread * (.78 + .22 * Math.sin(index * 1.31) ** 2);
    const z = Math.sin(angle) * spread * .30 + .055 * Math.sin(index * 2.17);
    const y = .88 + level * 4.36 + .10 * Math.sin(index * 1.71);
    const size = .034 + .016 * (index % 4) / 3;
    bulbTransform.position.set(x, y, z);
    bulbTransform.scale.setScalar(size);
    bulbTransform.updateMatrix();
    bulbs.setMatrixAt(index, bulbTransform.matrix);
    capTransform.position.set(x, y - size * 1.25, z);
    capTransform.scale.set(size * .68, size * .45, size * .68);
    capTransform.updateMatrix();
    caps.setMatrixAt(index, capTransform.matrix);
  }
  bulbs.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  // These are self-lit pin points, so shadow-map passes would cost more than they add visually.
  bulbs.castShadow = false;
  bulbs.receiveShadow = false;
  caps.castShadow = false;
  caps.receiveShadow = false;
  sculpture.add(caps, bulbs);
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
  registerEmissive(materials, materials.amber);
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
  horizontalRing(table, `${name} warm rim`, materials.amber, .47, .012, [0, topY + .042, 0],
    width / 1.0, depth / 1.0);
  cylinder(table, `${name} pedestal`, materials.darkMetal, .13, topY - .07, [0, (topY - .07) / 2, 0], 24);
  cylinder(table, `${name} foot`, materials.brass, .31, .032, [0, .045, 0], 32, width / .92, depth / .92);
  cylinder(table, `${name} porcelain centerpiece`, materials.porcelain, .095, .13,
    [.04, .865, -.02], 24);
  cylinder(table, `${name} center trim`, materials.amber, .098, .010,
    [.04, .931, -.02], 24);
  registerEmissive(materials, materials.amber);
}

function addWickerChair(parent: THREE.Group, materials: AtriumFurnishMaterials,
  name: string, x: number, z: number, yaw: number): void {
  const chair = new THREE.Group();
  chair.name = name;
  chair.position.set(x, 0, z);
  chair.rotation.y = yaw;
  parent.add(chair);
  roundedBox(chair, `${name} woven seat`, materials.wicker, .60, .13, .55, [0, .43, 0], .085);
  roundedBox(chair, `${name} seat shadow`, materials.wickerDark, .48, .032, .41, [0, .506, 0], .055);
  const loop = [
    [-.27, .49, .05], [-.31, .74, .06], [-.28, 1.05, .04], [-.16, 1.27, .01],
    [0, 1.35, -.01], [.16, 1.27, .01], [.28, 1.05, .04], [.31, .74, .06], [.27, .49, .05],
  ] as const;
  tube(chair, `${name} continuous wicker back loop`, materials.wicker, loop, .024, false, 30);
  tube(chair, `${name} inner wicker loop`, materials.wickerDark, [
    [-.20, .56, .05], [-.23, .79, .07], [-.17, 1.00, .06], [0, 1.10, .03],
    [.17, 1.00, .06], [.23, .79, .07], [.20, .56, .05],
  ], .010, false, 24);
  for (const [legX, legZ] of [[-.21, -.18], [.21, -.18], [-.21, .18], [.21, .18]] as const) {
    tube(chair, `${name} tapered leg`, materials.wickerDark, [
      [legX, .40, legZ], [legX * .80, .08, legZ * .80],
    ], .019, false, 10);
  }
  tube(chair, `${name} left arm`, materials.wicker, [[-.30, .50, .02], [-.38, .76, .02], [-.27, .91, .03]], .018, false, 16);
  tube(chair, `${name} right arm`, materials.wicker, [[.30, .50, .02], [.38, .76, .02], [.27, .91, .03]], .018, false, 16);
}

function addCafePlanter(parent: THREE.Group, materials: AtriumFurnishMaterials,
  name: string, x: number, z: number, scale: number): void {
  const planter = new THREE.Group();
  planter.name = name;
  planter.position.set(x, 0, z);
  parent.add(planter);
  cylinder(planter, `${name} tall clay vessel`, materials.planter, .39, .72, [0, .36, 0], 32, 1, .84);
  cylinder(planter, `${name} dark soil`, materials.soil, .30, .018, [0, .725, 0], 32, 1, .84);
  horizontalRing(planter, `${name} clay rim`, materials.brass, .36, .016, [0, .745, 0], 1, .84);
  const stemPoints: readonly Point3[] = [
    [0, .72, 0], [-.18, 1.31 * scale, .02], [-.28, 2.02 * scale, .06], [-.14, 2.65 * scale, .02],
    [.06, 3.10 * scale, -.01], [.27, 2.35 * scale, .05], [.37, 1.64 * scale, -.02],
  ];
  tube(planter, `${name} branched stems`, materials.wickerDark, stemPoints, .020, false, 24);
  const leafGeometry = new THREE.SphereGeometry(1, 8, 5);
  leafGeometry.scale(.19, .046, .095);
  const leafPoints: readonly [number, number, number, number, number][] = [
    [-.28, 1.62, .08, -.37, 1.2], [-.17, 2.02, .09, -.20, .9], [-.36, 2.42, .12, .37, 1.1],
    [-.06, 2.78, .03, -.12, 1.0], [.18, 2.45, .11, .32, 1.2], [.38, 2.08, .08, -.18, .9],
    [.27, 1.53, .10, .34, 1.1], [.07, 3.06, .02, -.30, .8], [-.39, 1.98, -.03, .17, .8],
    [.43, 2.53, -.06, -.12, .95],
  ];
  const leaves = new THREE.InstancedMesh(leafGeometry, materials.leaves, leafPoints.length);
  leaves.name = `${name} repeated olive leaves`;
  const transform = new THREE.Object3D();
  leafPoints.forEach(([leafX, leafY, leafZ, yaw, size], index) => {
    transform.position.set(leafX, leafY * scale, leafZ);
    transform.rotation.set(.18, yaw, .24);
    transform.scale.setScalar(size * scale);
    transform.updateMatrix();
    leaves.setMatrixAt(index, transform.matrix);
  });
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
  ATRIUM_CAFE_PLANTERS.forEach(({ x, z, scale }, index) =>
    addCafePlanter(cafe, materials, `Cafe tall planter ${index + 1}`, x, z, scale));
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
