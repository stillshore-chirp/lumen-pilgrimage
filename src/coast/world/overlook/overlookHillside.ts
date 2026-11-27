import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { addStem, GOLDEN_ANGLE, plantDirection, PlantSurface } from '../coastTreeMeshes';
import { seededDetail } from './overlookModel';
import { DECK_FRONT, DECK_SIDE } from './overlookTerrain';

type Random = () => number;
type Kind = 'sage' | 'buckwheat' | 'chaparral' | 'yucca' | 'grass' | 'stone';
type Shrub = 'sage' | 'buckwheat' | 'chaparral';

const up = new THREE.Vector3(0, 1, 0);
const bark = new THREE.Color(0x79644c);
const tau = Math.PI * 2;
const shrubProfiles = {
  sage: { leaves: [0x858b68, 0x909171, 0x687553], reach: 0.77, rise: 0.64, blade: 0.16, width: 0.022 },
  buckwheat: { leaves: [0x706743, 0x858351, 0x7d744b], reach: 0.88, rise: 0.51, blade: 0.12, width: 0.018 },
  chaparral: { leaves: [0x596343, 0x6b7551, 0x797b53], reach: 0.67, rise: 0.98, blade: 0.14, width: 0.027 },
} as const;

function leaf(surface: PlantSurface, start: THREE.Vector3, angle: number, length: number,
  lift: number, halfWidth: number, color: THREE.Color, shade: number, crease = true): void {
  const direction = plantDirection(angle);
  const tip = start.clone().addScaledVector(direction, length).addScaledVector(up, lift);
  const middle = start.clone().lerp(tip, 0.43).addScaledVector(up, length * 0.13);
  const across = plantDirection(angle + Math.PI * 0.5).multiplyScalar(halfWidth);
  across.y = halfWidth * Math.sin(angle * 1.8) * 0.75;
  const a = surface.point(start, color, shade * 0.79);
  const b = surface.point(middle.clone().sub(across), color, shade * 0.92);
  const d = surface.point(middle.clone().add(across), color, shade);
  const e = surface.point(tip, color, shade * 1.15);
  if (!crease) {
    surface.triangle(a, b, d);
    surface.triangle(b, e, d);
    return;
  }
  const c = surface.point(middle.clone().addScaledVector(up, halfWidth * 0.32), color, shade * 1.06);
  surface.triangle(a, b, c);
  surface.triangle(a, c, d);
  surface.triangle(b, e, c);
  surface.triangle(c, e, d);
}

