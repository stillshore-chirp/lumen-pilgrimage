import * as THREE from 'three';
import { coastRandom } from '../terrain';
import { addStem, GOLDEN_ANGLE, plantDirection, PlantSurface } from './coastTreeMeshes';

export const floorForms = ['swordFern', 'birdnest', 'shieldLeaf', 'heliconia', 'sedge', 'grass'] as const;
export type FloorForm = typeof floorForms[number];
type BladeCurve = (t: number) => THREE.Vector3;
type BladeShape = (t: number) => number;

const up = new THREE.Vector3(0, 1, 0);
const greenStem = new THREE.Color(0x5e7134);
const fernStem = new THREE.Color(0x7e8044);
const colors = {
  swordFern: [0x416426, 0x517c31, 0x678742],
  birdnest: [0x49692d, 0x5e8236, 0x759046],
  shieldLeaf: [0x355a39, 0x4c743e, 0x5a7e3c],
  heliconia: [0x3b622b, 0x557b35, 0x717f38],
  sedge: [0x587436, 0x617b36, 0x87894a],
  grass: [0x517743, 0x657d41, 0x8e8c4e],
};

function addLamina(surface: PlantSurface, curve: BladeCurve, width: BladeShape, steps: readonly number[],
  green: THREE.Color, handedness: number, stiffness: number, baseShade = 0.76): void {
  let previous: number[] = [];
  const across = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (const t of steps) {
    const center = curve(t);
    const tangent = curve(Math.min(1, t + 0.02)).sub(curve(Math.max(0, t - 0.02))).normalize();
    across.crossVectors(tangent, up).normalize();
    normal.crossVectors(across, tangent).normalize();
    const halfWidth = Math.max(0, width(t));
    const curled = handedness * Math.sin(t * 3.1 + 0.18) * 0.40;
    const shade = THREE.MathUtils.lerp(baseShade, 1.15, t ** 0.68);
    const centerIndex = surface.point(center, green, shade * 1.06, 0.5, t);
    const sidePoint = (sign: number) => surface.point(center.clone()
      .addScaledVector(across, sign * halfWidth * (1 + sign * handedness * 0.09))
      .addScaledVector(normal, halfWidth * (-stiffness + sign * curled)), green,
    shade * (0.91 + sign * handedness * 0.10), sign > 0 ? 1 : 0, t);
    const row = halfWidth > 0.00001 ? [sidePoint(-1), centerIndex, sidePoint(1)] : [centerIndex, centerIndex, centerIndex];
    if (previous.length) {
      for (let segment = 0; segment < 2; segment += 1) {
        if (previous[segment] !== previous[segment + 1]) {
          surface.triangle(previous[segment], row[segment], previous[segment + 1]);
        }
        if (row[segment] !== row[segment + 1]) {
          surface.triangle(previous[segment + 1], row[segment], row[segment + 1]);
        }
      }
    }
    previous = row;
  }
}

function simpleLeaf(t: number): number {
  return Math.sin(t * Math.PI) ** 0.83 * (1.09 - 0.29 * t);
}

