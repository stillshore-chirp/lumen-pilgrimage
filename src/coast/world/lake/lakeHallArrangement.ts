import {
  BufferGeometry, CatmullRomCurve3, Color, Float32BufferAttribute, InstancedMesh, LatheGeometry, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Quaternion, SphereGeometry, Vector2, Vector3,
  type Group,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAKE_TABLE } from './lakeLayout';

type BranchPoint = readonly [x: number, y: number, z: number, radius: number];
type Branch = { readonly points: readonly BranchPoint[]; readonly floweringFrom: number };

// The reference supports a low, returning trunk and a left-high/right-low flower crown,
// but not a species identification. These dimensions are a spatial modelling assumption.
const branches: readonly Branch[] = [
  { floweringFrom: 8, points: [
    [-.030, .110, .010, .017], [-.048, .139, .014, .018], [-.029, .157, .012, .016],
    [.032, .169, .009, .014], [.087, .197, -.002, .012], [.112, .223, -.010, .011],
    [.082, .245, -.017, .009], [.015, .250, -.014, .008], [-.053, .272, -.006, .006],
    [-.114, .312, -.014, .0045], [-.181, .341, -.022, .0032], [-.240, .381, -.019, .0018],
    [-.288, .402, -.026, .00065],
  ] },
  { floweringFrom: 2, points: [
    [.082, .245, -.017, .0075], [.155, .255, .005, .0055], [.223, .279, .013, .004],
    [.292, .276, .034, .0025], [.351, .300, .050, .0014], [.395, .308, .047, .0006],
  ] },
  { floweringFrom: 1, points: [
    [-.114, .312, -.014, .0043], [-.180, .322, .009, .0031], [-.235, .345, .031, .002],
    [-.293, .360, .022, .0012], [-.327, .382, .005, .0006],
  ] },
  { floweringFrom: 1, points: [
    [-.181, .341, -.022, .0031], [-.192, .380, -.034, .002], [-.221, .425, -.023, .0011],
    [-.251, .443, -.008, .00055],
  ] },
  { floweringFrom: 1, points: [
    [-.053, .272, -.006, .0047], [-.086, .306, -.053, .003], [-.130, .330, -.074, .0018],
    [-.161, .367, -.084, .0006],
  ] },
  { floweringFrom: 1, points: [
    [.155, .255, .005, .004], [.169, .291, -.031, .0027], [.205, .319, -.055, .0014],
    [.236, .351, -.062, .0006],
  ] },
  { floweringFrom: 1, points: [
    [.223, .279, .013, .003], [.258, .304, .049, .002], [.276, .340, .076, .0012],
    [.318, .355, .078, .00055],
  ] },
  { floweringFrom: 1, points: [
    [.032, .169, .009, .0065], [.012, .194, .035, .0038], [.021, .220, .053, .0018],
    [.004, .239, .057, .0006],
  ] },
];

function noise(seed: number) {
  const wave = Math.sin(seed * 127.1 + 17.18) * 43758.5453;
  return wave - Math.floor(wave);
}