function shrubGeometry(kind: Shrub, random: Random, detailed: boolean): THREE.BufferGeometry {
  const surface = new PlantSurface();
  const profile = shrubProfiles[kind];
  const greens = profile.leaves.map(value => new THREE.Color(value));
  const dryHeads = [new THREE.Color(0xa8764b), new THREE.Color(0xba9162), new THREE.Color(0x936044)];
  const count = detailed ? 11 + Math.floor(random() * 3) : 6;
  const twigs = detailed ? 3 : 2;
  const blades = detailed ? (kind === 'chaparral' ? 9 : 7) : 4;
  const bias = plantDirection(random() * tau);

  for (let i = 0; i < count; i += 1) {
    const angle = i * GOLDEN_ANGLE + (random() - 0.5) * 0.57;
    const direction = plantDirection(angle);
    const side = plantDirection(angle + Math.PI / 2);
    const spreading = 0.14 + 0.86 * (i / count) ** 0.73;
    const reach = profile.reach * spreading * (0.74 + 0.52 * random());
    const rise = profile.rise * (1.31 - spreading * 0.52) * (0.72 + random() * 0.45);
    const curve = (t: number) => direction.clone().multiplyScalar(0.025 + reach * t ** 1.13)
      .addScaledVector(up, -0.12 + (rise + 0.12) * t ** 0.79)
      .addScaledVector(side, reach * 0.12 * Math.sin(t * Math.PI))
      .addScaledVector(bias, 0.13 * t * t);
    const nodes = detailed ? [0, 0.40, 0.74, 1] : [0, 0.55, 1];
    const radii = detailed ? [0.019, 0.012, 0.0055, 0.001] : [0.021, 0.010, 0.001];
    addStem(surface, { points: nodes.map(curve), radii }, bark, 3, angle);

    for (let j = 0; j < twigs; j += 1) {
      const base = curve(0.43 + j / (twigs - 1) * 0.56);
      const twigAngle = angle + (j % 2 ? -1 : 1) * (0.37 + random() * 0.94);
      const spread = 0.07 + random() * 0.19;
      const tip = base.clone().addScaledVector(plantDirection(twigAngle), spread)
        .addScaledVector(up, 0.07 + random() * 0.16);
      const bend = base.clone().lerp(tip, 0.54).addScaledVector(up, 0.035);
      if (detailed) addStem(surface, { points: [base, bend, tip], radii: [0.0055, 0.0032, 0.0008] }, bark, 3, twigAngle);

      for (let k = 0; k < blades; k += 1) {
        const t = 0.10 + k / blades * 0.86;
        const start = t < 0.54 ? base.clone().lerp(bend, t / 0.54) : bend.clone().lerp(tip, (t - 0.54) / 0.46);
        const turn = twigAngle + (k % 2 ? 1 : -1) * (0.36 + random() * 1.45);
        const shade = 0.73 + 0.18 * t + random() * 0.30;
        leaf(surface, start, turn, profile.blade * (0.54 + random() * 0.61), (random() - 0.40) * 0.12,
          profile.width * (0.73 + random() * 0.57), greens[(i + j + k) % greens.length], shade, detailed);
      }

      if (kind === 'buckwheat' && (j > 0 || i % 3 === 0)) {
        const head = tip.clone().addScaledVector(up, 0.06 + 0.11 * random());
        if (detailed) addStem(surface, { points: [tip, head], radii: [0.0025, 0.001] }, bark, 3, angle);
        for (let k = 0; k < (detailed ? 5 : 3); k += 1) {
          leaf(surface, head, k * GOLDEN_ANGLE + twigAngle, 0.027 + random() * 0.047,
            (random() - 0.4) * 0.045, 0.015 + random() * 0.009, dryHeads[(i + k) % dryHeads.length], 0.93, detailed);
        }
      }
    }
  }
  return surface.geometry();
}

function yuccaGeometry(random: Random): THREE.BufferGeometry {
  const surface = new PlantSurface();
  const greens = [0x7a875a, 0x829276, 0x75896f, 0x697852].map(value => new THREE.Color(value));
  const straw = new THREE.Color(0xa08b59);
  for (let i = 0; i < 62; i += 1) {
    const whorl = i / 61;
    const dry = i > 53;
    const angle = i * GOLDEN_ANGLE + (random() - 0.5) * 0.37;
    const direction = plantDirection(angle);
    const side = plantDirection(angle + Math.PI / 2);
    const reach = (0.07 + 0.95 * whorl ** 0.64) * (0.79 + random() * 0.35);
    const rise = (1.09 - 0.73 * whorl) * (0.83 + random() * 0.36);
    const curve = dry ? 0.50 : 0.22 * whorl;
    const bladeWidth = 0.019 + random() * 0.018;
    const twist = (random() - 0.5) * 0.13;
    const color = dry ? straw : greens[i % greens.length];
    let previous: number[] | undefined;
    for (const t of [0, 0.16, 0.38, 0.63, 0.83, 1]) {
      const center = direction.clone().multiplyScalar(0.025 + reach * t ** 1.19)
        .addScaledVector(up, -0.05 + rise * t ** 0.69 - curve * t ** 2.4)
        .addScaledVector(side, twist * t * t);
      const width = bladeWidth * (1 - t) ** 0.72 * (0.6 + 1.6 * t);
      const shade = 0.60 + t * 0.61;
      const ridge = surface.point(center.clone().addScaledVector(up, width * 0.25), color, shade * 1.09);
      const row = t === 1 ? [ridge, ridge, ridge] : [
        surface.point(center.clone().addScaledVector(side, -width).addScaledVector(up, width * 0.35), color, shade * 0.82),
        ridge,
        surface.point(center.clone().addScaledVector(side, width), color, shade),
      ];
      if (previous) {
        surface.triangle(previous[0], row[0], previous[1]);
        surface.triangle(previous[1], row[2], previous[2]);
        if (t < 1) {
          surface.triangle(previous[1], row[0], row[1]);
          surface.triangle(previous[1], row[1], row[2]);
        }
      }
      previous = row;
    }
  }
  return surface.geometry();
}