function fern(surface: PlantSurface, random: () => number, near: boolean): void {
  const baseColor = new THREE.Color();
  const frondCount = 8;
  for (let stem = 0; stem < frondCount; stem += 1) {
    const angle = stem * GOLDEN_ANGLE + (random() - .5) * .84;
    const out = plantDirection(angle);
    const side = plantDirection(angle + Math.PI * .5);
    const extent = .52 + random() * .53;
    const lift = .27 + random() * .49;
    const curl = .13 + random() * .38;
    const bend = (random() - .5) * .31;
    const green = baseColor.setHex(colors.swordFern[stem % 3]);
    const rachis = (t: number) => out.clone().multiplyScalar(.04 + extent * t ** 1.26)
      .addScaledVector(side, t * t * extent * bend)
      .addScaledVector(up, lift * Math.sin(Math.PI * .76 * t) - curl * t ** 2.1 * .38);
    if (near || stem % 3 !== 1) {
      const points = [0, .21, .43, .65, .83, 1].map(rachis);
      addStem(surface, { points, radii: [.012, .010, .0075, .0053, .0035, .001] }, fernStem, 3, angle, 1.21);
    }
    const count = 11;
    for (let pair = 0; pair < count; pair += 1) {
      const t = .20 + pair / count * .76;
      const spread = extent * (0.06 + 0.23 * Math.sin(Math.PI * (t - .05)) ** .92) * (1.05 - t * .46);
      for (const sign of [-1, 1]) {
        const where = t + sign * .012;
        const start = rachis(where);
        const length = spread * (.84 + random() * .27);
        const twist = (random() - .48) * .99;
        const liftTip = length * (-.14 + random() * .38);
        const curve = (u: number) => start.clone().addScaledVector(side, sign * length * u)
          .addScaledVector(out, length * (.28 + 0.72 * where) * u * u)
          .addScaledVector(up, liftTip * u - length * .20 * u * u);
        if (!near && (stem % 3 === 1 || pair % 2 !== 0)) continue;
        addLamina(surface, curve, u => u === 1 ? 0 : length * (near ? .16 : .22) * Math.sin(u * Math.PI) ** .61,
          near ? [0, .28, .59, .80, 1] : [0, .43, 1], green, twist, .24, .59);
      }
    }
  }
}

function rosette(surface: PlantSurface, form: 'birdnest' | 'shieldLeaf' | 'heliconia',
  random: () => number, near: boolean): void {
  const color = new THREE.Color();
  const count = form === 'heliconia' ? 7 : form === 'shieldLeaf' ? 8 : 11;
  for (let stem = 0; stem < count; stem += 1) {
    const angle = stem * GOLDEN_ANGLE + (random() - .5) * .54;
    const out = plantDirection(angle);
    const sideways = plantDirection(angle + Math.PI * .5);
    const lift = .41 + random() * .63;
    const reach = .52 + random() * .47;
    const curl = .14 + random() * .45;
    const width = reach * (.65 + random() * .42) * (form === 'birdnest' ? .14 : form === 'shieldLeaf' ? .32 : .24);
    const twist = (random() - .5) * 1.43;
    const drift = (random() - .5) * .25;
    const edgeSeed = random() * Math.PI * 2;
    if (!near && stem > 4 && stem % 2 === 1) continue;
    const root = out.clone().multiplyScalar(.04 + .046 * stem / count);
    const shoulder = out.clone().multiplyScalar(reach * (form === 'birdnest' ? .1 : .35))
      .setY(lift * (form === 'birdnest' ? .21 : form === 'shieldLeaf' ? .70 : .89));
    const green = color.setHex(colors[form][stem % 3]);
    const nodes = [root, root.clone().lerp(shoulder, .51).addScaledVector(sideways, .035), shoulder];
    if (form !== 'birdnest') {
      addStem(surface, { points: nodes, radii: [.015, .012, .008] }, greenStem, near ? 5 : 3, angle, 1.18);
    }
    const curve = (t: number) => shoulder.clone()
      .addScaledVector(out, reach * t ** 1.17 * (form === 'birdnest' ? 1 : .74))
      .addScaledVector(up, Math.sin(Math.PI * .71 * t) * lift * (form === 'birdnest' ? .84 : .42) - curl * t ** 2.6)
      .addScaledVector(sideways, drift * t * t);
    const outline = (t: number) => {
      if (t === 0 || t === 1) return 0;
      const ripple = 1 + (near ? .12 : .045) * Math.sin(t * 38 + edgeSeed);
      const torn = form === 'heliconia' && near && stem % 3 !== 1 && (t === .56 || t === .80) ? .65 : 1;
      const profile = form === 'shieldLeaf' ? Math.sin(Math.PI * t ** .72) ** .78 : simpleLeaf(t);
      return width * profile * ripple * torn;
    };
    const steps = near ? [0, .11, .23, .34, .46, .56, .62, .72, .80, .88, .95, 1] : [0, .21, .46, .68, .86, 1];
    addLamina(surface, curve, outline, steps, green, twist, form === 'shieldLeaf' ? .25 : .41,
      form === 'birdnest' ? .54 : .74);
  }
}

