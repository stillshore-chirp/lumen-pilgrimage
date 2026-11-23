import * as THREE from 'three';
import { FurnitureModel } from './residenceFurnitureModel';
import type { ResidenceMaterials } from './residenceMaterials';
import { RESIDENCE_BALCONY_DOOR, RESIDENCE_ROOMS } from './residencePlan';

type Mount = readonly [east: number, north: number, heading: number];

interface Track {
  readonly mount: Mount;
  readonly length: number;
  readonly draw?: 'left' | 'right';
}

interface CurtainRoom {
  readonly id: string;
  readonly label?: string;
  readonly plate: Mount;
  readonly trackHeight: number;
  readonly tracks: readonly Track[];
}

function southTrack(from: number, to: number, north: number): Track {
  return { mount: [(from + to) / 2, north, 0], length: to - from };
}

function eastTrack(from: number, to: number, east: number, draw?: Track['draw']): Track {
  return { mount: [east, (from + to) / 2, -Math.PI / 2], length: to - from, draw };
}

const balcony = RESIDENCE_BALCONY_DOOR;
const rooms: readonly CurtainRoom[] = [
  {
    id: 'LD', label: 'リビング', plate: [17.93, .431, Math.PI], trackHeight: 2.988,
    tracks: [southTrack(11.44, 17.72, .454), southTrack(18.14, 22.40, .409), eastTrack(.48, 6.41, 22.48)],
  },
  {
    id: '01', label: '主寝室', plate: [20.16, 15.471, 0], trackHeight: 2.838,
    // Independent drapes on the fixed sidelights leave the sliding door and its approach clear.
    tracks: [
      eastTrack(12.01, balcony.nFrom - .028, 20.41, 'right'),
      eastTrack(balcony.nTo + .028, 15.23, 20.41, 'left'),
      eastTrack(10.09, 11.47, 22.48),
    ],
  },
  {
    id: '02', plate: [18.93, 9.879, 0], trackHeight: 2.838,
    tracks: [eastTrack(6.99, 9.66, 22.48)],
  },
  {
    id: '03', plate: [3.48, 4.929, 0], trackHeight: 2.838,
    tracks: [southTrack(.42, 3.11, .35)],
  },
  {
    id: '04', plate: [7.229, 4.54, -Math.PI / 2], trackHeight: 2.838,
    tracks: [southTrack(4.09, 6.87, .365)],
  },
  {
    id: '05', plate: [9.35, 4.929, 0], trackHeight: 2.838,
    tracks: [southTrack(7.74, 10.53, .35)],
  },
];

const SWITCH_REACH = .95;
const SEGMENTS_PER_FOLD = 16;
const ARC_SAMPLES = 48;
const ROWS = [0, .009, .03, .13, .29, .46, .64, .80, .93, .976, .992, 1] as const;
const RAIL_INSET = .029;
const MOTOR_RATE = 4.9;

const wave = Array.from({ length: ARC_SAMPLES + 1 }, (_, sample) => Math.sin(2 * Math.PI * sample / ARC_SAMPLES));

/** Convert a change in projected pitch into pleat depth while keeping the woven width fixed. */
function fitFold(pitch: number, materialWidth: number, distances: Float64Array, foldX: Float64Array,
  foldZ: Float64Array): void {
  const dx = pitch / ARC_SAMPLES;
  function arcLength(depth: number): number {
    let distance = 0;
    for (let i = 1; i <= ARC_SAMPLES; i++) {
      distance += Math.hypot(dx, (wave[i] - wave[i - 1]) * depth);
      distances[i] = distance;
    }
    return distance;
  }
  let low = 0;
  let high = materialWidth / 4;
  for (let i = 0; i < 8; i++) {
    const depth = (low + high) / 2;
    if (arcLength(depth) < materialWidth) low = depth;
    else high = depth;
  }
  const depth = (low + high) / 2;
  const arc = arcLength(depth);
  let right = 1;
  for (let i = 0; i < SEGMENTS_PER_FOLD; i++) {
    const target = arc * i / SEGMENTS_PER_FOLD;
    while (distances[right] < target) right++;
    const part = (target - distances[right - 1]) / (distances[right] - distances[right - 1]);
    foldX[i] = dx * (right - 1 + part);
    foldZ[i] = depth * THREE.MathUtils.lerp(wave[right - 1], wave[right], part);
  }
}

