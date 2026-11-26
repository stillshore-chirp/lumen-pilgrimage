import {
  Color, DoubleSide, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial,
  RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type Group, type Texture,
} from 'three';
import { coastRandom } from '../../terrain';
import { GOLDEN_ANGLE, plantDirection, PlantSurface } from '../coastTreeMeshes';

export type LakePine = {
  x: number;
  y: number;
  z: number;
  height: number;
  spread: number;
  yaw: number;
  seed: number;
  form?: 'broad';
  windYaw?: number;
};

type PineSurface = { wood: PlantSurface; needles: PlantSurface };
type BoughTile = { left: number; top: number; right: number; bottom: number; stem: number };

const up = new Vector3(0, 1, 0);
const xAxis = new Vector3(1, 0, 0);
const barkTint = new Color(0xc5beb3);
const needleTint = new Color(0xe9f2e7);
const tau = Math.PI * 2;
const atlasSize = 1254;
const boughTiles: readonly BoughTile[] = [
  { left: 39, top: 123, right: 609, bottom: 560, stem: 366 },
  { left: 633, top: 122, right: 1222, bottom: 529, stem: 417 },
  { left: 39, top: 784, right: 629, bottom: 1113, stem: 948 },
  { left: 633, top: 675, right: 1215, bottom: 1136, stem: 1009 },
];

// Bark follows the stem's local frame. Longitudinal fissures stay aligned through curved forks.
function addPineStem(surface: PlantSurface, points: readonly Vector3[], radii: readonly number[],
  sides: number, phase: number): void {
  const facing = new Vector3();
  const across = new Vector3();
  let previous: number[] = [];
  let distance = 0;
  const tilesAround = Math.max(1, Math.round(radii[0] * tau / 0.70));
  for (let ring = 0; ring < points.length; ring += 1) {
    const center = points[ring];
    const tangent = points[Math.min(ring + 1, points.length - 1)].clone()
      .sub(points[Math.max(ring - 1, 0)]).normalize();
    facing.addScaledVector(tangent, -facing.dot(tangent));
    if (facing.lengthSq() < 0.0001) facing.crossVectors(tangent, Math.abs(tangent.y) > 0.8 ? xAxis : up);
    facing.normalize();
    across.crossVectors(tangent, facing);
    if (ring > 0) distance += center.distanceTo(points[ring - 1]);
    const current: number[] = [];
    for (let side = 0; side <= sides; side += 1) {
      const fraction = side / sides;
      const angle = fraction * tau;
      const relief = Math.sin(angle * 3 + phase) * 0.10 + Math.sin(angle * 5 - phase + distance * 0.67) * 0.075;
      const radius = radii[ring] * (1 + relief);
      const point = center.clone().addScaledVector(facing, Math.cos(angle) * radius)
        .addScaledVector(across, Math.sin(angle) * radius);
      current.push(surface.point(point, barkTint, 0.82 + relief,
        phase * 0.14 + fraction * tilesAround, phase * 0.19 + distance / 0.70));
    }
    for (let side = 0; side < sides && ring > 0; side += 1) {
      surface.triangle(previous[side], previous[side + 1], current[side]);
      surface.triangle(previous[side + 1], current[side + 1], current[side]);
    }
    previous = current;
  }
}

function addBough(surface: PlantSurface, base: Vector3, end: Vector3, tile: BoughTile,
  width: number, fullness: number, roll: number, bow: number, shade: number): void {
  const axis = end.clone().sub(base).normalize();
  const cross = up.clone().addScaledVector(axis, -up.dot(axis)).normalize().applyAxisAngle(axis, roll);
  const face = new Vector3().crossVectors(axis, cross);
  const height = width * (tile.bottom - tile.top) / (tile.right - tile.left) * fullness;
  const stemHeight = (tile.bottom - tile.stem) / (tile.bottom - tile.top);
  let previous: number[] = [];
  for (const fraction of [0, 0.40, 0.72, 1]) {
    const center = base.clone().addScaledVector(axis, width * (fraction - 0.085));
    const u = (tile.left + fraction * (tile.right - tile.left)) / atlasSize;
    const current = [0, 0.50, 1].map(t => {
      const curve = Math.sin(fraction * Math.PI) * (0.61 + 0.39 * Math.sin(t * Math.PI));
      const point = center.clone().addScaledVector(cross, (t - stemHeight) * height)
        .addScaledVector(face, curve * width * bow);
      return surface.point(point, needleTint, shade * (0.86 + 0.27 * t), u,
        1 - (tile.bottom - t * (tile.bottom - tile.top)) / atlasSize);
    });
    for (let row = 0; row < 2 && previous.length > 0; row += 1) {
      surface.triangle(previous[row], current[row], previous[row + 1]);
      surface.triangle(previous[row + 1], current[row], current[row + 1]);
    }
    previous = current;
  }
}

