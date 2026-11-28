import * as THREE from 'three';

export type HeightAt = (x: number, z: number) => number;
type Waypoint = [number, number];
type RoadEnd = 'start' | 'end';
export type RoadPlan = {
  halfWidth: number;
  speed: number;
  waypoints: Waypoint[];
  lanes?: 2;
  soundWeight?: number;
  extension?: { from: RoadEnd; waypoints: Waypoint[] };
};

const roadPlans: RoadPlan[] = [
  // Valley approach to the central business district.
  { halfWidth: 36, speed: 34, soundWeight: 1.2, waypoints: [
    [-110, -525], [-40, -755], [70, -1000], [215, -1320], [475, -1660], [710, -2000], [930, -2250], [1120, -2680],
    [1210, -3060], [1300, -3330], [1470, -3610], [1550, -3980], [1780, -4340], [2190, -4640],
    [2440, -5150], [2580, -5490], [2950, -5940], [3490, -6370], [3740, -7000], [3970, -7480],
    [4560, -8400], [5400, -8950],
  ] },
  // A long arterial leads through the eastern grid toward the far edge of the basin.
  { halfWidth: 23, speed: 30, soundWeight: 0.8, waypoints: [
    [455, -145], [505, -315], [664, -522], [930, -695], [1290, -900], [1680, -1140], [2340, -1620], [3190, -2210],
    [4290, -2980], [5460, -3810], [6550, -4570],
    [7770, -5410], [8860, -6190], [10070, -7010], [11220, -7810], [12380, -8620],
  ] },
  // Cross-town viaduct passes over the valley approach and continues behind the skyline.
  { halfWidth: 26, speed: 30, soundWeight: 1.05, waypoints: [
    [-2300, -1790], [-1480, -2080], [-840, -2200], [-160, -2370], [410, -2560], [680, -2750],
    [805, -3060], [890, -3340], [1020, -3760], [1240, -4060], [1580, -4380], [1780, -4590],
    [2080, -4770], [2500, -4850], [2930, -4930], [3530, -5160], [4200, -5560], [5120, -6090],
    [6060, -6430], [8130, -6550], [9300, -6870],
  ] },
  // Western valley road, running south from the lower foothills.
  { halfWidth: 18, speed: 23, lanes: 2, soundWeight: 0.85, waypoints: [
    [-721, -520], [-725, -750], [-680, -1210], [-610, -1640], [-655, -2260], [-700, -2850], [-850, -3350], [-1150, -4300],
    [-1450, -5120], [-1660, -6020], [-1720, -6880], [-1920, -7630], [-2190, -8380], [-2370, -9660],
  ], extension: { from: 'end', waypoints: [
    [-2520, -10500], [-2700, -11300], [-2940, -12200], [-3120, -13300], [-3360, -14450], [-3890, -15450],
    [-4610, -16350], [-5240, -17530], [-6040, -19010], [-6690, -20500], [-7030, -22400],
  ] } },
  // Inner western distributor follows the gentler ground between the valley roads.
  { halfWidth: 17, speed: 21, lanes: 2, soundWeight: 0.75, waypoints: [
    [-225, -510], [-205, -800], [-235, -1330], [-250, -1860], [-170, -2340], [70, -2790], [230, -3290], [410, -3760],
    [410, -4230], [620, -4850], [1010, -5600], [1440, -6190], [1580, -6800], [1510, -7620], [1830, -8860],
  ], extension: { from: 'end', waypoints: [
    [1990, -9560], [1840, -10500], [1480, -11300], [970, -12150], [790, -13330], [1010, -14500],
    [1460, -15600], [1620, -17100], [1430, -18600], [1260, -20300], [1260, -22200], [1700, -23900],
  ] } },
  // The inner eastern bypass skirts the central ridges in a series of long bends.
  { halfWidth: 22, speed: 26, soundWeight: 0.95, waypoints: [
    [235, -390], [302, -509], [520, -860], [710, -1130], [940, -1430], [1110, -1740], [1530, -2250], [1620, -2610],
    [1920, -3190], [2150, -3520],
    [2410, -3900], [2740, -4530], [2890, -4860], [3140, -5400], [3440, -5840], [3880, -6370],
    [4310, -7130], [4630, -7780], [5090, -8340], [5570, -8780], [6070, -9590],
  ], extension: { from: 'end', waypoints: [
    [6570, -10420], [6920, -11290], [7040, -12200], [6810, -13550], [6510, -14850], [6500, -16000],
    [7030, -17220], [8320, -18390], [9440, -19840], [10250, -21570], [11880, -23250],
  ] } },
  // Eastern distributor between the wide arterial and the inner bypass.
  { halfWidth: 19, speed: 25, lanes: 2, soundWeight: 0.8, waypoints: [
    [361, -145], [414, -304], [557, -543], [980, -850], [1300, -1150], [1660, -1490], [1890, -1880], [2080, -2300], [2250, -2710],
    [2400, -2900], [2770, -3280], [3210, -3450], [3680, -3500], [4070, -3620],
    [4290, -3820], [4540, -4190], [4950, -4690], [5690, -5180], [6350, -5640], [6800, -6100],
    [7260, -6620], [7950, -7170], [8270, -7650], [8940, -8080],
  ], extension: { from: 'end', waypoints: [
    [9810, -8640], [10380, -9420], [10760, -10600], [11370, -11750], [12070, -12850], [12200, -14100],
    [12490, -15250], [13260, -16470], [14700, -17510], [16910, -18810],
  ] } },
  // A cross-basin belt links the foothill roads before the principal skyline.
  { halfWidth: 23, speed: 28, soundWeight: 1.05, waypoints: [
    [-3340, -3610], [-2210, -3650], [-1350, -3500], [-570, -3460], [210, -3480], [810, -3510],
    [1540, -3590], [2190, -3890], [2920, -4140], [3450, -4290], [3980, -4310], [4650, -4350],
    [5250, -4530], [5750, -4740], [6040, -5090], [6510, -5190], [6830, -5190], [7030, -4990], [7140, -4720],
    [7460, -4570], [8340, -4800],
  ], extension: { from: 'start', waypoints: [
    [-3710, -3595], [-4140, -3850], [-4390, -4430], [-4440, -5250], [-4660, -6060], [-4880, -6810],
    [-5350, -7310], [-6140, -7715], [-7090, -8030], [-8360, -8510], [-9730, -8800], [-11390, -9080], [-13700, -9700],
  ] } },
  // A second transverse route emerges beyond the skyline between the far districts.
  { halfWidth: 20, speed: 26, lanes: 2, waypoints: [
    [-3700, -7570], [-2650, -7480], [-1590, -7520], [-570, -7470], [390, -7230], [1200, -7310],
    [1850, -7520], [2520, -7870], [3220, -8090], [3980, -8050], [4700, -7900], [5350, -7870],
    [6060, -8090], [6810, -8440], [7810, -8780], [8990, -9070], [10100, -9440],
  ], extension: { from: 'start', waypoints: [
    [-4450, -7635], [-5140, -7830], [-5820, -8390], [-6810, -9220], [-7910, -10150], [-8430, -11160],
    [-8930, -12360], [-9460, -13750], [-9600, -15050], [-9050, -16100], [-8510, -17180], [-8290, -18610],
    [-8500, -20150], [-9190, -21700], [-10450, -23300],
  ] } },
];

