import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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

type Finish = 'lacquer' | 'iron' | 'roof' | 'wood' | 'plaster' | 'granite' | 'rope';
type Point = readonly [x: number, y: number, z: number];
type Solid = { finish: Finish; geometry: THREE.BufferGeometry };

function grain(seed: number): number {
  const wave = Math.sin(seed * 127.1 + 81.3) * 43758.5453;
  return wave - Math.floor(wave);
}

function lacquerWear(): THREE.DataTexture {
  const width = 128;
  const height = 256;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const brush = Math.cos(x * 0.23 + Math.sin(y * 0.025) * 0.45) * 2.5;
      const settling = Math.cos(y * 0.047 + Math.sin(x * 0.14) * 0.8) * 3.2;
      const fleck = grain(index * 1.137);
      const gloss = 247 + brush + settling - fleck ** 14 * 30;
      pixels.set([gloss, gloss * 0.985, gloss * 0.97, 255], index * 4);
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function finishes(wood: THREE.Texture, stone: THREE.Texture): Record<Finish, THREE.MeshStandardMaterial> {
  const wear = lacquerWear();
  const standard = (color: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, vertexColors: true, ...extra });
  return {
    lacquer: standard(0xd24620, 0.55, { map: wear, bumpMap: wear, bumpScale: 0.0018 }),
    iron: standard(0x302e2b, 0.74, { metalness: 0.13, bumpMap: wear, bumpScale: 0.002 }),
    roof: standard(0x69584a, 0.95, { map: wear, bumpMap: wood, bumpScale: 0.005 }),
    wood: standard(0x635040, 0.88, { map: wear, bumpMap: wood, bumpScale: 0.004 }),
    plaster: standard(0xd0c9b4, 0.91, { bumpMap: wear, bumpScale: 0.002 }),
    granite: standard(0xa5a59a, 0.96, { bumpMap: stone, bumpScale: 0.017, map: wear }),
    rope: standard(0xa58b61, 0.94, { bumpMap: wood, bumpScale: 0.005 }),
  };
}

class TimberForm {
  private readonly parts = new Map<Finish, THREE.BufferGeometry[]>();

  add(finish: Finish, geometry: THREE.BufferGeometry, tone: number | ((x: number, y: number, z: number) => number) = 1): void {
    const position = geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      const shade = typeof tone === 'number' ? tone : tone(position.getX(index), position.getY(index), position.getZ(index));
      colors[index * 3] = shade;
      colors[index * 3 + 1] = shade;
      colors[index * 3 + 2] = shade;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const parts = this.parts.get(finish);
    if (parts) parts.push(geometry);
    else this.parts.set(finish, [geometry]);
  }

  box(finish: Finish, at: Point, size: Point, tone = 1, angle = 0): void {
    this.add(finish, new THREE.BoxGeometry(...size).rotateX(angle).translate(...at), tone);
  }

