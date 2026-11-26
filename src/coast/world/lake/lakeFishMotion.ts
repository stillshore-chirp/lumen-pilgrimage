import { MathUtils } from 'three';
import { coastRandom } from '../../terrain';
import { LAKE_HALL, LAKE_WATER_Y, LAKE_WINDOW_VIEW_X } from './lakeLayout';

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
  yawGoal: number;
  heightGoal: number;
  verticalSpeed: number;
  boutAge: number;
  boutLength: number;
  coastLength: number;
  thrust: number;
};

const { clamp, damp, lerp, smoothstep, euclideanModulo } = MathUtils;
const fullTurn = Math.PI * 2;
const step = 1 / 60;
const patchZ = LAKE_HALL.frontZ - 7.8;
// Centre limits include room for the full fish above the 0.84 m gravel bed.
const patchHalfWidth = 3.2;
const patchHalfLength = 2.8;
const top = LAKE_WATER_Y - .28;
const bottom = LAKE_WATER_Y - .56;
type FishStart = { x: number; z: number; depth: number; beatRate: number };

function headingDifference(goal: number, heading: number): number {
  return euclideanModulo(goal - heading + Math.PI, fullTurn) - Math.PI;
}

function createSwimmer(centerX: number, start: FishStart, slot: number, seed: number): Swimmer {
  const random = coastRandom(seed);
  const current: Pose = {
    x: centerX + start.x + (random() - .5) * .38,
    y: LAKE_WATER_Y - start.depth,
    z: patchZ + start.z + (random() - .5) * .32,
    yaw: (slot < 2 ? 1 : -1) * (1.14 + random() * .74) * Math.sign(centerX),
    turnRate: 0,
    pitch: 0,
    speed: .36 + random() * .17,
    beat: random() * fullTurn,
    effort: .12,
  };
  return {
    current, previous: { ...current }, random, beatRate: start.beatRate, pace: .86 + random() * .28,
    affinity: .6 + random() * .7, yawGoal: current.yaw, heightGoal: current.y,
    verticalSpeed: 0, boutAge: .48 + random() * .36, boutLength: .43,
    coastLength: .55 + random() * .77, thrust: 0,
  };
}

function beginBout(fish: Swimmer): void {
  const { random, current } = fish;
  fish.boutAge -= fish.boutLength + fish.coastLength;
  fish.boutLength = .36 + random() * .48;
  fish.coastLength = .66 + random() * 1.28;
  fish.thrust = .86 + random() * .68;
  const turn = random() * 2 - 1;
  // Small course corrections are common, but a few strokes send the fish off on a new heading.
  fish.yawGoal = current.yaw + turn * (random() < .29 ? 1.80 : .55);
  fish.heightGoal = lerp(bottom + .018, top - .018, random());
}

