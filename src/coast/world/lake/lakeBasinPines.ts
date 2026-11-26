import { Color, DoubleSide, Mesh, MeshStandardMaterial, Vector3, type Group } from 'three';
import { coastRandom } from '../../terrain';
import { addStem, GOLDEN_ANGLE, plantDirection, PlantSurface } from '../coastTreeMeshes';

export type LakePine = {
  x: number;
  y: number;
  z: number;
  height: number;
  spread: number;
  yaw: number;
  seed: number;
};

const up = new Vector3(0, 1, 0);
const bark = new Color(0x5c4e39);
const needle = new Color(0x496039);
const spring = new Color(0x9ba75d);

function addNeedlePad(surface: PlantSurface, center: Vector3, axis: Vector3, across: Vector3,
  length: number, breadth: number, depth: number, tint: Color, seed: number, detailed: boolean): void {
  const random = coastRandom(seed);
  const n = detailed ? 8 : 6;
  const lower: number[] = [];
  const rim: number[] = [];
  const upper: number[] = [];
  const point = new Vector3();
  const shade = 0.73 + random() * 0.42;
  const top = surface.point(point.copy(center).addScaledVector(up, depth * 0.84)
    .addScaledVector(axis, length * 0.17), tint, shade * 1.12);
  const base = surface.point(point.copy(center).addScaledVector(up, -depth * 0.51), tint, shade * 0.48);
  for (let i = 0; i < n; i += 1) {
    const angle = i / n * 2 * Math.PI;
    const x = Math.cos(angle) * length * (0.65 + 0.51 * random());
    const z = Math.sin(angle) * breadth * (0.69 + 0.51 * random());
    const y = (random() - 0.48) * depth * 0.48;
    lower.push(surface.point(point.copy(center).addScaledVector(axis, x * 0.70)
      .addScaledVector(across, z * 0.66).addScaledVector(up, y - depth * 0.38), tint, shade * 0.57));
    rim.push(surface.point(point.copy(center).addScaledVector(axis, x)
      .addScaledVector(across, z).addScaledVector(up, y), tint, shade * (0.72 + 0.35 * random())));
    upper.push(surface.point(point.copy(center).addScaledVector(axis, x * 0.64 + length * 0.10)
      .addScaledVector(across, z * 0.72).addScaledVector(up, y + depth * (0.54 + 0.25 * random())),
    tint, shade * (0.91 + 0.32 * random())));
  }
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    surface.triangle(base, lower[i], lower[j]);
    surface.triangle(lower[i], rim[i], lower[j]);
    surface.triangle(lower[j], rim[i], rim[j]);
    surface.triangle(rim[i], upper[i], rim[j]);
    surface.triangle(rim[j], upper[i], upper[j]);
    surface.triangle(top, upper[j], upper[i]);
  }
  if (!detailed) return;
  // Sparse, tapered sprays break up the outline of each bough at the closest views.
  const start = new Vector3();
  for (let spray = 0; spray < 9; spray += 1) {
    const angle = spray * GOLDEN_ANGLE + random() * 0.58;
    const radius = 0.63 + 0.41 * random();
    const x = Math.cos(angle) * length * radius;
    const z = Math.sin(angle) * breadth * radius;
    start.copy(center).addScaledVector(axis, x).addScaledVector(across, z)
      .addScaledVector(up, depth * (0.23 + 0.56 * random()));
    for (let fan = 0; fan < 2; fan += 1) {
      const direction = angle + 0.54 * (fan - 0.5);
      const reach = length * (0.16 + random() * 0.24);
      const dx = Math.cos(direction) * reach;
      const dz = Math.sin(direction) * reach;
      const breadth = reach * 0.11;
      const a = surface.point(point.copy(start).addScaledVector(axis, breadth), tint, shade * 0.75);
      const b = surface.point(point.copy(start).addScaledVector(across, breadth), tint, shade * 0.91);
      const c = surface.point(point.copy(start).addScaledVector(axis, dx).addScaledVector(across, dz)
        .addScaledVector(up, depth * (0.22 + random() * 0.72)), tint, shade * (0.98 + 0.53 * random()));
      surface.triangle(a, b, c);
    }
  }
}