function curvedStem(points: readonly BranchPoint[]): BufferGeometry {
  const curve = new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z)), false, 'centripetal');
  const segments = Math.max(8, (points.length - 1) * 6);
  const sides = 9;
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= segments; ring += 1) {
    const t = ring / segments;
    const center = curve.getPointAt(t);
    const span = t * (points.length - 1);
    const lower = Math.min(points.length - 2, Math.floor(span));
    const blend = span - lower;
    const radius = points[lower][3] * (1 - blend) + points[lower + 1][3] * blend;
    for (let side = 0; side <= sides; side += 1) {
      const angle = side / sides * 2 * Math.PI;
      const bark = 1 + .045 * Math.sin(side * 3.7 + ring * .23);
      const vertex = center.clone()
        .addScaledVector(frames.normals[ring], radius * Math.cos(angle) * bark)
        .addScaledVector(frames.binormals[ring], radius * Math.sin(angle) * bark);
      positions.push(vertex.x, vertex.y, vertex.z);
      if (ring < segments && side < sides) {
        const a = ring * (sides + 1) + side;
        const b = a + sides + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function addLakeHallArrangement(root: Group): void {
  const base = new Vector3(LAKE_TABLE.x + .04, LAKE_TABLE.topY, LAKE_TABLE.z - .16);
  const ceramic = new MeshPhysicalMaterial({
    name: 'Iron-glazed stoneware', color: 0x373a32, roughness: .29, metalness: .04,
    clearcoat: .48, clearcoatRoughness: .22,
  });
  // The rolled lip, rounded shoulder and short foot are actual curved surfaces.
  // Reflections remain lighting-dependent; the vessel has no painted or emissive highlight.
  const profile = [
    [0, .003], [.060, .003], [.071, .007], [.073, .015], [.064, .023], [.060, .034],
    [.072, .044], [.110, .057], [.154, .077], [.185, .101], [.201, .119], [.205, .130],
    [.201, .141], [.193, .147], [.182, .149], [.174, .145], [.172, .138], [.178, .128],
    [.170, .111], [.145, .094], [.115, .084], [0, .080],
  ];
  const bowl = new Mesh(new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), 64), ceramic);
  bowl.name = 'Low stoneware branch vessel';
  bowl.position.copy(base);
  bowl.castShadow = bowl.receiveShadow = true;
  root.add(bowl);
  const soil = new Mesh(new SphereGeometry(1, 32, 8), new MeshStandardMaterial({ color: 0x342d21, roughness: 1 }));
  soil.name = 'Vessel substrate';
  soil.scale.set(.166, .008, .166);
  soil.position.copy(base).add(new Vector3(0, .127, 0));
  soil.receiveShadow = true;
  root.add(soil);

  const stems: BufferGeometry[] = [];
  const flowers: Vector3[] = [];
  const buds: Vector3[] = [];
  const up = new Vector3(0, 1, 0);
  // Buttress roots disappear into the substrate instead of ending as a cut stick.
  for (const [index, end] of [[-.112, .108, .038], [.070, .108, .067], [-.031, .108, -.095]].entries()) {
    stems.push(curvedStem([
      [-.038, .146, .012, .012], [-.042 + index * .008, .119, .014, .009],
      [end[0], end[1], end[2], .0018],
    ]));
  }
  for (const [branchIndex, branch] of branches.entries()) {
    stems.push(curvedStem(branch.points));
    for (let index = branch.floweringFrom; index < branch.points.length; index += 1) {
      const [ax, ay, az] = branch.points[index - 1];
      const [bx, by, bz, br] = branch.points[index];
      const a = new Vector3(ax, ay, az);
      const b = new Vector3(bx, by, bz);
      for (let spur = 0; spur < 2; spur += 1) {
        const seed = 31 * branchIndex + 7 * index + spur * 2;
        const start = a.clone().lerp(b, .30 + .41 * spur);
        const end = start.clone().add(new Vector3(
          .046 * (noise(seed + 1) - .5), .015 + noise(seed + 2) * .031, .054 * (noise(seed + 3) - .5),
        ));
        const middle = start.clone().lerp(end, .52).add(new Vector3(.006, .002, -.004));
        stems.push(curvedStem([
          [start.x, start.y, start.z, Math.min(.0013, br * .62)],
          [middle.x, middle.y, middle.z, .0007], [end.x, end.y, end.z, .00035],
        ]));
        flowers.push(end, start.clone().lerp(end, .66).add(new Vector3(.008, .003, .004)));
        if (noise(seed + 6) > .4) flowers.push(end.clone().add(new Vector3(.011, .005, -.007)));
        if ((branchIndex + index + spur) % 3 === 0) buds.push(end.clone().add(new Vector3(-.007, .010, .003)));
      }
    }
  }
  const geometry = mergeGeometries(stems);
  stems.forEach(part => part.dispose());
  const wood = new Mesh(geometry, new MeshStandardMaterial({ color: 0x574431, roughness: .92 }));
  wood.name = 'Tapering flowering branches';
  wood.position.copy(base);
  wood.scale.set(1.24, 1.17, 1.10);
  wood.castShadow = wood.receiveShadow = true;
  root.add(wood);

  const petalShape = new SphereGeometry(1, 8, 6);
  const detailShape = new SphereGeometry(1, 7, 5);
  const stamenShape = new SphereGeometry(1, 5, 3);
  const petals = new InstancedMesh(petalShape, new MeshStandardMaterial({ color: 0xffffff, roughness: .72 }), flowers.length * 5);
  const centres = new InstancedMesh(detailShape, new MeshStandardMaterial({ color: 0xb56a6c, roughness: .87 }), flowers.length);
  const stamens = new InstancedMesh(stamenShape, new MeshStandardMaterial({ color: 0xd8b577, roughness: .82 }), flowers.length * 7);
  const leafPoints = flowers.filter((_, index) => index % 3 === 1);
  const leaves = new InstancedMesh(detailShape, new MeshStandardMaterial({ color: 0xffffff, roughness: .86 }), leafPoints.length);
  const budMesh = new InstancedMesh(detailShape, new MeshStandardMaterial({ color: 0xc37586, roughness: .78 }), buds.length);
  const palette = [0xf8d4d9, 0xffe3e5, 0xf8dbe0, 0xf3c3d1, 0xffebeb, 0xeeb7c7].map(color => new Color(color));
  const leafTones = [0x687148, 0x7b8053, 0x7d6c4e].map(color => new Color(color));
  const pose = new Object3D();
  for (const [index, point] of flowers.entries()) {
    const size = .009 + .007 * noise(index + 22);
    const normal = new Vector3(
      noise(index + 89) - .5, -.15 + noise(index + 12), noise(index + 48) - .5,
    ).normalize();
    const tilt = new Quaternion().setFromUnitVectors(up, normal);
    for (let petal = 0; petal < 5; petal += 1) {
      const angle = 2 * Math.PI * (petal / 5 + noise(index + 18));
      const offset = new Vector3(Math.cos(angle) * size * .70, size * .10, Math.sin(angle) * size * .70);
      pose.position.copy(offset.applyQuaternion(tilt)).add(point);
      pose.quaternion.copy(tilt);
      pose.rotateY(-angle);
      pose.rotateZ(.17);
      pose.scale.set(size * .72, size * .14, size * .48);
      pose.updateMatrix();
      petals.setMatrixAt(index * 5 + petal, pose.matrix);
      petals.setColorAt(index * 5 + petal, palette[(index + Math.floor(petal / 3)) % palette.length]);
    }
    pose.position.copy(point).addScaledVector(normal, size * .12);
    pose.quaternion.copy(tilt);
    pose.scale.set(size * .31, size * .15, size * .31);
    pose.updateMatrix();
    centres.setMatrixAt(index, pose.matrix);
    for (let stamen = 0; stamen < 7; stamen += 1) {
      const angle = stamen / 7 * 2 * Math.PI;
      const offset = new Vector3(Math.cos(angle) * size * .32, size * .28, Math.sin(angle) * size * .32);
      pose.position.copy(offset.applyQuaternion(tilt)).add(point);
      pose.scale.setScalar(size * .066);
      pose.updateMatrix();
      stamens.setMatrixAt(index * 7 + stamen, pose.matrix);
    }
  }
  for (const [index, point] of leafPoints.entries()) {
    pose.position.copy(point).add(new Vector3(.012 * (noise(index + 19) - .5), -.014, .009));
    pose.rotation.set(.91 - noise(index + 7), noise(index + 5) * Math.PI, noise(index + 2) - .5);
    pose.scale.set(.011 + .006 * noise(index + 33), .0011, .004);
    pose.updateMatrix();
    leaves.setMatrixAt(index, pose.matrix);
    leaves.setColorAt(index, leafTones[index % leafTones.length]);
  }
  for (const [index, point] of buds.entries()) {
    pose.position.copy(point);
    pose.rotation.set(index * .7, index * 1.3, .4);
    pose.scale.set(.0034, .0054, .0034);
    pose.updateMatrix();
    budMesh.setMatrixAt(index, pose.matrix);
  }
  petals.name = 'Blush flower petals';
  centres.name = 'Rose flower centres';
  stamens.name = 'Fine ochre flower stamens';
  leaves.name = 'Sparse bronze-green spring leaves';
  budMesh.name = 'Unopened blush flower buds';
  for (const detail of [petals, centres, stamens, leaves, budMesh]) {
    detail.position.copy(base);
    detail.scale.copy(wood.scale);
    detail.receiveShadow = true;
    root.add(detail);
  }
}
