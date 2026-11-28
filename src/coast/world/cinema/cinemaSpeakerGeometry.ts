import { Matrix4, Quaternion, Vector3 } from 'three';
import { CINEMA_BOUNDS, CINEMA_ROOM_HEIGHT } from './cinemaLayout';
import { CINEMA_RENDER_SPEAKERS, type CinemaRenderSpeaker } from './cinemaSpeakers';

type Point = readonly [number, number, number];
type Part = 'cabinet' | 'grille' | 'mount' | 'support';

export interface CinemaEquipmentBox {
  readonly part: Part;
  readonly center: Vector3;
  readonly size: Vector3;
  readonly rotation: Quaternion;
  readonly matrix: Matrix4;
  readonly inverse: Matrix4;
}

interface SpeakerEquipment {
  readonly id: string;
  readonly acousticCenter: Point;
  readonly front: Vector3;
  readonly boxes: readonly CinemaEquipmentBox[];
}

function box(part: Part, center: Vector3, size: Point, rotation = new Quaternion()): CinemaEquipmentBox {
  const scale = new Vector3(...size);
  const matrix = new Matrix4().compose(center, rotation, scale);
  return { part, center, size: scale, rotation, matrix, inverse: matrix.clone().invert() };
}

function beam(from: Vector3, to: Vector3): CinemaEquipmentBox {
  const direction = to.clone().sub(from);
  const length = direction.length();
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  return box('support', from.clone().lerp(to, .5), [.035, length + .012, .035], rotation);
}

function equipment(speaker: CinemaRenderSpeaker): SpeakerEquipment {
  const top = speaker.kind === 'top';
  const side = speaker.kind === 'side';
  const size: Point = top ? [.61, .77, .43] : side ? [.61, .92, .75] : [.62, .91, .63];
  const [width, height, depth] = size;
  const front = new Vector3(...speaker.aim).normalize();
  // The top cabinet's width follows the room's width. Wall cabinets keep their
  // vertical edge upright while the complete cabinet follows the acoustic aim.
  const right = top
    ? new Vector3(1, 0, 0).addScaledVector(front, -front.x).normalize()
    : new Vector3(0, 1, 0).cross(front).normalize();
  const up = front.clone().cross(right).normalize();
  const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, front));
  const origin = new Vector3(...speaker.position);
  const local = (x: number, y: number, z: number) => new Vector3(x, y, z).applyQuaternion(rotation).add(origin);
  const boxes: CinemaEquipmentBox[] = [
    box('cabinet', local(0, 0, -.015 - depth / 2), size, rotation),
    box('grille', origin.clone(), [width - .08, height - .14, .038], rotation),
    box('mount', local(0, 0, -.025 - depth), [width * .76, height * .72, .03], rotation),
  ];

  for (const sign of [-1, 1]) {
    const from = top ? local(sign * width * .28, 0, -.025 - depth)
      : local(0, sign * height * .26, -.025 - depth);
    const to = from.clone();
    if (top) {
      // Keep both ceiling anchors inside the central bay. The adjacent coffer
      // starts at |x|=6.875 m; it is a lining, not the loudspeaker's support.
      to.x = Math.max(-6.75, Math.min(6.75, speaker.position[0] + sign * width * .28));
      to.y = CINEMA_ROOM_HEIGHT - .025;
      boxes.push(box('mount', new Vector3(to.x, CINEMA_ROOM_HEIGHT - .005, to.z), [.18, .06, .18]));
    } else if (side) {
      const wall = speaker.position[0] < 0 ? CINEMA_BOUNDS.minX : CINEMA_BOUNDS.maxX;
      to.x = wall;
      boxes.push(box('mount', new Vector3(wall, to.y, to.z), [.06, .18, .18]));
    } else {
      to.z = CINEMA_BOUNDS.maxZ;
      boxes.push(box('mount', new Vector3(to.x, to.y, to.z), [.18, .18, .06]));
    }
    boxes.push(beam(from, to));
  }
  return { id: speaker.id, acousticCenter: speaker.position, front, boxes };
}

/** The visible cabinets and their supports share the audio table's positions and aims. */
export const CINEMA_SPEAKER_EQUIPMENT: readonly SpeakerEquipment[] = CINEMA_RENDER_SPEAKERS
  .filter(({ kind }) => kind === 'side' || kind === 'rear' || kind === 'top')
  .map(equipment);

/** Point clearance for the camera/head, using the same oriented boxes as rendering. */
export function cinemaSpeakerEquipmentBlocked(x: number, y: number, z: number, clearance = 0): boolean {
  for (const equipment of CINEMA_SPEAKER_EQUIPMENT) {
    for (const box of equipment.boxes) {
      const e = box.inverse.elements;
      // These are affine transforms; scalar coordinates avoid per-flight-sample allocations.
      const localX = e[0] * x + e[4] * y + e[8] * z + e[12];
      const localY = e[1] * x + e[5] * y + e[9] * z + e[13];
      const localZ = e[2] * x + e[6] * y + e[10] * z + e[14];
      const dx = Math.max(0, (Math.abs(localX) - .5) * box.size.x);
      const dy = Math.max(0, (Math.abs(localY) - .5) * box.size.y);
      const dz = Math.max(0, (Math.abs(localZ) - .5) * box.size.z);
      if (dx * dx + dy * dy + dz * dz <= clearance * clearance) return true;
    }
  }
  return false;
}
