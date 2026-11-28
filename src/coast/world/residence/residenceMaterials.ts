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

function timber(rows: number, ends: number, jointWidth: number, weathering: number): SurfaceSampler {
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
    const knot = boardTone < .07 ? Math.max(0, 1 - knotDistance) ** 2 : 0;
    const warp = noise(u, v, 4, 13) + noise(u, v, 11, 26) * 0.24 - knot * knotV * 1.8;
    const offsetV = v + warp * .031 + stagger;
    const latewood = noise(u, offsetV, 13, 270);
    const annualRings = noise(u, offsetV, 7, 88) + noise(u, offsetV, 5, 34) * .33;
    const pores = Math.max(0, noise(u, offsetV, 123, 401) - .24);
    const seam = Math.max(joint(v * rows, jointWidth), .74 * joint(plank, .008));
    const structure = boardTone * 14 - knot * 14 + annualRings * 23;
    return [structure + latewood * 10 - pores * 26 - seam * 29 + detail * 4,
      .69 + latewood * .09 - pores * .34 - seam * .62, .46 + weathering + boardTone * .035 + seam * .13];
  };
}

function mineral(columns: number, rows: number, polished: boolean, seams = true): SurfaceSampler {
  return (u, v, detail) => {
    const seam = seams ? Math.max(joint(u * columns, 0.0055), joint(v * rows, 0.006)) : 0;
    const slab = hash(Math.floor(u * columns) + 91, Math.floor(v * rows)) - 0.5;
    const cloud = noise(u, v, 19, 16) * 0.68 + noise(u, v, 47, 41) * 0.32;
    const beddingPlane = v + .13 * Math.sin(u * Math.PI * 2) + .035 * noise(u, v, 7, 10);
    const strata = noise(u, beddingPlane, 6, 66);
    const inclusion = Math.max(0, noise(u, beddingPlane, 12, 90) - .27);
    const pit = Math.max(noise(u, v, 154, 148) - 0.31, 0);
    return [slab * 8 + cloud * 11 + strata * (polished ? 10 : 3) - inclusion * 27 - seam * 20 - pit * 27 + detail * 4,
      .66 + cloud * .075 - pit * .38 - seam * .56, (polished ? .45 : .68) + cloud * .06 + seam * .12];
  };
}

function woven(threads: number, irregularity: number): SurfaceSampler {
  return (u, v, detail) => {
    const warp = Math.sin(u * Math.PI * 2 * threads);
    const weft = Math.sin(v * Math.PI * 2 * threads);
    const crossings = Math.cos(u * Math.PI * threads) * Math.cos(v * Math.PI * threads);
    const yarn = warp * (0.66 + crossings * 0.28) + weft * (0.66 - crossings * 0.28);
    const mottling = noise(u, v, 37, 41) + .38 * noise(u, v, 69, 67);
    return [yarn * 7 + mottling * irregularity + detail * 7, 0.51 + yarn * 0.12 + detail * 0.15, 0.86 + yarn * 0.07];
  };
}

function rush(u: number, v: number, detail: number): Texel {
  const strand = Math.floor(v * 136);
  const crossover = Math.cos(u * Math.PI * 138) * ((strand % 2) * 2 - 1);
  const reed = Math.sin(v * Math.PI * 272 + .058 * Math.sin(u * Math.PI * 12));
  const dye = hash(strand, 81) - .5;
  const flecks = noise(u, v, 63, 99);
  const grain = reed * (.70 + crossover * .21) + crossover * .11;
  return [dye * 14 + grain * 8 + flecks * 7 + detail * 4, .55 + grain * .25 + dye * .035, .82 + grain * .055];
}

function cedarGrain(u: number, v: number, detail: number): Texel {
  const drift = v + .020 * noise(u, v, 5, 13) + .011 * Math.sin(u * Math.PI * 2);
  const fine = noise(u, drift, 9, 137);
  const early = noise(u, drift, 6, 37);
  return [early * 31 + fine * 13 + detail * 4, .53 + fine * .19 + early * .055, .69 + fine * .10];
}

function endGrain(u: number, v: number, detail: number): Texel {
  const x = u - .5;
  const y = v - .5;
  const rings = Math.sin(132 * Math.hypot(x * .46, y) + 5 * noise(u, v, 8, 9));
  return [rings * 12 + detail * 6, .52 + rings * .17, .58 + rings * .045];
}

