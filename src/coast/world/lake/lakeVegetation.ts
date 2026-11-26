import {
  Color, DoubleSide, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial,
  RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type Group, type Texture,
} from 'three';
import { coastRandom } from '../../terrain';
import { GOLDEN_ANGLE, plantDirection, PlantSurface } from '../coastTreeMeshes';

export type LakePlantForm = 'pine' | 'broadleaf' | 'sapling' | 'shrub';
export type LakePlant = {
  x: number; y: number; z: number;
  height: number; spread: number; yaw: number; seed: number;
  form: LakePlantForm;
  windYaw?: number;
};
export type LakePlantSurfaces = { wood: PlantSurface; needles: PlantSurface; leaves: PlantSurface };
type FoliageTile = readonly [left: number, top: number, right: number, bottom: number];
export type LakeGroundPatch = { x: number; z: number; radius: number; seed: number };
export type LakeGroundHeight = (x: number, z: number) => number | undefined;

const up = new Vector3(0, 1, 0);
const xAxis = new Vector3(1, 0, 0);
const barkTint = new Color(0x9a9386);
const needleTint = new Color(0xffffff);
const leafTint = new Color(0xffffff);
const tau = Math.PI * 2;
const pineTiles: readonly FoliageTile[] = [
  [39 / 1254, 123 / 1254, 609 / 1254, 560 / 1254],
  [633 / 1254, 122 / 1254, 1222 / 1254, 529 / 1254],
  [39 / 1254, 784 / 1254, 629 / 1254, 1113 / 1254],
  [633 / 1254, 675 / 1254, 1215 / 1254, 1136 / 1254],
];
// Updated with the generated atlas's occupied bounds, rather than stretching its empty margins.
const leafTiles: readonly FoliageTile[] = [
  [30 / 1254, 165 / 1254, 612 / 1254, 486 / 1254],
  [641 / 1254, 155 / 1254, 1223 / 1254, 487 / 1254],
  [30 / 1254, 762 / 1254, 615 / 1254, 1084 / 1254],
  [641 / 1254, 756 / 1254, 1223 / 1254, 1090 / 1254],
];

