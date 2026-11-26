import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createLakeFishMotion } from './lakeFishMotion';

type Point = [number, number, number];
type FishPigment = { belly: number; back: number; patch: number; fin: number; pattern: number };

const pigments: readonly FishPigment[] = [
  { belly: 0xe9c99c, back: 0xb46c32, patch: 0xeeb36b, fin: 0xb3713d, pattern: 0 },
  { belly: 0xcbd6ba, back: 0x758e83, patch: 0xb9c9b0, fin: 0x68867c, pattern: 1.6 },
  { belly: 0xefddb3, back: 0xd1c7a5, patch: 0xc47943, fin: 0xa9a384, pattern: 3.1 },
  { belly: 0xc4b88c, back: 0x6e7861, patch: 0xa49b68, fin: 0x6c775e, pattern: 4.5 },
];

const fishInPatch = [
  { size: 1.0, beatRate: 1.28, atNight: true, x: -.90, z: 1.12, depth: .33 },
  { size: .79, beatRate: 1.46, atNight: true, x: .76, z: .71, depth: .47 },
  { size: .91, beatRate: 1.32, atNight: false, x: .94, z: -.94, depth: .38 },
  { size: .72, beatRate: 1.51, atNight: false, x: -.87, z: -1.13, depth: .50 },
] as const;

const profile = new THREE.SplineCurve([
  [0, -.516], [.026, -.49], [.047, -.384], [.083, -.255],
  [.108, -.11], [.117, .045], [.094, .179], [.062, .275], [.040, .336], [0, .368],
].map(([radius, z]) => new THREE.Vector2(radius, z))).getPoints(30);

function paint(geometry: THREE.BufferGeometry, getColor: (x: number, y: number, z: number) => THREE.Color) {
  const points = geometry.getAttribute('position');
  const colors = new Float32Array(points.count * 3);
  for (let i = 0; i < points.count; i++) {
    getColor(points.getX(i), points.getY(i), points.getZ(i)).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.deleteAttribute('uv');
  return geometry;
}

function fin(fold: Point, outline: Point[], finColor: number) {
  const points = [fold, ...outline];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  const indices: number[] = [];
  for (let i = 0; i < outline.length; i++) indices.push(0, i + 1, (i + 1) % outline.length + 1);
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const color = new THREE.Color(finColor);
  return paint(geometry, (_x, _y, z) => color.clone().multiplyScalar(z < -.61 ? .69 : 1));
}

function bendFish(geometry: THREE.BufferGeometry): void {
  const points = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  geometry.morphTargetsRelative = true;
  const offsets = [
    (lag: number) => Math.cos(lag),
    (lag: number) => -Math.sin(lag),
    () => 1,
  ];
  geometry.morphAttributes.position = [];
  geometry.morphAttributes.normal = [];

  for (const offset of offsets) {
    const displacement = (z: number) => {
      const tailward = Math.max(0, (.21 - z) / .89);
      return .119 * tailward ** 2 * offset(tailward * 3.8);
    };
    const positionShift = new Float32Array(points.count * 3);
    const normalShift = new Float32Array(points.count * 3);
    for (let i = 0; i < points.count; i++) {
      const z = points.getZ(i);
      const slope = (displacement(z + .001) - displacement(z - .001)) / .002;
      positionShift[i * 3] = displacement(z);
      normalShift[i * 3 + 2] = -normals.getX(i) * slope;
    }
    // Two morphs make the tail beat; the third keeps a bend into a turn even while gliding.
    geometry.morphAttributes.position.push(new THREE.BufferAttribute(positionShift, 3));
    geometry.morphAttributes.normal.push(new THREE.BufferAttribute(normalShift, 3));
  }
}

function createFishGeometry({ belly, back, patch, fin: finColor, pattern }: FishPigment) {
  const bellyColor = new THREE.Color(belly);
  const backColor = new THREE.Color(back);
  const patchColor = new THREE.Color(patch);
  const body = paint(new THREE.LatheGeometry(profile, 20).rotateX(Math.PI / 2).scale(.92, 1, 1), (x, y, z) => {
    const { smoothstep } = THREE.MathUtils;
    const mottle = .64 * Math.sin(z * 13 + x * 15 + pattern) + .36 * Math.sin(z * 28 - y * 25 + pattern);
    return bellyColor.clone().lerp(backColor, smoothstep(y, -.068, .105))
      .lerp(patchColor, smoothstep(mottle, .20, .54) * smoothstep(y, -.056, .067));
  });
  const tail = fin([0, 0, -.524], [
    [0, .023, -.475], [.006, .077, -.529], [.013, .127, -.684], [.015, .060, -.652],
    [.016, .006, -.578], [.008, -.054, -.651], [.003, -.101, -.671], [0, -.045, -.544], [0, -.024, -.476],
  ], finColor);
  const dorsal = fin([0, .105, -.072], [
    [0, .105, .071], [.003, .150, .015], [.009, .150, -.071], [.012, .119, -.154], [0, .073, -.274],
  ], back);
  const sideDetails = [-1, 1].flatMap(side => {
    const pectoral = fin([side * .10, -.041, .081], [
      [side * .077, -.037, .149], [side * .134, -.055, .105], [side * .212, -.072, -.033],
      [side * .164, -.087, -.079], [side * .083, -.063, .002],
    ], finColor);
    const pupil = new THREE.Color(0x252923);
    const eye = paint(new THREE.SphereGeometry(.015, 8, 6).translate(side * .056, .024, .267), () => pupil);
    return [pectoral, eye];
  });
  const parts = [body, tail, dorsal, ...sideDetails];
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  bendFish(geometry);
  return geometry;
}

export function buildLakeFish(root: THREE.Group, seed = Math.floor(Math.random() * 0x1_0000_0000)) {
  const group = new THREE.Group();
  group.name = 'Lake fish';
  root.add(group);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .68, side: THREE.DoubleSide });
  const colors = pigments.map(createFishGeometry);
  const motion = createLakeFishMotion(fishInPatch, seed);
  const fish = ['west', 'east'].flatMap((side, patch) => fishInPatch.map((slot, i) => {
    const mesh = new THREE.Mesh(colors[(i + patch) % colors.length], material);
    mesh.name = 'lake-fish-' + side + '-' + (i + 1);
    mesh.scale.setScalar(slot.size);
    group.add(mesh);
    const { current, previous } = motion.fish[patch * fishInPatch.length + i];
    return { mesh, sway: mesh.morphTargetInfluences!, atNight: slot.atNight, current, previous };
  }));
  const { lerp } = THREE.MathUtils;

  return function swim(elapsed: number, night: boolean): void {
    const mix = motion.advance(elapsed);
    for (const { mesh, sway, atNight, current, previous } of fish) {
      mesh.visible = !night || atNight;
      if (!mesh.visible) continue;

      mesh.position.set(lerp(previous.x, current.x, mix), lerp(previous.y, current.y, mix),
        lerp(previous.z, current.z, mix));
      const beat = lerp(previous.beat, current.beat, mix);
      const effort = lerp(previous.effort, current.effort, mix);
      const turn = lerp(previous.turnRate, current.turnRate, mix);
      mesh.rotation.set(lerp(previous.pitch, current.pitch, mix),
        lerp(previous.yaw, current.yaw, mix) + .017 * Math.sin(beat) * effort, -.085 * turn, 'YXZ');
      sway[0] = Math.sin(beat) * effort;
      sway[1] = Math.cos(beat) * effort;
      sway[2] = .32 * turn;
    }
  };
}
