import { MathUtils } from 'three';
import { coastRandom } from '../../terrain';
import { LAKE_HALL, LAKE_WATER_Y, LAKE_WINDOW_VIEW_X } from './lakeLayout';
import { lakeDepthAt } from './lakeWater';

type Pose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  turnRate: number;
  pitch: number;
  speed: number;
  beat: number;
  effort: number;
};

type Swimmer = {
  current: Pose;
  previous: Pose;
  random: () => number;
  pace: number;
  beatRate: number;
  affinity: number;
  home: FishHabitat;
  roaming: number;
  destinationX: number;
  destinationZ: number;
  destinationTime: number;
  wanderingTurn: number;
  depthPreference: number;
  verticalSpeed: number;
  boutAge: number;
  boutLength: number;
  coastLength: number;
  thrust: number;
  passSide: -1 | 1;
  passTimer: number;
};

const { clamp, damp, lerp, smoothstep, euclideanModulo } = MathUtils;
const fullTurn = Math.PI * 2;
const step = 1 / 60;
const shallowDepth = lakeDepthAt(0);
// Leave clearance from the hall foundations and the west bank's first rocky projection.
const swimReach = { minX: -24, maxX: 24, nearZ: LAKE_HALL.frontZ - 3.6, farZ: -48 };
const habitats = {
  west: { x: -LAKE_WINDOW_VIEW_X + 1.5, z: -15.3, radiusX: 5.9, radiusZ: 4.1 },
  east: { x: LAKE_WINDOW_VIEW_X - 1.5, z: -15.3, radiusX: 5.9, radiusZ: 4.1 },
  front: { x: 0, z: -26.2, radiusX: 13.8, radiusZ: 6.8 },
  offshore: { x: 1.2, z: -39.8, radiusX: 17.8, radiusZ: 6.2 },
} as const;
const excursions = {
  west: ['front'],
  east: ['front'],
  front: ['west', 'east', 'offshore'],
  offshore: ['front'],
} as const;
type FishHabitat = keyof typeof habitats;
export type FishStart = {
  home: FishHabitat;
  x: number;
  z: number;
  depth: number;
  yaw: number;
  beatRate: number;
  roaming: number;
};

function maxDepth(z: number): number {
  // Rise well before crossing the lip of the gravel shelf, with clearance to pitch and roll.
  return .56 + clamp((lakeDepthAt(z + 2.2) - shallowDepth) * .54, 0, .76);
}

function headingDifference(goal: number, heading: number): number {
  return euclideanModulo(goal - heading + Math.PI, fullTurn) - Math.PI;
}

function chooseDestination(fish: Swimmer, from: Pose): void {
  const { random, home } = fish;
  const alternatives = excursions[home];
  const habitat = habitats[random() < fish.roaming ? alternatives[Math.floor(random() * alternatives.length)] : home];
  const angle = random() * fullTurn;
  const radius = Math.sqrt(random());
  fish.destinationX = habitat.x + Math.cos(angle) * radius * habitat.radiusX;
  fish.destinationZ = habitat.z + Math.sin(angle) * radius * habitat.radiusZ;
  const distance = Math.hypot(fish.destinationX - from.x, fish.destinationZ - from.z);
  fish.destinationTime = 8 + distance / .29 + random() * 8;
}

function createSwimmer(start: FishStart, seed: number): Swimmer {
  const random = coastRandom(seed);
  const current: Pose = {
    x: start.x + (random() - .5) * .76,
    y: LAKE_WATER_Y - start.depth,
    z: start.z + (random() - .5) * .64,
    yaw: start.yaw + (random() - .5) * .72,
    turnRate: 0,
    pitch: 0,
    speed: .38 + random() * .18,
    beat: random() * fullTurn,
    effort: .12,
  };
  return {
    current, previous: { ...current }, random, beatRate: start.beatRate, pace: .86 + random() * .32,
    affinity: .6 + random() * .7, home: start.home, roaming: start.roaming,
    // Follow the initial heading for a short glide before choosing the first destination.
    destinationX: current.x + Math.sin(current.yaw) * 6,
    destinationZ: current.z + Math.cos(current.yaw) * 6,
    destinationTime: 3 + random() * 5,
    wanderingTurn: 0, depthPreference: random(),
    verticalSpeed: 0, boutAge: .48 + random() * .36, boutLength: .43,
    coastLength: .55 + random() * .77, thrust: 0, passSide: 1, passTimer: 0,
  };
}

