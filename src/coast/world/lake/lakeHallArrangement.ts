import {
  Color, CylinderGeometry, InstancedMesh, LatheGeometry, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, Object3D, SphereGeometry, Vector2, Vector3,
  type Group,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAKE_TABLE } from './lakeLayout';

type BranchPoint = readonly [x: number, y: number, z: number, radius: number];

const branches: readonly (readonly BranchPoint[])[] = [
  [[-.04, .077, .008, .016], [-.025, .128, -.002, .014], [.06, .183, .008, .011],
    [.11, .24, .014, .008], [.095, .273, -.005, .006], [.138, .327, -.034, .003], [.186, .367, -.039, .001]],
  [[.095, .273, -.005, .006], [.172, .281, .011, .0045], [.257, .31, .006, .0032],
    [.321, .293, .04, .002], [.412, .32, .076, .0009]],
  [[.06, .183, .008, .009], [.009, .243, .023, .006], [-.07, .306, .004, .004],
    [-.132, .345, .012, .0032], [-.211, .389, .046, .0022], [-.335, .423, .022, .0009]],
  [[-.132, .345, .012, .0032], [-.217, .34, -.033, .0023], [-.247, .376, -.065, .0015], [-.30, .383, -.105, .0009]],
  [[.11, .24, .014, .0065], [.157, .25, -.049, .004], [.21, .265, -.095, .0027], [.269, .294, -.124, .0009]],
  [[-.07, .306, .004, .0042], [-.104, .364, .029, .0027], [-.148, .399, .062, .0015], [-.192, .449, .101, .0009]],
];

function noise(seed: number) {
  const wave = Math.sin(seed * 127.1 + 17.18) * 43758.5453;
  return wave - Math.floor(wave);
}