// Bark follows the stem's local frame. Longitudinal fissures stay aligned through curved forks.
function addStem(surface: PlantSurface, points: readonly Vector3[], radii: readonly number[],
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

// A bowed patch occupies a fixed botanical plane. None of the foliage follows the camera.
function addFoliagePatch(surface: PlantSurface, center: Vector3, width: number, depth: number,
  heading: number, tilt: number, roll: number, tile: FoliageTile, tint: Color, shade: number): void {
  const along = plantDirection(heading).multiplyScalar(Math.cos(tilt)).addScaledVector(up, Math.sin(tilt));
  const across = new Vector3().crossVectors(along, up).normalize().applyAxisAngle(along, roll);
  const normal = new Vector3().crossVectors(across, along).normalize();
  const [left, top, right, bottom] = tile;
  const point = (u: number, v: number) => {
    const bow = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * depth * 0.13;
    const position = center.clone().addScaledVector(along, (u - 0.5) * width)
      .addScaledVector(across, (v - 0.5) * depth).addScaledVector(normal, bow);
    return surface.point(position, tint, shade * (0.91 + v * 0.15),
      left + u * (right - left), 1 - top - v * (bottom - top));
  };
  // Edge midpoints were collinear with their corners. A four-triangle fan keeps the same
  // patch outline, UV boundary and central bow with half as many foliage triangles.
  const corners = [point(0, 0), point(1, 0), point(1, 1), point(0, 1)];
  const middle = point(0.5, 0.5);
  for (let edge = 0; edge < corners.length; edge += 1) {
    surface.triangle(corners[edge], middle, corners[(edge + 1) % corners.length]);
  }
}

function addCrownPad(surface: PlantSurface, center: Vector3, radius: number, heading: number,
  seed: number, pine: boolean, shade: number): void {
  const random = coastRandom(seed);
  const count = radius < 0.36 ? 9 : radius < 0.72 ? 15 : pine ? 25 : 29;
  const tint = pine ? needleTint : leafTint;
  const tiles = pine ? pineTiles : leafTiles;
  for (let cluster = 0; cluster < count; cluster += 1) {
    const angle = cluster * GOLDEN_ANGLE + heading;
    const radial = Math.sqrt((cluster + 0.35) / count);
    const lens = Math.sqrt(1 - radial * radial);
    const point = center.clone().addScaledVector(plantDirection(angle), radius * radial)
      .addScaledVector(up, radius * (0.11 * lens + (random() - 0.5) * 0.54 * lens));
    const width = radius * (pine ? 0.70 : 0.74) * (0.78 + random() * 0.35);
    const direction = angle + (random() - 0.5) * 0.8;
    const tile = tiles[Math.floor(random() * tiles.length)];
    // Horizontal branchlets fill the top and underside. Upright and oblique clusters fill the
    // shallow lens's edge, which would disappear into a line from the low reference viewpoint.
    addFoliagePatch(surface, point, width, width * 0.76, direction,
      (random() - 0.5) * 0.42, (random() - 0.5) * 0.56, tile, tint, shade);
    addFoliagePatch(surface, point.clone().addScaledVector(up, -width * 0.035), width,
      width * 0.77, direction + 0.34, (random() - 0.5) * 0.34,
      (cluster % 2 ? -1 : 1) * (1.40 + random() * 0.22), tile, tint, shade * 0.88);
    addFoliagePatch(surface, point.clone().addScaledVector(up, width * 0.07), width * 0.91,
      width * 0.73, direction + 1.33, (cluster % 2 ? -1 : 1) * 0.61,
      (random() - 0.5) * 1.25, tile, tint, shade * 1.02);
  }
}

function growPine({ wood, needles }: LakePlantSurfaces, plant: LakePlant): void {
  const { x, y, z, height, spread, yaw, seed } = plant;
  const random = coastRandom(seed);
  const origin = new Vector3(x, y, z);
  const wind = plantDirection(plant.windYaw ?? yaw);
  const lean = height * (0.09 + random() * 0.14);
  const trunk = (t: number) => origin.clone().addScaledVector(up, t * height)
    .addScaledVector(wind, lean * t * t)
    .addScaledVector(plantDirection(yaw + 1.6), height * 0.033 * Math.sin(t * 7.1));
  const thick = height * (0.023 + random() * 0.009);
  addStem(wood, [-0.04, 0, 0.15, 0.33, 0.52, 0.70, 0.87, 1].map(trunk),
    [1.25, 1.35, 0.89, 0.72, 0.56, 0.39, 0.20, 0.025].map(r => r * thick), height > 5 ? 10 : 6, yaw);
  const tiers = height > 3 ? 5 : 4;
  for (let tier = 0; tier < tiers; tier += 1) {
    const level = tier / (tiers - 1);
    const band = 0.34 + level * 0.58 + (random() - 0.5) * 0.055;
    const limbs = tier === tiers - 1 ? 2 : 3;
    for (let branch = 0; branch < limbs; branch += 1) {
      const angle = yaw + tier * 1.67 + branch * 2.31 + (random() - 0.5) * 0.7;
      const direction = plantDirection(angle);
      const across = plantDirection(angle + Math.PI * 0.5);
      const reach = spread * (0.76 - level * 0.47) * (0.78 + random() * 0.30);
      const start = trunk(band);
      const limb = (t: number) => start.clone().addScaledVector(direction, reach * t)
        .addScaledVector(up, height * (0.055 * t - 0.035 * Math.sin(t * Math.PI)))
        .addScaledVector(across, reach * 0.10 * Math.sin(t * 3.2));
      const radius = thick * (0.50 - level * 0.23);
      addStem(wood, [0, 0.3, 0.62, 1].map(limb), [1, 0.65, 0.32, 0.025].map(r => r * radius), 5, angle);
      for (let shoot = 0; shoot < 3; shoot += 1) {
        const t = 0.49 + shoot * 0.23;
        const junction = limb(t);
        const turn = (shoot % 2 ? -1 : 1) * (0.48 + random() * 0.5);
        const end = junction.clone().addScaledVector(plantDirection(angle + turn), reach * 0.30)
          .addScaledVector(up, height * (0.018 + random() * 0.023));
        addStem(wood, [junction, end], [radius * 0.30, radius * 0.025], 3, angle);
        addCrownPad(needles, end, spread * (0.18 - level * 0.07) * (0.9 + random() * 0.23),
          angle + turn, seed * 83 + tier * 61 + branch * 13 + shoot, true, 0.95 + level * 0.19 + random() * 0.14);
      }
    }
  }
  addCrownPad(needles, trunk(0.99), spread * 0.18, yaw + 0.6, seed * 197, true, 1.14);
}

function growBroadleaf({ wood, leaves }: LakePlantSurfaces, plant: LakePlant): void {
  const { x, y, z, height, spread, yaw, seed, form } = plant;
  const random = coastRandom(seed);
  const shrub = form === 'shrub';
  const sapling = form === 'sapling';
  const origin = new Vector3(x, y, z);
  const wind = plantDirection(plant.windYaw ?? yaw);
  const thick = height * (shrub ? 0.017 : sapling ? 0.021 : 0.027);
  const forkLevel = shrub ? 0.08 : 0.23;
  const fork = origin.clone().addScaledVector(up, height * forkLevel).addScaledVector(wind, height * 0.065);
  const trunkTop = fork.clone().addScaledVector(up, height * 0.09).addScaledVector(wind, height * 0.018);
  const middle = origin.clone().lerp(fork, 0.56).addScaledVector(plantDirection(yaw + 1.8), height * 0.024);
  addStem(wood, [origin.clone().addScaledVector(up, -0.08), origin, middle, fork, trunkTop],
    [thick * 1.22, thick * 1.37, thick, thick * 0.78, thick * 0.20], shrub ? 5 : 10, yaw);
  const mainCount = shrub ? 5 : 4;
  for (let main = 0; main < mainCount; main += 1) {
    const angle = yaw + main * GOLDEN_ANGLE + (random() - 0.5) * 0.38;
    const direction = plantDirection(angle);
    const span = spread * (0.47 + random() * 0.15);
    const branchTop = height * (0.65 + random() * 0.14);
    const start = fork.clone().lerp(trunkTop, main * 0.24);
    const across = plantDirection(angle + Math.PI * 0.5);
    const crooked = (random() - 0.5) * span * 0.37;
    const limb = (t: number) => start.clone().addScaledVector(direction, span * t)
      .addScaledVector(up, (branchTop - start.y + y) * (t * 1.22 - t * t * 0.22))
      .addScaledVector(across, crooked * Math.sin(t * 3.5))
      .addScaledVector(wind, height * 0.035 * Math.sin(t * Math.PI));
    const radius = thick * (0.69 + random() * 0.12);
    addStem(wood, [0, 0.24, 0.49, 0.76, 1].map(limb), [1, 0.78, 0.56, 0.32, 0.04].map(r => radius * r),
      shrub ? 4 : 7, angle);
    const secondaryCount = shrub ? 2 : 4;
    for (let secondary = 0; secondary < secondaryCount; secondary += 1) {
      const t = 0.37 + secondary * (shrub ? 0.43 : 0.19);
      const junction = limb(t);
      const side = secondary % 2 ? -1 : 1;
      const heading = angle + side * (0.59 + random() * 0.48);
      const reach = spread * (0.28 + random() * 0.15);
      const end = junction.clone().addScaledVector(plantDirection(heading), reach)
        .addScaledVector(up, height * (0.14 + 0.07 * (1 - t)));
      const mid = junction.clone().lerp(end, 0.58).addScaledVector(up, height * 0.043);
      addStem(wood, [junction, mid, end], [radius * 0.44, radius * 0.20, radius * 0.025], 4, heading);
      for (let twig = 0; twig < (shrub ? 2 : 3); twig += 1) {
        const twigBase = mid.clone().lerp(end, twig * 0.39);
        const twigHeading = heading + (twig - 1) * 0.85;
        const tip = twigBase.clone().addScaledVector(plantDirection(twigHeading), spread * (0.10 + random() * 0.075))
          .addScaledVector(up, height * (0.025 + random() * 0.04));
        addStem(wood, [twigBase, tip], [radius * 0.12, radius * 0.007], 3, twigHeading);
        addCrownPad(leaves, tip, spread * (sapling ? 0.13 : shrub ? 0.20 : 0.20) * (0.78 + random() * 0.28),
          twigHeading, seed * 101 + main * 163 + secondary * 23 + twig, false,
          0.85 + (tip.y - y) / height * 0.26 + random() * 0.16);
      }
    }
    addCrownPad(leaves, limb(1), spread * 0.20, angle, seed * 61 + main * 13, false, 1.12);
  }
}

export function buildLakePlantSurfaces(plants: readonly LakePlant[]): LakePlantSurfaces {
  const surfaces = { wood: new PlantSurface(true), needles: new PlantSurface(true), leaves: new PlantSurface(true) };
  for (const plant of plants) {
    if (plant.form === 'pine') growPine(surfaces, plant);
    else growBroadleaf(surfaces, plant);
  }
  return surfaces;
}

// Ground samples are evaluated for every blade, including its endpoints, so mat islands follow the bank.
export function addLakeGroundCover(surface: PlantSurface, patches: readonly LakeGroundPatch[],
  heightAt: LakeGroundHeight): void {
  const tint = new Color(0x53664b);
  const shadeTint = new Color(0x465a37);
  for (const patch of patches) {
    const random = coastRandom(patch.seed);
    const blades = Math.ceil(45 * patch.radius * patch.radius);
    for (let blade = 0; blade < blades; blade += 1) {
      const angle = blade * GOLDEN_ANGLE;
      const radial = Math.sqrt(random()) * patch.radius;
      const x = patch.x + Math.cos(angle) * radial;
      const z = patch.z + Math.sin(angle) * radial;
      const y = heightAt(x, z);
      if (y === undefined) continue;
      const heading = random() * tau;
      const length = 0.09 + random() * 0.20;
      const half = 0.016 + random() * 0.026;
      const dx = Math.cos(heading) * length;
      const dz = Math.sin(heading) * length;
      const tipY = heightAt(x + dx, z + dz);
      if (tipY === undefined) continue;
      const base = new Vector3(x, y - 0.015, z);
      const middleY = heightAt(x + dx * 0.51, z + dz * 0.51);
      if (middleY === undefined) continue;
      const mid = new Vector3(x + dx * 0.51, middleY + 0.06 + random() * 0.12, z + dz * 0.51);
      const tip = new Vector3(x + dx, tipY + 0.025 + random() * 0.04, z + dz);
      const across = plantDirection(heading + Math.PI * 0.5).multiplyScalar(half);
      const shade = 0.76 + random() * 0.45;
      const a = surface.point(base, shadeTint, shade);
      const b = surface.point(mid.clone().add(across), tint, shade);
      const c = surface.point(mid.clone().sub(across), tint, shade);
      const d = surface.point(tip, tint, shade * 1.13);
      surface.triangle(a, b, c);
      surface.triangle(b, d, c);
    }
  }
}

async function loadVegetationMaps(): Promise<{ bark: Texture; needles: Texture; leaves: Texture }> {
  const loader = new TextureLoader();
  const base = `${import.meta.env.BASE_URL}lake-materials/`;
  const loaded = await Promise.allSettled(['lake-pine-bark.webp', 'lake-pine-needles.webp', 'lake-broadleaf-clusters.webp']
    .map(name => loader.loadAsync(`${base}${name}`)));
  if (loaded.some(result => result.status === 'rejected')) {
    for (const result of loaded) if (result.status === 'fulfilled') result.value.dispose();
    throw new Error('Could not load the local lake vegetation textures.');
  }
  const textures = loaded.map(result => (result as PromiseFulfilledResult<Texture>).value);
  for (const texture of textures) {
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.anisotropy = 4;
  }
  textures[0].wrapS = textures[0].wrapT = RepeatWrapping;
  return { bark: textures[0], needles: textures[1], leaves: textures[2] };
}

export async function addLakeBankVegetation(root: Group, plants: readonly LakePlant[], ground: PlantSurface): Promise<void> {
  const maps = await loadVegetationMaps();
  const bark = new MeshStandardMaterial({ map: maps.bark, vertexColors: true, roughness: 0.96 });
  const foliage = (map: Texture) => {
    const material = new MeshStandardMaterial({
      map, alphaTest: 0.24, alphaToCoverage: true, vertexColors: true, roughness: 1, side: DoubleSide,
    });
    material.onBeforeCompile = shader => {
      // The atlas carries photographed-style local shadows. Compress their contrast slightly
      // before physical lighting. White vertex tints preserve the atlas's albedo; the foliage
      // remains lit by the scene's day/night light, with no emissive term.
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = diffuseColor.rgb * 1.05 + vec3(0.025, 0.027, 0.019);
      `);
    };
    return material;
  };
  const needles = foliage(maps.needles);
  const leaves = foliage(maps.leaves);
  for (const [index, name] of ['West bank', 'East bank', 'Distant ridge'].entries()) {
    const stand = plants.filter(plant => (plant.z < -260 ? 2 : plant.x < 0 ? 0 : 1) === index);
    const surfaces = buildLakePlantSurfaces(stand);
    for (const [key, material, label] of [
      ['wood', bark, 'branching trunks and fine limbs'],
      ['needles', needles, 'layered pine needle pads'],
      ['leaves', leaves, 'broadleaf crowns and shrubs'],
    ] as const) {
      const geometry = surfaces[key].geometry();
      geometry.setAttribute('uv', geometry.getAttribute('bladeUv'));
      geometry.deleteAttribute('bladeUv');
      const mesh = new Mesh(geometry, material);
      mesh.name = `${name} ${label}`;
      root.add(mesh);
    }
  }
  const mat = new Mesh(ground.geometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.98, side: DoubleSide }));
  mat.name = 'Ground-hugging leaf and grass islands between bank rocks';
  root.add(mat);
}
