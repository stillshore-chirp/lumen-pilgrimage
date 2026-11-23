import * as THREE from 'three';

type Texel = [tone: number, relief: number, roughness: number];
type SurfaceSampler = (u: number, v: number, detail: number) => Texel;
type Surface = { map: THREE.DataTexture; bumps: THREE.DataTexture };

function hash(x: number, y: number): number {
  let bits = Math.imul(x + 1229, 92837111) ^ Math.imul(y + 5273, 689287499);
  bits = Math.imul(bits ^ (bits >>> 16), 0x7feb352d);
  return ((bits ^ (bits >>> 15)) >>> 0) / 4294967296;
}

function noise(u: number, v: number, columns: number, rows: number): number {
  const x = u * columns;
  const y = v * rows;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const horizontal = fx * fx * (3 - 2 * fx);
  const vertical = fy * fy * (3 - 2 * fy);
  const left = THREE.MathUtils.euclideanModulo(x0, columns);
  const right = (left + 1) % columns;
  const bottom = THREE.MathUtils.euclideanModulo(y0, rows);
  const top = (bottom + 1) % rows;
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(left, bottom), hash(right, bottom), horizontal),
    THREE.MathUtils.lerp(hash(left, top), hash(right, top), horizontal), vertical,
  ) - 0.5;
}

function surface(name: string, meters: readonly [number, number], size: readonly [number, number],
  base: readonly [number, number, number], sample: SurfaceSampler): Surface {
  const [columns, rows] = size;
  const color = new Uint8Array(columns * rows * 4);
  const detail = new Uint8Array(color.length);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const pixel = (row * columns + column) * 4;
      const [tone, relief, roughness] = sample((column + 0.5) / columns, (row + 0.5) / rows, hash(column, row) - 0.5);
      color[pixel] = THREE.MathUtils.clamp(base[0] + tone * 1.03, 0, 255);
      color[pixel + 1] = THREE.MathUtils.clamp(base[1] + tone, 0, 255);
      color[pixel + 2] = THREE.MathUtils.clamp(base[2] + tone * 0.91, 0, 255);
      color[pixel + 3] = 255;
      detail[pixel] = THREE.MathUtils.clamp(relief * 255, 0, 255);
      detail[pixel + 1] = THREE.MathUtils.clamp(roughness * 255, 0, 255);
      detail[pixel + 3] = 255;
    }
  }
  function texture(pixels: Uint8Array, suffix: string, colorSpace: string): THREE.DataTexture {
    const result = new THREE.DataTexture(pixels, columns, rows, THREE.RGBAFormat);
    result.name = `${name} ${suffix}`;
    result.colorSpace = colorSpace;
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.magFilter = THREE.LinearFilter;
    result.anisotropy = 4;
    result.repeat.set(1 / meters[0], 1 / meters[1]);
    result.generateMipmaps = true;
    result.needsUpdate = true;
    return result;
  }
  return { map: texture(color, 'albedo', THREE.SRGBColorSpace), bumps: texture(detail, 'relief and roughness', THREE.NoColorSpace) };
}

function joint(at: number, width: number): number {
  const fraction = at - Math.floor(at);
  return 1 - THREE.MathUtils.smoothstep(Math.min(fraction, 1 - fraction), 0, width);
}

