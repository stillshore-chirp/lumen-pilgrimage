import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, NoColorSpace,
  RepeatWrapping, RGBAFormat, UnsignedByteType, type BufferGeometry,
} from 'three';

export const CINEMA_SPEAKER_GRILLE = {
  pitch: .005,
  diameter: .003,
  period: .040,
  sheetThickness: .0012,
  sheetCenter: .0014,
  backingThickness: .002,
  backingCenter: -.014,
  bumpScale: .00015,
  rimWidth: .00035,
} as const;

function grilleTextures() {
  const size = 512;
  const color = new Uint8Array(size * size * 4);
  const height = new Uint8Array(color.length);
  const cells = CINEMA_SPEAKER_GRILLE.period / CINEMA_SPEAKER_GRILLE.pitch;
  const holeRadius = CINEMA_SPEAKER_GRILLE.diameter / 2 / CINEMA_SPEAKER_GRILLE.pitch;
  const rimWidth = CINEMA_SPEAKER_GRILLE.rimWidth / CINEMA_SPEAKER_GRILLE.pitch;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    let solid = 0;
    let relief = 0;
    // Area coverage keeps circles round at magnification. Mips retain average
    // coverage at a distance; alpha testing would discard those small openings.
    for (let sy = 0; sy < 4; sy += 1) for (let sx = 0; sx < 4; sx += 1) {
      const u = ((x + (sx + .5) / 4) / size * cells) % 1 - .5;
      const v = ((y + (sy + .5) / 4) / size * cells) % 1 - .5;
      const radius = Math.hypot(u, v);
      solid += radius >= holeRadius ? 1 : 0;
      relief += Math.max(0, Math.min(1, (radius - holeRadius) / rimWidth));
    }
    const grain = ((Math.imul((x >> 2) + 891, 1597334677)
      ^ Math.imul((y >> 2) + 31, 3812015801)) >>> 0) / 0x100000000;
    const shade = Math.round(235 + grain * 20);
    const index = (y * size + x) * 4;
    color.set([shade, shade, shade, Math.round(solid / 16 * 255)], index);
    const value = Math.round(relief / 16 * 255);
    height.set([value, value, value, 255], index);
  }
  function texture(data: Uint8Array): DataTexture {
    const result = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
    result.wrapS = result.wrapT = RepeatWrapping;
    result.magFilter = LinearFilter;
    result.minFilter = LinearMipmapLinearFilter;
    result.generateMipmaps = true;
    result.anisotropy = 4;
    // RGB is a linear modulation of material.color; height is linear data.
    // Texture alpha is unpremultiplied. The material premultiplies once at output.
    result.colorSpace = NoColorSpace;
    result.premultiplyAlpha = false;
    result.needsUpdate = true;
    return result;
  }
  return { map: texture(color), height: texture(height) };
}

/** Physical face coordinates for the dimensioned thin front sheet, scale-one instances. */
export function cinemaSpeakerGrilleUv(geometry: BufferGeometry): BufferGeometry {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let index = 0; index < position.count; index += 1) {
    uv.setXY(index, position.getX(index) / CINEMA_SPEAKER_GRILLE.period,
      position.getY(index) / CINEMA_SPEAKER_GRILLE.period);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Shared front skins and their resources; detached high-detail maps stay owned. */
export function cinemaSpeakerFinishes() {
  const { map, height } = grilleTextures();
  const cabinet = new MeshStandardMaterial({ color: 0x272a2d, roughness: .78, metalness: 0 });
  const metal = new MeshStandardMaterial({ color: 0x3b3d40, roughness: .68, metalness: 0 });
  const fixings = new MeshStandardMaterial({ color: 0xb8babb, roughness: .48, metalness: 1 });
  const backing = new MeshStandardMaterial({ color: 0x090b0d, roughness: .97, metalness: 0 });
  const grille = new MeshStandardMaterial({
    color: 0x373b3e, map, roughness: .74, metalness: 0,
    transparent: true, premultipliedAlpha: true, depthWrite: false, depthTest: true,
    bumpScale: CINEMA_SPEAKER_GRILLE.bumpScale,
  });
  return {
    cabinet, metal, fixings, backing, grille,
    textures: [map, height] as const,
    setHighDetail(high: boolean) {
      const next = high ? height : null;
      if (grille.bumpMap === next) return;
      grille.bumpMap = next;
      grille.needsUpdate = true;
    },
  };
}