export function createResidenceMaterials() {
  const textures: THREE.Texture[] = [];
  const materials: THREE.Material[] = [];
  const solid = (name: string, params: THREE.MeshPhysicalMaterialParameters) => {
    const material = new THREE.MeshPhysicalMaterial({ name, ...params });
    materials.push(material);
    return material;
  };
  const textured = (name: string, maps: Surface, bumpScale: number,
    params: THREE.MeshPhysicalMaterialParameters = {}) => {
    textures.push(maps.map, maps.bumps);
    return solid(name, { map: maps.map, bumpMap: maps.bumps,
      roughnessMap: maps.bumps, bumpScale, roughness: 1, ...params });
  };
  const textureLoader = typeof document === 'undefined' ? null : new THREE.TextureLoader();
  const load = (file: string, width: number, height: number, colorSpace: string) => {
    if (!textureLoader) return null;
    const texture = textureLoader.load(`${import.meta.env?.BASE_URL ?? '/'}residence-materials/${file}.webp`);
    texture.name = file;
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.repeat.set(1 / width, 1 / height);
    textures.push(texture);
    return texture;
  };
  const scanned = (id: string, width: number, height: number, normal: number, roughness = false) => ({
    map: load(`${id}-color`, width, height, THREE.SRGBColorSpace),
    normalMap: load(`${id}-normal`, width, height, THREE.NoColorSpace),
    normalScale: new THREE.Vector2(normal, normal),
    ...(roughness && { roughnessMap: load(`${id}-roughness`, width, height, THREE.NoColorSpace) }),
  });
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
  const oak = solid('Oiled natural oak with staggered boards', {
    ...scanned('oak', 1.8, 1.45, .37, true), roughness: .74, anisotropy: .24,
    clearcoat: .24, clearcoatRoughness: .39,
  });
  const stone = textured('Honed limestone, 900 × 600 mm',
    surface('Limestone', [2.7, 1.8], [512, 512], [200, 193, 178], mineral(3, 3, true)), .0014,
    { clearcoat: .11, clearcoatRoughness: .35 });
  const counterStone = textured('Continuous honed limestone countertop',
    surface('Limestone slab', [2.9, 1.4], [512, 256], [212, 207, 191], mineral(1, 1, true, false)), .00065,
    { clearcoat: .26, clearcoatRoughness: .29 });
  const tile = textured('Unglazed porcelain, 600 mm square',
    surface('Porcelain', [1.8, 1.8], [512, 512], [171, 173, 168], mineral(3, 3, false)), .0015,
    { specularIntensity: .68 });
  const deck = textured('Oiled outdoor ash, 192 mm boards',
    surface('Ash decking', [3.84, 1.536], [768, 384], [141, 128, 109], timber(8, 2, 0.032, 0.23)), 0.0028);
  const wall = solid('Warm mineral plaster', {
    ...scanned('plaster', 1.44, 1.44, .17), color: 0xf2e9db, roughness: .87, specularIntensity: .39,
  });
  const ceiling = solid('Microtextured matte ceiling', {
    normalMap: wall.normalMap, normalScale: new THREE.Vector2(.07, .07),
    color: 0xf0ece4, roughness: .94, specularIntensity: .30,
  });
  const core = textured('Fine aggregate precast',
    surface('Precast concrete', [2.28, 1.20], [384, 256], [155, 154, 148], mineral(2, 2, false, false)), .0018);
  const cabinetry = solid('Oiled walnut veneer', {
    ...scanned('walnut', 1.68, .84, .22, true), roughness: .80, anisotropy: .30,
    clearcoat: .17, clearcoatRoughness: .42,
  });
  const woodEnd = textured('Oiled walnut end grain',
    surface('Walnut end grain', [.48, .40], [256, 256], [139, 111, 83], endGrain), .0008,
    { clearcoat: .16, clearcoatRoughness: .42 });
  const flax = scanned('linen', .30, .30, .58);
  const fabric = solid('Woven flax upholstery', {
    ...flax, color: 0xd8c8b3, roughness: .84, specularIntensity: .40,
    sheen: .83, sheenColor: new THREE.Color(0xe4d7c5), sheenRoughness: .74,
  });
  const linenShade = solid('Open weave shade flax', {
    ...flax, normalScale: new THREE.Vector2(.44, .44), color: 0xe8dcca, roughness: .90,
    specularIntensity: .32, sheen: .50, sheenColor: new THREE.Color(0xf3e3cd), sheenRoughness: .80,
    side: THREE.DoubleSide,
  });
  const rug = textured('Looped undyed wool',
    surface('Wool rug', [.32, .32], [256, 256], [171, 166, 153], woven(56, 26)), .00092,
    { sheen: .95, sheenColor: new THREE.Color(0xc4bfb1), sheenRoughness: .90, specularIntensity: .22 });
  const bedding = textured('Washed cotton',
    surface('Cotton bedding', [.24, .24], [256, 256], [227, 221, 213], woven(70, 7)), .00038,
    { sheen: .64, sheenColor: new THREE.Color(0xe9e3df), sheenRoughness: .73 });
  const felt = textured('Pressed wool felt',
    surface('Wool felt', [.25, .25], [192, 192], [111, 105, 99], woven(52, 14)), .00042,
    { sheen: .8, sheenColor: new THREE.Color(0xaaa49d), sheenRoughness: .94 });
  const tatami = textured('Woven igusa rush', surface('Igusa rush', [.56, .43], [512, 512], [174, 169, 131], rush),
    .00079, { sheen: .42, sheenColor: new THREE.Color(0xc5ba89), specularIntensity: .29 });
  const cedar = textured('Quarter-sawn cedar', surface('Cedar', [1.71, .51], [384, 256], [176, 130, 88], cedarGrain),
    .00062, { roughness: .95, specularIntensity: .37 });
  const washi = textured('Shoji kozo paper', surface('Kozo paper', [.73, .61], [256, 256], [233, 225, 205],
    (u, v, detail) => {
      const fibers = noise(u, v, 53, 128) + noise(u, v, 119, 41) * .3;
      const pulp = noise(u, v, 19, 14);
      return [fibers * 9 + pulp * 14 + detail * 4, .58 + fibers * .24, .92 + pulp * .14];
    }), .00028, { specularIntensity: .15 });
  const trim = solid('Pale stained timber trim', {
    normalMap: cabinetry.normalMap, normalScale: new THREE.Vector2(.15, .15),
    color: 0xbda887, roughness: .58, clearcoat: .13, clearcoatRoughness: .43,
  });
  const metal = solid('Satin warm nickel', { color: 0xaaa193, metalness: .65, roughness: .38, anisotropy: .51 });
  const brushedSteel = solid('Brushed stainless steel', {
    color: 0xb5bdc1, metalness: .91, roughness: .29, anisotropy: .78,
  });
  const darkMetal = solid('Dark anodized aluminum', {
    color: 0x424540, metalness: .44, roughness: .42, anisotropy: .53, clearcoat: .20, clearcoatRoughness: .32,
  });
  const ceramic = solid('Glazed sanitary ceramic', {
    color: 0xf4f1eb, roughness: .31, clearcoat: .72, clearcoatRoughness: .17,
  });
  const clearMirror = solid('Optical silvered mirror', { color: 0xc3d0d2, roughness: .12, metalness: .94 });
  const lamp = solid('Warm opal diffuser', { color: 0xf1e1cb, emissive: 0xffbc74, emissiveIntensity: .10, roughness: .78 });
  const glass = glazing('Low-reflection facade glass', 0xc8d7da, .050, .13);
  // Interior panes remain visible in the facade's planar captures. Keep them
  // separate so their shader never samples the target being rendered.
  const interiorGlass = glazing('Low-reflection interior glass', 0xc8d7da, .050, .13);
  interiorGlass.side = THREE.DoubleSide;
  interiorGlass.forceSinglePass = true;
  const guard = glazing('Balcony clear laminated glass', 0xc2dbdc, .090, .14);

  return { oak, stone, counterStone, tile, deck, core, wall, ceiling, trim, metal, glass, interiorGlass, guard, fabric, rug, bedding,
    cabinetry, woodEnd, ceramic, darkMetal, brushedSteel, clearMirror, felt, linenShade, lamp, tatami, cedar, washi,
    dispose() {
      materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
    } };
}

export type ResidenceMaterials = ReturnType<typeof createResidenceMaterials>;