function timber(rows: number, ends: number, jointWidth: number, weathering: number, veneer = false): SurfaceSampler {
  return (u, v, detail) => {
    const row = Math.floor(v * rows);
    const stagger = hash(row, 31);
    const plank = u * ends + stagger;
    const wrapped = THREE.MathUtils.euclideanModulo(Math.floor(plank), ends);
    const boardTone = hash(wrapped, row) - 0.5;
    const localU = plank - Math.floor(plank);
    const localV = v * rows - row;
    const knotU = .19 + .62 * hash(wrapped + 29, row);
    const knotV = localV - (.23 + .53 * hash(wrapped + 41, row));
    const knotDistance = ((localU - knotU) / .19) ** 2 + (knotV / .22) ** 2;
    const knot = !veneer && boardTone < .07 ? Math.max(0, 1 - knotDistance) ** 2 : 0;
    const warp = noise(u, v, 4, 13) + noise(u, v, 11, 26) * 0.24 - knot * knotV * 1.8;
    const offsetV = v + warp * .031 + (veneer ? 0 : stagger);
    const latewood = noise(u, offsetV, 13, 270);
    const annualRings = noise(u, offsetV, 7, 88) + noise(u, offsetV, 5, 34) * .33;
    const pores = Math.max(0, noise(u, offsetV, 123, 401) - .24);
    const seam = veneer ? 0 : Math.max(joint(v * rows, jointWidth), .74 * joint(plank, .008));
    const structure = (veneer ? 0 : boardTone * 14 - knot * 14) + annualRings * (veneer ? 15 : 23);
    return [structure + latewood * 10 - pores * 26 - seam * 29 + detail * 4,
      .69 + latewood * .09 - pores * .34 - seam * .62, .46 + weathering + boardTone * .035 + seam * .13];
  };
}

function mineral(columns: number, rows: number, polished: boolean, seams = true): SurfaceSampler {
  return (u, v, detail) => {
    const seam = seams ? Math.max(joint(u * columns, 0.009), joint(v * rows, 0.009)) : 0;
    const slab = hash(Math.floor(u * columns) + 91, Math.floor(v * rows)) - 0.5;
    const cloud = noise(u, v, 19, 16) * 0.68 + noise(u, v, 47, 41) * 0.32;
    const strata = noise(u, v + noise(u, v, 6, 15) * 0.035, 11, 55);
    const pit = Math.max(noise(u, v, 154, 148) - 0.31, 0);
    return [slab * 11 + cloud * 23 + strata * (polished ? 16 : 5) - seam * 25 - pit * 35 + detail * 4,
      0.66 + cloud * 0.12 - pit * 0.38 - seam * 0.55, (polished ? 0.62 : 0.80) + cloud * 0.08 + seam * 0.09];
  };
}

function plaster(u: number, v: number, detail: number): Texel {
  const coarse = noise(u, v, 7, 9) * 0.56 + noise(u, v, 44, 29) * 0.44;
  const grit = noise(u, v, 201, 207);
  return [coarse * 7.8 + grit * 3.0 + detail * 2.4, 0.52 + grit * 0.20 + detail * 0.08, 0.85 + grit * 0.06];
}

function woven(threads: number, irregularity: number): SurfaceSampler {
  return (u, v, detail) => {
    const warp = Math.sin(u * Math.PI * 2 * threads);
    const weft = Math.sin(v * Math.PI * 2 * threads);
    const crossings = Math.cos(u * Math.PI * threads) * Math.cos(v * Math.PI * threads);
    const yarn = warp * (0.66 + crossings * 0.28) + weft * (0.66 - crossings * 0.28);
    const mottling = noise(u, v, 16, 17) + 0.38 * noise(u, v, 53, 49);
    return [yarn * 7 + mottling * irregularity + detail * 7, 0.51 + yarn * 0.12 + detail * 0.15, 0.86 + yarn * 0.07];
  };
}

