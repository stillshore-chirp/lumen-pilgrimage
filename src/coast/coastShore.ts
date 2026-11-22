import { airCutoff, soundReach, terrainOcclusion } from './coastAcoustics';
import { COAST_BOUNDS, SEA_LEVEL, groundHeight, smoothstep, type CoastPoint } from './terrain';
import { coastSwellPhase } from './world/coastSwell';

export type ShorePatch = { crest: CoastPoint; wash: CoastPoint; phaseOffset: number };

const CELL = 12;
const SHALLOW_LEVEL = SEA_LEVEL - 0.65;
export const SHORE_VOICE_COUNT = 7;
export const SHORE_RANGE = 395;
export const SHORE_REF_DISTANCE = 20;
export const SHORE_ROLLOFF = 0.4;

/** Sample the ocean-connected shallows around headlands, islands and the mainland. */
export function buildShorePatches(): ShorePatch[] {
  const { minX, maxX, minZ, maxZ } = COAST_BOUNDS;
  const columns = Math.ceil((maxX - minX) / CELL) + 3;
  const rows = Math.ceil((maxZ - minZ) / CELL) + 3;
  const xAt = (index: number) => minX - CELL + (index % columns) * CELL;
  const zAt = (index: number) => minZ - CELL + Math.floor(index / columns) * CELL;
  const heights = new Float32Array(columns * rows);
  const ocean = new Uint8Array(heights.length);
  const queue: number[] = [];
  for (let i = 0; i < heights.length; i += 1) heights[i] = groundHeight(xAt(i), zAt(i));
  const addWet = (index: number) => {
    if (ocean[index] || heights[index] >= SHALLOW_LEVEL) return;
    ocean[index] = 1;
    queue.push(index);
  };
  for (let col = 0; col < columns; col += 1) addWet(col);
  for (let index = 0; index < queue.length; index += 1) {
    const cell = queue[index];
    const col = cell % columns;
    if (col > 0) addWet(cell - 1);
    if (col < columns - 1) addWet(cell + 1);
    if (cell >= columns) addWet(cell - columns);
    if (cell < heights.length - columns) addWet(cell + columns);
  }

  const patches: ShorePatch[] = [];
  const addCrossing = (a: number, b: number) => {
    if (ocean[a] === ocean[b]) return;
    const wet = ocean[a] ? a : b;
    const dry = ocean[a] ? b : a;
    if (heights[dry] < SHALLOW_LEVEL) return;
    const dx = xAt(dry) - xAt(wet);
    const dz = zAt(dry) - zAt(wet);
    const x = xAt(wet);
    const z = zAt(wet);
    let below = 0;
    let above = 1;
    for (let pass = 0; pass < 5; pass += 1) {
      const t = (below + above) * 0.5;
      if (groundHeight(x + dx * t, z + dz * t) < SHALLOW_LEVEL) below = t;
      else above = t;
    }
    const wash = { x: x + dx * below, y: SEA_LEVEL + 0.44, z: z + dz * below };
    if (patches.some(patch => Math.hypot(patch.wash.x - wash.x, patch.wash.z - wash.z) < CELL * 0.91)) return;

    // Follow the local seabed normal when it gives the breaker open water to move through.
    const gradientX = groundHeight(wash.x + 1.8, wash.z) - groundHeight(wash.x - 1.8, wash.z);
    const gradientZ = groundHeight(wash.x, wash.z + 1.8) - groundHeight(wash.x, wash.z - 1.8);
    const slope = Math.hypot(gradientX, gradientZ);
    let offshoreX = slope > 0.08 ? -gradientX / slope : -dx / CELL;
    let offshoreZ = slope > 0.08 ? -gradientZ / slope : -dz / CELL;
    if (groundHeight(wash.x + offshoreX * 6, wash.z + offshoreZ * 6) > SHALLOW_LEVEL) {
      offshoreX = -dx / CELL;
      offshoreZ = -dz / CELL;
    }
    let spread = 0;
    for (let distance = 1; distance <= 7; distance += 1) {
      if (groundHeight(wash.x + offshoreX * distance, wash.z + offshoreZ * distance) > SHALLOW_LEVEL) break;
      spread = distance;
    }
    if (spread < 2) return;
    const crest = { ...wash, x: wash.x + offshoreX * spread, z: wash.z + offshoreZ * spread };
    const phaseOffset = 0.037 * Math.sin(wash.x * 0.29 + wash.z * 0.57);
    patches.push({ crest, wash, phaseOffset });
  };
  for (let i = 0; i < heights.length; i += 1) {
    if (i % columns < columns - 1) addCrossing(i, i + 1);
    if (i < heights.length - columns) addCrossing(i, i + columns);
  }
  return patches;
}

export function shorePhase(patch: ShorePatch, elapsed: number): number {
  return (coastSwellPhase(elapsed, patch.crest.x, patch.crest.z) + patch.phaseOffset + 1) % 1;
}

export function shoreWavePoint(patch: ShorePatch, phase: number): CoastPoint {
  const t = smoothstep(0.18, 0.54, phase) * (1 - smoothstep(0.65, 0.98, phase));
  return {
    x: patch.crest.x + (patch.wash.x - patch.crest.x) * t,
    y: patch.crest.y,
    z: patch.crest.z + (patch.wash.z - patch.crest.z) * t,
  };
}

export function shoreTransmission(distance: number, obstruction: number): { gain: number; cutoff: number } {
  return {
    gain: soundReach(distance, SHORE_RANGE) * 0.32 ** obstruction,
    cutoff: Math.max(330, airCutoff(distance) * 0.068 ** obstruction),
  };
}

/** Rank physically nearby patches, retaining a live patch through small score changes. */
export function selectShorePatches(
  patches: readonly ShorePatch[], listener: CoastPoint, active: ReadonlySet<ShorePatch>,
): ShorePatch[] {
  return patches.map(patch => ({ patch, distance: Math.hypot(
    patch.crest.x - listener.x, patch.crest.y - listener.y, patch.crest.z - listener.z,
  ) }))
    .filter(({ distance }) => distance < SHORE_RANGE)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, SHORE_VOICE_COUNT * 3)
    .map(({ patch, distance }) => {
      const obstruction = terrainOcclusion(listener, patch.crest);
      const spreading = SHORE_REF_DISTANCE / (SHORE_REF_DISTANCE + SHORE_ROLLOFF * Math.max(0, distance - SHORE_REF_DISTANCE));
      const score = spreading * shoreTransmission(distance, obstruction).gain * (active.has(patch) ? 1.16 : 1);
      return { patch, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORE_VOICE_COUNT)
    .map(({ patch }) => patch);
}