export function addLakeHallArrangement(root: Group): void {
  const base = new Vector3(LAKE_TABLE.x + .04, LAKE_TABLE.topY, LAKE_TABLE.z - .16);
  const ceramic = new MeshPhysicalMaterial({
    name: 'Iron-glazed stoneware', color: 0x322b23, roughness: .38, clearcoat: .37, clearcoatRoughness: .28,
  });
  const profile = [
    [0, .003], [.080, .003], [.088, .010], [.089, .023], [.137, .033], [.182, .059],
    [.204, .080], [.205, .094], [.192, .106], [.171, .108], [.166, .117], [.156, .119],
    [.153, .109], [.159, .095], [.149, .071], [.127, .060], [0, .050],
  ];
  const bowl = new Mesh(new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), 48), ceramic);
  bowl.name = 'Low stoneware branch vessel';
  bowl.position.copy(base);
  bowl.castShadow = bowl.receiveShadow = true;
  root.add(bowl);
  const soil = new Mesh(new SphereGeometry(1, 24, 8), new MeshStandardMaterial({ color: 0x33291d, roughness: 1 }));
  soil.name = 'Vessel substrate';
  soil.scale.set(.142, .020, .142);
  soil.position.copy(base).add(new Vector3(0, .076, 0));
  root.add(soil);

  const stems: CylinderGeometry[] = [];
  const flowers: Vector3[] = [];
  const up = new Vector3(0, 1, 0);
  function stem(a: Vector3, b: Vector3, startRadius: number, tipRadius: number) {
    const direction = b.clone().sub(a);
    const part = new CylinderGeometry(tipRadius, startRadius, direction.length(), 7, 1);
    const pose = new Object3D();
    pose.position.copy(a).lerp(b, .5);
    pose.quaternion.setFromUnitVectors(up, direction.normalize());
    pose.updateMatrix();
    part.applyMatrix4(pose.matrix);
    stems.push(part);
  }

  for (const [branchIndex, branch] of branches.entries()) {
    for (let index = 1; index < branch.length; index += 1) {
      const [ax, ay, az, ar] = branch[index - 1];
      const [bx, by, bz, br] = branch[index];
      const a = new Vector3(ax, ay, az);
      const b = new Vector3(bx, by, bz);
      stem(a, b, ar, br);
      if (index < 2) continue;

      // Short flowering spurs follow the fine wood. The thick lower branch is left bare.
      for (let spur = 0; spur < 3; spur += 1) {
        const seed = 31 * branchIndex + 7 * index + spur * 2;
        const start = a.clone().lerp(b, .33 + .22 * spur);
        const end = start.clone().add(new Vector3(
          .105 * (noise(seed + 1) - .5), .025 + noise(seed + 2) * .049, .096 * (noise(seed + 3) - .5),
        ));
        stem(start, end, br * .54, .00055);
        flowers.push(end, start.clone().lerp(end, .63).add(new Vector3(.003, 0, -.002)));
      }
    }
  }

  const geometry = mergeGeometries(stems);
  stems.forEach(part => part.dispose());
  const wood = new Mesh(geometry, new MeshStandardMaterial({ color: 0x554234, roughness: .94 }));
  wood.name = 'Tapering flowering branches';
  wood.position.copy(base);
  wood.scale.set(1.28, 1.17, 1.10);
  wood.castShadow = wood.receiveShadow = true;
  root.add(wood);

  const petalShape = new SphereGeometry(1, 8, 6);
  const petalMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: .80, emissive: 0x843041, emissiveIntensity: .23 });
  const petals = new InstancedMesh(petalShape, petalMaterial, flowers.length * 5);
  const centres = new InstancedMesh(petalShape, new MeshStandardMaterial({ color: 0xb78a56, roughness: .87 }), flowers.length);
  const leaves = new InstancedMesh(petalShape, new MeshStandardMaterial({ color: 0xffffff, roughness: .89 }), flowers.length);
  const palette = [0xc16674, 0xdf8c91, 0xe6a4a4, 0xcf7682, 0xf0c2bc, 0xd9888b].map(color => new Color(color));
  const leafTones = [0x586246, 0x6b754d, 0x796249].map(color => new Color(color));
  const pose = new Object3D();
  for (const [index, point] of flowers.entries()) {
    const size = .007 + .013 * noise(index + 22);
    const normal = new Vector3(noise(index + 89) - .5, .24 + .65 * noise(index + 12), noise(index + 48) - .5).normalize();
    const tilt = pose.quaternion.clone().setFromUnitVectors(up, normal);
    for (let petal = 0; petal < 5; petal += 1) {
      const angle = 2 * Math.PI * (petal / 5 + noise(index + 18));
      const offset = new Vector3(Math.cos(angle) * size * .74, 0, Math.sin(angle) * size * .74);
      pose.position.copy(offset.applyQuaternion(tilt)).add(point);
      pose.quaternion.copy(tilt).multiply(pose.quaternion.clone().setFromAxisAngle(up, -angle));
      pose.scale.set(size * .72, size * .18, size * .49);
      pose.updateMatrix();
      petals.setMatrixAt(index * 5 + petal, pose.matrix);
      petals.setColorAt(index * 5 + petal, palette[(index + Math.floor(petal / 3)) % palette.length]);
    }
    pose.position.copy(point).addScaledVector(normal, size * .17);
    pose.quaternion.copy(tilt);
    pose.scale.set(size * .39, size * .24, size * .39);
    pose.updateMatrix();
    centres.setMatrixAt(index, pose.matrix);

    pose.position.copy(point).add(new Vector3(.014 * (noise(index + 19) - .5), -.010, .018));
    pose.rotation.set(.91 - noise(index + 7), noise(index + 5) * Math.PI, noise(index + 2) - .5);
    pose.scale.set(size * 1.47, size * .10, size * .51);
    pose.updateMatrix();
    leaves.setMatrixAt(index, pose.matrix);
    leaves.setColorAt(index, leafTones[index % leafTones.length]);
  }
  petals.name = 'Blush flower petals';
  centres.name = 'Ochre flower centres';
  leaves.name = 'Bronze-green spring leaves';
  for (const detail of [petals, centres, leaves]) {
    detail.position.copy(base);
    detail.scale.copy(wood.scale);
    detail.receiveShadow = true;
    root.add(detail);
  }
}
