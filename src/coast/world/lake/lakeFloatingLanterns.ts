import {
  Box3, BoxGeometry, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Group,
  InstancedBufferAttribute, InstancedMesh, MeshLambertMaterial, Object3D, PlaneGeometry, Sphere, Vector3,
} from 'three';
import type { IUniform } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coastRandom } from '../../terrain';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { createFloatingLanternMaterials } from './lakeFloatingLanternMaterials';
import { LAKE_TERRAIN, LAKE_WATER_Y, LAKE_WINDOW_VIEW_X, LAKE_WINDOW_VIEW_Z } from './lakeLayout';

type Lantern = {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly phase: number;
  readonly width: number;
  readonly height: number;
};

type LanternCluster = readonly [x: number, z: number, spreadX: number, spreadZ: number, count: number];

// The sparse foreground opens up at both windows. Further out, staggered groups
// leave long uninterrupted passages of water between their overlapping edges.
const clusters: readonly LanternCluster[] = [
  [-LAKE_WINDOW_VIEW_X + 1.4, LAKE_WINDOW_VIEW_Z - 5.6, 4.5, 2.6, 6],
  [LAKE_WINDOW_VIEW_X - 1.5, LAKE_WINDOW_VIEW_Z - 6.3, 4.5, 3.4, 7],
  [-3.8, -16, 8.4, 5.2, 7],
  [9.6, -26, 10.4, 7.8, 10],
  [-12.7, -37, 10.3, 12.1, 12],
  [6, -55, 14.7, 18, 17],
  [-11.5, -78, 12.5, 19, 13],
  [20, -92, 16, 22, 20],
  [-15.5, -117, 20.5, 21, 17],
  [29, -142, 30, 32, 21],
  [-11, -169, 23, 32, 17],
  [57, -197, 43, 43, 19],
  [-4, -239, 31, 44, 18],
  [76, -278, 59, 58, 21],
  [26, LAKE_TERRAIN.shoreZ + 55, 45, 19, 14],
];

function sampleLanterns(): Lantern[] {
  const random = coastRandom(212678);
  const lanterns: Lantern[] = [];
  for (const [centerX, centerZ, radiusX, radiusZ, count] of clusters) {
    let placed = 0;
    for (let attempt = 0; placed < count && attempt < count * 32; attempt += 1) {
      const angle = 2 * Math.PI * random();
      const radius = Math.sqrt(random());
      const along = radius * Math.sin(angle) * radiusZ;
      const x = centerX + radius * Math.cos(angle) * radiusX + along * 0.25;
      const z = centerZ + along;
      const clearance = Math.min(4.1, 1.04 - z * 0.013);
      if (lanterns.some(other => Math.hypot(x - other.x, z - other.z) < clearance)) continue;
      const scale = 0.78 + random() * 0.43;
      lanterns.push({
        x, z,
        yaw: random() * 2 * Math.PI,
        phase: random() * 2 * Math.PI,
        width: scale * (0.91 + 0.18 * random()),
        height: scale * (0.89 + 0.23 * random()),
      });
      placed += 1;
    }
  }
  return lanterns;
}