// The outer belt skirts the western ridge and crosses the lower plain in front of the outer centers.
const outerBelt: RoadPlan = { halfWidth: 22, speed: 26, lanes: 2, waypoints: [
  [-14100, -10900], [-12000, -10500], [-10180, -10440], [-8610, -10550], [-6950, -10520],
  [-5330, -10790], [-3740, -11000], [-2220, -11150], [-890, -11210], [690, -11550], [2580, -12060],
  [4530, -12410], [6410, -12710], [8410, -12880], [10170, -13010], [12120, -13250], [13920, -13590], [16190, -14230],
] };

function createCenterline(plan: RoadPlan) {
  const curve = new THREE.CatmullRomCurve3(plan.waypoints.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  curve.arcLengthDivisions = 80 * plan.waypoints.length;
  const length = curve.getLength();
  const count = Math.ceil(length / 18);
  const centers = curve.getSpacedPoints(count);
  const lastIndex = centers.length - 1;
  const frames = centers.map((center, i) => {
    const a = centers[Math.max(0, i - 1)], b = centers[Math.min(lastIndex, i + 1)];
    const tangent = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
    return { x: center.x, z: center.z, nx: -tangent.y, nz: tangent.x };
  });
  return { plan, frames, length, step: length / count };
}

type Centerline = ReturnType<typeof createCenterline>;
type RoadJoin = { road: Centerline; index: number };
export type OriginalRoad = Centerline & { heights: Float32Array };
type Segment = { road: Centerline; i: number };

const originalRoads = roadPlans.map(createCenterline);
const joins = new Map<Centerline, RoadJoin>();
const extensions = originalRoads.flatMap(road => {
  const { extension, halfWidth, speed, lanes } = road.plan;
  if (!extension) return [];
  const atStart = extension.from === 'start';
  const index = atStart ? 0 : road.frames.length - 1;
  const end = road.frames[index];
  const continuation = createCenterline({ halfWidth, speed, lanes, waypoints: [[end.x, end.z], ...extension.waypoints] });
  const direction = atStart ? -1 : 1;
  continuation.frames[0].nx = end.nx * direction;
  continuation.frames[0].nz = end.nz * direction;
  joins.set(continuation, { road, index });
  return [continuation];
});
const roads = originalRoads.concat(extensions, createCenterline(outerBelt));

const cellSize = 180;
const roadCells = new Map<string, Segment[]>();
for (const road of roads) {
  const width = road.plan.halfWidth + 2;
  for (let i = 0; i < road.frames.length - 1; i += 1) {
    const a = road.frames[i], b = road.frames[i + 1];
    const segment = { road, i };
    for (let x = Math.floor((Math.min(a.x, b.x) - width) / cellSize);
      x <= Math.floor((Math.max(a.x, b.x) + width) / cellSize); x += 1) {
      for (let z = Math.floor((Math.min(a.z, b.z) - width) / cellSize);
        z <= Math.floor((Math.max(a.z, b.z) + width) / cellSize); z += 1) {
        const key = `${x}:${z}`;
        let bucket = roadCells.get(key);
        if (!bucket) roadCells.set(key, bucket = []);
        bucket.push(segment);
      }
    }
  }
}

function intersectsRoad(x: number, z: number, padding: number, ignoredRoad?: Centerline): boolean {
  for (let column = Math.floor((x - padding) / cellSize); column <= Math.floor((x + padding) / cellSize); column += 1) {
    for (let row = Math.floor((z - padding) / cellSize); row <= Math.floor((z + padding) / cellSize); row += 1) {
      const bucket = roadCells.get(`${column}:${row}`);
      if (!bucket) continue;
      for (const { road, i } of bucket) {
        if (road === ignoredRoad) continue;
        const a = road.frames[i], b = road.frames[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const along = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
        const radius = road.plan.halfWidth + 2 + padding;
        if ((x - a.x - along * dx) ** 2 + (z - a.z - along * dz) ** 2 <= radius * radius) return true;
      }
    }
  }
  return false;
}

export function isOverlookOriginalRoadway(x: number, z: number, padding = 0, ignoredRoad?: number): boolean {
  return intersectsRoad(x, z, padding, ignoredRoad === undefined ? undefined : roads[ignoredRoad]);
}

function clearanceAt(x: number, z: number, halfWidth: number, earlierRoads: ReadonlyMap<Centerline, OriginalRoad>,
  joinedRoad?: Centerline): number {
  let height = -Infinity;
  for (let column = Math.floor((x - halfWidth) / cellSize); column <= Math.floor((x + halfWidth) / cellSize); column += 1) {
    for (let row = Math.floor((z - halfWidth) / cellSize); row <= Math.floor((z + halfWidth) / cellSize); row += 1) {
      const segments = roadCells.get(`${column}:${row}`);
      if (!segments) continue;
      for (const { road, i } of segments) {
        if (road === joinedRoad) continue;
        const lower = earlierRoads.get(road);
        if (!lower) continue;
        const a = road.frames[i], b = road.frames[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const along = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
        const width = road.plan.halfWidth + halfWidth;
        if ((x - a.x - along * dx) ** 2 + (z - a.z - along * dz) ** 2 <= width * width) {
          const deck = THREE.MathUtils.lerp(lower.heights[i], lower.heights[i + 1], along);
          height = Math.max(height, deck + 17);
        }
      }
    }
  }
  return height;
}

function gradeRoad(road: Centerline, heightAt: HeightAt, earlierRoads: ReadonlyMap<Centerline, OriginalRoad>): OriginalRoad {
  const { plan, frames, step } = road;
  const join = joins.get(road);
  const jointHeight = join && earlierRoads.get(join.road)?.heights[join.index];
  const distant = !originalRoads.includes(road);
  const heights = Float32Array.from(frames, ({ x, z, nx, nz }, i) => {
    const shoulder = plan.halfWidth * 0.54;
    const ground = Math.max(heightAt(x, z), heightAt(x + nx * shoulder, z + nz * shoulder),
      heightAt(x - nx * shoulder, z - nz * shoulder),
      heightAt(x + nx * plan.halfWidth, z + nz * plan.halfWidth), heightAt(x - nx * plan.halfWidth, z - nz * plan.halfWidth));
    // Allow for the difference between surveyed heights and the coarser distant terrain mesh.
    const margin = distant ? 4 * (join ? THREE.MathUtils.smoothstep(i * step, 0, 285) : 1) : 0;
    return Math.max(ground + 3.6 + margin, clearanceAt(x, z, plan.halfWidth, earlierRoads, join?.road));
  });
  // Match the end of the original deck without changing its grade or sound corridor.
  if (jointHeight !== undefined) heights[0] = jointHeight;
  // Lift the road out of hollows with a continuous grade between terrain sample peaks.
  const grade = 0.058 * step;
  for (let i = 1; i < heights.length; i += 1) heights[i] = Math.max(heights[i], heights[i - 1] - grade);
  for (let i = heights.length - 2; i >= 0; i -= 1) heights[i] = Math.max(heights[i], heights[i + 1] - grade);
  const softened = heights.map((y, i) => {
    const a = heights[Math.max(0, i - 2)], b = heights[Math.min(heights.length - 1, i + 2)];
    return Math.max(y, (2 * y + a + b) * 0.25);
  });
  if (jointHeight !== undefined) softened[0] = jointHeight;
  return { ...road, heights: softened };
}

function regularizeRoadProfiles(graded: OriginalRoad[]) {
  const before = graded.map(road => road.heights.slice());
  const links = [...joins].map(([extension, join]) => ({ a: roads.indexOf(extension), b: roads.indexOf(join.road), index: join.index }));
  let settled = false;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    let changed = false;
    const raise = (road: OriginalRoad, index: number, required: number) => {
      const value = Math.fround(Math.max(road.heights[index], required));
      if (value > road.heights[index]) { road.heights[index] = value; changed = true; }
    };
    for (const road of graded) {
      for (let i = 1; i < road.frames.length; i += 1) {
        const a = road.frames[i - 1], b = road.frames[i];
        raise(road, i, road.heights[i - 1] - 0.058 * Math.hypot(a.x - b.x, a.z - b.z));
      }
      for (let i = road.frames.length - 2; i >= 0; i -= 1) {
        const a = road.frames[i], b = road.frames[i + 1];
        raise(road, i, road.heights[i + 1] - 0.058 * Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    for (const link of links) {
      const value = Math.max(graded[link.a].heights[0], graded[link.b].heights[link.index]);
      raise(graded[link.a], 0, value); raise(graded[link.b], link.index, value);
    }
    if (!changed) { settled = true; break; }
  }
  if (!settled) throw new Error('Road grade and shared endpoint constraints did not settle.');
  return graded.map((road, id) => {
    let maximumLift = 0, previousMaximumGrade = 0, maximumGrade = 0;
    for (let i = 0; i < road.frames.length; i += 1) {
      maximumLift = Math.max(maximumLift, road.heights[i] - before[id][i]);
      if (i) {
        const a = road.frames[i - 1], b = road.frames[i], distance = Math.hypot(a.x - b.x, a.z - b.z);
        previousMaximumGrade = Math.max(previousMaximumGrade, Math.abs(before[id][i] - before[id][i - 1]) / distance);
        maximumGrade = Math.max(maximumGrade, Math.abs(road.heights[i] - road.heights[i - 1]) / distance);
      }
    }
    return { id, maximumLift, previousMaximumGrade, maximumGrade };
  });
}

export interface CorridorFrame {
  readonly x: number;
  /** Centre asphalt top in world metres; outside edges are 0.42 m lower. */
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
  readonly station: number;
}

export interface CorridorRoad {
  readonly id: number;
  readonly plan: RoadPlan;
  readonly frames: readonly CorridorFrame[];
  readonly length: number;
  /** Original road chainage begins here. Prefixes are genuinely connected paths. */
  readonly originalOffset: number;
  readonly originalLength: number;
}

export interface CorridorPortal {
  readonly roadId: number;
  readonly frame: CorridorFrame;
  readonly halfWidth: number;
  readonly medianHalfWidth: number;
  readonly roofAboveRoad: number;
  readonly liningThickness: number;
  readonly outerHalfWidth: number;
  readonly crest: readonly { readonly lateral: number; readonly height: number }[];
  readonly headwallDepth: number;
}

export interface CorridorApproach {
  readonly roadId: number;
  readonly frames: readonly CorridorFrame[];
  readonly halfWidth: number;
  /** Formation contacts the underside of the existing 3.1 m road fascia. */
  readonly formationDepth: number;
}

export interface OverlookCorridorPlan {
  readonly roads: readonly CorridorRoad[];
  readonly alignment: readonly { readonly id: number; readonly maximumLift: number; readonly previousMaximumGrade: number; readonly maximumGrade: number }[];
  readonly portals: readonly CorridorPortal[];
  readonly approaches: readonly CorridorApproach[];
  readonly fieldBounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  readonly isRoadway: (x: number, z: number, padding?: number, ignoredRoad?: number) => boolean;
}

/**
 * Preserve the established road vertical alignment. This is an intentional road
 * design datum, not a ground sampler or a proxy for rendered pier support.
 */
export function createOverlookRoadDatum(survey: HeightAt): HeightAt {
  return (x, z) => {
    const side = Math.max(Math.abs(x) - 35.45, 0), front = Math.max(-24.45 - z, 0), rear = Math.max(z - 30.9, 0);
    const apron = THREE.MathUtils.lerp(345.65, survey(x, z), THREE.MathUtils.smoothstep(Math.hypot(side, front, rear), 0, 20));
    const distance = Math.hypot(side, front);
    const run = THREE.MathUtils.lerp(Math.max(side, front), distance, THREE.MathUtils.smoothstep(distance, 6, 20));
    const cut = 345.65 - 12.5 * (1 - Math.exp(-run * 0.36)) - 23 * (1 - Math.exp(-run * 0.026)) - 0.30 * run;
    return THREE.MathUtils.lerp(apron, Math.min(apron, cut),
      (1 - THREE.MathUtils.smoothstep(z, -11, 6)) * (1 - THREE.MathUtils.smoothstep(run, 330, 780)));
  };
}

function frameAt(road: OriginalRoad, station: number): CorridorFrame {
  const index = THREE.MathUtils.clamp(station / road.step, 0, road.frames.length - 1);
  const i = Math.min(Math.floor(index), road.frames.length - 2), t = index - i;
  const a = road.frames[i], b = road.frames[i + 1], mix = THREE.MathUtils.lerp;
  const nx = mix(a.nx, b.nx, t), nz = mix(a.nz, b.nz, t), scale = Math.hypot(nx, nz);
  return { x: mix(a.x, b.x, t), z: mix(a.z, b.z, t), y: mix(road.heights[i], road.heights[i + 1], t) + 0.42,
    nx: nx / scale, nz: nz / scale, station };
}

export function sampleCorridorRoad(road: CorridorRoad, station: number): CorridorFrame & { readonly grade: number } {
  if (!Number.isFinite(station)) throw new Error('A finite road station is required.');
  const s = THREE.MathUtils.clamp(station, 0, road.length);
  let low = 0, high = road.frames.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (road.frames[middle].station <= s) low = middle;
    else high = middle;
  }
  const a = road.frames[low], b = road.frames[high], t = (s - a.station) / (b.station - a.station);
  const mix = THREE.MathUtils.lerp, nx = mix(a.nx, b.nx, t), nz = mix(a.nz, b.nz, t), norm = Math.hypot(nx, nz);
  return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t), nx: nx / norm, nz: nz / norm, station: s, grade: (b.y - a.y) / Math.hypot(b.x - a.x, b.z - a.z) };
}

export function corridorRole(plan: OverlookCorridorPlan, roadId: number, station: number): 'tunnel' | 'approach' | 'open' {
  const portal = plan.portals.find(p => p.roadId === roadId);
  if (!portal) return 'open';
  if (station <= portal.frame.station) return 'tunnel';
  const approach = plan.approaches.find(p => p.roadId === roadId);
  return approach && station <= approach.frames[approach.frames.length - 1].station ? 'approach' : 'open';
}

/** CPU-only deterministic plan. The function allocates no renderer, audio graph, texture, or geometry. */
export function createOverlookCorridorPlan(roadDatum: HeightAt, ground: HeightAt,
  fieldBounds: OverlookCorridorPlan['fieldBounds']): OverlookCorridorPlan {
  if (![fieldBounds.minX, fieldBounds.maxX, fieldBounds.minZ, fieldBounds.maxZ].every(Number.isFinite)
    || fieldBounds.minX >= fieldBounds.maxX || fieldBounds.minZ >= fieldBounds.maxZ) {
    throw new Error('A finite corridor field is required.');
  }
  const earlier = new Map<Centerline, OriginalRoad>();
  const graded = roads.map(road => {
    const result = gradeRoad(road, roadDatum, earlier);
    if (!result.heights.every(Number.isFinite)) throw new Error('A finite road design datum is required.');
    if (result.frames.some(p => p.x - result.plan.halfWidth < fieldBounds.minX || p.x + result.plan.halfWidth > fieldBounds.maxX
      || p.z - result.plan.halfWidth < fieldBounds.minZ || p.z + result.plan.halfWidth > fieldBounds.maxZ)) {
      throw new Error('The road design is outside the declared field.');
    }
    earlier.set(road, result);
    return result;
  });
  const alignment = regularizeRoadProfiles(graded);
  const resultRoads: CorridorRoad[] = [];
  const portals: CorridorPortal[] = [], approaches: CorridorApproach[] = [];
  for (const [id, original] of graded.entries()) {
    const base = original.frames.map((_, i) => frameAt(original, i * original.step));
    if (id >= 7) {
      resultRoads.push({ id, plan: original.plan, frames: base, length: original.length,
        originalOffset: 0, originalLength: original.length });
      continue;
    }
    const a = base[0], b = base[1], dx = a.x - b.x, dz = a.z - b.z, length = Math.hypot(dx, dz);
    const tx = dx / length, tz = dz / length, nx = -tz, nz = tx;
    const slope = -(b.y - a.y) / original.step;
    const continuationY = (d: number) => a.y + slope * (d <= 100 ? d - d * d / 200 : 50);
    const halfWidth = original.plan.halfWidth;
    const roof = 5 + THREE.MathUtils.clamp((halfWidth + 1 - halfWidth * 0.116) * 0.25, 4.8, 8.5) + 0.8;
    const outerHalfWidth = halfWidth + 1.8;
    const cover = (p: CorridorFrame) => {
      let minimum = Infinity;
      for (let j = 0; j <= 16; j += 1) {
        const across = outerHalfWidth * (j / 8 - 1), y = ground(p.x + p.nx * across, p.z + p.nz * across);
        if (!Number.isFinite(y)) throw new Error('The corridor is outside the finite ground field.');
        minimum = Math.min(minimum, y - p.y - roof);
      }
      return minimum;
    };
    let startExtension = 0, portalStation: number;
    if (cover(a) >= 2) {
      let index = 0;
      while (index + 1 < base.length && cover(base[index + 1]) >= 2) index += 1;
      portalStation = base[index].station;
    } else {
      let covered = false;
      for (let d = 0; d < 4000; d += 5) {
        const point = { x: a.x + tx * d, y: continuationY(d), z: a.z + tz * d, nx: -nx, nz: -nz, station: -d };
        if (cover(point) >= 2) { startExtension = d; covered = true; break; }
      }
      if (!covered) throw new Error('A covered road continuation could not be established.');
      portalStation = -startExtension;
    }
    const radius = id === 4 ? 220 : 360, curveLength = 350;
    const curveStart = startExtension + (id === 4 ? 0 : 60), prefixLength = curveStart + curveLength;
    const prefix: CorridorFrame[] = [];
    for (let d = prefixLength; d > 0; d -= 2.5) {
      const s = Math.max(0, d - curveStart), theta = s / radius;
      const x = a.x + tx * (Math.min(d, curveStart) + radius * Math.sin(theta)) + nx * radius * (1 - Math.cos(theta));
      const z = a.z + tz * (Math.min(d, curveStart) + radius * Math.sin(theta)) + nz * radius * (1 - Math.cos(theta));
      const backX = tx * Math.cos(theta) + nx * Math.sin(theta), backZ = tz * Math.cos(theta) + nz * Math.sin(theta);
      prefix.push({ x, z, y: continuationY(d), nx: backZ, nz: -backX, station: prefixLength - d });
    }
    const frames = prefix.concat(base.map(p => ({ ...p, station: p.station + prefixLength })));
    const road: CorridorRoad = { id, plan: original.plan, frames, length: original.length + prefixLength,
      originalOffset: prefixLength, originalLength: original.length };
    resultRoads.push(road);
    const portal = sampleCorridorRoad(road, prefixLength + portalStation);
    portals.push({ roadId: id, frame: portal, halfWidth, medianHalfWidth: halfWidth * 0.116,
      roofAboveRoad: roof, liningThickness: 0.8, outerHalfWidth, headwallDepth: 1.6,
      crest: Array.from({ length: 33 }, (_, i) => {
        const lateral = outerHalfWidth * (i / 16 - 1), x = portal.x + portal.nx * lateral, z = portal.z + portal.nz * lateral;
        return { lateral, height: Math.max(ground(x, z), ground(x + portal.nz * 1.6, z - portal.nx * 1.6)) - portal.y + 0.10 };
      }) });
    let approachEnd = prefixLength;
    if (portalStation >= 0) {
      let i = Math.round(portalStation / original.step);
      while (i + 1 < base.length) {
        i += 1;
        const p = base[i];
        const maximum = Math.max(...[-1, 0, 1].map(f => ground(p.x + p.nx * halfWidth * f, p.z + p.nz * halfWidth * f)));
        if (maximum <= p.y - 3.52) break;
      }
      approachEnd = prefixLength + base[i].station;
    }
    const approachFrames: CorridorFrame[] = [portal];
    for (let s = portal.station + 2.5; s < approachEnd; s += 2.5) approachFrames.push(sampleCorridorRoad(road, s));
    approachFrames.push(sampleCorridorRoad(road, approachEnd));
    approaches.push({ roadId: id, frames: approachFrames, halfWidth: outerHalfWidth, formationDepth: 3.52 });
  }
  const cell = 120, buckets = new Map<string, { a: CorridorFrame; b: CorridorFrame; width: number; roadId: number }[]>();
  for (const road of resultRoads) {
    const width = road.plan.halfWidth + 2;
    for (let i = 0; i + 1 < road.frames.length; i += 1) {
      const a = road.frames[i], b = road.frames[i + 1];
      for (let x = Math.floor((Math.min(a.x, b.x) - width) / cell); x <= Math.floor((Math.max(a.x, b.x) + width) / cell); x += 1) {
        for (let z = Math.floor((Math.min(a.z, b.z) - width) / cell); z <= Math.floor((Math.max(a.z, b.z) + width) / cell); z += 1) {
          const key = `${x}:${z}`, list = buckets.get(key) ?? [];
          list.push({ a, b, width, roadId: road.id }); buckets.set(key, list);
        }
      }
    }
  }
  const isRoadway = (x: number, z: number, padding = 0, ignoredRoad?: number): boolean => {
    if (![x, z, padding].every(Number.isFinite) || padding < 0) return false;
    for (let cx = Math.floor((x - padding) / cell); cx <= Math.floor((x + padding) / cell); cx += 1) {
      for (let cz = Math.floor((z - padding) / cell); cz <= Math.floor((z + padding) / cell); cz += 1) {
        for (const { a, b, width, roadId } of buckets.get(`${cx}:${cz}`) ?? []) {
          if (roadId === ignoredRoad) continue;
          const dx = b.x - a.x, dz = b.z - a.z;
          const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
          if ((x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2 <= (width + padding) ** 2) return true;
        }
      }
    }
    return false;
  };
  return { roads: resultRoads, alignment, portals, approaches,
    fieldBounds, isRoadway };
}

/** Existing two-argument-less traffic callers retain the original road layout. */
export function createOriginalRoadProfiles(heightAt: HeightAt): readonly CorridorRoad[] {
  const earlier = new Map<Centerline, OriginalRoad>();
  return roads.map((road, id) => {
    const graded = gradeRoad(road, heightAt, earlier); earlier.set(road, graded);
    return { id, plan: road.plan, frames: road.frames.map((_, i) => frameAt(graded, i * road.step)),
      length: road.length, originalOffset: 0, originalLength: road.length };
  });
}