function grassGeometry(random: Random): THREE.BufferGeometry {
  const surface = new PlantSurface();
  const wheat = [0xaa925d, 0xbdab72, 0x977e4e, 0x9e995f].map(value => new THREE.Color(value));
  for (let i = 0; i < 19; i += 1) {
    const angle = i * GOLDEN_ANGLE;
    const out = plantDirection(angle);
    const root = out.clone().multiplyScalar(0.02 + random() * 0.085).setY(-0.05);
    const reach = 0.10 + random() * 0.39;
    const height = 0.22 + random() * 0.54;
    const side = plantDirection(angle + Math.PI / 2).multiplyScalar(0.006 + 0.010 * random());
    const color = wheat[i % wheat.length];
    const mid = root.clone().addScaledVector(out, reach * 0.32).setY(height * 0.63);
    const tip = root.clone().addScaledVector(out, reach).setY(height);
    const a = surface.point(root.clone().sub(side), color, 0.61);
    const b = surface.point(root.clone().add(side), color, 0.69);
    const c = surface.point(mid.clone().addScaledVector(side, -0.68), color, 0.97);
    const d = surface.point(mid.clone().addScaledVector(side, 0.68), color, 1.08);
    const e = surface.point(tip, color, 1.12);
    surface.triangle(a, b, c);
    surface.triangle(b, d, c);
    surface.triangle(c, d, e);
    if (i % 6 === 0) leaf(surface, tip, angle, 0.058, 0.078, 0.020, color, 1.02);
  }
  return surface.geometry();
}

function stoneGeometry(random: Random): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const count = 7 + Math.floor(random() * 3);
  const offset = random() * tau;
  const cut = Array.from({ length: count }, () => 0.64 + random() * 0.45);
  for (const [level, radius, slip] of [[-0.99, 0.66, 0.09], [-0.12, 1, -0.07], [0.66, 0.76, 0.19]] as const) {
    for (let i = 0; i < count; i += 1) {
      const angle = offset + i * tau / count + slip + (random() - 0.5) * 0.36;
      const r = radius * cut[i] * (0.86 + random() * 0.30);
      points.push(new THREE.Vector3(Math.cos(angle) * r + level * 0.15,
        level + (random() - 0.5) * 0.32 + Math.cos(angle) * 0.22, Math.sin(angle) * r));
    }
  }
  points.push(new THREE.Vector3(random() * 0.55 - 0.21, 0.93, (random() - 0.5) * 0.54));
  const geometry = new ConvexGeometry(points);
  const position = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const shades = [0xa29480, 0x948976, 0xaaa08e, 0x88877a].map(value => new THREE.Color(value));
  const mineral = shades[Math.floor(random() * shades.length)];
  const uv: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < position.count; i += 3) {
    const nx = normals.getX(i), ny = normals.getY(i), nz = normals.getZ(i);
    const faceTone = 0.87 + random() * 0.20;
    for (let j = i; j < i + 3; j += 1) {
      const x = position.getX(j), y = position.getY(j), z = position.getZ(j);
      uv.push((Math.abs(nx) > Math.abs(nz) ? z : x) * 0.62, (0.54 * y + x * 0.11 + z * 0.19) + 0.18 * ny * z);
      const tone = faceTone * THREE.MathUtils.lerp(0.54, 1.04, THREE.MathUtils.smoothstep(y, -0.66, 0.61));
      colors.push(mineral.r * tone, mineral.g * tone, mineral.b * tone);
    }
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function stoneMaterial(): THREE.MeshStandardMaterial {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  const random = seededDetail(530689);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size * tau, v = y / size * tau;
      const mottles = Math.sin(u * 3 + Math.sin(v * 2)) * Math.sin(v * 3 - Math.sin(u)) * 12;
      const band = Math.sin(v * 4 + Math.sin(u * 2) * 0.49 + Math.cos(v) * 0.55);
      const fleck = random();
      const value = 213 + mottles + (fleck - 0.49) * 24 + 24 * Math.max(0, band - 0.86) / 0.14 - (fleck < 0.035 ? 34 : 0);
      const i = (x + y * size) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.min(255, Math.round(value));
      pixels[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.name = 'Hillside mineral weathering';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: texture, bumpMap: texture, bumpScale: 0.023 });
}

type Position = { x: number; z: number; height: number; width: number; aspect: number };