function growPine(wood: PlantSurface, needles: PlantSurface, pine: LakePine): void {
  const { x, y, z, height, spread, yaw, seed } = pine;
  const random = coastRandom(seed);
  const origin = new Vector3(x, y, z);
  const sway = plantDirection(yaw);
  const transverse = plantDirection(yaw + Math.PI * 0.5);
  const lean = (0.12 + random() * 0.16) * height;
  const trunk = (t: number) => origin.clone().addScaledVector(up, t * height)
    .addScaledVector(sway, lean * (t ** 2 + 0.22 * Math.sin(t * 6.0)))
    .addScaledVector(transverse, height * Math.sin(t * 4.5) * 0.073 * t);
  const close = z > -86 && seed < 100;
  const thick = height * (0.041 + random() * 0.014);
  const levels = [-0.085, 0, 0.10, 0.24, 0.43, 0.59, 0.76, 0.87, 1.0];
  addStem(wood, { points: levels.map(trunk), radii: [1.25, 1.40, 0.88, 0.75, 0.62, 0.48, 0.31, 0.14, 0.018]
    .map(radius => thick * radius) }, bark, close ? 8 : 5, yaw);

  const branches = close ? 9 : height > 2.1 ? 7 : 4;
  const tint = new Color();
  for (let branch = 0; branch < branches; branch += 1) {
    const level = branch / (branches - 1);
    const heightAt = Math.min(0.96, 0.36 + 0.57 * level + (random() - 0.5) * 0.13);
    const base = trunk(heightAt);
    const angle = yaw + branch * GOLDEN_ANGLE + (random() - 0.5) * 0.48;
    const axis = plantDirection(angle);
    const across = plantDirection(angle + Math.PI * 0.5);
    const reach = spread * (0.53 + 0.42 * random()) * (1.03 - 0.66 * level ** 2);
    const crooked = (random() - 0.5) * reach * 0.45;
    const rise = height * (0.06 + random() * 0.095) * (1 - 0.59 * level);
    const limb = (t: number) => base.clone().addScaledVector(axis, reach * t)
      .addScaledVector(across, Math.sin(t * 2.84) * crooked)
      .addScaledVector(up, (0.81 * t + 0.16 * Math.sin(t * 4.72)) * rise);
    const branchRadius = thick * (0.53 - 0.27 * level);
    addStem(wood, { points: [0, 0.27, 0.57, 0.82, 1].map(limb),
      radii: [1, 0.76, 0.42, 0.26, 0.033].map(radius => branchRadius * radius) }, bark, close ? 6 : 4, angle);
    const shoots = close ? 5 : height > 2.1 ? 4 : 3;
    for (let bough = 0; bough < shoots; bough += 1) {
      const fraction = 0.33 + 0.65 * bough / (shoots - 1);
      const junction = limb(fraction);
      const fanAngle = angle + (bough % 2 ? -1 : 1) * (0.49 + random() * 0.79);
      const fan = plantDirection(fanAngle);
      const fanAcross = plantDirection(fanAngle + Math.PI * 0.5);
      const extent = spread * (0.16 + random() * 0.17) * (0.98 - 0.51 * level);
      const mid = junction.clone().addScaledVector(fan, extent * 0.60).addScaledVector(up, height * 0.023);
      const end = mid.clone().addScaledVector(fan, extent * 0.51).addScaledVector(up, height * 0.012);
      addStem(wood, { points: [junction, mid, end], radii: [branchRadius * 0.38, branchRadius * 0.16, 0.007] },
        bark, close ? 5 : 3, fanAngle);
      const padCount = 2;
      for (let cluster = 0; cluster < padCount; cluster += 1) {
        const padCenter = mid.clone().lerp(end, cluster / (padCount - 1))
          .addScaledVector(fanAcross, extent * (random() - 0.5) * 0.72)
          .addScaledVector(up, height * (0.003 + random() * 0.030));
        const size = extent * (0.47 + random() * 0.45);
        tint.copy(needle).lerp(spring, (0.08 + random() * 0.42) * (0.81 + 0.21 * level));
        addNeedlePad(needles, padCenter, fan, fanAcross, size, size * (0.52 + random() * 0.34),
          height * (0.030 + random() * 0.031), tint, seed * 101 + branch * 171 + bough * 73 + cluster * 3, close);
      }
    }
  }
}

export function addLakeBankPines(root: Group, pines: readonly LakePine[]): void {
  const barkMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
  const needleMaterial = new MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, side: DoubleSide,
  });
  const stands = [
    { name: 'West bank', wood: new PlantSurface(), needles: new PlantSurface() },
    { name: 'East bank', wood: new PlantSurface(), needles: new PlantSurface() },
    { name: 'Distant ridge', wood: new PlantSurface(), needles: new PlantSurface() },
  ];
  for (const pine of pines) {
    const stand = stands[pine.z < -260 ? 2 : pine.x < 0 ? 0 : 1];
    growPine(stand.wood, stand.needles, pine);
  }
  for (const { name, wood, needles } of stands) {
    const trunks = new Mesh(wood.geometry(), barkMaterial);
    trunks.name = `${name} pine trunks and limbs`;
    const crowns = new Mesh(needles.geometry(), needleMaterial);
    crowns.name = `${name} pine boughs and needle sprays`;
    root.add(trunks, crowns);
  }
}
