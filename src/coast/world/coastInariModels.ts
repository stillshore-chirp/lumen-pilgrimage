import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inariFinishes, timberGrain as grain, type InariFinish as Finish } from './coastInariFinishes';

/** Base elevation in meters. Local +Z continues up the approach. */
export interface InariPlacement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale?: number;
}

export interface InariGatePlacement extends InariPlacement {
  style?: 'main' | 'path';
}

export interface InariBuildingPlacement extends InariPlacement {
  kind: 'roumon' | 'worship' | 'small';
}

export interface InariArchitectureLayout {
  gates: readonly InariGatePlacement[];
  buildings: readonly InariBuildingPlacement[];
  lanterns: readonly InariPlacement[];
}

type Point = readonly [x: number, y: number, z: number];
type Tone = number | ((x: number, y: number, z: number) => number | Point);
type Solid = { finish: Finish; geometry: THREE.BufferGeometry };

// Bevels share smooth normals with the large faces while keeping seams in the UV projection.
function cutTimber(size: Point, radius: number, finish: Finish): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const corner = new THREE.Vector3();
  const rounded = new THREE.Vector3();
  const lengthAxis = size.indexOf(Math.max(...size));
  const stone = finish === 'granite';
  const isotropic = stone || finish === 'plaster' || finish === 'iron';
  for (let i = 0; i < position.count; i += 1) {
    corner.fromBufferAttribute(position, i);
    const axes = [corner.x, corner.y, corner.z];
    const face = [normal.getX(i), normal.getY(i), normal.getZ(i)].findIndex(axis => axis !== 0);
    rounded.set(
      corner.x - Math.sign(corner.x) / 6,
      corner.y - Math.sign(corner.y) / 6,
      corner.z - Math.sign(corner.z) / 6,
    ).normalize();
    const point = axes.map((axis, index) => Math.sign(axis) * (size[index] / 2 - radius) + rounded.getComponent(index) * radius);
    position.setXYZ(i, point[0], point[1], point[2]);
    normal.setXYZ(i, rounded.x, rounded.y, rounded.z);
    const across = (face + 1) % 3;
    const along = (face + 2) % 3;
    const v = isotropic || lengthAxis === face ? along : lengthAxis;
    const u = v === along ? across : along;
    uv.setXY(i, point[u] / (stone ? 0.63 : isotropic ? 0.83 : 0.34),
      point[v] / (stone ? 0.63 : isotropic ? 0.83 : 2.05));
  }
  return geometry;
}

function repeatUV(geometry: THREE.BufferGeometry, u: number, v: number, offset = 0): THREE.BufferGeometry {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * u + offset, uv.getY(i) * v + offset * 0.24);
  return geometry;
}

class TimberForm {
  private readonly parts = new Map<Finish, THREE.BufferGeometry[]>();

  add(finish: Finish, geometry: THREE.BufferGeometry, tone: Tone = 1): void {
    const position = geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      const shade = typeof tone === 'number' ? tone : tone(position.getX(index), position.getY(index), position.getZ(index));
      if (typeof shade === 'number') colors.fill(shade, index * 3, index * 3 + 3);
      else colors.set(shade, index * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const parts = this.parts.get(finish);
    if (parts) parts.push(geometry);
    else this.parts.set(finish, [geometry]);
  }

  box(finish: Finish, at: Point, size: Point, tone: Tone = 1, angle = 0, bevel = 0.028): void {
    const radius = Math.min(Math.min(...size) * 0.15, bevel);
    const geometry = cutTimber(size, radius, finish);
    this.add(finish, repeatUV(geometry, 1, 1, grain(at[0] * 7.1 + at[1] * 16.7 + at[2] * 91)).rotateX(angle).translate(...at), tone);
  }

  pillar(finish: Finish, base: Point, top: Point, lowerRadius: number, upperRadius: number,
    tone: Tone = 1, sides = 18): void {
    const start = new THREE.Vector3(...base);
    const axis = new THREE.Vector3(...top).sub(start);
    const length = axis.length();
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
    const center = start.addScaledVector(axis, length * 0.5);
    const geometry = new THREE.CylinderGeometry(upperRadius, lowerRadius, length, sides, Math.max(1, Math.ceil(length / 0.47)));
    const stone = finish === 'granite';
    repeatUV(geometry, ((lowerRadius + upperRadius) * Math.PI) / (stone ? 0.63 : 0.53),
      length / (stone ? 0.63 : 2.5), grain(base[0] * 2 + base[2] * 7));
    this.add(finish, geometry.applyQuaternion(rotation).translate(center.x, center.y, center.z), tone);
  }

  // A cut profile in XY with a small bevel around its exposed edges and end grain.
  profile(finish: Finish, at: Point, outline: readonly [number, number][], depth: number,
    tone: Tone = 1, yaw = 0, bevel = 0.012): void {
    const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true,
      bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
    geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i));
    this.add(finish, repeatUV(geometry, 2.9, 0.75).translate(0, 0, -depth / 2).rotateY(yaw).translate(...at), tone);
  }

  finish(): Solid[] {
    return Array.from(this.parts, ([finish, parts]) => {
      const geometry = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      geometry.computeBoundingSphere();
      return { finish, geometry };
    });
  }
}

