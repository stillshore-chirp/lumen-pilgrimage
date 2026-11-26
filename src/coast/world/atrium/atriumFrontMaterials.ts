import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RepeatWrapping, RGBAFormat,
  SRGBColorSpace, UnsignedByteType,
} from 'three';
import type { Texture } from 'three';

/** All maps are scene-owned, deterministic and work without a document/canvas. */
function finishMap(name: string, kind: 'oak' | 'linen' | 'paper'): DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const grain = Math.sin((x + Math.sin(y * .014) * 9 + Math.sin(y * .057) * 2) * 3.4 + Math.sin(y * .13) * .8);
      const fine = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const noise = fine - Math.floor(fine);
      const value = kind === 'oak' ? 240 + grain * 2 + Math.sin(x * .047 + y * .005) * 2 + noise * 3
        : kind === 'linen' ? 222 + ((x % 4 < 2) === (y % 4 < 2) ? 17 : -4) + noise * 12
          : 237 + noise * 16;
      const index = (y * size + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = Math.round(value);
      data[index + 3] = 255;
    }
  }
  const map = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  map.name = name;
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.repeat.set(kind === 'oak' ? 1 / .45 : 1 / .12, kind === 'oak' ? 1 / 1.8 : 1 / .12);
  map.minFilter = LinearMipmapLinearFilter;
  map.magFilter = LinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

function solid(name: string, color: number, roughness: number, metalness = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ name: `Front ${name}`, color, roughness, metalness });
}

export function createFrontMaterials(wallStone: Texture | null) {
  const oakMap = finishMap('front independent oak grain, .45 by 1.8 metres', 'oak');
  const clothMap = finishMap('front independent linen weave, .12 metres', 'linen');
  const paperMap = finishMap('front independent paper tooth, .12 metres', 'paper');
  const oak = solid('low chroma oak', 0xa58866, .76);
  oak.map = oakMap;
  const darkOak = solid('smoked oak shelving', 0x655446, .78);
  darkOak.map = oakMap;
  const wood = solid('craft pale oak', 0xc0aa85, .73);
  wood.map = oakMap;
  const stone = solid('honed display stone', 0xd6cfbf, .62);
  stone.map = wallStone;
  const fabric = solid('taupe upholstery with woven surface', 0x8a8d83, .94);
  fabric.map = clothMap;
  const curtain = solid('heavy muted flax curtain', 0x77796d, .96);
  curtain.map = clothMap;
  const paper = solid('warm unprinted book paper', 0xddd6c3, .94);
  paper.map = paperMap;
  const covers = [0x515b61, 0x9a684d, 0xc7b48e, 0x737b68, 0x76605e, 0x42464a, 0xbba991]
    .map((color, i) => solid(`unlettered book cloth ${i + 1}`, color, .87));
  const glaze = [0xd7d0bd, 0x75837c, 0x9e735c, 0x4b595a, 0xb5b3a1]
    .map((color, i) => {
      const material = solid(`ceramic glaze ${i + 1}`, color, .30 + i % 2 * .10);
      material.vertexColors = true;
      return material;
    });
  const clay = solid('unglazed ceramic foot', 0x92765d, .89);
  const dark = solid('recessed fixture baffle', 0x242523, .86);
  const bronze = solid('satin bronze trim', 0x4c443b, .44, .75);
  const felt = solid('warm grey display felt', 0x9a9386, .95);
  const glows: { material: MeshStandardMaterial; energy: number }[] = [];
  function diffuser(name: string, energy = .62): MeshStandardMaterial {
    const material = solid(name, 0xddd4c0, .58);
    material.emissive.setHex(0xffe5c4);
    glows.push({ material, energy });
    return material;
  }
  return {
    oak, darkOak, wood, stone, fabric, curtain, paper, covers, glaze, clay, dark, bronze, felt,
    diffuser,
    setLighting(on: boolean, night: boolean) {
      for (const { material, energy } of glows) material.emissiveIntensity = on ? energy * (night ? .85 : 1) : 0;
    },
  };
}

export type FrontMaterials = ReturnType<typeof createFrontMaterials>;
