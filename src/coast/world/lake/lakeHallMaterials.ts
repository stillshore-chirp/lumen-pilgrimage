import {
  DataTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshPhysicalMaterial, MeshStandardMaterial,
  NoColorSpace, RGBAFormat, RepeatWrapping, SRGBColorSpace, TextureLoader,
} from 'three';
import { LAKE_GLAZING, LAKE_HALL } from './lakeLayout';

// The panes are visually clear. Sample a broad sky reflection only along rays that reach the aperture.
const windowReflection = `
  uniform float windowLight;

  float lakeWindowWeight(vec3 worldPoint, vec3 reflectedRay) {
    float t = (${LAKE_HALL.frontZ} - worldPoint.z) / min(-0.001, reflectedRay.z);
    vec3 hit = worldPoint + t * reflectedRay;
    float mask = smoothstep(0.018, 0.22, hit.y);
    mask *= 1.0 - smoothstep(${LAKE_GLAZING.headY - .6}, ${LAKE_GLAZING.headY}, hit.y);
    mask *= 1.0 - smoothstep(${LAKE_GLAZING.halfWidth - .5}, ${LAKE_GLAZING.halfWidth}, abs(hit.x));
    return mask * smoothstep(0.01, 0.25, -reflectedRay.z);
  }
`;

const reflectedSky = `
  vec3 eye = normalize(vViewPosition);
  vec3 worldPoint = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
  vec3 reflectedRay = inverseTransformDirection(reflect(-eye, normal), viewMatrix);
  vec3 worldNormal = inverseTransformDirection(geometryNormal, viewMatrix);
  float fresnel = .04 + .96 * pow(clamp(1.0 - dot(normal, eye), 0.0, 1.0), 5.0);
  float sheen = smoothstep(.35, .95, worldNormal.y) * fresnel * lakeWindowWeight(worldPoint, reflectedRay) * windowLight;
`;