function grid(columns: number, rows: number, point: (u: number, v: number) => Point, reverse = false): THREE.BufferGeometry {
  const positions = [];
  const uv = [];
  const indices = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const v = row / rows;
      const [x, y, z] = point(u, v);
      positions.push(x, y, z);
      uv.push(u, v);
      if (row === rows || column === columns) continue;
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(...(reverse ? [a, c, b, b, c, d] : [a, b, c, b, d, c]));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Sweep a chamfered timber section along the sprung line of the eave.
function crown(form: TimberForm, finish: Finish, halfSpan: number, y: number, height: number,
  depth: number, rise: number, z = 0, flare = 0.18, tone = 1): void {
  const lip = Math.min(height * 0.20, 0.024);
  const lower = depth * (0.5 - flare);
  const upper = depth / 2;
  const corners: readonly [number, number][] = [
    [0, -lower + lip], [lip, -lower], [height - lip, -upper], [height, -upper + lip],
    [height, upper - lip], [height - lip, upper], [lip, lower], [0, lower - lip],
  ];
  const sideHeight = (u: number) => rise * Math.abs(u * 2 - 1) ** 3.7;
  const elevation = [0.86, 1, 1.12, 1, 1.11, 1, 0.85, 0.80];
  for (let side = 0; side < corners.length; side += 1) {
    const a = corners[side];
    const b = corners[(side + 1) % corners.length];
    const face = grid(12, 1, (u, v) => [
      (u * 2 - 1) * halfSpan, y + sideHeight(u) + THREE.MathUtils.lerp(a[0], b[0], v), z + THREE.MathUtils.lerp(a[1], b[1], v),
    ], true);
    const uv = face.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getY(i) * 0.45 + side * 0.13, uv.getX(i) * halfSpan);
    form.add(finish, face, tone * elevation[side]);
  }
  for (const sign of [-1, 1]) {
    const points = corners.map(([up, across]) => new THREE.Vector2(across, up));
    const geometry = new THREE.ShapeGeometry(new THREE.Shape(points));
    geometry.rotateY(sign * Math.PI / 2).translate(sign * halfSpan, y + rise, z);
    form.add(finish, repeatUV(geometry, 2.9, 2.9), tone * 0.82);
  }
}

function stonePatina(x: number, y: number, z: number): Point {
  const mottling = 0.5 + Math.sin(x * 11.2 + z * 7.3) * Math.sin(y * 19.7 - x * 8.9) * 0.5;
  const damp = Math.max(0, 1 - (y + 0.15) / 0.45) * (0.46 + 0.43 * mottling);
  const gray = 0.82 + 0.24 * mottling;
  return [gray * (1 - 0.36 * damp), gray * (1 - 0.24 * damp), gray * (1 - 0.48 * damp)];
}

function torii(main: boolean): Solid[] {
  const form = new TimberForm();
  const post = main ? 2.34 : 1.55;
  const nuki = main ? 4.27 : 2.86;
  const shoulder = main ? 5.13 : 3.37;
  const thick = main ? 1.48 : 1;
  for (const sign of [-1, 1]) {
    const x = post * sign;
    const shoe = 0.445 * thick;
    const baseAt = (y: number): Point => [x - 0.017 * sign * y / shoe, y, 0];
    const weather: Tone = (px, y, pz) => {
      const streak = Math.abs(Math.cos(pz * 14 + px * 9 + sign * 0.37)) ** 4;
      const drip = 1 - THREE.MathUtils.smoothstep(y, shoe + 0.03, shoe + 0.80 + streak * 0.22);
      const joint = 1 - THREE.MathUtils.smoothstep(Math.abs(y - nuki), 0.08, 0.38);
      return [1.05 - drip * 0.19 - joint * 0.13, 0.95 - drip * 0.26, 0.88 - drip * 0.18];
    };
    form.pillar('granite', [x, -0.4, 0], [x, -0.018, 0], 0.260 * thick, 0.258 * thick, stonePatina, 16);
    form.pillar('granite', [x, -0.018, 0], [x, 0.043, 0], 0.258 * thick, 0.232 * thick, stonePatina, 16);
    form.pillar('iron', baseAt(-0.26), baseAt(shoe), 0.230 * thick, 0.216 * thick, (px, y, pz) =>
      0.64 + THREE.MathUtils.smoothstep(y, 0, shoe) * 0.30 + Math.sin(px * 29 + pz * 27) * 0.10, 16);
    form.pillar('iron', baseAt(shoe - 0.027), baseAt(shoe + 0.014),
      0.221 * thick, 0.216 * thick, 1.10, 16);
    form.pillar('lacquer', baseAt(shoe - 0.011), [x - 0.112 * sign * thick, shoulder + 0.07, 0],
      0.211 * thick, 0.175 * thick, weather, 16);
    // A sloping wooden wedge locks the through-beam at the post's outer cheek.
    form.profile('wood', [x + sign * 0.213 * thick, nuki + 0.169 * thick, 0], [
      [-0.17 * thick, 0], [0.17 * thick, 0], [0.148 * thick, 0.037 * thick], [-0.16 * thick, 0.092 * thick],
    ], 0.188 * thick, 0.88, sign < 0 ? Math.PI : 0, 0.006);
    if (main) {
      for (const side of [-1, 1]) form.pillar('iron', [x - 0.046 * sign, nuki + 0.075, side * 0.306],
        [x - 0.046 * sign, nuki + 0.075, side * 0.325], 0.027, 0.018, 1.12, 8);
    }
  }
  crown(form, 'lacquer', post + 0.34 * thick, nuki, 0.187 * thick, 0.256 * thick, 0.015 * thick, 0, 0.04, 0.93);
  form.box('lacquer', [0, (nuki + shoulder) * 0.5 + 0.06, 0],
    [0.20 * thick, shoulder - nuki - 0.065, 0.162 * thick], 0.89);
  if (main) {
    const plaque: readonly [number, number][] = [[-0.235, -0.27], [0.235, -0.27], [0.244, 0.206], [0.171, 0.314],
      [-0.171, 0.314], [-0.244, 0.206]];
    form.profile('lacquer', [0, nuki + 0.46, -0.145], plaque, 0.105, 1.18);
    form.profile('wood', [0, nuki + 0.46, -0.209], plaque.map(([x, y]) => [x * 0.78, y * 0.83]),
      0.012, 0.93, 0, 0.004);
    for (const x of [-0.177, 0.177]) {
      for (const y of [-0.213, 0.193]) form.pillar('iron', [x, nuki + 0.46 + y, -0.201],
        [x, nuki + 0.46 + y, -0.225], 0.015, 0.011, 1.32, 8);
    }
  }
  const eave = post + 0.64 * thick;
  crown(form, 'lacquer', eave - 0.18 * thick, shoulder - 0.009, 0.124 * thick, 0.37 * thick, 0.176 * thick, 0, 0.18, 0.87);
  crown(form, 'lacquer', eave - 0.045 * thick, shoulder + 0.109 * thick, 0.167 * thick, 0.51 * thick, 0.202 * thick, 0, 0.26, 1.03);
  crown(form, 'iron', eave + 0.045 * thick, shoulder + 0.26 * thick, 0.082 * thick, 0.608 * thick, 0.229 * thick, 0, 0.16, 0.93);
  return form.finish();
}

