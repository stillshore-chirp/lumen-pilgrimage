import {
  DataTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshPhysicalMaterial, MeshStandardMaterial,
  NoColorSpace, RGBAFormat, RepeatWrapping, SRGBColorSpace, TextureLoader,
} from 'three';
import { LAKE_GLAZING, LAKE_HALL } from './lakeLayout';

function fabricMap(kind: 'rush' | 'binding', relief: boolean): DataTexture {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  const isRush = kind === 'rush';
  const threads = isRush ? 48 : 32;

  for (let row = 0; row < size; row += 1) {
    const across = row / size * threads;
    const reed = .5 - .5 * Math.cos(across * 2 * Math.PI);
    const strand = Math.floor(across);
    const hue = ((strand * 29 + 7) % 31) / 30 - .5;
    for (let column = 0; column < size; column += 1) {
      const along = column / size * 32;
      const warp = Math.cos((along + strand) * Math.PI);
      const cross = isRush ? reed * (.8 + .2 * warp) : reed * (.61 + .39 * warp);
      const fibre = ((column * 93 + row * 61 + column * row * 7) % 37) / 36 - .5;
      const shade = isRush ? 221 + 24 * cross + 18 * hue + 12 * fibre : 175 + 58 * cross + 18 * fibre;
      const value = relief ? 58 + 169 * cross + 12 * fibre : shade;
      const index = (row * size + column) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }

  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.name = `${kind} ${relief ? 'relief' : 'weave'}`;
  texture.colorSpace = relief ? NoColorSpace : SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(isRush ? 9 : 54, isRush ? 8 : 45);
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createLakeHallMaterials() {
  const loader = new TextureLoader();
  const texture = (file: string, metersX: number, metersY: number, isColour = false) => {
    const result = loader.load(`${import.meta.env.BASE_URL}residence-materials/${file}.webp`);
    result.name = file;
    result.colorSpace = isColour ? SRGBColorSpace : NoColorSpace;
    result.wrapS = result.wrapT = RepeatWrapping;
    result.repeat.set(1 / metersX, 1 / metersY);
    result.anisotropy = 8;
    return result;
  };
  const oak = {
    map: texture('oak-color', 1.8, 1.45, true),
    normalMap: texture('oak-normal', 1.8, 1.45),
    roughnessMap: texture('oak-roughness', 1.8, 1.45),
  };
  const walnut = {
    map: texture('walnut-color', 1.68, .84, true),
    normalMap: texture('walnut-normal', 1.68, .84),
    roughnessMap: texture('walnut-roughness', 1.68, .84),
  };
  const ceiling = new MeshStandardMaterial({
    ...walnut, name: 'Oiled ceiling boards', color: 0xacaaa4, roughness: .93,
    emissive: 0x756a61, emissiveIntensity: .26, vertexColors: true,
  });
  const lattice = new MeshStandardMaterial({
    ...walnut, name: 'Ceiling lattice', color: 0x989188, roughness: .94,
    emissive: 0x61574e, emissiveIntensity: .22, vertexColors: true,
  });
  const plaster = new MeshStandardMaterial({
    name: 'Ochre mineral plaster', color: 0xb6a899, roughness: .94,
    normalMap: texture('plaster-normal', 1.44, 1.44), vertexColors: true,
  });
  plaster.normalScale.set(.30, .30);
  const boards = new MeshPhysicalMaterial({
    ...oak, name: 'Brushed oak floorboards', color: 0xbdb9b7, roughness: .88, clearcoat: .09,
    clearcoatRoughness: .65, vertexColors: true,
  });
  boards.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      float woodTone = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(woodTone), 0.72);
    `);
  };
  boards.customProgramCacheKey = () => 'lake-hall-neutral-oak';

  const tableWindowLight = { value: 1 };
  const table = new MeshPhysicalMaterial({
    ...walnut, name: 'Indigo-oiled table top', color: 0x88949d, roughness: .62, clearcoat: .39,
    clearcoatRoughness: .37, emissive: 0x455c70, emissiveIntensity: .18, vertexColors: true,
  });
  table.onBeforeCompile = shader => {
    shader.uniforms.tableWindowLight = tableWindowLight;
    shader.fragmentShader = `uniform float tableWindowLight;
${shader.fragmentShader}`.replace('#include <opaque_fragment>', `
      // The tabletop sees a broad window-shaped source reflected in its varnish.
      vec3 eye = normalize(vViewPosition);
      vec3 reflectedRay = inverseTransformDirection(reflect(-eye, normal), viewMatrix);
      vec3 tablePoint = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
      float t = (${LAKE_HALL.frontZ} - tablePoint.z) / min(-0.001, reflectedRay.z);
      vec3 windowPoint = tablePoint + t * reflectedRay;
      float windowMask = smoothstep(0.0, 1.2, windowPoint.y);
      windowMask *= 1.0 - smoothstep(${LAKE_GLAZING.headY - 1}, ${LAKE_GLAZING.headY}, windowPoint.y);
      windowMask *= 1.0 - smoothstep(${LAKE_GLAZING.halfWidth - 3}, ${LAKE_GLAZING.halfWidth}, abs(windowPoint.x));
      windowMask *= smoothstep(0.0, 0.24, -reflectedRay.z);
      vec3 tableNormal = inverseTransformDirection(geometryNormal, viewMatrix);
      float varnish = smoothstep(0.35, 0.95, tableNormal.y) * smoothstep(0.25, 0.92, 1.0 - dot(normal, eye));
      float grain = dot(texture2D(map, vMapUv).rgb, vec3(0.2126, 0.7152, 0.0722));
      outgoingLight += vec3(0.070, 0.103, 0.139) * varnish * windowMask * (0.55 + 2.2 * grain) * tableWindowLight;
      #include <opaque_fragment>
    `);
  };
  table.customProgramCacheKey = () => 'lake-hall-table-window-light';

  return {
    ceiling,
    lattice,
    plaster,
    timber: new MeshStandardMaterial({
      ...walnut, name: 'Charcoal-stained structural timber', color: 0x70665d, roughness: .91, vertexColors: true,
    }),
    panel: new MeshStandardMaterial({
      ...walnut, name: 'Smoked wood wall panels', color: 0xc2a384, roughness: .90, vertexColors: true,
    }),
    boards,
    veranda: new MeshStandardMaterial({
      ...oak, name: 'Weathered veranda boards', color: 0x9b8c78, roughness: 1, vertexColors: true,
    }),
    foundation: new MeshStandardMaterial({ name: 'Shadowed basalt base', color: 0x3c3d3c, roughness: 1, vertexColors: true }),
    tatami: new MeshStandardMaterial({
      name: 'Woven rush mat', color: 0xc6ba9f, map: fabricMap('rush', false), bumpMap: fabricMap('rush', true),
      bumpScale: .00043, roughness: .95, vertexColors: true,
    }),
    binding: new MeshStandardMaterial({
      name: 'Indigo-black cloth binding', color: 0x33404a, map: fabricMap('binding', false),
      roughness: .91, vertexColors: true,
    }),
    table,
    tableWindowLight,
    rail: new MeshStandardMaterial({
      name: 'Patinated dark metal', color: 0x3d3d3d, metalness: .54, roughness: .74, vertexColors: true,
    }),
    glazing: new MeshPhysicalMaterial({
      name: 'Low-reflection lake-facing glazing', color: 0xb7cad2, roughness: .2,
      metalness: .04, transparent: true, opacity: .032, depthWrite: false, side: DoubleSide,
    }),
    lamp: new MeshStandardMaterial({
      name: 'Kozo paper light diffuser', color: 0xd5bfa1, emissive: 0xe5a468, emissiveIntensity: .02,
      roughness: .91, vertexColors: true,
    }),
  };
}
