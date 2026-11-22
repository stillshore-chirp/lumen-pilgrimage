import * as THREE from 'three';

export type InariFinish = 'lacquer' | 'iron' | 'roof' | 'wood' | 'plaster' | 'granite' | 'rope';
type Surface = Exclude<InariFinish, 'granite'>;
type RGB = readonly [number, number, number];

export function timberGrain(seed: number): number {
  const wave = Math.sin(seed * 127.1 + 81.3) * 43758.5453;
  return wave - Math.floor(wave);
}

function tileNoise(u: number, v: number, width: number, height: number, seed: number): number {
  const px = u * width;
  const py = v * height;
  const x = Math.floor(px);
  const y = Math.floor(py);
  const fx = THREE.MathUtils.smoothstep(px - x, 0, 1);
  const fy = THREE.MathUtils.smoothstep(py - y, 0, 1);
  const at = (col: number, row: number) =>
    timberGrain(THREE.MathUtils.euclideanModulo(col, width) * 1.71 + THREE.MathUtils.euclideanModulo(row, height) * 47.3 + seed);
  const mix = THREE.MathUtils.lerp;
  return mix(mix(at(x, y), at(x + 1, y), fx), mix(at(x, y + 1), at(x + 1, y + 1), fx), fy);
}

const palette: Record<Surface, [RGB, RGB]> = {
  lacquer: [[146, 48, 25], [215, 82, 42]],
  iron: [[42, 37, 35], [97, 83, 72]],
  roof: [[52, 43, 37], [101, 81, 62]],
  wood: [[65, 43, 31], [157, 111, 72]],
  plaster: [[141, 129, 108], [218, 207, 177]],
  rope: [[109, 79, 47], [206, 173, 109]],
};

// V runs with the fibres. The larger film variation stays legible when the fine grain has mipmapped away.
function surfaceTexel(finish: Surface, u: number, v: number, pixel: number): number {
  const blotch = tileNoise(u, v, 8, 8, 13);
  const speckle = timberGrain(pixel * 1.157);
  switch (finish) {
    case 'lacquer': {
      const flow = (tileNoise(u, v, 7, 3, 20) - 0.5) * 0.037;
      const brush = tileNoise(u + flow, v, 57, 8, 33);
      const streak = tileNoise(u, v, 18, 4, 79);
      const thin = tileNoise(u, v, 69, 16, 64) ** 6;
      return 0.50 + (blotch - 0.5) * 0.23 + streak * 0.22 + brush * 0.14 - thin * 0.60 - speckle ** 18 * 0.24;
    }
    case 'iron':
      return 0.46 + blotch * 0.22 + tileNoise(u, v, 37, 31, 17) * 0.18 - speckle ** 9 * 0.35;
    case 'roof': {
      const fibres = tileNoise(u, v, 13, 103, 7);
      const tears = tileNoise(u, v, 30, 51, 51) ** 4;
      return 0.30 + blotch * 0.25 + fibres * 0.40 - tears * 0.25 + speckle * 0.07;
    }
    case 'wood': {
      const warp = (tileNoise(u, v, 4, 3, 11) - 0.5) * 0.085;
      const rings = Math.cos(2 * Math.PI * (u + warp) * 35) * 0.5 + 0.5;
      const pores = tileNoise(u + warp, v, 88, 16, 39) ** 5;
      return 0.38 + (1 - rings ** 3) * 0.23 + tileNoise(u, v, 16, 5, 33) * 0.28 - pores * 0.45 + speckle * 0.055;
    }
    case 'plaster':
      return 0.60 + blotch * 0.20 + tileNoise(u, v, 43, 45, 6) * 0.15 - speckle ** 8 * 0.18;
    case 'rope':
      return 0.33 + tileNoise(u, v, 73, 14, 24) * 0.52 + blotch * 0.14 - speckle ** 10 * 0.21;
  }
}

function finishMap(finish: Surface): THREE.DataTexture {
  const size = 256;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const [low, high] = palette[finish];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const pixel = y * size + x;
      const tone = THREE.MathUtils.clamp(surfaceTexel(finish, x / size, y / size, pixel), 0, 1);
      pixels.set([
        THREE.MathUtils.lerp(low[0], high[0], tone),
        THREE.MathUtils.lerp(low[1], high[1], tone),
        THREE.MathUtils.lerp(low[2], high[2], tone),
        255,
      ], pixel * 4);
    }
  }
  const texture = new THREE.DataTexture(new Uint8Array(pixels.buffer), size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function inariFinishes(stone: THREE.Texture, stoneNormal: THREE.Texture): Record<InariFinish, THREE.MeshStandardMaterial> {
  const surface = (kind: Surface, roughness: number, bumpScale: number, metalness = 0) => {
    const map = finishMap(kind);
    return new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale, roughness, metalness, vertexColors: true });
  };
  return {
    lacquer: surface('lacquer', 0.48, 0.0019),
    iron: surface('iron', 0.51, 0.0023, 0.30),
    roof: surface('roof', 0.90, 0.007),
    wood: surface('wood', 0.78, 0.004),
    plaster: surface('plaster', 0.92, 0.0025),
    granite: new THREE.MeshStandardMaterial({
      map: stone, normalMap: stoneNormal, normalScale: new THREE.Vector2(0.78, 0.78),
      roughness: 0.94, vertexColors: true,
    }),
    rope: surface('rope', 0.92, 0.002),
  };
}