interface Roof {
  eaveY: number;
  width: number;
  near: number;
  far: number;
  rise: number;
  ridge: number;
  thickness: number;
  flare: number;
  hip: number;
}

function barkRoof(form: TimberForm, roof: Roof): void {
  const { eaveY, width, near, far, rise, ridge, thickness, flare } = roof;
  const courses = Math.round(Math.max(-near, far) * 14);
  const hipCourses = Math.round(courses * roof.hip);
  const hip = hipCourses / courses;
  const slope = (t: number) => eaveY + rise * t ** 1.43;
  const span = (t: number) => THREE.MathUtils.lerp(width, ridge, Math.min(t / hip, 1));
  const edgeRise = (u: number, t: number) => flare * Math.abs(u) ** 4 * (1 - t) ** 3;
  const scallop = (u: number, t: number) => {
    const course = Math.round(t * courses * 3) % 3;
    const grainLine = Math.sin(u * 19 + t * 38) * Math.sin(u * Math.PI) * 0.003;
    return [0.020, 0.006, 0.000][course] + grainLine;
  };
  const damp = (run: (x: number, z: number) => number): Tone => (x, y, z) => {
    const t = run(x, z);
    const variation = Math.sin(x * 4.9 + y * 3.4) * Math.cos(z * 3.8 - y * 10.7) * 0.10;
    const wash = THREE.MathUtils.smoothstep(y, eaveY + 0.04, eaveY + 0.70);
    const exposed = [0.71, 1.04, 0.95][Math.round(t * courses * 3) % 3];
    return [(0.80 + wash * 0.19 + variation) * exposed, (0.86 + wash * 0.18 + variation) * exposed,
      (0.82 + wash * 0.21 + variation) * exposed];
  };
  for (const edge of [near, far]) {
    const face = (u: number, t: number, drop: number): Point => [
      u * span(t), slope(t) + edgeRise(u, t) - drop, edge * (1 - t),
    ];
    form.add('roof', repeatUV(grid(36, courses * 3,
      (u, t) => face(u * 2 - 1, t, -scallop(u, t)), edge < 0), width * 2.5, Math.abs(edge) * 2.6),
      damp((_x, z) => 1 - z / edge));
    form.add('wood', repeatUV(grid(22, courses, (u, t) => face(u * 2 - 1, t, thickness), edge > 0), width * 2, 2), 0.79);
    form.add('roof', repeatUV(grid(32, 2, (u, v) => face(u * 2 - 1, 0, v * thickness), edge > 0), width * 2.2, 0.36), 0.96);
    for (let course = 0; course < 7; course += 1) {
      const front = (u: number, v: number): Point => {
        const [x, y, z] = face(u * 2 - 1, 0, ((course + v) / 7) * thickness);
        return [x, y, z + Math.sign(edge) * (course % 2 === 0 ? 0.013 : 0.002)];
      };
      form.add('roof', repeatUV(grid(34, 1, front, edge > 0), width * 2.2, 0.1, course * 0.14),
        course % 3 === 1 ? 0.75 : 1.20);
    }
    const roofEdge = Math.sign(edge);
    crown(form, 'wood', width - 0.05, eaveY - thickness - 0.049, 0.053, 0.158, flare,
      edge - roofEdge * 0.047, 0.18, 1.03);
    // A thinner lining under the exposed bark and rafter heads with separately lit end grain.
    const rafters = Math.floor(width * 6.1);
    for (let i = 0; i <= rafters; i += 1) {
      const u = i / rafters * 2 - 1;
      const y = eaveY + edgeRise(u, 0) - thickness - 0.061;
      const x = u * (width - 0.13);
      form.box('wood', [x, y + 0.023, edge * 0.91], [0.079, 0.137, Math.min(0.70, Math.abs(edge) * 0.27)],
        0.83 + grain(i) * 0.28, roofEdge * 0.145, 0.012);
      form.box('plaster', [x, y - 0.005, edge * 0.994], [0.058, 0.077, 0.024], 0.67, roofEdge * 0.13);
    }
  }
  for (const sign of [-1, 1]) {
    const end = (u: number, t: number, drop: number): Point => [
      sign * span(t), slope(t) + edgeRise(1, t) - drop, THREE.MathUtils.lerp(near, far, u) * (1 - t),
    ];
    form.add('roof', repeatUV(grid(26, hipCourses * 3, (u, v) => end(u, v * hip, -scallop(u, v * hip)), sign > 0),
      (far - near) * 1.2, hip * 3), damp(x => THREE.MathUtils.clamp((width - Math.abs(x)) / (width - ridge) * hip, 0, hip)));
    form.add('wood', repeatUV(grid(22, hipCourses, (u, v) => end(u, v * hip, thickness), sign < 0), (far - near) * 1.5, hip), 0.79);
    form.add('roof', repeatUV(grid(30, 2, (u, v) => end(u, 0, v * thickness), sign < 0), (far - near) * 1.2, 0.36), 0.96);
    for (let course = 0; course < 7; course += 1) {
      form.add('roof', repeatUV(grid(30, 1, (u, v) => {
        const [x, y, z] = end(u, 0, (course + v) / 7 * thickness);
        return [x + sign * (course % 2 === 0 ? 0.013 : 0.002), y, z];
      }, sign < 0), (far - near) * 1.2, 0.1, course * 0.14), course % 3 === 1 ? 0.75 : 1.20);
    }
    form.add('plaster', repeatUV(grid(18, 16, (u, v) => {
      const t = THREE.MathUtils.lerp(hip, 1, v);
      const [x, y, z] = end(u, t, thickness * 0.74);
      return [x - sign * 0.072, y, z];
    }, sign > 0), 2, 1), 0.83);
    for (const edge of [near, far]) {
      form.add('wood', repeatUV(grid(3, 20, (u, v) => {
        const t = THREE.MathUtils.lerp(hip, 1, v);
        return [sign * (ridge + 0.028), slope(t) + edgeRise(1, t) - u * thickness * 0.97, edge * (1 - t)];
      }, sign * edge < 0), 0.52, 1.4), 1.02);
    }
    form.box('lacquer', [sign * (ridge - 0.015), slope(hip) - thickness * 0.69, (near + far) * (1 - hip) * 0.5],
      [0.112, 0.092, (far - near) * (1 - hip)], 0.88);
    form.box('wood', [sign * (ridge - 0.024), (slope(hip) + slope(1)) * 0.5 - thickness * 0.75, 0],
      [0.11, slope(1) - slope(hip), 0.093], 0.83);
  }
  crown(form, 'roof', ridge + 0.13, eaveY + rise - 0.052, 0.095, 0.445, 0.104, 0, 0.19, 0.93);
  crown(form, 'wood', ridge + 0.16, eaveY + rise + 0.018, 0.102, 0.316, 0.132, 0, 0.12, 0.86);
  crown(form, 'iron', ridge + 0.19, eaveY + rise + 0.101, 0.046, 0.346, 0.151, 0, 0.18, 0.94);
}
function beamSaddle(form: TimberForm, x: number, y: number, z: number, scale: number): void {
  const shaped = (rise: number, width: number, depth: number, turn: number, tone: number) => {
    const outline: readonly [number, number][] = [
      [-0.29, 0], [0.29, 0], [0.31, 0.054], [0.37, 0.104], [0.49, 0.132],
      [0.50, 0.184], [-0.50, 0.184], [-0.49, 0.132], [-0.37, 0.104], [-0.31, 0.054],
    ];
    form.profile('lacquer', [x, y + rise * scale, z], outline.map(([px, py]) => [px * width * scale, py * scale]),
      depth * scale, tone, turn, 0.015 * scale);
  };
  shaped(-0.04, 0.57, 0.41, 0, 0.86);
  shaped(0.114, 0.94, 0.327, Math.PI / 2, 1.04);
  shaped(0.236, 0.94, 0.388, 0, 0.97);
  form.box('wood', [x, y + 0.209 * scale, z], [0.39 * scale, 0.058 * scale, 0.68 * scale], 0.79);
  form.box('lacquer', [x, y + 0.422 * scale, z], [0.79 * scale, 0.059 * scale, 0.60 * scale], 0.90);
  for (const side of [-1, 1]) {
    form.box('plaster', [x + side * 0.39 * scale, y + 0.382 * scale, z], [0.015, 0.034 * scale, 0.29 * scale], 0.83);
    form.box('iron', [x, y + 0.259 * scale, z + side * 0.442 * scale], [0.203 * scale, 0.051 * scale, 0.022], 0.93);
  }
}

