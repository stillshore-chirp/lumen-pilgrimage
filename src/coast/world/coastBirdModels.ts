import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CoastBirdSpecies } from '../coastBirdCue';
import { smoothstep } from '../terrain';

export type BirdKind = CoastBirdSpecies | 'duck';

type Point = [number, number, number];
// Cross sections run from the tail towards the bill, on local +Z.
type Section = [z: number, centerY: number, halfWidth: number, halfDepth: number];
type WingJoint = [span: number, centerZ: number, chord: number];
type BirdForm = {
  lengthScale: number;
  body: Section[];
  headOrigin: Point;
  head: Section[];
  bill: Section[];
  leg: Point;
  shin: number;
  tail: [baseZ: number, tipZ: number, halfWidth: number, pitch: number];
  wing: [WingJoint, WingJoint, WingJoint];
  folded: [shoulderY: number, shoulderZ: number, tipY: number, tipZ: number];
  eye: [height: number, z: number];
  eyeRadius: number;
  colors: {
    back: number; belly: number; side: number; crown: number; cheek: number;
    throat: number; wing: number; quill: number; edge: number;
    bill: number; tip: number; foot: number; eye: number;
  };
};

const forms: Record<BirdKind, BirdForm> = {
  gull: {
    lengthScale: .46,
    body: [[-.51, .055, .012, .027], [-.38, .002, .101, .107], [-.17, -.023, .151, .157],
      [.04, -.003, .148, .183], [.19, .061, .108, .174], [.31, .129, .083, .135], [.37, .17, .054, .079], [.41, .187, .009, .015]],
    headOrigin: [0, .181, .207],
    head: [[-.062, .047, .008, .024], [-.019, .079, .071, .08], [.069, .081, .097, .116],
      [.159, .074, .081, .097], [.209, .043, .047, .046], [.226, .033, .012, .015]],
    bill: [[.185, .026, .034, .042], [.251, .031, .03, .04], [.331, .020, .022, .028],
      [.392, .015, .016, .021], [.417, .009, .003, .009], [.42, .009, .0008, .001]],
    leg: [.064, -.121, -.002], shin: .224, tail: [-.36, -.68, .119, -.034],
    wing: [[.095, -.094, .34], [.62, .007, .235], [1.49, -.205, .024]],
    folded: [.087, .124, .033, -.66], eye: [.108, .148], eyeRadius: .024,
    colors: { back: 0x5f6770, belly: 0xf0ede2, side: 0xdfdfd5, crown: 0xf3f3eb, cheek: 0xf2efe3,
      throat: 0xf2efe3, wing: 0x68717a, quill: 0x1b2227, edge: 0xe7e7de,
      bill: 0xc5aa47, tip: 0xa74b36, foot: 0xb1a050, eye: 0xb6a37d },
  },
  whiteEye: {
    lengthScale: .18,
    body: [[-.39, -.008, .021, .039], [-.26, -.025, .139, .127], [-.07, -.012, .191, .178],
      [.1, .009, .177, .187], [.234, .061, .103, .134], [.335, .117, .016, .033]],
    headOrigin: [0, .103, .112],
    head: [[-.113, .07, .011, .034], [-.065, .082, .075, .096], [.028, .097, .133, .135],
      [.126, .084, .125, .122], [.216, .069, .064, .065], [.256, .051, .015, .024]],
    bill: [[.197, .038, .036, .030], [.269, .029, .027, .023], [.362, .009, .010, .012], [.412, .004, .002, .002]],
    leg: [.082, -.11, -.015], shin: .194, tail: [-.29, -.555, .104, .029],
    wing: [[.115, -.063, .313], [.408, -.032, .241], [.729, -.225, .04]],
    folded: [.085, .101, .016, -.534], eye: [.114, .143], eyeRadius: .031,
    colors: { back: 0x828f32, belly: 0xe1dbbf, side: 0xa8a084, crown: 0x889a30, cheek: 0x939e38,
      throat: 0xc1c94e, wing: 0x737e38, quill: 0x414833, edge: 0xa7a14d,
      bill: 0x3d423e, tip: 0x25292a, foot: 0x696259, eye: 0x452d20 },
  },
  bushWarbler: {
    lengthScale: .21,
    body: [[-.38, -.018, .013, .029], [-.21, -.006, .116, .133], [-.06, 0, .148, .156],
      [.103, .017, .127, .152], [.225, .067, .081, .106], [.286, .093, .008, .018]],
    headOrigin: [0, .067, .124],
    head: [[-.089, .037, .009, .026], [-.027, .064, .081, .092], [.075, .074, .099, .109],
      [.155, .054, .088, .081], [.218, .039, .046, .048], [.242, .025, .012, .015]],
    bill: [[.213, .016, .026, .029], [.267, .013, .019, .016], [.358, -.003, .009, .009], [.389, -.002, .001, .002]],
    leg: [.061, -.087, -.009], shin: .243, tail: [-.277, -.708, .079, .101],
    wing: [[.076, -.074, .27], [.329, -.026, .223], [.621, -.214, .03]],
    folded: [.08, .091, .011, -.451], eye: [.077, .164], eyeRadius: .027,
    colors: { back: 0x807650, belly: 0xd5cbb4, side: 0xaf9b72, crown: 0x716b47, cheek: 0x8d805d,
      throat: 0xd9cbb0, wing: 0x766547, quill: 0x5a4c36, edge: 0x988259,
      bill: 0x4c4034, tip: 0x332d26, foot: 0x8d6454, eye: 0x402e23 },
  },
  thrush: {
    lengthScale: .285,
    body: [[-.39, -.02, .016, .033], [-.26, -.025, .1, .11], [-.108, -.007, .159, .163],
      [.08, .046, .149, .174], [.196, .104, .106, .15], [.3, .183, .064, .098], [.35, .206, .016, .028]],
    headOrigin: [0, .149, .161],
    head: [[-.07, .058, .011, .027], [-.031, .073, .074, .094], [.053, .097, .109, .125],
      [.141, .083, .095, .106], [.197, .057, .06, .053], [.226, .046, .016, .021]],
    bill: [[.183, .035, .027, .032], [.25, .028, .023, .024], [.339, .009, .011, .013], [.384, .006, .002, .002]],
    leg: [.067, -.09, .012], shin: .268, tail: [-.27, -.66, .087, -.109],
    wing: [[.092, -.072, .32], [.486, -.026, .253], [.877, -.24, .03]],
    folded: [.094, .114, -.003, -.51], eye: [.095, .156], eyeRadius: .030,
    colors: { back: 0x56595d, belly: 0xe0d9c5, side: 0xc6bfa8, crown: 0x303133, cheek: 0x363839,
      throat: 0x45433e, wing: 0x505456, quill: 0x303638, edge: 0x706e65,
      bill: 0xa68b36, tip: 0x6e5b2e, foot: 0xa07855, eye: 0x473328 },
  },
  duck: {
    lengthScale: .59,
    body: [[-.51, .025, .015, .037], [-.386, 0, .124, .126], [-.242, -.014, .172, .153],
      [-.039, -.01, .172, .158], [.115, .013, .136, .136], [.228, .093, .082, .131],
      [.268, .185, .068, .109], [.289, .264, .019, .021]],
    headOrigin: [0, .156, .165],
    head: [[-.018, .049, .007, .03], [.005, .126, .065, .069], [.069, .124, .083, .091],
      [.159, .102, .062, .074], [.191, .078, .049, .032], [.219, .068, .014, .02]],
    bill: [[.171, .062, .045, .024], [.215, .052, .039, .018], [.301, .032, .037, .013],
      [.346, .026, .029, .011], [.361, .027, .009, .008], [.363, .027, .001, .001]],
    leg: [.068, -.104, -.104], shin: .152, tail: [-.374, -.538, .098, .054],
    wing: [[.087, -.095, .343], [.43, .036, .249], [.943, -.197, .026]],
    folded: [.090, .123, .024, -.452], eye: [.128, .132], eyeRadius: .020,
    colors: { back: 0x463d32, belly: 0x6b5843, side: 0x938064, crown: 0x514436, cheek: 0xb6a889,
      throat: 0xcfbda0, wing: 0x70614c, quill: 0x453e36, edge: 0xa89b81,
      bill: 0x303333, tip: 0xc79125, foot: 0xb97841, eye: 0x503829 },
  },
};