function growPine({ wood, needles }: PineSurface, pine: LakePine): void {
  const { x, y, z, height, spread, yaw, seed } = pine;
  const random = coastRandom(seed);
  const origin = new Vector3(x, y, z);
  const close = z > -86 && seed < 100;
  const broadCrown = pine.form === 'broad';
  const windHeading = pine.windYaw ?? yaw;
  const wind = plantDirection(windHeading);
  const transverse = plantDirection(windHeading + Math.PI * 0.5);
  const lean = height * (close ? 0.24 + random() * 0.24 : 0.14 + random() * 0.18);
  const bend = height * (random() - 0.5) * 0.31;
  const trunk = (t: number) => origin.clone().addScaledVector(up, t * height)
    .addScaledVector(wind, lean * (t ** 2 + 0.24 * Math.sin(t * 6.9) * t))
    .addScaledVector(transverse, bend * Math.sin(t * 5.1) * Math.min(1, t * 2.3));
  const thick = height * (0.037 + random() * 0.012);
  const trunkLevels = [-0.10, 0, 0.13, 0.28, 0.43, 0.59, 0.75, 0.87, 0.97, 1.01];
  addPineStem(wood, trunkLevels.map(trunk),
    [1.2, 1.42, 0.91, 0.79, 0.64, 0.49, 0.34, 0.23, 0.12, 0.02].map(radius => thick * radius),
    close ? 12 : 5, yaw);

  const branchCount = close ? 9 : height > 2.1 ? 7 : 4;
  for (let branch = 0; branch < branchCount; branch += 1) {
    const level = branch / (branchCount - 1);
    const leader = branch === branchCount - 1;
    const angle = windHeading + branch * GOLDEN_ANGLE + (random() - 0.5) * 0.97;
    const outward = plantDirection(angle).addScaledVector(wind, close ? 0.35 : 0.17).normalize();
    const across = new Vector3().crossVectors(up, outward).normalize();
    // Low forks grow through the middle of the silhouette while some long limbs sag before lifting.
    const fork = close && branch === 2;
    const band = broadCrown ? 0.37 + 0.46 * level : 0.25 + 0.62 * level;
    const heightAt = leader ? 0.84 : band + (random() - 0.46) * 0.20;
    const base = trunk(heightAt);
    const reach = spread * (0.46 + 0.47 * random()) * (1.13 - 0.63 * level ** 1.8);
    const rise = height * (fork ? 0.37 : 0.08 + random() * 0.15) * (1 - level * 0.36);
    const sag = height * (random() - 0.68) * 0.23;
    const crooked = (random() - 0.44) * reach * 0.56;
    const limb = (t: number) => base.clone().addScaledVector(outward, reach * t)
      .addScaledVector(up, rise * t ** 0.86 + sag * Math.sin(t * Math.PI))
      .addScaledVector(across, Math.sin(t * 2.9) * crooked);
    const radius = thick * (fork ? 0.69 : 0.53 - 0.28 * level);
    addPineStem(wood, [0, 0.23, 0.48, 0.71, 1].map(limb),
      [1, 0.74, 0.56, 0.28, 0.035].map(value => radius * value), close ? 7 : 4, angle);

    const shootCount = close ? 6 : height > 2.1 ? 4 : 3;
    for (let shoot = 0; shoot < shootCount; shoot += 1) {
      const fraction = 0.32 + (shoot + random() * 0.70) / shootCount * 0.72;
      const junction = limb(fraction);
      const shootAngle = angle + (shoot % 2 === 0 ? -1 : 1) * (0.39 + random() * 1.07);
      const fan = plantDirection(shootAngle);
      const reach = spread * (0.17 + random() * 0.22) * (1 - level * 0.36);
      const deltaY = height * ((random() - 0.46) * 0.12 + 0.014);
      const middle = junction.clone().addScaledVector(fan, reach * 0.48).addScaledVector(up, deltaY * 0.40);
      const end = junction.clone().addScaledVector(fan, reach).addScaledVector(up, deltaY);
      addPineStem(wood, [junction, middle, end], [radius * 0.34, radius * 0.15, radius * 0.027],
        close ? 4 : 3, shootAngle);

      const lobeWidth = reach * (1.19 + random() * 0.57);
      const tileIndex = Math.floor(random() * boughTiles.length);
      const lowTile = boughTiles[tileIndex < 2 ? 0 : 2];
      const tile = broadCrown && shoot % 3 !== 0 ? lowTile : boughTiles[tileIndex];
      const shade = 0.92 + random() * 0.47;
      const roll = (random() - 0.5) * 1.55;
      addBough(needles, middle, end, tile, lobeWidth, 0.75 + random() * 0.30,
        roll, 0.09 + random() * 0.083, shade);

      // The paired outer sprays cross the first one obliquely and start farther along the shoot.
      // The volume reads from both banks and from below without view-facing billboards.
      const side = shoot % 2 === 0 ? -1 : 1;
      const turn = side * (0.61 + random() * 0.68);
      const outer = end.clone().addScaledVector(plantDirection(shootAngle + turn), reach * 0.65)
        .addScaledVector(up, reach * (random() - 0.19) * 0.62);
      const outerTile = boughTiles[Math.floor(random() * boughTiles.length)];
      const outerBase = middle.clone().lerp(end, 0.55);
      addBough(needles, outerBase, outer, outerTile, lobeWidth * (0.79 + random() * 0.32),
        0.76 + random() * 0.32, roll + (roll < 0 ? 1.05 : -1.05), -0.17, shade * 1.04);

      if (close || height > 4.2) {
        const inner = middle.clone().addScaledVector(plantDirection(shootAngle - turn * 1.19), reach * 0.61)
          .addScaledVector(up, reach * (0.07 + random() * 0.30));
        const innerTile = boughTiles[Math.floor(random() * boughTiles.length)];
        addBough(needles, middle, inner, innerTile, lobeWidth * (0.64 + random() * 0.42),
          0.93, -0.59 * roll, 0.19 * side, shade * 1.12);
      }
      if (broadCrown && shoot !== 0) {
        const crownBase = middle.clone().lerp(end, 0.12);
        const crownTip = crownBase.clone().addScaledVector(plantDirection(shootAngle - 0.45 * turn), reach)
          .addScaledVector(up, reach * (0.23 + 0.22 * Math.sin(shoot * 2.8 + branch)));
        addBough(needles, crownBase, crownTip, boughTiles[shoot % 2 ? 0 : 2],
          lobeWidth * 0.96, 0.83, roll + side * 0.53, 0.15, shade * 1.11);
      }
    }
  }
}