function shutter(form: TimberForm, at: Point, width: number, height: number, count: number,
  facing = -1, rail = false): void {
  const [x, y, z] = at;
  const depth = (offset: number) => z + facing * offset;
  const stile = Math.min(width / count * 0.52, 0.125);
  const short = height < 1.1;
  const bottom = short ? y - height / 2 : y - height * 0.21;
  const grilleHeight = y + height / 2 - bottom;
  form.box('wood', [x, y, depth(-0.069)], [width, height, 0.10], 0.61);
  if (!short) {
    form.box('wood', [x, y - height * 0.35, depth(0.006)], [width - 0.10, height * 0.28, 0.035], 1.04);
    form.box('lacquer', [x, y - height * 0.21, depth(0.050)], [width, 0.087, 0.11], 0.88);
  }
  for (let i = 0; i < count; i += 1) {
    const slatX = x + ((i + 0.5) / count - 0.5) * width;
    form.box('lacquer', [slatX, bottom + grilleHeight / 2, depth(0.025)],
      [stile, grilleHeight, 0.098], 0.78 + grain(i + x) * 0.22, 0, 0.009);
  }
  if (rail) form.box('wood', [x, bottom + grilleHeight * 0.73, depth(0.008)], [width, 0.047, 0.105], 0.82);
  for (const side of [-1, 1]) {
    form.box('lacquer', [x + side * width * 0.5, y, depth(0.050)], [0.142, height + 0.118, 0.158], 0.92);
    form.box('lacquer', [x, y + side * height * 0.5, depth(0.050)], [width + 0.125, 0.138, 0.171], 1.00);
    for (const other of [-1, 1]) {
      form.pillar('iron', [x + side * width / 2, y + other * height * 0.43, depth(0.123)],
        [x + side * width / 2, y + other * height * 0.43, depth(0.142)], 0.018, 0.014, 1.04, 8);
    }
  }
}