function stepSwimmer(fish: Swimmer, neighbors: readonly Swimmer[], centerX: number): void {
  const { current: pose, previous: before } = fish;
  fish.boutAge += step;
  if (fish.boutAge >= fish.boutLength + fish.coastLength) beginBout(fish);
  const beatProgress = fish.boutAge / fish.boutLength;
  const stroke = smoothstep(beatProgress, 0, .22) * (1 - smoothstep(beatProgress, .46, 1));

  const forwardX = Math.sin(before.yaw);
  const forwardZ = Math.cos(before.yaw);
  let socialTurn = 0;
  let evasiveTurn = 0;
  let braking = 0;
  let separationX = 0;
  let separationZ = 0;
  for (const neighbor of neighbors) {
    if (neighbor === fish) continue;
    const other = neighbor.previous;
    const dx = other.x - before.x;
    const dz = other.z - before.z;
    const distance = Math.max(1e-5, Math.hypot(dx, dz));
    if (distance > 3.4) continue;

    const side = forwardZ * dx - forwardX * dz;
    const ahead = forwardX * dx + forwardZ * dz;
    const interest = smoothstep(distance, 1.12, 1.8) * (1 - smoothstep(distance, 2.2, 3.4));
    if (ahead > -.4) {
      socialTurn += interest * (.32 * side / distance + .20 * Math.sin(other.yaw - before.yaw));
    }

    // Anticipate the closest point of an encounter before the noses reach it.
    const dvX = other.speed * Math.sin(other.yaw) - before.speed * forwardX;
    const dvZ = other.speed * Math.cos(other.yaw) - before.speed * forwardZ;
    const untilClosest = clamp(-(dx * dvX + dz * dvZ) / (dvX * dvX + dvZ * dvZ + 1e-5), 0, 1.3);
    const meetX = dx + untilClosest * dvX;
    const meetZ = dz + untilClosest * dvZ;
    const urgency = (1 - smoothstep(Math.hypot(meetX, meetZ), .89, 1.57))
      * (1 - smoothstep(distance, 1.55, 2.6));
    const meetingSide = forwardZ * meetX - forwardX * meetZ;
    // Give oncoming fish the same right-hand bias when there is no clear side to pass.
    const turnAway = 1 - 2 * smoothstep(meetingSide, .05, .29);
    evasiveTurn += turnAway * urgency * (1.95 * smoothstep(ahead, -.62, .05) + .18);
    braking = Math.max(braking, urgency * smoothstep(ahead, -.1, .29));
    // A brief lateral slip keeps body clearance if steering alone was too late.
    const slip = .52 * (1 - smoothstep(distance, .80, 1.23)) / distance;
    separationX -= dx * slip;
    separationZ -= dz * slip;
  }

  const lookAhead = .95 * before.speed;
  const wallX = inwardBias(before.x - centerX + forwardX * lookAhead, patchHalfWidth);
  const wallZ = inwardBias(before.z - patchZ + forwardZ * lookAhead, patchHalfLength);
  const wallWeight = Math.max(Math.abs(wallX), Math.abs(wallZ));
  const inwardTurn = 1.9 * headingDifference(Math.atan2(wallX, wallZ), before.yaw);
  const turn = 1.38 * headingDifference(fish.yawGoal, before.yaw) + fish.affinity * socialTurn + evasiveTurn;
  const turnGoal = lerp(clamp(turn, -1.95, 1.95), clamp(inwardTurn, -1.95, 1.95), wallWeight);
  pose.turnRate = damp(before.turnRate, turnGoal, 7.2, step);
  pose.yaw = before.yaw + pose.turnRate * step;

  const cruiseSpeed = .27 * fish.pace;
  const push = stroke * fish.thrust * fish.pace * (1 - .7 * braking);
  const drag = 1.32 * (before.speed - cruiseSpeed) + 3.2 * braking * (before.speed - .13);
  pose.speed = clamp(before.speed + (push - drag) * step, .13, .91);
  pose.x = clamp(before.x + (Math.sin(pose.yaw) * pose.speed + separationX) * step,
    centerX - patchHalfWidth, centerX + patchHalfWidth);
  pose.z = clamp(before.z + (Math.cos(pose.yaw) * pose.speed + separationZ) * step,
    patchZ - patchHalfLength, patchZ + patchHalfLength);

  const verticalGoal = clamp((fish.heightGoal - before.y) * .68, -.095, .095);
  fish.verticalSpeed = damp(fish.verticalSpeed, verticalGoal, 2.4, step);
  pose.y = clamp(before.y + fish.verticalSpeed * step, bottom, top);
  pose.pitch = -clamp(Math.atan2(fish.verticalSpeed, pose.speed), -.23, .23);
  pose.beat = before.beat + fullTurn * fish.beatRate * (.53 + .79 * stroke + .35 * pose.speed) * step;
  pose.effort = .09 + stroke * fish.thrust * .53 + .07 * Math.abs(pose.turnRate);
}

function inwardBias(offset: number, halfSize: number): number {
  return -Math.sign(offset) * smoothstep(Math.abs(offset), halfSize - 1.4, halfSize - .31);
}

export function createLakeFishMotion(starts: readonly FishStart[], seed: number) {
  const patches = [-LAKE_WINDOW_VIEW_X, LAKE_WINDOW_VIEW_X].map((centerX, side) => ({
    centerX,
    fish: starts.map((start, i) => createSwimmer(centerX, start, i, seed + 677 * i + 13517 * side)),
  }));
  const fish = patches.flatMap(patch => patch.fish);
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
        for (const { centerX, fish: neighbors } of patches) {
          for (const swimmer of neighbors) stepSwimmer(swimmer, neighbors, centerX);
        }
        remainder -= step;
      }
      return remainder / step;
    },
  };
}
