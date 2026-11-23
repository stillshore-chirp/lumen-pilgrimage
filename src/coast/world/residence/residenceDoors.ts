import { isResidenceDoorOpening, RESIDENCE_DOORWAYS, type ResidenceDoorway, type ResidenceOpening,
  type ResidenceWall } from './residencePlan';

const DOOR_REACH = 1.12;
const DOOR_SECONDS = .55;
const HINGE_INSET = .019;
const HINGE_OFFSET = .013;
const HINGED_HALF_DEPTH = .021;
const SLIDING_OVERLAP = .014;
const GALLERY_LEAF_OVERLAP = .026;
const GALLERY_TRACK_OFFSET = .023;
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
  poses: readonly LeafPose[];
};

function leafPoses({ wall, opening }: ResidenceDoorway, amount: number): readonly LeafPose[] {
  const alongEast = wall.axis === 'e';
  const alongAngle = alongEast ? 0 : Math.PI / 2;
  const span = opening.to - opening.from;
  const poseAt = (along: number, across: number, angle: number, width: number, halfDepth: number): LeafPose => ({
    east: alongEast ? along : across,
    north: alongEast ? across : along,
    angle, width, halfDepth,
  });
  if (opening.kind === 'gallery-slide') {
    const width = (span + 2 * SLIDING_OVERLAP + GALLERY_LEAF_OVERLAP) / 2;
    const retracted = opening.to + SLIDING_OVERLAP;
    const lead = opening.from - SLIDING_OVERLAP;
    const follower = lead + width - GALLERY_LEAF_OVERLAP;
    // The leading and following panels meet in the same pocket on parallel tracks.
    return [
      poseAt(lead + (retracted - lead) * amount, wall.fixed - GALLERY_TRACK_OFFSET, alongAngle, width, .017),
      poseAt(follower + (retracted - follower) * amount, wall.fixed + GALLERY_TRACK_OFFSET, alongAngle, width, .017),
    ];
  }
  if (opening.kind === 'fusuma') {
    const width = span + 2 * SLIDING_OVERLAP;
    const along = opening.from - SLIDING_OVERLAP - amount * width;
    // The hallway face has room for the track beside the tea-room alcove.
    return [poseAt(along, wall.fixed + wall.thickness / 2 + .025, alongAngle, width, .018)];
  }

  const { hinge, side } = opening.swing;
  const reverse = hinge === 'to';
  const along = reverse ? opening.to - HINGE_INSET : opening.from + HINGE_INSET;
  const across = wall.fixed + side * HINGE_OFFSET;
  const swingAngle = (alongEast ? side : -side) * (reverse ? -1 : 1) * Math.PI / 2;
  const angle = alongAngle + (reverse ? Math.PI : 0) + amount * swingAngle;
  return [poseAt(along, across, angle, span - .044, HINGED_HALF_DEPTH)];
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

function sweepBlocks(doorway: ResidenceDoorway, pose: LeafPose, next: LeafPose, { x, z }: Position): boolean {
  if (doorway.opening.kind !== 'door') {
    // The moving leaf covers one continuous span along its track.
    const first = next.east < pose.east || next.north < pose.north ? next : pose;
    const travel = Math.hypot(next.east - pose.east, next.north - pose.north);
    const width = exposedWidth(doorway, first, first.width + travel);
    return width > 0 && leafBlocks(first, x, -z, first.angle, width);
  }
  // Distance to the hinged leaf is smallest at the angle closest to the walker.
  const mid = (pose.angle + next.angle) / 2;
  const halfSwing = Math.abs(pose.angle - next.angle) / 2;
  const offset = Math.atan2(-z - pose.north, x - pose.east) - mid;
  const relative = Math.atan2(Math.sin(offset), Math.cos(offset));
  const closestAngle = mid + Math.max(-halfSwing, Math.min(halfSwing, relative));
  return leafBlocks(pose, x, -z, closestAngle);
}

function exposedWidth({ wall, opening }: ResidenceDoorway, pose: LeafPose, width = pose.width): number {
  if (opening.kind !== 'gallery-slide') return width;
  // The pocket itself already has a permanent wall collision.
  const start = wall.axis === 'e' ? pose.east : pose.north;
  return Math.min(width, opening.to - start);
}

function doorwayDistance({ wall, opening }: ResidenceDoorway, { x, z }: Position): number {
  const along = wall.axis === 'e' ? x : -z;
  const across = wall.axis === 'e' ? -z : x;
  return Math.hypot(across - wall.fixed, Math.max(opening.from - along, along - opening.to, 0));
}

export function createResidenceDoors(
  positionLeaf?: (doorway: ResidenceDoorway, pose: LeafPose, index: number) => void,
  balconyOpenness: () => number = () => 0,
) {
  const doors = new Map<string, DoorState>();
  for (const doorway of RESIDENCE_DOORWAYS) {
    const poses = leafPoses(doorway, 1);
    doors.set(doorway.id, { doorway, amount: 1, target: 1, poses });
    poses.forEach((pose, index) => positionLeaf?.(doorway, pose, index));
  }

  function openness(id: string): number {
    return doors.get(id)?.amount ?? 1;
  }

  return {
    openness,
    opennessFor(_wall: ResidenceWall, opening: ResidenceOpening): number {
      if (opening.kind === 'balcony-door') return balconyOpenness();
      return isResidenceDoorOpening(opening) ? openness(opening.id) : 1;
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
        const poses = leafPoses(door.doorway, amount);
        if (poses.some((pose, index) => sweepBlocks(door.doorway, door.poses[index], pose, position))) continue;
        door.amount = amount;
        door.poses = poses;
        poses.forEach((pose, index) => positionLeaf?.(door.doorway, pose, index));
        moved = true;
      }
      return moved;
    },
    blocksWalking(x: number, z: number): boolean {
      for (const { doorway, poses } of doors.values()) {
        if (poses.some(pose => {
          const width = exposedWidth(doorway, pose);
          return width > 0 && leafBlocks(pose, x, -z, pose.angle, width);
        })) return true;
      }
      return false;
    },
  };
}

export type ResidenceDoors = ReturnType<typeof createResidenceDoors>;