function foundation(form: TimberForm, x: number, y: number, z: number, width: number, length: number,
  height: number, blocks: number): void {
  const pitch = width / blocks;
  form.box('granite', [x, y - height * 0.36, z], [width - 0.042, height * 0.62, length - 0.042], stonePatina);
  for (let column = 0; column < blocks; column += 1) {
    const px = x + (column + 0.5 - blocks / 2) * pitch;
    form.box('granite', [px, y, z], [pitch - 0.012, height * 0.65, length],
      0.89 + grain(px * 12.21 + z) * 0.20, 0, 0.049);
  }
  form.box('granite', [x, y + height * 0.325, z], [width + 0.066, 0.078, length + 0.06], 1.12, 0, 0.026);
}

function balustrade(form: TimberForm, x: number, y: number, z: number, length: number,
  height: number, divisions: number, facingZ: boolean): void {
  const at = (u: number, rise: number): Point => facingZ ? [x + u, y + rise, z] : [x, y + rise, z + u];
  const span = (u: number, rise: number, d: number): Point => facingZ ? [u, rise, d] : [d, rise, u];
  form.box('lacquer', at(0, height - 0.059), span(length + 0.09, 0.099, 0.123), 1.06);
  form.box('lacquer', at(0, 0.131), span(length + 0.038, 0.089, 0.093), 0.90);
  for (let i = 1; i < divisions; i += 1) {
    const offset = (i / divisions - 0.5) * length;
    form.box('lacquer', at(offset, height * 0.53), span(0.051, height - 0.099, 0.068), 0.79 + grain(i + length) * 0.24);
  }
  for (const end of [-1, 1]) {
    const u = end * length / 2;
    form.box('lacquer', at(u, height * 0.49), [0.155, height * 0.98, 0.155], 0.95);
    form.pillar('iron', at(u, height - 0.019), at(u, height + 0.057), 0.098, 0.059, 1.13, 10);
    form.pillar('iron', at(u, height + 0.057), at(u, height + 0.079), 0.059, 0.011, 1.18, 10);
  }
}