  pillar(finish: Finish, base: Point, top: Point, lowerRadius: number, upperRadius: number,
    tone: number | ((x: number, y: number, z: number) => number) = 1, sides = 18): void {
    const start = new THREE.Vector3(...base);
    const axis = new THREE.Vector3(...top).sub(start);
    const length = axis.length();
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
    const center = start.addScaledVector(axis, length * 0.5);
    this.add(finish, new THREE.CylinderGeometry(upperRadius, lowerRadius, length, sides, 3)
      .applyQuaternion(rotation).translate(center.x, center.y, center.z), tone);
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

// Sweep a timber's trapezoidal profile along X, including exposed end grain.
function crown(form: TimberForm, finish: Finish, halfSpan: number, y: number, height: number,
  depth: number, rise: number, z = 0, flare = 0.18, tone = 1): void {
  const corners: readonly [number, number][] = [
    [0, -depth * (0.5 - flare)], [height, -depth / 2], [height, depth / 2], [0, depth * (0.5 - flare)],
  ];
  const sideHeight = (u: number) => rise * Math.abs(u * 2 - 1) ** 3.7;
  for (let side = 0; side < corners.length; side += 1) {
    const a = corners[side];
    const b = corners[(side + 1) % corners.length];
    form.add(finish, grid(14, 1, (u, v) => [
      (u * 2 - 1) * halfSpan, y + sideHeight(u) + THREE.MathUtils.lerp(a[0], b[0], v), z + THREE.MathUtils.lerp(a[1], b[1], v),
    ], true), tone * [1, 1.02, 1, 0.82][side]);
  }
  for (const sign of [-1, 1]) {
    form.add(finish, grid(1, 1, (u, v) => [sign * halfSpan, y + sideHeight(1) + height * v,
      z + (u - 0.5) * depth * (1 - flare * 2 * (1 - v))], sign > 0), tone * 0.9);
  }
}

function torii(main: boolean): Solid[] {
  const form = new TimberForm();
  const post = main ? 2.34 : 1.55;
  const nuki = main ? 4.27 : 2.86;
  const shoulder = main ? 5.13 : 3.37;
  const thick = main ? 1.48 : 1;
  for (const sign of [-1, 1]) {
    const x = post * sign;
    const weather = (px: number, y: number, pz: number) =>
      0.74 + 0.23 * THREE.MathUtils.smoothstep(y, 0.33, 1.6) + 0.035 * Math.sin(px * 9 + pz * 14);
    form.pillar('granite', [x, -0.40, 0], [x, 0.035, 0], 0.265 * thick, 0.255 * thick, 0.66);
    form.pillar('iron', [x, -0.30, 0], [x - 0.018 * sign, 0.46 * thick, 0], 0.235 * thick, 0.218 * thick, weather);
    form.pillar('lacquer', [x - 0.016 * sign, 0.41 * thick, 0], [x - 0.112 * sign * thick, shoulder + 0.06, 0],
      0.214 * thick, 0.176 * thick, weather);
    form.pillar('iron', [x - 0.015 * sign, 0.44 * thick, 0], [x - 0.015 * sign, 0.464 * thick, 0],
      0.222 * thick, 0.221 * thick, 1.02);
    form.box('lacquer', [sign * (post + 0.206 * thick), nuki + 0.017 * thick, 0],
      [0.16 * thick, 0.085 * thick, 0.29 * thick], 0.79);
  }
  crown(form, 'lacquer', post + 0.34 * thick, nuki, 0.187 * thick, 0.256 * thick, 0.028 * thick, 0, 0.06, 0.93);
  form.box('lacquer', [0, (nuki + shoulder) * 0.5, 0],
    [0.24 * thick, shoulder - nuki, 0.162 * thick], 0.89);
  if (main) {
    form.box('lacquer', [0, nuki + 0.46, -0.156], [0.54, 0.63, 0.115], 0.8);
    form.box('wood', [0, nuki + 0.46, -0.221], [0.425, 0.51, 0.026], 0.76);
  }
  const eave = post + 0.64 * thick;
  crown(form, 'lacquer', eave - 0.055, shoulder, 0.145 * thick, 0.44 * thick, 0.185 * thick, 0, 0.19, 0.94);
  crown(form, 'lacquer', eave, shoulder + 0.141 * thick, 0.15 * thick, 0.56 * thick, 0.185 * thick);
  crown(form, 'iron', eave + 0.032 * thick, shoulder + 0.284 * thick, 0.065 * thick, 0.586 * thick, 0.19 * thick, 0, 0.08);
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
  const { eaveY, width, near, far, rise, ridge, thickness, flare, hip } = roof;
  const slope = (t: number) => eaveY + rise * t ** 1.36;
  const span = (t: number) => THREE.MathUtils.lerp(width, ridge, Math.min(t / hip, 1));
  const edgeRise = (u: number, t: number) => flare * Math.abs(u) ** 4 * (1 - t) ** 3;
  const course = (u: number, t: number) =>
    0.012 * Math.cos(t * Math.PI * 82 + Math.sin(u * 27 + t * 23) * Math.sin(u * Math.PI) * 0.36);
  const stain = (x: number, y: number, z: number) =>
    0.85 + Math.sin(x * 3.9 + z * 5.4) * 0.025 + 0.085 * grain(Math.round(y * 104));
  for (const edge of [near, far]) {
    const face = (u: number, t: number, drop: number): Point => [
      u * span(t), slope(t) + edgeRise(u, t) - drop, edge * (1 - t),
    ];
    form.add('roof', grid(30, 123, (u, t) => face(u * 2 - 1, t, course(u, t)), edge < 0), stain);
    form.add('wood', grid(24, 9, (u, t) => face(u * 2 - 1, t, thickness), edge > 0), 0.72);
    form.add('roof', grid(24, 4, (u, v) => face(u * 2 - 1, 0, v * thickness), edge > 0),
      (_x, y) => 0.78 + 0.12 * Math.sin(y * 193));

    // Visible rafter tails follow the lift of the outer eave.
    const rafters = Math.floor(width * 8);
    for (let i = 0; i <= rafters; i += 1) {
      const u = i / rafters * 2 - 1;
      const y = eaveY + edgeRise(u, 0) - thickness - 0.065;
      form.box('wood', [u * (width - 0.11), y + 0.035, edge * 0.92], [0.075, 0.125, Math.min(0.67, Math.abs(edge) * 0.26)],
        0.8 + grain(i) * 0.24, Math.sign(edge) * 0.12);
      form.box('plaster', [u * (width - 0.11), y, edge * 0.995], [0.049, 0.067, 0.022], 0.59);
    }
  }
  for (const sign of [-1, 1]) {
    const end = (u: number, t: number, drop: number): Point => [
      sign * span(t), slope(t) + edgeRise(1, t) - drop, THREE.MathUtils.lerp(near, far, u) * (1 - t),
    ];
    form.add('roof', grid(18, 64, (u, v) => end(u, v * hip, course(u, v * hip)), sign > 0), stain);
    form.add('wood', grid(16, 8, (u, v) => end(u, v * hip, thickness), sign < 0), 0.65);
    form.add('roof', grid(16, 4, (u, v) => end(u, 0, v * thickness), sign < 0), 0.84);
    // The hip breaks into a closed gable. Dark bargeboards cap the exposed bark courses.
    if (hip < 1) {
      form.add('plaster', grid(18, 10, (u, v) => {
        const t = THREE.MathUtils.lerp(hip, 1, v);
        const [x, y, z] = end(u, t, thickness * 0.70);
        return [x - sign * 0.045, y, z];
      }, sign > 0), 0.74);
      for (const edge of [near, far]) {
        form.add('iron', grid(1, 16, (u, v) => {
          const t = THREE.MathUtils.lerp(hip, 1, v);
          return [sign * (ridge + 0.017), slope(t) + edgeRise(1, t) - u * thickness * 0.92, edge * (1 - t)];
        }, sign * edge < 0), 0.95);
      }
      form.box('lacquer', [sign * (ridge - 0.015), slope(hip) - thickness * 0.69, (near + far) * (1 - hip) * 0.5],
        [0.112, 0.092, (far - near) * (1 - hip)], 0.79);
    }
  }
  crown(form, 'iron', ridge + 0.18, eaveY + rise - 0.05, 0.171, 0.335, 0.115, 0, 0.22, 0.91);
  crown(form, 'roof', ridge + 0.11, eaveY + rise - 0.12, 0.079, 0.428, 0.096, 0, 0.19, 0.86);
}

function beamSaddle(form: TimberForm, x: number, y: number, z: number, scale: number): void {
  form.box('lacquer', [x, y, z], [0.51 * scale, 0.16 * scale, 0.46 * scale], 0.89);
  form.box('lacquer', [x, y + 0.166 * scale, z], [0.78 * scale, 0.185 * scale, 0.63 * scale], 0.97);
  form.box('plaster', [x, y + 0.244 * scale, z], [0.61 * scale, 0.043 * scale, 0.52 * scale], 0.83);
  form.box('lacquer', [x, y + 0.327 * scale, z], [0.97 * scale, 0.139 * scale, 0.77 * scale], 0.93);
}

function shutter(form: TimberForm, at: Point, width: number, height: number, count: number): void {
  const [x, y, z] = at;
  form.box('wood', [x, y, z + 0.039], [width, height, 0.12], 0.58);
  for (let i = 0; i < count; i += 1) {
    form.box('lacquer', [x + ((i + 0.5) / count - 0.5) * width, y, z - 0.024],
      [Math.min(0.074, width / count * 0.48), height, 0.12], 0.64 + grain(i) * 0.2);
  }
  for (const side of [-1, 1]) {
    form.box('lacquer', [x + side * width * 0.5, y, z - 0.034], [0.14, height + 0.18, 0.17], 0.84);
    form.box('lacquer', [x, y + side * height * 0.5, z - 0.034], [width + 0.13, 0.14, 0.18], 0.92);
  }
}

function roumon(): Solid[] {
  const form = new TimberForm();
  const bays = [-4.55, -1.99, 1.99, 4.55];
  for (const z of [-1.88, 1.88]) {
    for (const x of bays) {
      form.pillar('granite', [x, -0.34, z], [x, 0.073, z], 0.34, 0.33, 0.69, 12);
      form.pillar('lacquer', [x, 0.049, z], [x, 3.73, z], 0.242, 0.215, 0.93);
      beamSaddle(form, x, 3.43, z, 1.08);
    }
    form.box('lacquer', [0, 3.775, z], [9.73, 0.27, 0.385], 0.94);
    form.box('plaster', [0, 3.92, z], [9.82, 0.075, 0.415], 0.84);
  }
  for (const sign of [-1, 1]) {
    const x = sign * 3.27;
    // Plinths and screens sit in the flanking bays. The center remains a flush through-route.
    form.box('granite', [x, -0.09, 0], [2.87, 0.39, 4.28], 0.86);
    form.box('lacquer', [x, 0.20, 0], [2.56, 0.19, 3.74], 0.72);
    for (const z of [-1.91, 1.91]) {
      form.box('plaster', [x, 2.64, z], [2.34, 1.48, 0.17], 0.76);
      shutter(form, [x, 1.88, z < 0 ? z + 0.045 : z - 0.12], 2.02, 1.82, 11);
      form.box('lacquer', [x, 0.72, z], [2.47, 0.54, 0.19], 0.83);
    }
    form.box('plaster', [sign * 4.53, 2.18, 0], [0.15, 2.61, 3.68], 0.81);
    form.box('wood', [sign * 4.54, 0.77, 0], [0.18, 0.79, 3.68], 0.7);
    form.box('lacquer', [sign * 4.63, 2.63, 0], [0.24, 0.115, 3.94], 0.86);
  }
  for (let column = -19; column <= 19; column += 1) {
    form.box('wood', [column * 0.264, 4.01, 0], [0.258, 0.145, 4.95], 0.79 + grain(column) * 0.24);
  }
  for (const z of [-1.12, 0, 1.12]) form.box('lacquer', [0, 3.885, z], [9.6, 0.173, 0.19], 0.8);
  for (const x of bays) form.box('lacquer', [x, 3.84, 0], [0.27, 0.23, 4.22], 0.83);
  crown(form, 'lacquer', 5.35, 3.86, 0.215, 0.32, 0.075, -2.43, 0.12, 0.86);
  crown(form, 'lacquer', 5.35, 3.86, 0.215, 0.32, 0.075, 2.43, 0.12, 0.86);
  for (const z of [-2.29, 2.29]) {
    form.box('lacquer', [0, 4.66, z], [10.18, 0.112, 0.153], 0.98);
    form.box('lacquer', [0, 4.27, z], [10.18, 0.111, 0.115], 0.85);
    for (let index = -15; index <= 15; index += 1) {
      const x = index * 0.326;
      const pier = index % 5 === 0;
      const tier = pier ? 0.156 : 0.058;
      form.box('lacquer', [x, 4.45, z], [tier, pier ? 0.59 : 0.40, tier], 0.79 + grain(index) * 0.22);
    }
  }
  for (const x of [-4.94, 4.94]) {
    for (const y of [4.27, 4.66]) form.box('lacquer', [x, y, 0], [0.139, 0.115, 4.57], 0.94);
    for (let index = -6; index <= 6; index += 1) {
      form.box('lacquer', [x, 4.46, index * 0.327], [0.069, 0.41, 0.081], 0.9);
    }
  }
  form.box('plaster', [0, 5.02, 0], [8.36, 1.65, 3.43], 0.97);
  for (const z of [-1.78, 1.78]) {
    for (const x of [-4.16, -2.18, 0, 2.18, 4.16]) {
      form.pillar('lacquer', [x, 4.22, z], [x, 5.79, z], 0.142, 0.123, 0.91);
      beamSaddle(form, x, 5.51, z, 0.77);
    }
    for (const x of [-3.16, -1.09, 1.09, 3.16]) shutter(form, [x, 5.06, z], 1.31, 0.75, 8);
    form.box('lacquer', [0, 5.80, z], [9.02, 0.176, 0.31], 0.96);
    form.box('wood', [0, 6.03, z], [8.92, 0.31, 0.23], 0.73);
  }
  for (const x of [-4.24, 4.24]) form.box('wood', [x, 5.99, 0], [0.205, 0.29, 3.62], 0.67);
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
  for (let strand = 0; strand < 3; strand += 1) {
    const twist = new THREE.CatmullRomCurve3(Array.from({ length: 95 }, (_, i) => {
      const angle = i * 1.035 + strand * Math.PI * 2 / 3;
      return rope.getPoint(i / 94).add(new THREE.Vector3(0, Math.cos(angle) * 0.027, Math.sin(angle) * 0.027));
    }));
    form.add('rope', new THREE.TubeGeometry(twist, 160, 0.027, 6, false), 0.87 + strand * 0.075);
  }
  for (const side of [-1, 1]) {
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
  form.box('granite', [0, 0.075, (back + front) / 2], [halfWidth * 2 + 0.46, 0.68, deckDepth], 0.81);
  for (let step = 0; step < 3; step += 1) {
    form.box('granite', [0, floor / 6 * (step + 1) - 0.051, front - 0.67 + step * 0.23],
      [small ? 1.46 : 2.55, floor / 3 * (step + 1) + 0.102, 0.26], 0.90 + 0.033 * step);
  }
  form.box('lacquer', [0, floor - 0.12, (front + back) / 2], [halfWidth * 2 + 0.37, 0.27, deckDepth + 0.07], 0.71);
  const floorboards = small ? 13 : 19;
  for (let i = 0; i < floorboards; i += 1) {
    const pitch = (halfWidth * 2 + 0.34) / floorboards;
    form.box('wood', [(i + 0.5 - floorboards * 0.5) * pitch, floor + 0.024, (front + back) / 2],
      [pitch - 0.007, 0.071, deckDepth + 0.08], 0.83 + grain(i) * 0.22);
  }
  const paneY = (floor + beam) * 0.5;
  const paneHeight = beam - floor - 0.18;
  const wallFront = front + (small ? 0.91 : 1.34);
  const roomDepth = back - wallFront;
  form.box('plaster', [0, paneY, back - 0.047], [halfWidth * 2 - 0.089, paneHeight, 0.14], 0.8);
  for (const sign of [-1, 1]) {
    const x = sign * halfWidth;
    form.box('plaster', [x, paneY, (wallFront + back) * 0.5], [0.163, paneHeight, roomDepth], 0.76);
    for (const y of [floor + 0.41, beam - 0.22]) {
      form.box('lacquer', [x, y, (back + wallFront) / 2], [0.188, 0.127, roomDepth + 0.13], 0.84);
    }
    form.box('lacquer', [x, beam, (front + back) / 2], [0.267, 0.169, back - front + 0.33], 0.96);
    for (const z of [front, wallFront, back]) {
      form.pillar('lacquer', [x, floor, z], [x, beam + 0.06, z], 0.122, 0.111, 0.91, 16);
      beamSaddle(form, x, beam - 0.26, z, 0.71);
    }
    shutter(form, [sign * (small ? 0.76 : 1.41), paneY, wallFront], small ? 1.33 : 2.48, paneHeight - 0.12, small ? 9 : 14);
    form.box('lacquer', [x, floor + 0.69, (front + wallFront) * 0.5], [0.105, 0.11, wallFront - front], 0.95);
    form.box('lacquer', [x, floor + 0.27, (front + wallFront) * 0.5], [0.089, 0.099, wallFront - front], 0.87);
    for (let divider = 1; divider <= 3; divider += 1) {
      form.box('lacquer', [x, floor + 0.47, THREE.MathUtils.lerp(front, wallFront, divider / 4)], [0.065, 0.39, 0.06], 0.8);
    }
  }
  form.box('lacquer', [0, beam + 0.06, front], [halfWidth * 2 + 0.58, 0.235, 0.269], 0.97);
  form.box('wood', [0, paneY, wallFront + 0.024], [0.57, paneHeight, 0.14], 0.63);
  form.box('lacquer', [0, paneY, wallFront - 0.068], [0.126, paneHeight, 0.095], 0.77);
  shimenawa(form, halfWidth - 0.12, beam - 0.15, front - 0.138);
  barkRoof(form, { eaveY: beam + 0.31, width: halfWidth + (small ? 0.72 : 0.88),
    near: front - 0.59, far: back + 0.72, rise: small ? 1.16 : 1.64, ridge: halfWidth + 0.13,
    thickness: small ? 0.147 : 0.22, flare: small ? 0.13 : 0.19, hip: small ? 0.67 : 0.57 });
  return form.finish();
}

function stoneLantern(): Solid[] {
  const form = new TimberForm();
  const coursing = (x: number, y: number, z: number) =>
    0.82 + Math.sin(x * 48 + z * 52) * Math.sin(y * 39 - x * 44) * 0.095;
  const profile = [
    [0.0, -0.19], [0.32, -0.19], [0.32, 0.046], [0.29, 0.087], [0.218, 0.116], [0.175, 0.167],
    [0.129, 0.227], [0.107, 0.28], [0.096, 0.69], [0.128, 0.76], [0.145, 0.80], [0.245, 0.855],
    [0.245, 0.934], [0.19, 0.955], [0.0, 0.955],
  ];
  const cap = [[0.0, 1.245], [0.247, 1.245], [0.302, 1.27], [0.327, 1.31], [0.273, 1.328],
    [0.183, 1.373], [0.117, 1.441], [0.074, 1.475], [0.083, 1.499], [0.067, 1.55], [0.0, 1.617]];
  for (const profilePoints of [profile, cap]) {
    const points = profilePoints.map(([r, y]) => new THREE.Vector2(r, y));
    form.add('granite', new THREE.LatheGeometry(points, 8).rotateY(Math.PI / 8), coursing);
  }
  for (const x of [-0.128, 0.128]) {
    for (const z of [-0.128, 0.128]) form.box('granite', [x, 1.10, z], [0.09, 0.321, 0.09], 0.86);
  }
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

export function createInariArchitecture(layout: InariArchitectureLayout, wood: THREE.Texture, stone: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Inari approach, gate and hill shrine';
  const materials = finishes(wood, stone);
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
