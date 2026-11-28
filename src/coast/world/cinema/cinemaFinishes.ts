import {
  BoxGeometry, DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial,
  RepeatWrapping, RGBAFormat, UnsignedByteType, InstancedMesh, Object3D,
  type BufferGeometry, type Group, type Material,
} from 'three';
import { applyCinemaMetricBoxUv } from './cinemaMetricUv';

export type CinemaBox = readonly [
  x: number, y: number, z: number, width: number, height: number, depth: number, yaw?: number,
];

export function cinemaBoxes(
  group: Group, name: string, geometry: BufferGeometry, material: Material, boxes: readonly CinemaBox[],
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, boxes.length);
  mesh.name = name;
  const transform = new Object3D();
  boxes.forEach(([x, y, z, width, height, depth, yaw = 0], index) => {
    transform.position.set(x, y, z);
    transform.rotation.y = yaw;
    transform.scale.set(width, height, depth);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return mesh;
}

const TEXTURE_SIZE = 128;
export const CINEMA_WEAVE_PERIOD = .016;
export const CINEMA_ACOUSTIC_PATTERN = {
  textureSize: 512, cells: 8, pitch: .016, coreRadius: .0024, rimRadius: .00325,
} as const;

function finishTexture(sample: (x: number, y: number, grain: number) => number, size = TEXTURE_SIZE): DataTexture {
  const pixels = new Uint8Array(size * size * 4);
  let seed = 38921;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const shade = Math.max(0, Math.min(255, sample(x, y, seed / 0x100000000)));
      const i = (y * size + x) * 4;
      pixels.set([shade, shade, shade, 255], i);
    }
  }
  const data = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  data.wrapS = data.wrapT = RepeatWrapping;
  data.magFilter = LinearFilter;
  data.minFilter = LinearMipmapLinearFilter;
  data.generateMipmaps = true;
  data.anisotropy = 4;
  data.needsUpdate = true;
  return data;
}

export function cinemaFinishes() {
  const weave = finishTexture((x, y, grain) => {
    const warp = x % 4;
    const weft = y % 4;
    const raisedThread = ((x >>> 2) + (y >>> 2)) % 2 === 0 ? warp : weft;
    const yarn = raisedThread === 1 || raisedThread === 2 ? 76 : 32;
    const mottling = 11 * Math.sin((x + y) * Math.PI / 16) * Math.cos((x - y) * Math.PI / 32);
    return 143 + yarn + mottling + 30 * grain;
  });
  weave.repeat.set(3.75, 4.25);
  // The image is immutable/shared; each consumer owns its UV transform.
  const seatWeave = weave.clone();
  seatWeave.repeat.set(1, 1);
  seatWeave.needsUpdate = true;

  // Keep fine seeded pile variation without coherent sinusoidal bands at grazing views.
  const carpetGrain = finishTexture((_x, _y, grain) => 188 + 20 * grain);

  const pattern = CINEMA_ACOUSTIC_PATTERN;
  const cellPixels = pattern.textureSize / pattern.cells;
  const perforations = finishTexture((x, y, grain) => {
    let shade = 0;
    for (let sy = 0; sy < 4; sy += 1) for (let sx = 0; sx < 4; sx += 1) {
      const u = ((x + (sx + .5) / 4) % cellPixels - cellPixels / 2) / cellPixels * pattern.pitch;
      const v = ((y + (sy + .5) / 4) % cellPixels - cellPixels / 2) / cellPixels * pattern.pitch;
      const radius = Math.hypot(u, v);
      shade += radius < pattern.coreRadius ? 73 + grain * 12
        : radius < pattern.rimRadius ? 151 + (v < 0 ? 38 : 0) + grain * 10
          : 223 + grain * 21;
    }
    return shade / 16;
  }, pattern.textureSize);
  // Eight 16 mm cells per period. This texture belongs only to the flat wall panels.
  perforations.repeat.set(1, 1);

  const material = (color: number, roughness = 0.8, metalness = 0) =>
    new MeshStandardMaterial({ color, roughness, metalness });
  const shell = material(0x171b20);
  const bulkhead = material(0x313233);
  const ribs = material(0x4a4842, 0.79);
  const matte = material(0x101114, 0.97);
  const drape = new MeshStandardMaterial({ color: 0x19191c, map: weave, roughness: 1 });
  const acoustic = new MeshStandardMaterial({ color: 0x393b3a, map: perforations, roughness: 0.93 });
  applyCinemaMetricBoxUv(acoustic, 1 / (pattern.cells * pattern.pitch));
  const carpet = new MeshStandardMaterial({ color: 0x342d2e, map: carpetGrain, roughness: 0.98 });
  const aisle = new MeshStandardMaterial({ color: 0x51413a, map: carpetGrain, roughness: 0.98 });
  const protection = material(0x272529, 0.75);
  const bronze = material(0x7d6344, 0.54, 0.24);
  const steel = material(0x767477, 0.53, 0.34);
  const darkSteel = material(0x363638, 0.56, 0.22);
  const safetyRed = material(0x6e2422, 0.6);
  const seatFabric = new MeshStandardMaterial({ color: 0xffffff, map: seatWeave, roughness: 0.93 });
  return {
    box: new BoxGeometry(), shell, bulkhead, ribs, matte, drape, acoustic, carpet, aisle,
    protection, bronze, steel, darkSteel, safetyRed, seatFabric,
    setHighDetail(high: boolean) {
      const surfaces = [
        { surface: seatFabric, texture: seatWeave, scale: 0.0002 },
        { surface: carpet, texture: carpetGrain, scale: 0.018 },
        { surface: aisle, texture: carpetGrain, scale: 0.020 },
        { surface: acoustic, texture: perforations, scale: 0.0008 },
      ];
      for (const { surface, texture, scale } of surfaces) {
        const map = high ? texture : null;
        if (surface.bumpMap === map) continue;
        surface.bumpMap = map;
        surface.bumpScale = scale;
        surface.needsUpdate = true;
      }
    },
  };
}

export type CinemaFinishes = ReturnType<typeof cinemaFinishes>;