function roumon(): Solid[] {
  const form = new TimberForm();
  const bays = [-4.55, -1.99, 1.99, 4.55];
  for (const z of [-1.88, 1.88]) {
    for (const x of bays) {
      form.pillar('granite', [x, -0.34, z], [x, 0.065, z], 0.348, 0.343, stonePatina, 12);
      form.pillar('granite', [x, 0.065, z], [x, 0.129, z], 0.343, 0.265, 1.1, 12);
      form.pillar('lacquer', [x, 0.102, z], [x, 3.73, z], 0.242, 0.215, (px, y, pz) => {
        const splash = (1 - THREE.MathUtils.smoothstep(y, 0.15, 0.88)) * (0.13 + Math.abs(Math.sin(px * 9 + pz * 12)) * 0.19);
        return [0.99 - splash * 0.30, 0.95 - splash * 0.64, 0.89 - splash * 0.60];
      });
      form.pillar('iron', [x, 0.115, z], [x, 0.187, z], 0.246, 0.241, 0.90, 16);
      beamSaddle(form, x, 3.37, z, 1.11);
    }
    form.box('lacquer', [0, 3.785, z], [9.75, 0.24, 0.39], 0.95);
    form.box('wood', [0, 3.91, z], [9.81, 0.075, 0.40], 0.91);
  }
  for (const sign of [-1, 1]) {
    const x = sign * 3.27;
    // Raised cheeks and screened bays flank the flush central passage.
    foundation(form, x, -0.09, 0, 2.87, 4.25, 0.36, 3);
    form.box('lacquer', [x, 0.17, 0], [2.56, 0.17, 3.78], 0.83);
    for (const z of [-1.91, 1.91]) {
      const facing = Math.sign(z);
      form.box('plaster', [x, 2.95, z - facing * 0.09], [2.32, 0.84, 0.137], 0.89);
      shutter(form, [x, 1.87, z], 1.97, 1.32, 11, facing, true);
      for (let panel = -2; panel <= 2; panel += 1) {
        form.box('wood', [x + panel * 0.454, 0.655, z - facing * 0.035],
          [0.432, 0.99, 0.162], 0.87 + grain(panel + x) * 0.17);
      }
      for (const y of [0.293, 1.19, 2.61, 3.32]) {
        form.box('lacquer', [x, y, z + facing * 0.03], [2.56, 0.11, 0.21], 0.89);
      }
      form.box('wood', [x, 2.97, z - facing * 0.018], [0.083, 0.73, 0.083], 0.87);
    }
    form.box('plaster', [sign * 4.49, 2.08, 0], [0.15, 2.49, 3.67], 0.90);
    for (let panel = -3; panel <= 3; panel += 1) {
      form.box('wood', [sign * 4.51, 0.64, panel * 0.505], [0.18, 0.88, 0.493], 0.92 + grain(panel + sign) * 0.12);
    }
    for (const y of [1.10, 2.54, 3.31]) form.box('lacquer', [sign * 4.565, y, 0], [0.17, 0.135, 3.88], 0.91);
    for (const z of [-0.92, 0.92]) {
      form.box('lacquer', [sign * 4.55, 2.24, z], [0.19, 2.19, 0.115], 0.85);
    }
    form.box('wood', [sign * 1.91, 0.51, 0], [0.145, 0.59, 3.52], 0.79);
    form.box('lacquer', [sign * 1.896, 0.895, 0], [0.204, 0.105, 3.74], 0.84);
  }
  for (let column = -19; column <= 19; column += 1) {
    form.box('wood', [column * 0.264, 4.012, 0], [0.258, 0.141, 4.99], 0.87 + grain(column) * 0.25);
  }
  for (const z of [-1.12, 0, 1.12]) form.box('lacquer', [0, 3.877, z], [9.60, 0.177, 0.186], 0.85);
  for (const x of bays) form.box('lacquer', [x, 3.81, 0], [0.262, 0.246, 4.23], 0.87);
  for (const z of [-2.43, 2.43]) {
    crown(form, 'wood', 5.24, 3.838, 0.153, 0.33, 0.076, z, 0.16, 0.93);
    crown(form, 'lacquer', 5.35, 3.969, 0.137, 0.35, 0.076, z, 0.13, 0.92);
  }
  for (const z of [-2.29, 2.29]) {
    balustrade(form, -2.48, 4.07, z, 4.90, 0.64, 15, true);
    balustrade(form, 2.48, 4.07, z, 4.90, 0.64, 15, true);
  }
  for (const x of [-4.94, 4.94]) balustrade(form, x, 4.07, 0, 4.50, 0.64, 14, false);
  form.box('plaster', [0, 5.02, 0], [8.36, 1.65, 3.39], 0.95);
  for (const z of [-1.78, 1.78]) {
    for (const x of [-4.16, -2.18, 0, 2.18, 4.16]) {
      form.pillar('lacquer', [x, 4.19, z], [x, 5.79, z], 0.141, 0.125, 0.92, 16);
      beamSaddle(form, x, 5.46, z, 0.82);
    }
    for (const x of [-3.16, -1.09, 1.09, 3.16]) shutter(form, [x, 5.015, z], 1.39, 0.78, 8, Math.sign(z));
    form.box('lacquer', [0, 5.79, z], [9.02, 0.16, 0.31], 0.97);
    form.box('wood', [0, 5.98, z], [8.93, 0.238, 0.23], 0.86);
    form.box('plaster', [0, 5.884, z * 1.03], [8.81, 0.042, 0.25], 0.75);
  }
  for (const x of [-4.24, 4.24]) form.box('wood', [x, 5.958, 0], [0.221, 0.248, 3.61], 0.86);
  barkRoof(form, { eaveY: 6.05, width: 5.94, near: -3.13, far: 3.13,
    rise: 2.17, ridge: 3.92, thickness: 0.265, flare: 0.23, hip: 0.55 });
  return form.finish();
}
function shimenawa(form: TimberForm, halfWidth: number, y: number, z: number): void {
  const rope = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-halfWidth, y, z), new THREE.Vector3(-halfWidth * 0.5, y - 0.18, z - 0.006),
    new THREE.Vector3(0, y - 0.24, z - 0.009), new THREE.Vector3(halfWidth * 0.5, y - 0.18, z - 0.006),
    new THREE.Vector3(halfWidth, y, z),
  ]);
  const turns = Math.round(halfWidth * 11);
  const samples = turns * 8;
  for (let strand = 0; strand < 3; strand += 1) {
    const twist = new THREE.CatmullRomCurve3(Array.from({ length: samples + 1 }, (_, i) => {
      const t = i / samples;
      const angle = (t * turns + strand / 3) * Math.PI * 2;
      const radius = 0.020 + Math.sin(t * Math.PI) * 0.012;
      return rope.getPoint(t).add(new THREE.Vector3(0, Math.cos(angle) * radius, Math.sin(angle) * radius));
    }));
    const geometry = new THREE.TubeGeometry(twist, samples, 0.024, 6, false);
    form.add('rope', repeatUV(geometry, 2, 0.34), 0.89 + strand * 0.074);
  }
  for (const side of [-1, 1]) {
    for (let wrap = 0; wrap < 3; wrap += 1) {
      const knot = new THREE.TorusGeometry(0.059 - wrap * 0.004, 0.014, 5, 14);
      form.add('rope', knot.rotateY(Math.PI / 2).translate(side * (halfWidth - 0.107 + wrap * 0.021), y - 0.023, z), 1.09);
    }
    for (const t of [0.24, 0.59]) {
      const x = side * halfWidth * t;
      const top = y - 0.26 + 0.26 * t * t;
      form.pillar('rope', [x, top - 0.11, z], [x, top, z], 0.025, 0.031, 0.88, 7);
      const paper = (u: number, v: number): Point => [x + (u - 0.5) * 0.067 + v * 0.062,
        top - 0.108 - v * 0.24 + (u - 0.5) * 0.032, z - 0.014 - Math.abs(Math.sin(v * Math.PI * 3)) * 0.033];
      form.add('plaster', grid(1, 6, paper), 1.16);
      form.add('plaster', grid(1, 6, paper, true), 1.16);
    }
  }
}