function fabricMap(kind: 'rush' | 'binding', relief: boolean): DataTexture {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  const isRush = kind === 'rush';
  const threads = isRush ? 48 : 32;

  for (let row = 0; row < size; row += 1) {
    const across = row / size * threads + .10 * Math.sin(row * .22);
    const reed = .5 - .5 * Math.cos(across * 2 * Math.PI);
    const strand = Math.floor(across);
    const strandNoise = Math.sin(strand * 127.1 + 43.7) * 43758.5453;
    const hue = strandNoise - Math.floor(strandNoise) - .5;
    for (let column = 0; column < size; column += 1) {
      const along = column / size * 32;
      const warp = Math.cos((along + strand) * Math.PI);
      const cross = isRush ? reed * (.72 + .28 * warp) : reed * (.61 + .39 * warp);
      const fibre = ((column * 93 + row * 61 + column * row * 7) % 37) / 36 - .5;
      const shade = isRush ? 210 + 22 * cross + 23 * hue + 14 * fibre : 168 + 58 * cross + 18 * fibre;
      const value = relief ? 66 + 144 * cross + 16 * fibre : shade;
      const index = (row * size + column) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }

  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.name = `${kind} ${relief ? 'relief' : 'weave'}`;
  texture.colorSpace = relief ? NoColorSpace : SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(isRush ? 8 : 44, isRush ? 7 : 44);
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
    ...walnut, name: 'Oiled ceiling boards', color: 0xb7afa4, roughness: .91,
    emissive: 0xf4e7d6, emissiveMap: walnut.map, emissiveIntensity: .38, vertexColors: true,
  });
  const lattice = new MeshStandardMaterial({
    ...walnut, name: 'Ceiling lattice', color: 0x988d80, roughness: .94,
    emissive: 0xd4c5b1, emissiveMap: walnut.map, emissiveIntensity: .22, vertexColors: true,
  });
  const plaster = new MeshStandardMaterial({
    name: 'Natural mineral plaster', color: 0xc8bcaa, roughness: .94,
    map: texture('plaster-color', 2.02, 2.02, true), normalMap: texture('plaster-normal', 2.02, 2.02), vertexColors: true,
  });
  plaster.normalScale.set(.30, .30);
  const windowLight = { value: 1 };
  const boards = new MeshPhysicalMaterial({
    ...oak, name: 'Taupe brushed oak floorboards', color: 0xcac7c3, roughness: .85, clearcoat: .12,
    clearcoatRoughness: .54, vertexColors: true,
  });
  boards.onBeforeCompile = shader => {
    shader.uniforms.windowLight = windowLight;
    shader.fragmentShader = (windowReflection + shader.fragmentShader).replace('#include <map_fragment>', `
      #include <map_fragment>
      float woodTone = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(woodTone), 0.82);
    `).replace('#include <opaque_fragment>', `
      ${reflectedSky}
      float grain = dot(texture2D(map, vMapUv).rgb, vec3(.2126, .7152, .0722));
      outgoingLight += vec3(.345, .357, .363) * (0.55 + 1.25 * grain) * sheen;
      #include <opaque_fragment>
    `);
  };
  boards.customProgramCacheKey = () => 'lake-hall-neutral-oak';

  const table = new MeshPhysicalMaterial({
    ...walnut, name: 'Charcoal-oiled tabletop', color: 0x525250, roughness: .60, clearcoat: .31,
    clearcoatRoughness: .31, vertexColors: true,
  });
  table.onBeforeCompile = shader => {
    shader.uniforms.windowLight = windowLight;
    shader.fragmentShader = (windowReflection + shader.fragmentShader).replace('#include <opaque_fragment>', `
      ${reflectedSky}
      float grain = dot(texture2D(map, vMapUv).rgb, vec3(.2126, .7152, .0722));
      outgoingLight += vec3(.306, .405, .500) * (0.45 + 2.15 * grain) * sheen;
      #include <opaque_fragment>
    `);
  };
  table.customProgramCacheKey = () => 'lake-hall-table-window-light';

  const paperGrain = texture('linen-color', 1.37, 1.37, true);
  const paperNormal = texture('linen-normal', 1.37, 1.37);
  const paper = new MeshStandardMaterial({
    name: 'Fixed kozo paper panels', color: 0xe0ceb3, map: paperGrain, normalMap: paperNormal,
    roughness: .97, vertexColors: true,
  });
  const lamp = new MeshStandardMaterial({
    name: 'Warm recessed kozo diffusers', color: 0xe4d2b7, map: paperGrain, normalMap: paperNormal,
    emissive: 0xffcb91, emissiveMap: paperGrain, emissiveIntensity: 0, roughness: .94, vertexColors: true,
  });
  paper.normalScale.set(.17, .17);
  lamp.normalScale.set(.15, .15);

  const tatami = new MeshStandardMaterial({
    name: 'Woven rush mat', color: 0xd4c5a5, map: fabricMap('rush', false), bumpMap: fabricMap('rush', true),
    bumpScale: .00028, roughness: .95, vertexColors: true,
  });
  tatami.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `
      // Pale rush catches direct sunlight while the backing remains in the cooler room fill.
      reflectedLight.directDiffuse *= 1.85;
      reflectedLight.indirectDiffuse *= vec3(.66, .75, .94);
      #include <aomap_fragment>
    `);
  };
  tatami.customProgramCacheKey = () => 'lake-hall-woven-rush-light';

  return {
    ceiling,
    lattice,
    plaster,
    timber: new MeshStandardMaterial({
      ...walnut, name: 'Charcoal-stained structural timber', color: 0x786c60, roughness: .91, vertexColors: true,
    }),
    panel: new MeshStandardMaterial({
      ...walnut, name: 'Smoked wood wall panels', color: 0x9e8a75, roughness: .92, vertexColors: true,
    }),
    boards,
    joinery: new MeshStandardMaterial({
      ...walnut, name: 'Oiled joinery', color: 0xb49b7f, roughness: .87, vertexColors: true,
    }),
    foundation: new MeshStandardMaterial({ name: 'Shadowed basalt base', color: 0x3c3d3c, roughness: 1, vertexColors: true }),
    tatami,
    binding: new MeshStandardMaterial({
      name: 'Indigo-black cloth binding', color: 0x3c4851, map: fabricMap('binding', false),
      roughness: .91, vertexColors: true,
    }),
    table,
    windowLight,
    rail: new MeshStandardMaterial({
      name: 'Patinated dark metal', color: 0x3d3d3d, metalness: .54, roughness: .74, vertexColors: true,
    }),
    glazing: new MeshPhysicalMaterial({
      name: 'Low-reflection lake-facing glazing', color: 0xb7cad2, roughness: .2,
      metalness: .04, transparent: true, opacity: .018, depthWrite: false, side: DoubleSide,
    }),
    paper,
    lamp,
  };
}

export type HallMaterials = ReturnType<typeof createLakeHallMaterials>;
