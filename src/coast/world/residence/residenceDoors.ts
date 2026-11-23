import { RESIDENCE_DOORWAYS, type ResidenceDoorway, type ResidenceOpening, type ResidenceWall } from './residencePlan';

const DOOR_REACH = 1.12;
const DOOR_SECONDS = .55;
const HINGE_INSET = .019;
const HINGE_OFFSET = .013;
const HINGED_HALF_DEPTH = .021;
const FUSUMA_OVERLAP = .014;
export const RESIDENCE_WALKER_RADIUS = .24;

type Position = { readonly x: number; readonly z: number };

type LeafPose = {
  readonly east: number;
  readonly north: number;
  readonly angle: number;
  readonly width: number;
  readonly halfDepth: number;
};

type DoorState = {
  readonly doorway: ResidenceDoorway;
  amount: number;
  target: 0 | 1;
  pose: LeafPose;
};

function leafPose({ wall, opening }: ResidenceDoorway, amount: number): LeafPose {
  const alongEast = wall.axis === 'e';
  const alongAngle = alongEast ? 0 : Math.PI / 2;
  const span = opening.to - opening.from;
  if (opening.kind === 'fusuma') {
    const width = span + 2 * FUSUMA_OVERLAP;
    const along = opening.from - FUSUMA_OVERLAP - amount * width;
    // The hallway face has room for the track beside the tea-room alcove.
    const across = wall.fixed + wall.thickness / 2 + .025;
    return { east: alongEast ? along : across, north: alongEast ? across : along,
      angle: alongAngle, width, halfDepth: .018 };
  }

  const { hinge, side } = opening.swing;
  const reverse = hinge === 'to';
  const along = reverse ? opening.to - HINGE_INSET : opening.from + HINGE_INSET;
  const across = wall.fixed + side * HINGE_OFFSET;
  const swingAngle = (alongEast ? side : -side) * (reverse ? -1 : 1) * Math.PI / 2;
  return {
    east: alongEast ? along : across,
    north: alongEast ? across : along,
    angle: alongAngle + (reverse ? Math.PI : 0) + amount * swingAngle,
    width: span - .044, halfDepth: HINGED_HALF_DEPTH,
  };
}

function leafBlocks(pose: LeafPose, east: number, north: number, angle = pose.angle, width = pose.width): boolean {
  const dx = east - pose.east;
  const dn = north - pose.north;
  const reach = width + RESIDENCE_WALKER_RADIUS + pose.halfDepth;
  if (Math.abs(dx) >= reach || Math.abs(dn) >= reach) return false;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const along = dx * cos + dn * sin;
  const across = dn * cos - dx * sin;
  const endGap = Math.max(-along, along - width, 0);
  return endGap ** 2 + across ** 2 < (RESIDENCE_WALKER_RADIUS + pose.halfDepth) ** 2;
}

function sweepBlocks(door: DoorState, next: LeafPose, amount: number, { x, z }: Position): boolean {
  const { pose } = door;
  if (door.doorway.opening.kind === 'fusuma') {
    // The moving leaf covers one continuous span along its track.
    const first = amount > door.amount ? next : pose;
    const travel = pose.width * Math.abs(amount - door.amount);
    return leafBlocks(first, x, -z, first.angle, first.width + travel);
  }
  // Distance to the hinged leaf is smallest at the angle closest to the walker.
  const mid = (pose.angle + next.angle) / 2;
  const halfSwing = Math.abs(pose.angle - next.angle) / 2;
  const offset = Math.atan2(-z - pose.north, x - pose.east) - mid;
  const relative = Math.atan2(Math.sin(offset), Math.cos(offset));
  const closestAngle = mid + Math.max(-halfSwing, Math.min(halfSwing, relative));
  return leafBlocks(pose, x, -z, closestAngle);
}

function doorwayDistance({ wall, opening }: ResidenceDoorway, { x, z }: Position): number {
  const along = wall.axis === 'e' ? x : -z;
  const across = wall.axis === 'e' ? -z : x;
  return Math.hypot(across - wall.fixed, Math.max(opening.from - along, along - opening.to, 0));
}

export function createResidenceDoors(
  positionLeaf?: (doorway: ResidenceDoorway, pose: LeafPose) => void,
  balconyOpenness: () => number = () => 0,
) {
  const doors = new Map<string, DoorState>();
  for (const doorway of RESIDENCE_DOORWAYS) {
    const pose = leafPose(doorway, 1);
    doors.set(doorway.id, { doorway, amount: 1, target: 1, pose });
    positionLeaf?.(doorway, pose);
  }

  function openness(id: string): number {
    return doors.get(id)?.amount ?? 1;
  }

  return {
    openness,
    opennessFor(_wall: ResidenceWall, opening: ResidenceOpening): number {
      if (opening.kind === 'balcony-door') return balconyOpenness();
      return opening.kind === 'door' || opening.kind === 'fusuma' ? openness(opening.id) : 1;
    },
    nearby(position: Position) {
      let nearest: DoorState | undefined;
      let distance = Infinity;
      for (const door of doors.values()) {
        const candidate = doorwayDistance(door.doorway, position);
        if (candidate > DOOR_REACH || candidate >= distance) continue;
        nearest = door;
        distance = candidate;
      }
      if (!nearest) return null;
      const door = nearest;
      const action = door.target === 1 ? '閉める' : '開ける';
      return { distance, label: `${door.doorway.label}を${action}`, invoke() {
        door.target = door.target === 1 ? 0 : 1;
      } };
    },
    update(dt: number, position: Position): boolean {
      const step = Math.max(0, dt) / DOOR_SECONDS;
      let moved = false;
      for (const door of doors.values()) {
        const amount = door.target === 1 ? Math.min(1, door.amount + step) : Math.max(0, door.amount - step);
        if (door.amount === amount) continue;
        const pose = leafPose(door.doorway, amount);
        if (sweepBlocks(door, pose, amount, position)) continue;
        door.amount = amount;
        door.pose = pose;
        positionLeaf?.(door.doorway, pose);
        moved = true;
      }
      return moved;
    },
    blocksWalking(x: number, z: number): boolean {
      for (const { pose } of doors.values()) {
        if (leafBlocks(pose, x, -z)) return true;
      }
      return false;
    },
  };
}

export type ResidenceDoors = ReturnType<typeof createResidenceDoors>;