function worship(small: boolean): Solid[] {
  const form = new TimberForm();
  const halfWidth = small ? 1.67 : 2.9;
  const front = small ? -1.58 : -2.20;
  const back = small ? 1.02 : 1.85;
  const floor = small ? 0.47 : 0.60;
  const beam = small ? 2.36 : 2.91;
  const deckDepth = back - front + 0.38;
  const stepWidth = small ? 1.49 : 2.55;
  foundation(form, 0, 0.022, (back + front) / 2, halfWidth * 2 + 0.36, deckDepth, 0.58, small ? 4 : 6);
  for (let step = 0; step < 3; step += 1) {
    const rise = floor / 3 * (step + 1);
    const z = front - 0.67 + step * 0.23;
    form.box('granite', [0, rise / 2 - 0.077, z], [stepWidth - step * 0.017, rise + 0.09, 0.268], stonePatina, 0, 0.035);
    form.box('granite', [0, rise - 0.027, z - 0.019], [stepWidth + 0.021, 0.059, 0.274], 1.12, 0, 0.021);
  }
  form.box('wood', [0, floor - 0.18, (front + back) / 2], [halfWidth * 2 + 0.32, 0.094, deckDepth - 0.03], 0.81);
  form.box('lacquer', [0, floor - 0.113, (front + back) / 2], [halfWidth * 2 + 0.37, 0.116, deckDepth + 0.03], 0.83);
  const floorboards = small ? 15 : 24;
  for (let i = 0; i < floorboards; i += 1) {
    const pitch = (halfWidth * 2 + 0.34) / floorboards;
    const x = (i + 0.5 - floorboards * 0.5) * pitch;
    form.box('wood', [x, floor + 0.01, (front + back) / 2],
      [pitch - 0.012, 0.092, deckDepth + 0.08], 0.88 + grain(i) * 0.25, 0, 0.010);
  }
  const paneY = (floor + beam) * 0.5;
  const paneHeight = beam - floor - 0.18;
  const wallFront = front + (small ? 0.82 : 1.10);
  const roomDepth = back - wallFront;
  form.box('plaster', [0, paneY, back - 0.047], [halfWidth * 2 - 0.089, paneHeight, 0.14], 0.86);
  for (const sign of [-1, 1]) {
    const x = sign * halfWidth;
    // A dado of closely fitted cedar boards ends at the deep sill beneath the side panels.
    form.box('plaster', [x, paneY + 0.15, (wallFront + back) * 0.5], [0.163, paneHeight - 0.29, roomDepth], 0.89);
    const boards = small ? 6 : 10;
    for (let i = 0; i < boards; i += 1) {
      const step = roomDepth / boards;
      form.box('wood', [x + sign * 0.011, floor + 0.26, wallFront + step * (i + 0.5)],
        [0.174, 0.41, step - 0.008], 0.92 + grain(i * 1.71 + sign) * 0.15);
    }
    for (const y of [floor + 0.50, beam - 0.19]) {
      form.box('lacquer', [x, y, (back + wallFront) / 2], [0.193, 0.142, roomDepth + 0.13], 0.88);
    }
    form.box('lacquer', [x, paneY + 0.18, (wallFront + back) / 2], [0.21, paneHeight - 0.23, 0.117], 0.86);
    form.box('lacquer', [x, beam, (front + back) / 2], [0.272, 0.175, back - front + 0.35], 0.95);
    for (const z of [front, wallFront, back]) {
      form.pillar('iron', [x, floor + 0.045, z], [x, floor + 0.128, z], 0.142, 0.132, 1.02, 12);
      form.pillar('lacquer', [x, floor + 0.10, z], [x, beam + 0.06, z], 0.129, 0.116, 0.97, 18);
      beamSaddle(form, x, beam - 0.28, z, 0.75);
    }
    shutter(form, [sign * (small ? 0.79 : 1.44), paneY, wallFront], small ? 1.38 : 2.62,
      paneHeight - 0.15, small ? 7 : 12, -1, true);
    balustrade(form, x, floor + 0.034, (front + wallFront) * 0.5, wallFront - front, small ? 0.57 : 0.64, 5, false);
    const railInner = stepWidth / 2 + 0.085;
    const railOuter = halfWidth - 0.095;
    balustrade(form, sign * (railInner + railOuter) / 2, floor + 0.034, front,
      railOuter - railInner, small ? 0.57 : 0.64, small ? 4 : 6, true);
  }
  form.box('lacquer', [0, beam + 0.04, front], [halfWidth * 2 + 0.55, 0.227, 0.264], 0.99);
  crown(form, 'wood', halfWidth + 0.27, beam + 0.15, 0.081, 0.269, 0.036, front, 0.13, 1.07);
  form.box('wood', [0, paneY, wallFront + 0.005], [0.34, paneHeight, 0.138], 0.67);
  if (small) {
    form.profile('wood', [0, beam - 0.193, wallFront - 0.073], [
      [-1.28, 0.102], [-1.28, -0.058], [-1.00, -0.035], [-0.70, 0.011], [-0.33, 0.033],
      [0.33, 0.033], [0.70, 0.011], [1.00, -0.035], [1.28, -0.058], [1.28, 0.102],
    ], 0.11, 0.89);
  }
  const pull = small ? 0.142 : 0.158;
  for (const side of [-1, 1]) {
    const x = side * pull;
    form.box('iron', [x, floor + 0.79, wallFront - 0.143], [0.053, 0.114, 0.022], 1.40);
    form.add('iron', new THREE.TorusGeometry(0.022, 0.006, 7, 12).rotateX(0.25)
      .translate(x, floor + 0.775, wallFront - 0.166), 1.44);
  }
  shimenawa(form, halfWidth - 0.12, beam - 0.138, front - 0.143);
  barkRoof(form, { eaveY: beam + 0.31, width: halfWidth + (small ? 0.64 : 0.88),
    near: front - (small ? 0.77 : 0.69), far: back + 0.72, rise: small ? 1.16 : 1.64, ridge: halfWidth + 0.13,
    thickness: small ? 0.158 : 0.22, flare: small ? 0.11 : 0.20, hip: small ? 0.59 : 0.54 });
  return form.finish();
}
function stoneLantern(): Solid[] {
  const form = new TimberForm();
  const weather: Tone = (x, y, z) => {
    const deposit = THREE.MathUtils.smoothstep(Math.sin(x * 38 + y * 17) * Math.sin(z * 28 - y * 21), 0.2, 0.86);
    const wetEdge = 1 - THREE.MathUtils.smoothstep(y, -0.024, 0.24);
    const crevice = y > 1.29 ? 0.40 : y > 0.72 && y < 0.95 ? 0.24 : 0.08;
    const moss = deposit * (crevice + 0.34 * wetEdge);
    const light = 1.01 + deposit * 0.19;
    return [light - moss * 0.83, light - moss * 0.51, light - moss * 0.94];
  };
  const foot = [
    [0, -0.23], [0.306, -0.23], [0.337, -0.198], [0.334, 0.024], [0.312, 0.059],
    [0.262, 0.074], [0.255, 0.097], [0.206, 0.114], [0.180, 0.155], [0.144, 0.179], [0, 0.179],
  ];
  const shaft = [
    [0, 0.147], [0.147, 0.147], [0.162, 0.175], [0.158, 0.208], [0.125, 0.237], [0.113, 0.278],
    [0.110, 0.398], [0.103, 0.58], [0.105, 0.637], [0.123, 0.671], [0.132, 0.70], [0.124, 0.726], [0, 0.726],
  ];
  const table = [
    [0, 0.705], [0.133, 0.705], [0.150, 0.728], [0.156, 0.755], [0.192, 0.798], [0.240, 0.819],
    [0.263, 0.854], [0.262, 0.882], [0.232, 0.891], [0.23, 0.906], [0.211, 0.922], [0, 0.922],
  ];
  const cap = [
    [0, 1.224], [0.209, 1.224], [0.222, 1.239], [0.278, 1.246], [0.318, 1.268], [0.348, 1.285],
    [0.339, 1.306], [0.292, 1.308], [0.234, 1.331], [0.167, 1.379], [0.119, 1.421], [0.095, 1.443], [0, 1.443],
  ];
  const finial = [
    [0, 1.437], [0.089, 1.437], [0.094, 1.456], [0.078, 1.47], [0.094, 1.49], [0.097, 1.521],
    [0.084, 1.551], [0.056, 1.578], [0.027, 1.602], [0, 1.617],
  ];
  for (const [part, outline] of [foot, shaft, table, cap, finial].entries()) {
    const points = outline.map(([r, y]) => new THREE.Vector2(r, y));
    const stone = new THREE.LatheGeometry(points, part === 4 ? 12 : 8).rotateY(Math.PI / 8);
    const positions = stone.getAttribute('position');
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const cut = 1 + Math.sin(x * 41.1 + y * 29.2 + z * 17.1) * Math.sin(x * 12.5 - z * 28.1) * 0.022;
      positions.setXYZ(i, x * cut, y + (cut - 1) * 0.21, z * cut);
    }
    const perimeter = Math.max(...outline.map(([r]) => r)) * Math.PI * 2;
    if (part === 3) {
      const uv = stone.getAttribute('uv');
      // Project the flared cap from above. Wrapped UVs concentrate the stone grains near its tip.
      for (let i = 0; i < uv.count; i += 1) uv.setXY(i, positions.getX(i) / 0.57, positions.getZ(i) / 0.57);
    } else {
      repeatUV(stone, perimeter / 0.63, (outline[outline.length - 1][1] - outline[0][1]) / 0.63, part * 0.37);
    }
    form.add('granite', stone, weather);
  }
  // The fire chamber remains open on four sides behind the sills and carved uprights.
  for (const x of [-0.127, 0.127]) {
    for (const z of [-0.127, 0.127]) {
      form.box('granite', [x, 0.942, z], [0.111, 0.053, 0.111], 0.94, 0, 0.018);
      form.box('granite', [x, 1.078, z], [0.074, 0.263, 0.078], weather, 0, 0.019);
      form.box('granite', [x, 1.208, z], [0.097, 0.049, 0.097], 0.91, 0, 0.014);
    }
  }
  form.pillar('granite', [0, 0.920, 0], [0, 0.942, 0], 0.122, 0.108, 0.45, 8);
  return form.finish();
}