function grass(surface: PlantSurface, form: 'sedge' | 'grass', random: () => number, near: boolean): void {
  const color = new THREE.Color();
  const sedge = form === 'sedge';
  const count = sedge ? 16 : 21;
  for (let blade = 0; blade < count; blade += 1) {
    const angle = blade * GOLDEN_ANGLE + (random() - 0.5) * 1.42;
    const out = plantDirection(angle);
    const side = plantDirection(angle + Math.PI * .5);
    const width = (sedge ? .022 : .016) * (0.73 + random() * 1.07);
    const rise = (sedge ? .63 : .49) * (.43 + random() * .72);
    const arch = (sedge ? .54 : .42) * (.51 + random() * .69);
    const root = out.clone().multiplyScalar(.035 + random() * .18);
    const twist = (random() - .53) * .57;
    const green = color.setHex(colors[form][blade % 3]).multiplyScalar(.79 + random() * .34);
    const droop = (.10 + random() * .22) * rise;
    const curve = (t: number) => root.clone().addScaledVector(out, arch * t ** 1.74)
      .addScaledVector(side, twist * arch * t * t)
      .addScaledVector(up, rise * Math.sin(t * Math.PI * .60) - droop * t ** 2.8);
    if (!near && blade % 2 !== 0) continue;
    addLamina(surface, curve, t => t === 1 ? 0 : width * (near ? 1 : 1.35) * (1.02 - t ** 1.3) * (.50 + t * .73),
      near ? [0, .24, .50, .74, .89, 1] : [0, .39, .75, 1], green, twist, .40, .35);
  }
}

export function createFloorModel(form: FloorForm, near: boolean): THREE.BufferGeometry {
  const surface = new PlantSurface(true);
  const random = coastRandom(10348 + floorForms.indexOf(form) * 73111);
  if (form === 'swordFern') fern(surface, random, near);
  else if (form === 'grass' || form === 'sedge') grass(surface, form, random, near);
  else rosette(surface, form, random, near);
  return surface.geometry();
}

export function createPalmCrown(near: boolean): THREE.BufferGeometry {
  const random = coastRandom(778301);
  const surface = new PlantSurface(true);
  const palette = [0x526b32, 0x5c7535, 0x748944, 0x4f6d36];
  const color = new THREE.Color();
  for (let frond = 0; frond < 13; frond += 1) {
    const angle = frond * GOLDEN_ANGLE + (random() - .5) * .50;
    const radial = plantDirection(angle);
    const side = plantDirection(angle + Math.PI * .5);
    const reach = .37 + random() * .39;
    const lift = .10 + random() * .26;
    const bend = .08 + random() * .27;
    const sway = (random() - .36) * .17;
    const green = color.setHex(palette[frond % palette.length]);
    const curve = (t: number) => new THREE.Vector3(.16, 1 + lift * Math.sin(Math.PI * .91 * t) - bend * t * t, .004)
      .addScaledVector(radial, t * reach).addScaledVector(side, sway * t ** 2);
    if (near || frond % 3 !== 1) {
      addStem(surface, { points: [0, .18, .36, .55, .72, .86, 1].map(curve),
        radii: [.012, .010, .008, .0065, .0045, .0028, .001] }, fernStem, 3, angle, 1.22);
    }
    for (let joint = 1; joint <= 18; joint += 1) {
      const t = joint / 19;
      const extension = Math.sin(t * Math.PI) ** .81 * (.095 + reach * .155);
      for (const sign of [-1, 1]) {
        const where = t + .008 * sign;
        const start = curve(where);
        const length = extension * (.80 + random() * .46);
        const drop = .21 + random() * .39;
        if (!near && (joint % 2 !== 0 || frond % 3 === 1)) continue;
        const leaflet = (u: number) => start.clone().addScaledVector(side, sign * length * u)
          .addScaledVector(radial, length * (.32 + .26 * t) * u * u)
          .addScaledVector(up, -length * drop * u ** 1.48);
        addLamina(surface, leaflet, u => u === 1 ? 0 : length * (near ? .112 : .158) * simpleLeaf(u),
          near ? [0, .28, .52, .74, 1] : [0, .42, 1], green, sign * .43, .27, .59);
      }
    }
  }
  return surface.geometry();
}