async function loadPineMaps(): Promise<{ bark: Texture; needles: Texture }> {
  const loader = new TextureLoader();
  const base = `${import.meta.env.BASE_URL}lake-materials/`;
  const [bark, needles] = await Promise.allSettled([
    loader.loadAsync(`${base}lake-pine-bark.webp`),
    loader.loadAsync(`${base}lake-pine-needles.webp`),
  ]);
  if (bark.status === 'rejected' || needles.status === 'rejected') {
    if (bark.status === 'fulfilled') bark.value.dispose();
    if (needles.status === 'fulfilled') needles.value.dispose();
    throw new Error('Could not load the local lake pine textures.');
  }
  for (const texture of [bark.value, needles.value]) {
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.anisotropy = 4;
  }
  bark.value.wrapS = bark.value.wrapT = RepeatWrapping;
  return { bark: bark.value, needles: needles.value };
}

export async function addLakeBankPines(root: Group, pines: readonly LakePine[]): Promise<void> {
  const maps = await loadPineMaps();
  const barkMaterial = new MeshStandardMaterial({ map: maps.bark, vertexColors: true, roughness: 0.96 });
  const needleMaterial = new MeshStandardMaterial({
    map: maps.needles, alphaTest: 0.39, alphaToCoverage: true,
    vertexColors: true, roughness: 0.91, side: DoubleSide,
  });
  const stands = ['West bank', 'East bank', 'Distant ridge'].map(name => ({
    name, wood: new PlantSurface(true), needles: new PlantSurface(true),
  }));
  for (const pine of pines) {
    const stand = stands[pine.z < -260 ? 2 : pine.x < 0 ? 0 : 1];
    growPine(stand, pine);
  }
  for (const { name, wood, needles } of stands) {
    const trunks = new Mesh(mapGeometry(wood), barkMaterial);
    trunks.name = `${name} pine trunks and limbs`;
    const crowns = new Mesh(mapGeometry(needles), needleMaterial);
    crowns.name = `${name} pine boughs and needle sprays`;
    root.add(trunks, crowns);
  }
}

function mapGeometry(surface: PlantSurface) {
  const geometry = surface.geometry();
  geometry.setAttribute('uv', geometry.getAttribute('bladeUv'));
  geometry.deleteAttribute('bladeUv');
  return geometry;
}