function makePanel(parent: THREE.Group, linen: THREE.Material, carrierGeometry: THREE.BufferGeometry,
  metal: THREE.Material, anchor: number, direction: -1 | 1, closedSpan: number, height: number, depthOffset: number) {
  const folds = Math.max(5, Math.round(closedSpan / .165));
  const carrier = new THREE.InstancedMesh(carrierGeometry, metal, folds + 1);
  carrier.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const columns = folds * SEGMENTS_PER_FOLD;
  const openSpan = closedSpan * .151;
  const width = closedSpan * 1.20;
  const top = height - .040;
  const length = top - .041;
  const geometry = new THREE.PlaneGeometry(1, 1, columns, ROWS.length - 1);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  position.setUsage(THREE.DynamicDrawUsage);
  (geometry.getAttribute('normal') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
  const uv = geometry.getAttribute('uv');
  const colors = new Float32Array(position.count * 3);
  const offsets = new Float32Array(position.count * 3);
  const seed = parent.position.x + parent.position.z + anchor;
  const distances = new Float64Array(ARC_SAMPLES + 1);
  const foldX = new Float64Array(SEGMENTS_PER_FOLD);
  const foldZ = new Float64Array(SEGMENTS_PER_FOLD);
  const transform = new THREE.Matrix4();

  for (const [row, v] of ROWS.entries()) {
    for (let column = 0; column <= columns; column++) {
      const index = row * (columns + 1) + column;
      const u = column / columns;
      const grain = .972 + .021 * Math.sin(u * 91 + seed) + .007 * Math.cos(u * 153 - seed);
      const seam = row >= ROWS.length - 2 || column === 0 || column === columns;
      const offset = index * 3;
      colors.fill(grain * (seam ? .835 : 1), offset, offset + 3);
      uv.setXY(index, u * width, (1 - v) * length);
      offsets[offset] = v * (.022 * Math.sin(u * 11 + v * 2.9 + seed)
        + .010 * Math.sin(u * 25 - v * 3.2 - seed));
      offsets[offset + 1] = v ** 7 * (.009 * Math.cos(u * folds * Math.PI * 2) + .011 * Math.sin(u * 23 + seed));
      offsets[offset + 2] = v * (.010 * Math.sin(u * 25 + v * 3.6 + seed) + .005 * Math.sin(u * 66 - v * 3));
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const halfWidth = closedSpan / 2 + .04;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(anchor + direction * closedSpan / 2, top / 2, 0),
    Math.hypot(halfWidth, top / 2, .13));
  carrier.boundingSphere = new THREE.Sphere(new THREE.Vector3(anchor + direction * closedSpan / 2, height, 0),
    Math.hypot(halfWidth, .10));
  const cloth = new THREE.Mesh(geometry, linen);
  cloth.name = 'Residence curtain panel';
  cloth.castShadow = true;
  cloth.receiveShadow = true;
  parent.add(cloth, carrier);

  function update(openness: number): void {
    const pitch = THREE.MathUtils.lerp(closedSpan, openSpan, openness) / folds;
    const sway = THREE.MathUtils.lerp(1, .33, openness) * Math.min(closedSpan, 1);
    fitFold(pitch, width / folds, distances, foldX, foldZ);
    for (let column = 0; column <= columns; column++) {
      const segment = column % SEGMENTS_PER_FOLD;
      const x = anchor + direction * (Math.floor(column / SEGMENTS_PER_FOLD) * pitch + foldX[segment]);
      const z = depthOffset + foldZ[segment];
      for (const [row, v] of ROWS.entries()) {
        const index = row * (columns + 1) + column;
        const offset = index * 3;
        position.setXYZ(index, x + sway * offsets[offset], top - v * length + offsets[offset + 1],
          z + offsets[offset + 2]);
      }
      if (segment === 0) {
        transform.makeTranslation(x, height - .024, depthOffset);
        carrier.setMatrixAt(column / SEGMENTS_PER_FOLD, transform);
      }
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    carrier.instanceMatrix.needsUpdate = true;
  }

  return { update, dispose() { geometry.dispose(); carrier.dispose(); } };
}

export function createResidenceCurtains(m: ResidenceMaterials) {
  const furniture = new FurnitureModel();
  furniture.group.name = 'Residence curtain rails and controls';
  const group = new THREE.Group();
  group.name = 'Residence curtains';
  group.add(furniture.group);

  const livingLinen = furniture.tone(m.linenShade, 0xd9ceba);
  const bedroomLinen = furniture.tone(m.linenShade, 0xbcb1a2);
  for (const material of [livingLinen, bedroomLinen]) material.vertexColors = true;
  const plateFinish = furniture.tone(m.ceiling, 0xe5dac7);
  const carrierGeometry = new THREE.BoxGeometry(.010, .035, .015);

  const controllers = rooms.map(({ id, label: displayLabel, plate, trackHeight, tracks }) => {
    const roomGroup = new THREE.Group();
    roomGroup.name = `Residence curtains ${id}`;
    group.add(roomGroup);
    furniture.room(`Curtain fittings ${id}`);
    const [east, north, heading] = plate;
    const control = furniture.at(...plate);
    const y = 1.245;
    control.box(plateFinish, 0, y, .006, .082, .123, .015, .005);
    control.box(m.metal, 0, y, .014, .059, .092, .009, .003);
    control.box(plateFinish, 0, y, .021, .052, .084, .009, .003);
    control.box(m.darkMetal, 0, y + .019, .026, .031, .002, .001);
    for (const x of [-.012, -.007, .007, .012]) {
      control.box(m.darkMetal, x, y + .006, .026, .0016, .022, .001);
    }
    control.box(m.darkMetal, 0, y - .019, .026, .008, .002, .001);

    const panels = tracks.flatMap(({ mount, length, draw }) => {
      const rail = furniture.at(...mount);
      rail.box(m.ceiling, 0, trackHeight, 0, length, .024, .086, .003);
      rail.box(m.darkMetal, 0, trackHeight - .013, 0, length - .04, .003, .057);
      for (const side of [-1, 1]) {
        rail.box(m.ceiling, side * (length / 2 - .012), trackHeight - .018, 0, .022, .021, .087, .002);
      }

      const frame = new THREE.Group();
      frame.position.set(mount[0], 0, -mount[1]);
      frame.rotation.y = mount[2];
      roomGroup.add(frame);
      const travel = length - 2 * RAIL_INSET;
      const spans = draw === 'left' ? [-1] as const : draw === 'right' ? [1] as const : [-1, 1] as const;
      return spans.map(side => {
        const closedSpan = draw ? travel : travel / 2 + .043;
        return makePanel(frame, id === 'LD' ? livingLinen : bedroomLinen, carrierGeometry, m.metal,
          side * travel / 2, side === -1 ? 1 : -1, closedSpan, trackHeight, draw ? 0 : side * .033);
      });
    });

    const { label, rectangles } = RESIDENCE_ROOMS.find(room => room.id === id)!;
    const inward = new THREE.Vector2(Math.sin(heading), Math.cos(heading));
    let target = 1;
    let openness = 1;
    let velocity = 0;
    for (const panel of panels) panel.update(openness);

    return {
      candidate(position: THREE.Vector3) {
        const dx = position.x - east;
        const dz = position.z + north;
        const distance = Math.hypot(dx, dz);
        if (distance > SWITCH_REACH || dx * inward.x + dz * inward.y <= 0) return null;
        const inside = rectangles.some(([w, s, e, n]) =>
          position.x >= w && position.x <= e && -position.z >= s && -position.z <= n);
        if (!inside) return null;
        return {
          distance,
          label: `${displayLabel ?? label}のカーテンを${target === 1 ? '閉める' : '開ける'}`,
          invoke() { target = 1 - target; },
        };
      },
      update(dt: number) {
        if (openness === target && velocity === 0) return false;
        // A critically damped motor carries its current speed smoothly through an early reversal.
        const error = openness - target;
        const response = velocity + MOTOR_RATE * error;
        const decay = Math.exp(-MOTOR_RATE * dt);
        openness = target + (error + response * dt) * decay;
        velocity = (velocity - MOTOR_RATE * response * dt) * decay;
        if (Math.abs(openness - target) < .002 && Math.abs(velocity) < .010) {
          openness = target;
          velocity = 0;
        }
        for (const panel of panels) panel.update(openness);
        return true;
      },
      dispose() { for (const panel of panels) panel.dispose(); },
    };
  });

  furniture.finish();
  return {
    group,
    nearby(position: THREE.Vector3) {
      for (const controller of controllers) {
        const candidate = controller.candidate(position);
        if (candidate) return candidate;
      }
      return null;
    },
    update(dt: number) {
      if (dt <= 0) return false;
      let moved = false;
      for (const controller of controllers) if (controller.update(dt)) moved = true;
      return moved;
    },
    dispose() {
      for (const controller of controllers) controller.dispose();
      carrierGeometry.dispose();
      furniture.dispose();
    },
  };
}