export function createBirdMaterials() {
  return {
    plumage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .87, side: THREE.DoubleSide }),
    bare: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .66 }),
    iris: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .23 }),
  };
}

function mix(a: number, b: number, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), THREE.MathUtils.clamp(t, 0, 1));
}

function skinWidth(profile: Section[], z: number, y: number): number {
  const end = profile.findIndex(section => section[0] >= z);
  if (end < 1) return 0;
  const [left, right] = [profile[end - 1], profile[end]];
  const t = (z - left[0]) / (right[0] - left[0]);
  const span = THREE.MathUtils.lerp(left[2], right[2], t);
  const rise = THREE.MathUtils.lerp(left[3], right[3], t);
  const height = (y - THREE.MathUtils.lerp(left[1], right[1], t)) / rise;
  return span * Math.sqrt(Math.max(0, 1 - height * height));
}

function pigmented(geometry: THREE.BufferGeometry, pigment: (x: number, y: number, z: number) => THREE.Color) {
  const points = geometry.getAttribute('position');
  const colors = new Float32Array(points.count * 3);
  for (let i = 0; i < points.count; i++) pigment(points.getX(i), points.getY(i), points.getZ(i)).toArray(colors, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function loft(sections: Section[], shade: (angle: number, z: number, y: number) => THREE.Color,
  radialSteps = 28, steps = 34, hemisphere = 0): THREE.BufferGeometry {
  const profile = new THREE.SplineCurve(sections.map(s => new THREE.Vector2(s[0], s[1])));
  const radii = new THREE.SplineCurve(sections.map(s => new THREE.Vector2(s[2], s[3])));
  const shape = new THREE.BufferGeometry();
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const startAngle = hemisphere < 0 ? Math.PI : 0;
  const arc = hemisphere === 0 ? Math.PI * 2 : Math.PI;
  const stride = hemisphere ? radialSteps + 1 : radialSteps;
  for (let row = 0; row <= steps; row++) {
    const { x: z, y: centerY } = profile.getPoint(row / steps);
    const { x: width, y: height } = radii.getPoint(row / steps);
    for (let i = 0; i < stride; i++) {
      const angle = startAngle + i / radialSteps * arc;
      const y = centerY + Math.sin(angle) * Math.max(height, .0008);
      positions.push(Math.cos(angle) * Math.max(width, .0008), y, z);
      const grain = .02 * Math.sin(angle * 49 + z * 260) + .024 * Math.sin(angle * 26 - z * 169)
        + .016 * Math.sin(z * 372 - angle * 51);
      shade(angle, z, y).multiplyScalar(1 + grain).toArray(colors, colors.length);
      if (row === steps || (hemisphere && i === radialSteps)) continue;
      const from = row * stride, next = (i + 1) % stride;
      indices.push(from + i, from + next, from + i + stride, from + i + stride, from + next, from + next + stride);
    }
  }
  shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  shape.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  shape.setIndex(indices);
  shape.computeVertexNormals();
  return shape;
}

function oval(position: Point, size: Point, tint: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 14, 9).scale(...size).translate(...position);
  geometry.deleteAttribute('uv');
  return pigmented(geometry, () => new THREE.Color(tint));
}

function rod(from: Point, to: Point, root: number, tip: number, tint: number): THREE.BufferGeometry {
  const lead = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(lead);
  const geometry = new THREE.CylinderGeometry(tip, root, direction.length(), 6);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  geometry.translate(...lead.lerp(end, .5).toArray());
  geometry.deleteAttribute('uv');
  return pigmented(geometry, (x, y, z) => new THREE.Color(tint).multiplyScalar(.93 + .09 * Math.sin(x * 74 + y * 160 + z * 139)));
}

// A curved vane with a shallow rachis ridge and asymmetric lobes. Feather pigment follows the barbs.
function feather(from: Point, to: Point, across: Point, width: number, lift: number,
  shade: (u: number, v: number) => THREE.Color, rows = 9, cols = 4): THREE.BufferGeometry {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const side = new THREE.Vector3(...across).normalize();
  const ray = b.clone().sub(a);
  const normal = ray.clone().cross(side).normalize();
  if (normal.y < 0) normal.negate();
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    const opening = (.19 + .81 * smoothstep(0, .32, u)) * Math.sqrt(1 - .986 * smoothstep(.74, 1, u));
    for (let j = 0; j <= cols; j++) {
      const v = (j / cols * 2 - 1) * (j < cols / 2 ? .80 : 1);
      const arch = (1 - Math.abs(v)) * width * .17 + Math.sin(u * Math.PI) * lift;
      const point = a.clone().addScaledVector(ray, u).addScaledVector(side, v * width * opening).addScaledVector(normal, arch);
      positions.push(point.x, point.y, point.z);
      const barb = .057 * Math.sin(u * 104 - Math.abs(v) * 6) + .024 * Math.cos(v * 16 + u * 59);
      shade(u, v).multiplyScalar(1 + barb).toArray(colors, colors.length);
      if (i === rows || j === cols) continue;
      const index = i * (cols + 1) + j;
      indices.push(index, index + cols + 1, index + 1, index + 1, index + cols + 1, index + cols + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function plumageColor(kind: BirdKind, angle: number, z: number): THREE.Color {
  const { colors } = forms[kind];
  const surface = Math.sin(angle);
  const tint = mix(colors.side, colors.back, smoothstep(.04, .72, surface));
  tint.lerp(new THREE.Color(colors.belly), smoothstep(-.22, -.96, surface));
  if (kind === 'gull') {
    tint.lerp(new THREE.Color(colors.belly), (1 - smoothstep(-.02, .31, surface)) * .97);
  } else if (kind === 'duck') {
    const rows = z * 35 + Math.cos(angle * 15) * .20;
    tint.lerp(new THREE.Color(0xbbab8e), .34 * smoothstep(.84, 1, Math.cos(rows * Math.PI * 2)));
  } else if (kind === 'thrush') {
    const mottled = Math.cos(angle * 14 + Math.sin(z * 72) * 1.44) * Math.sin(z * 87);
    tint.lerp(new THREE.Color(0x4e493d), .87 * smoothstep(.26, .76, mottled) * smoothstep(.12, -.33, surface));
  }
  return tint;
}

function faceColor(kind: BirdKind, angle: number, z: number, height: number): THREE.Color {
  const { colors, eye, eyeRadius } = forms[kind];
  const y = Math.sin(angle);
  const tint = mix(colors.cheek, colors.crown, smoothstep(.03, .78, y));
  tint.lerp(new THREE.Color(colors.throat), smoothstep(-.02, -.86, y));
  const orbit = Math.hypot((z - eye[1]) * .94, height - eye[0]) / eyeRadius;
  const orbitalColor = kind === 'whiteEye' ? 0xeee9d9 : kind === 'gull' ? 0x9a5949 : 0x665f4b;
  if (Math.abs(Math.cos(angle)) > .29) {
    tint.lerp(new THREE.Color(orbitalColor), smoothstep(1.15, .90, orbit));
  }
  if (kind === 'bushWarbler' || kind === 'duck') {
    const brow = height - (.112 + (z - .13) * .17);
    const browLength = smoothstep(.018, .066, z) * smoothstep(.215, .172, z);
    tint.lerp(new THREE.Color(kind === 'duck' ? 0xd0c7ac : 0xcbbc97),
      (1 - smoothstep(.010, .022, Math.abs(brow))) * browLength * .94);
    if (kind === 'duck') {
      const stripe = height - (.125 + (z - .12) * .08);
      tint.lerp(new THREE.Color(0x43392f), (1 - smoothstep(.010, .021, Math.abs(stripe))) * browLength * .81);
    }
  }
  return tint;
}

function billColor(kind: BirdKind, z: number, lower: boolean): THREE.Color {
  const { colors } = forms[kind];
  const joint = kind === 'duck' ? smoothstep(.289, .309, z) : smoothstep(.24, .414, z);
  const tint = mix(colors.bill, colors.tip, joint);
  if (kind === 'gull') {
    tint.lerp(new THREE.Color(0xc9aa45), smoothstep(.33, .2, z));
    tint.lerp(new THREE.Color(0x302825), smoothstep(.342, .365, z) * smoothstep(.396, .378, z));
  }
  return tint.multiplyScalar(lower ? .77 : 1);
}

function feet(form: BirdForm, webbed: boolean): THREE.BufferGeometry {
  const { colors, shin } = form;
  const heel: Point = [0, -shin * .47, -.064];
  const ankle: Point = [.001, -shin + .018, -.017];
  const parts = [
    oval([0, -.018, 0], [.029, .064, .038], colors.side),
    rod([0, 0, .013], heel, .017, .015, colors.foot),
    rod(heel, ankle, .0135, .011, colors.foot),
  ];
  const toeTips: Point[] = [];
  for (const [i, toeX] of [-.044, 0, .044].entries()) {
    const tip: Point = [toeX, -shin + .006, i === 1 ? .086 : .063];
    const joint: Point = [toeX * .60, -shin + .014, .031];
    parts.push(rod(ankle, joint, .010, .0065, colors.foot), rod(joint, tip, .0065, .0039, colors.foot));
    parts.push(rod(tip, [toeX * 1.06, -shin + .001, tip[2] + .014], .0038, .0009, 0x61554c));
    toeTips.push(tip);
  }
  if (webbed) {
    const web = new THREE.BufferGeometry();
    web.setAttribute('position', new THREE.Float32BufferAttribute([ankle, ...toeTips].flat(), 3));
    web.setIndex([0, 1, 2, 0, 2, 3]);
    web.computeVertexNormals();
    parts.push(pigmented(web, () => new THREE.Color(colors.foot).multiplyScalar(.89)));
  } else {
    const back: Point = [-.016, -shin + .004, -.083];
    parts.push(rod(ankle, back, .008, .0044, colors.foot), rod(back, [-.018, -shin, -.099], .0044, .0014, 0x61554c));
  }
  return mergeGeometries(parts);
}

function foldedWing(kind: BirdKind, sign: number): THREE.BufferGeometry[] {
  const { colors, folded: [nearY, nearZ, tipY, tipZ] } = forms[kind];
  const width = .105;
  const cover = feather([0, nearY - .069, nearZ + .057], [0, tipY, tipZ], [0, 1, 0], width, 0, (u, v) => {
    const edge = smoothstep(.88, 1, Math.abs(v));
    const band = Math.cos(u * 55 - Math.cos(v * 30 + u * 5) * .73);
    const margin = .37 * smoothstep(.60, 1, band) * smoothstep(0, .15, u);
    const tint = mix(colors.wing, colors.quill, smoothstep(.59, .96, u) * (kind === 'gull' ? .96 : .52));
    tint.lerp(new THREE.Color(colors.edge), edge * .15 + margin + smoothstep(.92, .998, u) * .20);
    return tint;
  }, 36, 16);
  const layers: THREE.BufferGeometry[] = [cover];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const y = THREE.MathUtils.lerp(nearY + .002, nearY - .137, t);
      const z = THREE.MathUtils.lerp(nearZ - .105, tipZ + .133, row / 3) - t * .052;
      const end = Math.max(tipZ + t * .078, z - .185);
      layers.push(feather([0, y, z], [0, THREE.MathUtils.lerp(y, tipY, row * .10) - .03, end], [0, 1, 0],
        .0180 - row * .0009, 0, (u, v) => {
          const shade = .15 * row + .17 * smoothstep(.4, .98, u);
          const rim = smoothstep(.65, 1, Math.abs(v)) * .22 + smoothstep(.85, 1, u) * .29;
          const tint = mix(colors.wing, colors.quill, shade)
            .lerp(new THREE.Color(colors.edge), rim);
          if (kind === 'duck' && row === 2 && i >= 2 && i <= 4) {
            tint.lerp(new THREE.Color(0x535981), smoothstep(.20, .50, u) * smoothstep(.99, .86, u) * .85);
          }
          return tint;
        }));
    }
  }
  for (const [index, layer] of layers.entries()) {
    const stride = index === 0 ? 17 : 5;
    const points = layer.getAttribute('position');
    for (let i = 0; i < points.count; i++) {
      const y = points.getY(i), z = points.getZ(i);
      const u = (z - nearZ) / (tipZ - nearZ);
      const outside = THREE.MathUtils.lerp(.088, .033, smoothstep(.32, 1, u));
      const span = Math.max(outside, skinWidth(forms[kind].body, z, y) - .004);
      const across = (i % stride) / (stride - 1);
      const soft = Math.sin(across * Math.PI) * (index === 0 ? .011 : .014);
      points.setX(i, sign * (span + soft + (index ? .008 - Math.floor((index - 1) / 6) * .002 : 0)));
    }
    layer.computeVertexNormals();
  }
  return layers;
}

// Each wing has a shoulder and a wrist pivot. Secondaries follow the arm.
// The primaries fan out on the hand and keep the outline visible through the stroke.
function wing(kind: BirdKind, sign: number, hand: boolean): THREE.BufferGeometry {
  const form = forms[kind];
  const { colors } = form;
  const start = form.wing[hand ? 1 : 0], end = form.wing[hand ? 2 : 1];
  const span = end[0] - start[0];
  const geometries: THREE.BufferGeometry[] = [];
  geometries.push(feather([0, .003, start[2] * .18], [sign * span, .002, end[1] - start[1]], [0, 0, 1],
    start[2] * .47, .016, (u, v) => mix(colors.wing, colors.quill,
      (hand ? .68 : .08) + .16 * u + .18 * smoothstep(.05, .96, -v))));
  const layers = hand ? 2 : 3;
  for (let row = 0; row < layers; row++) {
    const length = row === 0 ? 1 : row === 1 ? .62 : .37;
    const count = hand ? 9 : 11;
    for (let i = 0; i < count; i++) {
      const f = i / (count - 1);
      const sweep = hand ? .23 * f + .025 : .025 + f * .043;
      const x = span * f, z = THREE.MathUtils.lerp(start[1], end[1], f) - start[1];
      const chord = THREE.MathUtils.lerp(start[2], end[2], f);
      const pad = row * .021;
      const tipX = sign * (hand ? x + sweep * length : x + span * .13);
      const leadingZ = z + chord * .49;
      const trailingZ = z - chord * .67 - (hand ? .11 * (1 - f) : .02);
      geometries.push(feather([sign * x, .011 + pad - f * .02, leadingZ],
        [tipX, -.026 * f + pad, THREE.MathUtils.lerp(leadingZ, trailingZ, length)], [1, .1 * sign, 0],
        Math.max(span / count * 1.07, .018) * (row > 0 ? .89 : 1), .026 * (1 - .42 * f), (u, v) => {
          const split = hand ? smoothstep(.9, .15, f) * .2 : .13;
          const primary = row === 0 && hand ? .92 - split : split + .22 * u;
          const paleEdge = smoothstep(.71, 1, Math.abs(v)) * .2 + smoothstep(.94, 1, u) * (kind === 'gull' && hand ? .14 : .34);
          const tint = mix(colors.wing, colors.quill, primary).lerp(new THREE.Color(colors.edge), paleEdge);
          if (kind === 'duck' && row === 0 && !hand && f > .32) {
            tint.lerp(new THREE.Color(0x4c577d), smoothstep(.43, .57, u) * smoothstep(.9, .82, u));
          }
          return tint;
        }));
    }
  }
  return mergeGeometries(geometries);
}

function tail(kind: BirdKind): THREE.BufferGeometry {
  const { colors, tail: [start, end, width, pitch] } = forms[kind];
  return mergeGeometries(Array.from({ length: 10 }, (_, i) => {
    const fan = (i - 4.5) / 4.5;
    return feather([fan * width * .32, .018 + .014 * (1 - Math.abs(fan)), start],
      [fan * width, pitch, end + Math.abs(fan) ** 2 * .036], [1, 0, 0],
      width * .196, .014, (u, v) => {
        if (kind === 'gull') {
          return mix(colors.belly, colors.quill, smoothstep(.48, .64, u) * smoothstep(.98, .883, u));
        }
        return mix(colors.wing, colors.quill, .38 + u * .32).lerp(new THREE.Color(colors.edge), Math.abs(v) * .18);
      });
  }));
}

function createBlueprint(kind: BirdKind) {
  const form = forms[kind];
  const { colors, eye: [eyeY, eyeZ], eyeRadius } = form;
  const body = loft(form.body, (angle, z) => plumageColor(kind, angle, z), 38, 60);
  const head = [loft(form.head, (angle, z, y) => faceColor(kind, angle, z, y), 54, 58)];
  const eyes: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const radius = eyeRadius;
    const [x, y, z]: Point = [side * skinWidth(form.head, eyeZ, eyeY), eyeY, eyeZ];
    eyes.push(oval([x + side * radius * .01, y, z], [radius * .29, radius * .72, radius * .74], colors.eye));
    const pupil = kind === 'gull' ? .43 : .81;
    eyes.push(oval([x + side * radius * .225, y + radius * .06, z + radius * .098],
      [radius * .097, radius * .72 * pupil, radius * .73 * pupil], 0x111210));
    eyes.push(oval([x + side * radius * .3, y + radius * .27, z + radius * .20],
      [radius * .024, radius * .090, radius * .082], 0xc6c8b8));
    if (kind === 'gull' || kind === 'duck') {
      const [billZ, billY, billW] = form.bill[1];
      head.push(oval([side * billW * .93, billY + .011, billZ + .008], [.0029, .0059, .009], 0x37312c));
    }
  }
  const lowerBill = form.bill.map(([z, y, w, h]): Section => [z, y - .006, w * .979, h * .62]);
  const flange = new THREE.PlaneGeometry(.046, .1, 1, 3).rotateX(Math.PI / 2)
    .translate(0, form.bill[0][1] - .004, form.bill[0][0] + .028);
  flange.deleteAttribute('uv');
  return {
    body, head: mergeGeometries(head), eyes: mergeGeometries(eyes),
    bill: loft(form.bill, (_angle, z) => billColor(kind, z, false), 16, 32, 1),
    lowerBill: mergeGeometries([loft(lowerBill, (_angle, z) => billColor(kind, z, true), 16, 32, -1),
      pigmented(flange, () => new THREE.Color(0x42332c))]),
    feet: feet(form, kind === 'gull' || kind === 'duck'),
    tail: tail(kind),
    folded: mergeGeometries([-1, 1].flatMap(side => foldedWing(kind, side))),
    arms: [-1, 1].map(side => wing(kind, side, false)),
    hands: [-1, 1].map(side => wing(kind, side, true)),
  };
}

const blueprints = new Map<BirdKind, ReturnType<typeof createBlueprint>>();

export function createBirdModel(kind: BirdKind, size: number, materials: ReturnType<typeof createBirdMaterials>) {
  let shape = blueprints.get(kind);
  if (!shape) {
    shape = createBlueprint(kind);
    blueprints.set(kind, shape);
  }
  const form = forms[kind];
  const { plumage, bare, iris } = materials;
  const root = new THREE.Group();
  const body = new THREE.Group();
  const head = new THREE.Group();
  const jaw = new THREE.Group();
  const billTip = new THREE.Object3D();
  const folded = new THREE.Mesh(shape.folded, plumage);
  const tail = new THREE.Mesh(shape.tail, plumage);
  const bodyMesh = new THREE.Mesh(shape.body, plumage);
  const scale = size * form.lengthScale;
  root.name = kind;
  root.scale.setScalar(scale);
  const headMesh = new THREE.Mesh(shape.head, plumage);
  const eyes = new THREE.Mesh(shape.eyes, iris);
  const bill = new THREE.Mesh(shape.bill, plumage);
  const lower = new THREE.Mesh(shape.lowerBill, plumage);
  jaw.position.set(0, form.bill[0][1], form.bill[0][0]);
  lower.position.copy(jaw.position).negate();
  head.position.set(...form.headOrigin);
  const [tipZ, tipY] = form.bill[form.bill.length - 1];
  billTip.position.set(0, tipY, tipZ);
  head.add(headMesh, eyes, bill, jaw, billTip);
  jaw.add(lower);
  body.add(bodyMesh, head, tail, folded);
  root.add(body);
  const legs = [-1, 1].map(side => {
    const mesh = new THREE.Mesh(shape.feet, bare);
    mesh.position.set(side * form.leg[0], form.leg[1], form.leg[2]);
    root.add(mesh);
    return mesh;
  });
  const wings = [-1, 1].map((side, index) => {
    const arm = new THREE.Mesh(shape.arms[index], plumage);
    const hand = new THREE.Mesh(shape.hands[index], plumage);
    arm.position.set(side * form.wing[0][0], .035, form.wing[0][1]);
    hand.position.set(side * (form.wing[1][0] - form.wing[0][0]), 0, form.wing[1][1] - form.wing[0][1]);
    arm.add(hand);
    body.add(arm);
    return { side, arm, hand };
  });
  return { root, body, head, jaw, billTip, tail, folded, wings, legs, standingY: (form.shin - form.leg[1]) * scale };
}

export type CoastBirdModel = ReturnType<typeof createBirdModel>;