function position(object: THREE.Object3D, placement: InariPlacement): void {
  object.position.set(placement.x, placement.y, placement.z);
  object.rotation.y = placement.yaw;
  object.scale.setScalar(placement.scale ?? 1);
}

function instanceArchitecture(group: THREE.Group, name: string, solids: Solid[], placements: readonly InariPlacement[],
  materials: Record<Finish, THREE.MeshStandardMaterial>): void {
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  for (const { finish, geometry } of solids) {
    const batch = new THREE.InstancedMesh(geometry, materials[finish], placements.length);
    batch.name = `${name} ${finish}`;
    batch.castShadow = batch.receiveShadow = true;
    placements.forEach((placement, index) => {
      position(transform, placement);
      transform.updateMatrix();
      batch.setMatrixAt(index, transform.matrix);
      const tone = 0.88 + grain(placement.x * 3.19 + placement.z * 2.47) * 0.21;
      color.setRGB(tone, tone, tone);
      batch.setColorAt(index, color);
    });
    batch.computeBoundingSphere();
    group.add(batch);
  }
}

export function createInariArchitecture(layout: InariArchitectureLayout, stone: THREE.Texture, stoneNormal: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Gates, lanterns and hill shrine';
  const materials = inariFinishes(stone, stoneNormal);
  for (const style of ['path', 'main'] as const) {
    const gates = layout.gates.filter(gate => (gate.style ?? 'path') === style);
    if (gates.length) instanceArchitecture(group, `${style} torii`, torii(style === 'main'), gates, materials);
  }
  if (layout.lanterns.length) instanceArchitecture(group, 'Stone lanterns', stoneLantern(), layout.lanterns, materials);
  for (const kind of ['roumon', 'worship', 'small'] as const) {
    const buildings = layout.buildings.filter(building => building.kind === kind);
    if (buildings.length) instanceArchitecture(group, kind, kind === 'roumon' ? roumon() : worship(kind === 'small'), buildings, materials);
  }
  return group;
}