function beginBout(fish: Swimmer): void {
  const { random } = fish;
  fish.boutAge -= fish.boutLength + fish.coastLength;
  fish.boutLength = .36 + random() * .48;
  fish.coastLength = .66 + random() * 1.28;
  fish.thrust = .86 + random() * .68;
  // Most strokes correct the course a little, with occasional detours on the way to a destination.
  fish.wanderingTurn = (2 * random() - 1) * (random() < .2 ? 1.32 : .56);
  fish.depthPreference = lerp(fish.depthPreference, random(), .32);
}

function stepSwimmer(fish: Swimmer, neighbors: readonly Swimmer[]): void {
  const { current: pose, previous: before } = fish;
  fish.destinationTime -= step;
  if (fish.destinationTime <= 0 || Math.hypot(fish.destinationX - before.x, fish.destinationZ - before.z) < 1.5) {
    chooseDestination(fish, before);
  }
  fish.boutAge += step;
  if (fish.boutAge >= fish.boutLength + fish.coastLength) beginBout(fish);
  const beatProgress = fish.boutAge / fish.boutLength;
  const stroke = smoothstep(beatProgress, 0, .22) * (1 - smoothstep(beatProgress, .46, 1));

  const forwardX = Math.sin(before.yaw);
  const forwardZ = Math.cos(before.yaw);
  let socialTurn = 0;
  let evasiveTurn = 0;
  let braking = 0;
  fish.passTimer = Math.max(0, fish.passTimer - step);
  let separationX = 0;
  let separationZ = 0;
  for (const neighbor of neighbors) {
    if (neighbor === fish) continue;
    const other = neighbor.previous;
    const dx = other.x - before.x;
    const dz = other.z - before.z;
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared > 3.4 ** 2) continue;
    const distance = Math.max(1e-5, Math.sqrt(distanceSquared));

    const side = forwardZ * dx - forwardX * dz;
    const ahead = forwardX * dx + forwardZ * dz;
    const interest = smoothstep(distance, 1.12, 1.8) * (1 - smoothstep(distance, 2.2, 3.4));
    if (ahead > -.4) {
      socialTurn += interest * (.32 * side / distance + .20 * Math.sin(other.yaw - before.yaw));
    }

    // Anticipate the closest point of an encounter before the noses reach it.
    const dvX = other.speed * Math.sin(other.yaw) - before.speed * forwardX;
    const dvZ = other.speed * Math.cos(other.yaw) - before.speed * forwardZ;
    const untilClosest = clamp(-(dx * dvX + dz * dvZ) / (dvX * dvX + dvZ * dvZ + 1e-5), 0, 1.6);
    const meetX = dx + untilClosest * dvX;
    const meetZ = dz + untilClosest * dvZ;
    const urgency = (1 - smoothstep(Math.hypot(meetX, meetZ), .97, 1.70))
      * (1 - smoothstep(distance, 1.63, 2.78));
    const meetingSide = forwardZ * meetX - forwardX * meetZ;
    // Keep the first passing side during a turn so two approaching fish do not keep changing sides.
    if (fish.passTimer === 0 && urgency > .58 && ahead > .5) {
      fish.passSide = meetingSide < .18 ? 1 : -1;
      fish.passTimer = .94;
    }
    const turnAway = fish.passTimer > 0 ? fish.passSide : 1 - 2 * smoothstep(meetingSide, .05, .29);
    evasiveTurn += turnAway * urgency * (1.95 * smoothstep(ahead, -.62, .05) + .18);
    braking = Math.max(braking, urgency * smoothstep(ahead, -.1, .29));
    // A brief lateral slip keeps body clearance if steering alone was too late.
    const slip = .85 * (1 - smoothstep(distance, .93, 1.61)) / distance;
    const pass = .21 * urgency * smoothstep(ahead, .20, .63)
      * (1 - smoothstep(distance, 1.0, 1.42)) * turnAway;
    separationX += forwardZ * pass - dx * slip;
    separationZ -= forwardX * pass + dz * slip;
  }

  const lookAhead = 1.2 * before.speed;
  const wallX = inwardBias(before.x + forwardX * lookAhead, swimReach.minX, swimReach.maxX);
  const wallZ = inwardBias(before.z + forwardZ * lookAhead, swimReach.farZ, swimReach.nearZ);
  const wallWeight = Math.max(Math.abs(wallX), Math.abs(wallZ));
  const inwardTurn = 1.9 * headingDifference(Math.atan2(wallX, wallZ), before.yaw);
  const bearing = Math.atan2(fish.destinationX - before.x, fish.destinationZ - before.z);
  const turn = 1.11 * headingDifference(bearing + fish.wanderingTurn, before.yaw)
    + fish.affinity * socialTurn + evasiveTurn;
  const turnGoal = lerp(clamp(turn, -1.95, 1.95), clamp(inwardTurn, -1.95, 1.95), wallWeight);
  pose.turnRate = damp(before.turnRate, turnGoal, 7.2, step);
  pose.yaw = before.yaw + pose.turnRate * step;

  const cruiseSpeed = .36 * fish.pace;
  const push = stroke * fish.thrust * fish.pace * (1 - .7 * braking);
  const drag = 1.32 * (before.speed - cruiseSpeed) + 3.2 * braking * (before.speed - .13);
  pose.speed = clamp(before.speed + (push - drag) * step, .13, .97);
  const nextForwardX = Math.sin(pose.yaw);
  const nextForwardZ = Math.cos(pose.yaw);
  // A close neighbor can slow a fish to a crawl, while a lateral slip makes room to pass.
  const forwardSpeed = Math.max(.037, pose.speed + nextForwardX * separationX + nextForwardZ * separationZ);
  const lateralSlip = nextForwardZ * separationX - nextForwardX * separationZ;
  pose.x = clamp(before.x + (nextForwardX * forwardSpeed + nextForwardZ * lateralSlip) * step,
    swimReach.minX, swimReach.maxX);
  pose.z = clamp(before.z + (nextForwardZ * forwardSpeed - nextForwardX * lateralSlip) * step,
    swimReach.farZ, swimReach.nearZ);

  const minDepth = .28;
  const deepest = maxDepth(pose.z);
  const depthGoal = lerp(minDepth + .02, maxDepth(before.z + forwardZ * before.speed * 3.4) - .02,
    fish.depthPreference);
  const verticalGoal = clamp((LAKE_WATER_Y - depthGoal - before.y) * .68, -.11, .11);
  fish.verticalSpeed = damp(fish.verticalSpeed, verticalGoal, 2.4, step);
  pose.y = clamp(before.y + fish.verticalSpeed * step, LAKE_WATER_Y - deepest, LAKE_WATER_Y - minDepth);
  pose.pitch = -clamp(Math.atan2(fish.verticalSpeed, pose.speed), -.23, .23);
  pose.beat = before.beat + fullTurn * fish.beatRate * (.53 + .79 * stroke + .35 * pose.speed) * step;
  pose.effort = .09 + stroke * fish.thrust * .53 + .07 * Math.abs(pose.turnRate);
}

function inwardBias(position: number, lower: number, upper: number): number {
  return 1 - smoothstep(position, lower + .35, lower + 2)
    - smoothstep(position, upper - 2, upper - .35);
}

export function createLakeFishMotion(starts: readonly FishStart[], seed: number) {
  const fish = starts.map((start, i) => createSwimmer(start, seed + 677 * i));
  let lastElapsed: number | undefined;
  let remainder = 0;

  return {
    fish,
    advance(elapsed: number): number {
      // The scenery clock is capped by CoastApp. Bound gaps here too so a suspended view resumes smoothly.
      remainder += lastElapsed === undefined ? 0 : clamp(elapsed - lastElapsed, 0, .1);
      lastElapsed = elapsed;
      while (remainder >= step) {
        for (const swimmer of fish) Object.assign(swimmer.previous, swimmer.current);
        for (const swimmer of fish) stepSwimmer(swimmer, fish);
        remainder -= step;
      }
      return remainder / step;
    },
  };
}
