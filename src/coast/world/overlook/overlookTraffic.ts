import * as THREE from 'three';
import type { CoastQuality } from '../../CoastWorld';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { seededDetail } from './overlookModel';

type HeightAt = (x: number, z: number) => number;
type Waypoint = [number, number];
type RoadEnd = 'start' | 'end';
type RoadPlan = {
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
type Road = Centerline & { heights: Float32Array };
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

export function isOverlookRoadway(x: number, z: number, padding = 0): boolean {
  return intersectsRoad(x, z, padding);
}

function clearanceAt(x: number, z: number, halfWidth: number, earlierRoads: ReadonlyMap<Centerline, Road>,
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

function gradeRoad(road: Centerline, heightAt: HeightAt, earlierRoads: ReadonlyMap<Centerline, Road>): Road {
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

type RoadPoint = { x: number; y: number; z: number; nx: number; nz: number };

function sampleRoad(road: Road, distance: number, point: RoadPoint): void {
  const index = distance / road.step;
  const i = Math.min(Math.floor(index), road.frames.length - 2);
  const t = index - i;
  const a = road.frames[i], b = road.frames[i + 1];
  const mix = THREE.MathUtils.lerp;
  point.x = mix(a.x, b.x, t);
  point.y = mix(road.heights[i], road.heights[i + 1], t);
  point.z = mix(a.z, b.z, t);
  point.nx = mix(a.nx, b.nx, t);
  point.nz = mix(a.nz, b.nz, t);
}

const lampSpacing = 78;

const roadLampTint = /* glsl */`
  vec3 roadLampTint(vec2 xz) {
    float district = sin(dot(xz, vec2(0.0016, 0.0007))) * cos(xz.y * 0.0019);
    float warmth = smoothstep(-0.65, 0.65, district);
    return mix(vec3(1.0, 0.84, 0.55), vec3(1.0, 0.57, 0.19), warmth);
  }
`;

function roadwaySurface(roads: Road[], night: THREE.IUniform<number>) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const laneStyles: number[] = [];
  const walls: number[] = [], wallIndices: number[] = [];
  const columns = [-1, 0, 1];
  for (const { plan, frames, heights, step } of roads) {
    const base = positions.length / 3;
    const wallBase = walls.length / 3;
    for (const [i, { x, z, nx, nz }] of frames.entries()) {
      for (const fraction of columns) {
        const offset = fraction * plan.halfWidth;
        positions.push(x + nx * offset, heights[i] + 0.42 * (1 - Math.abs(fraction)), z + nz * offset);
        uv.push(fraction, i * step);
        laneStyles.push(Number(plan.lanes === 2));
      }
      for (const side of [-1, 1]) {
        const offset = side * plan.halfWidth;
        walls.push(x + nx * offset, heights[i] + 0.7, z + nz * offset,
          x + nx * offset, heights[i] - 3.1, z + nz * offset);
      }
      if (i === 0) continue;
      const stride = columns.length;
      for (let c = 0; c < stride - 1; c += 1) {
        const a = base + (i - 1) * stride + c, b = a + stride;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const a = wallBase + (i - 1) * 4, b = a + 4;
      wallIndices.push(b, b + 1, a + 1, b, a + 1, a, a + 2, a + 3, b + 3, a + 2, b + 3, b + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('laneStyle', new THREE.Float32BufferAttribute(laneStyles, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({ roughness: 0.87 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uRoadNight = night;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float laneStyle;
      varying vec2 vTrafficUv;
      varying vec2 vRoadXZ;
      varying float vLaneStyle;
    `).replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrafficUv = uv;\nvRoadXZ = position.xz;\nvLaneStyle = laneStyle;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uRoadNight;
        varying vec2 vTrafficUv;
        varying vec2 vRoadXZ;
        varying float vLaneStyle;
        ${roadLampTint}
        float paintLine(float center, float width, float feather) {
          float lateral = abs(vTrafficUv.x) - center;
          return smoothstep(-width - feather, -width + feather, lateral)
            - smoothstep(width - feather, width + feather, lateral);
        }
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float lateral = abs(vTrafficUv.x);
        float chainage = vTrafficUv.y;
        float feather = max(0.008, fwidth(vTrafficUv.x) * 0.45);
        vec3 asphalt = vec3(0.062, 0.069, 0.075) * (0.95 + 0.05 * sin(chainage * 0.17));
        vec3 shoulder = vec3(0.18, 0.16, 0.126);
        diffuseColor.rgb = mix(asphalt, shoulder, smoothstep(0.83, 0.97, lateral));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.115, 0.113, 0.08), 1.0 - smoothstep(0.06, 0.102, lateral));
        float dash = 1.0 - smoothstep(0.15, 0.20, abs(fract(chainage / 30.0) - 0.5));
        float fadeDashes = 1.0 - smoothstep(7.0, 20.0, fwidth(chainage));
        float edge = paintLine(0.79, 0.011, feather) * 0.67;
        float median = paintLine(0.116, 0.011, feather) * 0.61;
        float lanes = max(paintLine(0.33, 0.014, feather), paintLine(0.55, 0.014, feather));
        lanes = mix(lanes, paintLine(0.44, 0.014, feather), vLaneStyle);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.47, 0.49, 0.49), max(edge, lanes * dash * fadeDashes));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.51, 0.36, 0.14), median);
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uRoadNight > 0.0) {
          float station = chainage / ${lampSpacing.toFixed(1)};
          float fromLamp = abs(fract(station - step(0.0, vTrafficUv.x) * 0.5) - 0.5);
          float lightAcross = (lateral - 0.68) / 0.36;
          // Average neighboring pools when a projected pixel spans an entire lamp interval.
          float along = mix(exp(-fromLamp * fromLamp * 12.0), 0.51, smoothstep(0.35, 1.2, fwidth(station)));
          float roadPool = exp(-lightAcross * lightAcross * 1.45) * along;
          float edgeReflection = (lateral - 0.84) * 7.0;
          float distanceLift = smoothstep(3800.0, 13800.0, length(vViewPosition));
          float reflection = roadPool * mix(0.27, 0.40, distanceLift) + exp(-edgeReflection * edgeReflection) * 0.054;
          totalEmissiveRadiance += uRoadNight * reflection * roadLampTint(vRoadXZ);
        }
      `);
  };
  const surface = new THREE.Mesh(geometry, material);
  surface.name = 'Asphalt, lane markings, and streetlight reflections';
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(walls, 3));
  wallGeometry.setIndex(wallIndices);
  wallGeometry.computeVertexNormals();
  const fascias = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0x918979, roughness: 0.92 }));
  fascias.name = 'Concrete viaduct fascias';
  return { surface, fascias };
}

const lightsVertex = /* glsl */`
  attribute vec2 heading;
  attribute vec2 lamp;
  uniform float uPixelFactor;
  varying vec3 vColor;
  varying vec2 vAxis;
  varying float vOpacity;
  varying float vTraffic;
  ${roadLampTint}

  void main() {
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    vec4 view = viewMatrix * vec4(world, 1.0);
    vec4 clip = projectionMatrix * view;
    float eyeDistance = length(view.xyz);
    float axle = lamp.x;
    float power = lamp.y;
    vTraffic = step(0.5, axle);
    vAxis = vec2(1.0, 0.0);
    float size;
    if (vTraffic > 0.5) {
      vec2 facing = (cameraPosition.xz - world.xz) / max(1.0, length(cameraPosition.xz - world.xz));
      vec3 direction = vec3(heading.x, 0.0, heading.y);
      float visibility = smoothstep(-0.51, 0.37, dot(heading, facing) * (axle < 1.5 ? 1.0 : -1.0));
      vec4 ahead = projectionMatrix * viewMatrix * vec4(world + 45.0 * direction, 1.0);
      vec2 motion = ahead.xy / ahead.w - clip.xy / clip.w;
      motion *= vec2(projectionMatrix[1][1] / projectionMatrix[0][0], -1.0);
      vAxis = motion / max(length(motion), 0.00001);
      vColor = axle < 1.5 ? vec3(0.96, 0.98, 1.0) : vec3(1.0, 0.049, 0.024);
      vOpacity = exp(-eyeDistance * 0.000066) * power * 1.38 * visibility;
      size = clamp(5.4 + 10700.0 / max(820.0, eyeDistance), 6.1, 13.2);
    } else {
      vOpacity = min(0.94, exp(-eyeDistance * 0.000043) * power);
      vColor = roadLampTint(world.xz);
      size = clamp(5.05 + 4000.0 / max(700.0, eyeDistance), 5.4, 8.5);
    }
    gl_PointSize = size * uPixelFactor;
    gl_Position = clip;
  }
`;

const lightsFragment = /* glsl */`
  varying vec3 vColor;
  varying vec2 vAxis;
  varying float vOpacity;
  varying float vTraffic;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float rad2 = dot(p, p);
    if (rad2 > 0.25 || vOpacity < 0.005) discard;
    vec2 tangentSpace = vec2(dot(p, vAxis), dot(p, vec2(-vAxis.y, vAxis.x)));
    float head = exp(-mix(100.0, 74.0, vTraffic) * rad2);
    float halo = exp(-mix(16.0, 22.0, vTraffic) * rad2);
    float tail = exp(-202.0 * tangentSpace.y * tangentSpace.y)
      * smoothstep(-0.47, -0.065, tangentSpace.x) * (1.0 - smoothstep(-0.08, 0.13, tangentSpace.x));
    float alpha = head * 0.91 + halo * mix(0.20, 0.15, vTraffic) + tail * 0.33 * vTraffic;
    gl_FragColor = vec4(vColor, vOpacity * alpha);
    #include <colorspace_fragment>
  }
`;

function points(positions: THREE.BufferAttribute, heading: THREE.BufferAttribute, lamps: THREE.BufferAttribute,
  material: THREE.ShaderMaterial): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positions);
  geometry.setAttribute('heading', heading);
  geometry.setAttribute('lamp', lamps);
  const mesh = new THREE.Points(geometry, material);
  const bufferSize = new THREE.Vector2();
  mesh.onBeforeRender = renderer => {
    renderer.getDrawingBufferSize(bufferSize);
    material.uniforms.uPixelFactor.value = THREE.MathUtils.clamp(bufferSize.y / 860, 0.72, 2.5);
  };
  return mesh;
}

function roadFurniture(graded: Road[], heightAt: HeightAt, box: THREE.BoxGeometry, lightMaterial: THREE.ShaderMaterial) {
  const props: Array<{ x: number; y: number; z: number; w: number; h: number; d: number; color: number }> = [];
  const fixtures: number[] = [], power: number[] = [];
  const point: RoadPoint = { x: 0, y: 0, z: 0, nx: 0, nz: 0 };
  const random = seededDetail(642901);

  for (const [i, road] of graded.entries()) {
    for (const side of [-1, 1]) {
      const startingDistance = side === 1 ? lampSpacing : lampSpacing * 0.5;
      for (let distance = startingDistance; distance < road.length; distance += lampSpacing) {
        sampleRoad(road, distance, point);
        const offset = side * (road.plan.halfWidth - 2.5);
        const x = point.x + point.nx * offset, z = point.z + point.nz * offset;
        const h = 8.2 + random() * 2.7;
        props.push({ x, z, y: point.y + h / 2, w: 0.77, h, d: 0.77, color: 0x686d68 });
        fixtures.push(x, point.y + h, z);
        power.push(0, 0.64 + random() * 0.48);
      }
    }
    for (let distance = 43; distance < road.length - 30; distance += 66) {
      sampleRoad(road, distance, point);
      const ground = heightAt(point.x, point.z);
      if (point.y - ground < 7.6 || intersectsRoad(point.x, point.z, 6, roads[i])) continue;
      const h = point.y - ground - 1.1;
      props.push({ x: point.x, y: ground + h / 2 - 0.5, z: point.z,
        w: 5.8, h: h + 1.0, d: 8.4, color: 0x9b8e7d });
    }
  }

  const material = new THREE.MeshStandardMaterial({ roughness: 0.86 });
  const poles = new THREE.InstancedMesh(box, material, props.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (const [i, prop] of props.entries()) {
    dummy.position.set(prop.x, prop.y, prop.z);
    dummy.scale.set(prop.w, prop.h, prop.d);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    poles.setColorAt(i, color.set(prop.color));
  }
  poles.name = 'Lamp standards and viaduct piers';

  const lamps = points(new THREE.Float32BufferAttribute(fixtures, 3),
    new THREE.BufferAttribute(new Float32Array(power.length), 2), new THREE.Float32BufferAttribute(power, 2), lightMaterial);
  lamps.name = 'Warm roadside lamps';
  return { poles, lamps };
}

type Vehicle = {
  road: Road; speed: number; lane: number; phase: number; w: number; h: number; length: number; power: number;
};

function createVehicles(roads: Road[], random: () => number) {
  const vehicles: Vehicle[] = [], extra: Vehicle[] = [];
  for (const road of roads) {
    const lanes = road.plan.lanes === 2 ? [0.28, 0.62] : [0.24, 0.43, 0.64];
    const spacingByLane = road.plan.lanes === 2 ? [134, 157] : [146, 122, 171];
    for (const direction of [-1, 1]) {
      for (const [lane, fraction] of lanes.entries()) {
        const count = Math.floor(road.length / spacingByLane[lane]);
        const spacing = road.length / count;
        const speed = road.plan.speed * direction * (0.85 + 0.26 * random() + (0.61 - fraction) * 0.23);
        const phase = random() * spacing;
        for (let i = 0; i < count; i += 1) {
          const truck = random() < 0.12;
          const h = truck ? 3.7 : 1.9 + random() * 0.65;
          const list = lane === 1 && i % 2 === 0 ? extra : vehicles;
          list.push({ road, speed, lane: road.plan.halfWidth * fraction * direction, h,
            phase: i * spacing + phase - random() * spacing * 0.74,
            w: truck ? 3.2 : 2.5, length: truck ? 15 + random() * 4 : 5.8 + random() * 2.6,
            power: 0.68 + random() * 0.38 });
        }
      }
    }
  }
  return { vehicles: vehicles.concat(extra), lightCount: vehicles.length };
}

type SoundCorridor = {
  readonly points: readonly { x: number; y: number; z: number }[];
  readonly weight: number;
};

export function createOverlookTraffic(heightAt: HeightAt) {
  const group = new THREE.Group();
  group.name = 'Basin expressways and traffic';
  // Approaches are graded first. A later road crosses above any earlier deck in its path.
  const earlierRoads = new Map<Centerline, Road>();
  const graded = roads.map(road => {
    const finished = gradeRoad(road, heightAt, earlierRoads);
    earlierRoads.set(road, finished);
    return finished;
  });
  const soundCorridors: readonly SoundCorridor[] = graded.flatMap(road => {
    const weight = road.plan.soundWeight;
    if (weight === undefined) return [];
    const segments = Math.round(road.length / 285);
    const sample: RoadPoint = { x: 0, y: 0, z: 0, nx: 0, nz: 0 };
    const points = Array.from({ length: segments + 1 }, (_, i) => {
      sampleRoad(road, road.length * (i / segments), sample);
      return { x: sample.x, y: sample.y + 0.42, z: sample.z };
    });
    return [{ points, weight }];
  });
  const night = { value: 0 };
  const { surface, fascias } = roadwaySurface(graded, night);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const lightsMaterial = new THREE.ShaderMaterial({
    uniforms: { uPixelFactor: { value: 1 } }, vertexShader: lightsVertex, fragmentShader: lightsFragment,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const { poles, lamps } = roadFurniture(graded, heightAt, box, lightsMaterial);
  const random = seededDetail(304402);
  const { vehicles, lightCount } = createVehicles(graded, random);
  const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.14 });
  const bodies = new THREE.InstancedMesh(box, bodyMaterial, vehicles.length);
  bodies.name = 'Moving cars and freight vehicles';
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bodies.boundingSphere = surface.geometry.boundingSphere;

  const positions = new THREE.BufferAttribute(new Float32Array(vehicles.length * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const headings = new THREE.BufferAttribute(new Float32Array(vehicles.length * 4), 2).setUsage(THREE.DynamicDrawUsage);
  const lampData = new THREE.BufferAttribute(new Float32Array(vehicles.length * 4), 2).setUsage(THREE.DynamicDrawUsage);
  const movingLights = points(positions, headings, lampData, lightsMaterial);
  movingLights.name = 'Moving headlights and tail lamps';
  movingLights.geometry.boundingSphere = surface.geometry.boundingSphere;
  const colors = [0xccc6b7, 0x494f55, 0x808b9b, 0x793c36, 0x2a3e47, 0xbcae91, 0x777c80, 0x38454e];
  const color = new THREE.Color();
  for (let i = 0; i < vehicles.length; i += 1) {
    bodies.setColorAt(i, color.set(colors[Math.floor(random() * colors.length)]));
  }

  group.add(surface, fascias, poles, bodies, lamps, movingLights);
  const point: RoadPoint = { x: 0, y: 0, z: 0, nx: 0, nz: 0 };
  const matrices = bodies.instanceMatrix.array;
  let elapsed = 0;
  function update(time: number): void {
    elapsed = time;
    for (let i = 0; i < bodies.count; i += 1) {
      const car = vehicles[i];
      const distance = THREE.MathUtils.euclideanModulo(time * car.speed + car.phase, car.road.length);
      sampleRoad(car.road, distance, point);
      const direction = Math.sign(car.speed);
      const dx = point.nz * direction, dz = -point.nx * direction;
      const x = point.x + point.nx * car.lane, z = point.z + point.nz * car.lane;
      const y = point.y + 0.42 * (1 - Math.abs(car.lane / car.road.plan.halfWidth));
      // Write the changing entries of the column-major instance matrix directly.
      const offset = i * 16;
      matrices[offset] = dz * car.w;
      matrices[offset + 2] = -dx * car.w;
      matrices[offset + 5] = car.h;
      matrices[offset + 8] = dx * car.length;
      matrices[offset + 10] = dz * car.length;
      matrices[offset + 12] = x;
      matrices[offset + 13] = y + car.h * 0.5;
      matrices[offset + 14] = z;
      if (night.value === 0) continue;

      // Paired vehicle lamps occlude with terrain and are visible according to facing.
      const nose = car.length * 0.47;
      const lamplightY = y + car.h * 0.54;
      const arrival = THREE.MathUtils.smoothstep(distance, 0, 55);
      const exit = 1 - THREE.MathUtils.smoothstep(distance, car.road.length - 55, car.road.length);
      const brightness = car.power * arrival * exit;
      positions.setXYZ(i * 2, x + dx * nose, lamplightY, z + dz * nose);
      positions.setXYZ(i * 2 + 1, x - dx * nose, lamplightY, z - dz * nose);
      headings.setXY(i * 2, dx, dz);
      headings.setXY(i * 2 + 1, dx, dz);
      lampData.setXY(i * 2, 1, brightness);
      lampData.setXY(i * 2 + 1, 2, brightness);
    }
    bodies.instanceMatrix.needsUpdate = true;
    if (night.value > 0) {
      positions.needsUpdate = true;
      headings.needsUpdate = true;
      lampData.needsUpdate = true;
    }
  }

  function setQuality(quality: CoastQuality): void {
    bodies.count = quality === 'high' ? vehicles.length : lightCount;
    movingLights.geometry.setDrawRange(0, bodies.count * 2);
    update(elapsed);
  }

  const setTimeOfDay = (time: CoastTimeOfDay): void => {
    const dark = time === 'night';
    night.value = Number(dark);
    lamps.visible = movingLights.visible = dark;
    if (dark) update(elapsed);
  };

  setTimeOfDay('day');
  setQuality('light');

  return {
    group, soundCorridors, update, setTimeOfDay, setQuality,
    dispose() {
      for (const geometry of [surface.geometry, fascias.geometry, box, lamps.geometry, movingLights.geometry])
        geometry.dispose();
      for (const material of [surface.material, fascias.material, poles.material, bodyMaterial, lightsMaterial])
        material.dispose();
      poles.dispose();
      bodies.dispose();
    },
  };
}