function makeLanternFrame() {
  const pieces: (BoxGeometry | CylinderGeometry)[] = [];
  const color = new Color();
  const random = coastRandom(51631);

  function add(geometry: BoxGeometry | CylinderGeometry, x: number, y: number, z: number, tint: number) {
    geometry.translate(x, y, z);
    const position = geometry.getAttribute('position');
    const colors = [];
    for (let index = 0; index < position.count; index += 1) {
      color.setHex(tint).multiplyScalar(0.90 + 0.16 * random());
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    pieces.push(geometry);
  }

  const box = (width: number, height: number, depth: number) => new BoxGeometry(width, height, depth);
  for (const plank of [-1, 0, 1]) {
    add(box(0.172, 0.065, 0.53), plank * 0.176, 0.015, 0,
      plank === 0 ? 0x865435 : 0x765038);
  }
  for (const side of [-1, 1]) {
    add(box(0.51, 0.034, 0.063), 0, -0.024, side * 0.16, 0x67422c);
    for (const y of [0.067, 0.486]) {
      add(box(0.448, 0.025, 0.028), 0, y, side * 0.207, 0x5a3827);
      add(box(0.028, 0.025, 0.395), side * 0.207, y, 0, 0x5a3827);
    }
    for (const opposite of [-1, 1]) {
      add(box(0.028, 0.467, 0.028), side * 0.206, 0.268, opposite * 0.206, 0x71482c);
    }
  }
  add(new CylinderGeometry(0.044, 0.047, 0.017, 9), 0, 0.055, 0, 0x675140);
  add(new CylinderGeometry(0.026, 0.030, 0.055, 9), 0, 0.09, 0, 0xc69a68);

  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  return merged;
}

function makeLanternPaper() {
  const faces = Array.from({ length: 4 }, (_, index) => (
    new PlaneGeometry(0.400, 0.409)
      .translate(0, 0.277, 0.205)
      .rotateY(index * Math.PI / 2)
  ));
  for (const angle of [0, Math.PI / 2]) {
    const flame = new PlaneGeometry(0.055, 0.081).translate(0, 0.161, 0).rotateY(angle);
    const coordinates = flame.getAttribute('uv');
    // UVs above the paper domain mark the two crossed faces of the small flame.
    for (let index = 0; index < coordinates.count; index += 1) {
      coordinates.setY(index, coordinates.getY(index) + 2);
    }
    faces.push(flame);
  }
  const merged = mergeGeometries(faces);
  for (const face of faces) face.dispose();
  return merged;
}

export function buildLakeFloatingLanterns(parent: Group, lightDirection?: IUniform<Vector3>) {
  const lanterns = sampleLanterns();
  const variation = new Float32Array(lanterns.length * 3);
  const random = coastRandom(1842);
  for (let index = 0; index < lanterns.length; index += 1) {
    variation[3 * index] = random();
    variation[3 * index + 1] = 0.74 + 0.46 * random();
    variation[3 * index + 2] = random();
  }

  const { paper, reflection, time, night } = createFloatingLanternMaterials(lightDirection);
  const root = new Group();
  root.name = 'Floating lake lanterns';
  root.visible = false;
  parent.add(root);

  const frame = new InstancedMesh(makeLanternFrame(), new MeshLambertMaterial({ vertexColors: true }), lanterns.length);
  frame.name = 'Lantern cedar frames and floats';
  frame.instanceMatrix.setUsage(DynamicDrawUsage);

  const panels = new InstancedMesh(makeLanternPaper(), paper, lanterns.length);
  panels.name = 'Lantern paper';
  panels.material.side = DoubleSide;
  panels.geometry.setAttribute('lanternVariation', new InstancedBufferAttribute(variation, 3));

  const gleams = new InstancedMesh(new PlaneGeometry(2, 1), reflection, lanterns.length);
  gleams.name = 'Lantern reflections on ripples';
  gleams.geometry.setAttribute('lanternVariation', new InstancedBufferAttribute(variation, 3));
  gleams.renderOrder = 9;

  // Leave room for the full drift and tilt at the edges of the visible group.
  const bounds = new Box3();
  const anchor = new Vector3();
  for (const { x, z } of lanterns) bounds.expandByPoint(anchor.set(x, LAKE_WATER_Y, z));
  const field = bounds.expandByScalar(1.5).getBoundingSphere(new Sphere());
  frame.boundingSphere = field;
  panels.boundingSphere = field;
  // The reflected patches extend toward the camera, outside the mesh's static bounds.
  gleams.frustumCulled = false;

  for (const mesh of [frame, panels, gleams]) {
    // Keep one upload for all three passes, including each eye's water projection.
    mesh.instanceMatrix = frame.instanceMatrix;
    root.add(mesh);
  }

  const pose = new Object3D();
  let lastSeconds = 0;

  function moveLanterns(seconds: number) {
    const wind = seconds * 0.022;
    for (const [index, lantern] of lanterns.entries()) {
      const x = lantern.x + 0.63 * Math.sin(wind + lantern.z * 0.039)
        + 0.16 * Math.sin(seconds * 0.082 + lantern.phase);
      const z = lantern.z + 0.44 * Math.sin(wind * 0.81 + lantern.x * 0.055)
        + 0.13 * Math.sin(seconds * 0.074 + lantern.phase * 0.73);
      const wave = 0.62 * seconds + 0.69 * x + 0.49 * z;
      const cross = 0.91 * seconds + 0.37 * x - 0.81 * z;
      pose.position.set(x, LAKE_WATER_Y + 0.010 * Math.sin(wave) + 0.006 * Math.sin(cross), z);
      pose.rotation.set(
        0.019 * Math.cos(wave) + 0.009 * Math.sin(cross),
        lantern.yaw + 0.16 * Math.sin(wind * 2.3 + lantern.phase),
        0.016 * Math.cos(cross) + 0.009 * Math.sin(wave),
        'YXZ',
      );
      pose.scale.set(lantern.width, lantern.height, lantern.width);
      pose.updateMatrix();
      frame.setMatrixAt(index, pose.matrix);
    }
    frame.instanceMatrix.needsUpdate = true;
    time.value = seconds;
  }

  return {
    setVisible(value: boolean): void {
      if (root.visible === value) return;
      root.visible = value;
      if (value) moveLanterns(lastSeconds);
    },
    setTimeOfDay(timeOfDay: CoastTimeOfDay): void {
      night.value = Number(timeOfDay === 'night');
    },
    update(seconds: number): void {
      lastSeconds = seconds;
      if (root.visible) moveLanterns(seconds);
    },
  };
}