export function createResidenceMaterials() {
  const textures: THREE.Texture[] = [];
  const materials: THREE.Material[] = [];
  const textured = (name: string, maps: Surface, bumpScale: number) => {
    const material = new THREE.MeshStandardMaterial({ name, map: maps.map, bumpMap: maps.bumps,
      roughnessMap: maps.bumps, bumpScale, roughness: 1 });
    materials.push(material);
    textures.push(maps.map, maps.bumps);
    return material;
  };
  const solid = (name: string, params: THREE.MeshStandardMaterialParameters) => {
    const material = new THREE.MeshStandardMaterial({ name, ...params });
    materials.push(material);
    return material;
  };
  const glazing = (name: string, tint: number, opacity: number, roughness: number) => {
    const material = new THREE.MeshPhysicalMaterial({ name, color: tint, opacity, transparent: true, depthWrite: false,
      roughness, metalness: 0, ior: 1.51, specularIntensity: 0.35 });
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        // Low-reflection coated glass. A restrained edge reflection leaves the street legible.
        float grazing = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 4.0);
        outgoingLight = mix(diffuseColor.rgb * 0.52, outgoingLight + diffuseColor.rgb * 0.20, grazing);
        diffuseColor.a *= 0.56 + 1.35 * grazing;
        #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'residence-coated-glazing';
    materials.push(material);
    return material;
  };
  const oak = textured('Clear matte oak, 180 mm staggered boards',
    surface('Oak floor', [4.8, 1.44], [1024, 512], [186, 154, 116], timber(8, 3, 0.014, 0.11)), 0.0017);
  const stone = textured('Honed limestone, 900 × 600 mm',
    surface('Limestone', [2.7, 1.8], [512, 512], [186, 178, 160], mineral(3, 3, true)), 0.0021);
  const counterStone = textured('Continuous honed limestone countertop',
    surface('Limestone slab', [2.9, 1.4], [512, 256], [204, 197, 177], mineral(1, 1, true, false)), 0.0007);
  const tile = textured('Unglazed porcelain, 600 mm square',
    surface('Porcelain', [1.8, 1.8], [512, 512], [171, 172, 163], mineral(3, 3, false)), 0.0021);
  const deck = textured('Oiled outdoor ash, 192 mm boards',
    surface('Ash decking', [3.84, 1.536], [768, 384], [141, 128, 109], timber(8, 2, 0.032, 0.23)), 0.0028);
  const wall = textured('Warm mineral plaster',
    surface('Mineral plaster', [1.45, 1.45], [256, 256], [218, 212, 199], plaster), 0.00045);
  const ceiling = solid('White matte ceiling', { color: 0xe0ddd3, roughness: 0.91 });
  const core = textured('Fine aggregate precast',
    surface('Precast concrete', [2.28, 1.20], [384, 256], [151, 150, 142], mineral(2, 2, false)), 0.0018);
  const cabinetry = textured('Oiled walnut veneer',
    surface('Walnut joinery', [2.40, 1.24], [768, 384], [140, 108, 80], timber(4, 1, 0, .01, true)), 0.00075);
  const fabric = textured('Tightly woven flax upholstery',
    surface('Upholstery flax', [0.32, 0.32], [256, 256], [197, 181, 156], woven(68, 18)), 0.00072);
  const rug = textured('Looped undyed wool',
    surface('Wool rug', [0.56, 0.56], [256, 256], [181, 168, 146], woven(72, 42)), 0.0017);
  const bedding = textured('Washed cotton',
    surface('Cotton bedding', [0.24, 0.24], [256, 256], [227, 221, 207], woven(64, 9)), 0.00048);
  const trim = solid('Pale stained oak trim', { color: 0xaf987a, roughness: 0.63 });
  const metal = solid('Satin nickel and bronze', { color: 0x928a7d, metalness: 0.46, roughness: 0.41 });
  const darkMetal = solid('Dark anodized aluminum', { color: 0x393b38, metalness: 0.35, roughness: 0.46 });
  const ceramic = solid('Satin sanitary ceramic', { color: 0xf0ede3, roughness: 0.29 });
  const lamp = solid('Warm opal diffuser', { color: 0xf3e3c4, emissive: 0xffbd76, emissiveIntensity: 0.10, roughness: 0.83 });
  const glass = glazing('Low-reflection facade glass', 0xc1d3d8, 0.092, 0.13);
  const guard = glazing('Balcony clear laminated glass', 0xb9d1d2, 0.122, 0.14);

  return { oak, stone, counterStone, tile, deck, core, wall, ceiling, trim, metal, glass, guard, fabric, rug, bedding,
    cabinetry, ceramic, darkMetal, lamp,
    dispose() {
      materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
    } };
}

export type ResidenceMaterials = ReturnType<typeof createResidenceMaterials>;