export function createOverlookHillside(heightAt: (x: number, z: number) => number,
  surfaceHeightAt?: (x: number, z: number) => number | undefined): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Dry hillside scrub, yucca and fractured stone';
  const random = seededDetail(2694973);
  const plants = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, vertexColors: true, roughness: 0.93 });
  const stones = stoneMaterial();
  const placements = new Map<string, { kind: Kind; detail: boolean; form: number; points: Position[] }>();
  const place = (kind: Kind, x: number, z: number, width: number, height: number, aspect = 1) => {
    const ledgeGap = Math.max(Math.abs(x) - DECK_SIDE - 0.60, DECK_FRONT - 0.45 - z, z - 31.1);
    const clearance = z < DECK_FRONT + 9 ? 4.2 : 0.8;
    if (ledgeGap < clearance + width * 1.55 || (z > 30 && z < 69 && Math.abs(x + 2) < 12)) return;
    const detail = ledgeGap < 18;
    const form = Math.floor(random() * (kind === 'stone' ? 4 : kind === 'grass' ? 2 : 3));
    const key = `${kind}:${detail}:${form}`;
    let set = placements.get(key);
    if (!set) {
      set = { kind, detail, form, points: [] };
      placements.set(key, set);
    }
    set.points.push({ x, z, width, height, aspect });
  };

  for (let z = -232; z <= 113; z += 4) {
    for (let x = -154; x <= 186; x += 4) {
      const px = x + random() * 4, pz = z + random() * 4;
      const patch = 0.5 + 0.50 * Math.sin(px * 0.091 + Math.sin(pz * 0.041) * 1.8) * Math.cos(pz * 0.077 - px * 0.028);
      const near = Math.hypot(px * 0.8, pz + 12) < 110;
      if (random() > 0.12 + patch * (near ? 0.83 : 0.49)) continue;
      const roll = random();
      if (roll < 0.035 && pz < 12 && near) {
        place('yucca', px, pz, 0.41 + random() * 0.44, 0.56 + random() * 0.40);
      } else if (roll < 0.25) {
        place('grass', px, pz, 0.43 + random() * 0.86, 0.26 + random() * 0.47);
      } else if (roll < 0.42) {
        const scale = 0.18 + random() ** 2.1 * 1.75;
        place('stone', px, pz, scale, scale * (0.40 + random() * 0.47), 0.67 + random() * 0.35);
      } else {
        const kind = roll < 0.56 + patch * 0.12 ? 'sage' : roll < 0.78 + patch * 0.07 ? 'buckwheat' : 'chaparral';
        const growth = 0.45 + random() ** 1.25 * (near ? 1.18 : 1.75);
        place(kind, px, pz, growth, growth * (kind === 'chaparral' ? 0.88 : 0.64), 0.75 + random() * 0.42);
      }
    }
  }

  // Irregular groups at the deck's lateral shoulders and farther down the south-facing slope.
  for (const [x, z, reach, density] of [
    [-41, -14, 4.5, 11], [42, 9, 5.6, 12], [-40, 20, 3.5, 8], [42, -21, 5.8, 15],
    [-22, -33, 5.6, 10], [-9, -31, 3.2, 8], [7, -35, 5.2, 10], [23, -31, 4.7, 10],
    [37, -38, 5.8, 12], [17, -49, 7.5, 13], [-19, -46, 8.3, 14], [54, -47, 10, 14],
  ] as const) {
    for (let i = 0; i < density; i += 1) {
      const angle = random() * tau;
      const r = Math.sqrt(random()) * reach;
      const kind = i % 5 === 0 ? 'stone' : i % 3 === 0 ? 'sage' : i % 3 === 1 ? 'grass' : 'buckwheat';
      const size = 0.52 + random() * 1.05;
      place(kind, x + Math.cos(angle) * r, z + Math.sin(angle) * r * 0.74, size, size * (0.42 + random() * 0.26));
    }
  }
  for (const [x, z, size] of [[-41, -9, 1.38], [41, 8, 1.44], [40, -20, 1.52], [-44, 19, 1.32], [48, -31, 1.28]] as const) {
    place('chaparral', x, z, size * 1.28, size * 1.65, 0.86);
    place('yucca', x + 1.7, z - 2.1, 0.78, 0.79);
    place('stone', x - 0.8, z - 2.7, size * 0.85, size * 0.62, 0.70);
  }
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const normal = new THREE.Vector3();
  const lean = new THREE.Quaternion();
  const supportPoint = new THREE.Vector3();
  const supportHeight = surfaceHeightAt ?? heightAt;
  for (const { kind, detail, form, points } of placements.values()) {
    const source = seededDetail(8747 + form * 349);
    const geometry = kind === 'stone' ? stoneGeometry(source) : kind === 'yucca' ? yuccaGeometry(source)
      : kind === 'grass' ? grassGeometry(source) : shrubGeometry(kind, source, detail);
    geometry.computeBoundingBox();
    const maxY = geometry.boundingBox!.max.y;
    const supportPoints: THREE.Vector3[] = [];
    if (surfaceHeightAt) {
      const position = geometry.getAttribute('position');
      const threshold = kind === 'stone' ? geometry.boundingBox!.min.y + (maxY - geometry.boundingBox!.min.y) * 0.35
        : kind === 'grass' || kind === 'yucca' ? -0.035 : -0.08;
      const unique = new Set<string>();
      for (let i = 0; i < position.count; i++) {
        if (position.getY(i) > threshold) continue;
        const point = new THREE.Vector3().fromBufferAttribute(position, i);
        const key = `${point.x},${point.y},${point.z}`;
        if (unique.has(key)) continue;
        unique.add(key);
        supportPoints.push(point);
      }
    }
    const batch = new THREE.InstancedMesh(geometry, kind === 'stone' ? stones : plants, points.length);
    batch.name = `${kind}${detail ? ' (near)' : ' (slope)'}`;
    batch.count = 0;
    for (const { x, z, width, height, aspect } of points) {
      // Instance translations are Float32: sample at those same X/Z values.
      const px = surfaceHeightAt ? Math.fround(x) : x, pz = surfaceHeightAt ? Math.fround(z) : z;
      const y = supportHeight(px, pz);
      if (y === undefined || !Number.isFinite(y)) continue;
      const stone = kind === 'stone';
      const baseY = y - (stone ? height * 0.18 : 0.025);
      const angle = random() * tau;
      dummy.position.set(px, baseY, pz);
      dummy.rotation.set(0, angle, 0);
      dummy.scale.set(width, height / maxY, width * aspect);
      if (stone) {
        const west = supportHeight(px - width * 0.6, pz), east = supportHeight(px + width * 0.6, pz);
        const north = supportHeight(px, pz - width * 0.6), south = supportHeight(px, pz + width * 0.6);
        if (west === undefined || east === undefined || north === undefined || south === undefined) continue;
        const slopeX = (east - west) / (width * 1.2);
        const slopeZ = (south - north) / (width * 1.2);
        normal.set(-slopeX * 0.76, 1, -slopeZ * 0.76).normalize();
        dummy.quaternion.premultiply(lean.setFromUnitVectors(up, normal));
        // Boulders lean into the grade with their weathered base still partly buried.
        dummy.position.y -= Math.min(0.29 * width, Math.hypot(slopeX, slopeZ) * 0.16 * width);
      }
      dummy.updateMatrix();
      if (surfaceHeightAt) {
        let highestBase = -Infinity;
        let valid = supportPoints.length > 0;
        for (const point of supportPoints) {
          supportPoint.copy(point).applyMatrix4(dummy.matrix);
          const ground = surfaceHeightAt(supportPoint.x, supportPoint.z);
          if (ground === undefined || !Number.isFinite(ground)) { valid = false; break; }
          highestBase = Math.max(highestBase, supportPoint.y - ground);
        }
        if (!valid) continue;
        // Join every root ring / basal rock footprint to the soil. Move the
        // instance as a whole; never pull leaves or individual vertices down.
        if (highestBase > -0.01) dummy.position.y -= highestBase + 0.01;
        dummy.updateMatrix();
      }
      const index = batch.count++;
      batch.setMatrixAt(index, dummy.matrix);
      const tone = 0.83 + random() * 0.29;
      tint.setRGB(tone * (0.94 + random() * 0.12), tone, tone * (0.91 + random() * 0.13));
      batch.setColorAt(index, tint);
    }
    if (batch.count === 0) {
      geometry.dispose();
      continue;
    }
    batch.computeBoundingSphere();
    batch.castShadow = detail && kind !== 'grass';
    batch.receiveShadow = detail;
    group.add(batch);
  }
  return group;
}
