import * as THREE from 'three';
import { groundHeight, restSiteYaw, type CoastRestSite } from '../terrain';

type Point = [x: number, y: number, z: number];
type Part = {
  position: Point;
  size: Point;
  color: number;
  rotation?: THREE.Euler | THREE.Quaternion;
};

type RestParts = {
  timber: Part[];
  stone: Part[];
  fittings: Part[];
  roof: Part[];
};

const oiledWood = 0xc2a891;
const frameWood = 0xa28a73;
const endWood = 0xb3987e;
const grayStone = 0xb2afa9;
const iron = 0x49443c;
const roofMetal = 0x54574d;

/** Cross section of a dressed beam with the grain and long edges running along local X. */
function createTimberGeometry(): THREE.BufferGeometry {
  const corner = 0.08;
  const section = new THREE.Shape([
    new THREE.Vector2(-0.5 + corner, -0.5), new THREE.Vector2(0.5 - corner, -0.5),
    new THREE.Vector2(0.5, -0.5 + corner), new THREE.Vector2(0.5, 0.5 - corner),
    new THREE.Vector2(0.5 - corner, 0.5), new THREE.Vector2(-0.5 + corner, 0.5),
    new THREE.Vector2(-0.5, 0.5 - corner), new THREE.Vector2(-0.5, -0.5 + corner),
  ]);
  const geometry = new THREE.ExtrudeGeometry(section, { depth: 1, bevelEnabled: false });
  geometry.rotateY(Math.PI / 2).translate(-0.5, 0, 0);
  geometry.clearGroups();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let index = 0; index < uv.count; index += 1) {
    const across = position.getY(index) + position.getZ(index);
    // Use a narrow strip of the existing bark pattern as longitudinal grain.
    const end = Math.abs(normal.getX(index)) > 0.9;
    const strip = normal.getY(index) > 0.5 ? 0.20 : 0.38;
    uv.setXY(index, strip + across * (end ? 0.13 : 0.10),
      0.45 + 0.65 * (end ? position.getY(index) : position.getX(index)));
  }
  return geometry;
}

function createFootingGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.94, 1, 1, 8, 1);
  geometry.rotateY(Math.PI / 8).scale(0.53, 1, 0.53);
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const roughEdge = 0.96 + 0.10 * Math.sin(x * 15 + z * 13 + y * 8);
    position.setXYZ(index, x * roughEdge + y * 0.055,
      y + 0.059 * Math.sin(x * 7 - z * 19) + 0.027 * Math.cos(z * 27 + y), z * roughEdge);
  }
  geometry.computeVertexNormals();
  geometry.clearGroups();
  return geometry;
}

function addPart(parts: Part[], position: Point, size: Point, color: number, rotation?: Part['rotation']): void {
  parts.push({ position, size, color, rotation });
}

function addBeam(parts: Part[], from: Point, to: Point, thickness: number, width: number, color: number): void {
  const start = new THREE.Vector3(...from);
  const direction = new THREE.Vector3(...to).sub(start);
  const length = direction.length();
  const midpoint = start.addScaledVector(direction, 0.5);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize());
  addPart(parts, midpoint.toArray(), [length, thickness, width], color, rotation);
}

function addFooting(parts: Part[], localGrade: (x: number, z: number) => number, x: number, z: number,
  width: number, depth: number, maxTop: number): number {
  const ground = localGrade(x, z);
  // Bury the lower course far enough to meet the downhill edge of the trail shoulder.
  const bottom = Math.min(ground, localGrade(x - width / 2, z), localGrade(x + width / 2, z),
    localGrade(x, z - depth / 2), localGrade(x, z + depth / 2), maxTop - 0.12) - 0.18;
  const top = Math.min(maxTop, ground + 0.13);
  addPart(parts, [x, (top + bottom) / 2, z], [width, top - bottom, depth], grayStone);
  return top - 0.018;
}

function addBench(parts: RestParts, localGrade: (x: number, z: number) => number, sheltered: boolean): void {
  const length = sheltered ? 2.50 : 2.10;
  const legOffset = length / 2 - 0.24;
  for (const [index, z] of [-0.166, 0, 0.166].entries()) {
    addPart(parts.timber, [0, 0.454, z], [length, 0.052, 0.152], index === 1 ? endWood : oiledWood);
  }
  for (const [index, y] of [0.696, 0.872].entries()) {
    addPart(parts.timber, [0, y, -0.235 - 0.16 * (y - 0.4)],
      [length, 0.145, 0.046], index === 0 ? endWood : oiledWood, new THREE.Euler(-0.16, 0, 0));
  }
  addPart(parts.timber, [0, 0.286, -0.136], [legOffset * 2, 0.075, 0.083], frameWood);

  for (const x of [-legOffset, legOffset]) {
    const foot = addFooting(parts.stone, localGrade, x, -0.065, 0.34, 0.70, 0.23);
    addBeam(parts.timber, [x, foot, 0.132], [x, 0.406, 0.147], 0.09, 0.105, frameWood);
    addBeam(parts.timber, [x, foot, -0.218], [x, 0.949, -0.355], 0.095, 0.093, frameWood);
    addPart(parts.timber, [x, 0.405, -0.034], [0.55, 0.055, 0.115], frameWood, new THREE.Euler(0, Math.PI / 2, 0));
    for (const z of [-0.166, 0, 0.166]) {
      addPart(parts.fittings, [x, 0.481, z], [0.020, 0.008, 0.020], iron);
    }
    for (const y of [0.696, 0.872]) {
      addPart(parts.fittings, [x, y, -0.210 - 0.16 * (y - 0.4)],
        [0.021, 0.008, 0.021], iron, new THREE.Euler(Math.PI / 2 - 0.16, 0, 0));
    }
  }
}

function addShelter(parts: RestParts, localGrade: (x: number, z: number) => number): void {
  const mastX = 1.62;
  const ridgeZ = 0.13;
  const eaveY = 2.375;
  const eaveRun = 1.63;
  const pitch = Math.PI / 10;
  const rise = eaveRun * Math.tan(pitch);
  const slopeLength = eaveRun / Math.cos(pitch);
  const ridgeY = eaveY + rise;
  const roofWidth = 4.18;

  for (const z of [-1.03, 1.32]) {
    addPart(parts.timber, [0, 2.33, z], [3.84, 0.205, 0.17], frameWood);
    for (const sign of [-1, 1]) {
      const x = sign * mastX;
      const foot = addFooting(parts.stone, localGrade, x, z, 0.47, 0.45, 0.34);
      addBeam(parts.timber, [x, foot, z], [x, 2.35, z], 0.169, 0.169, frameWood);
      addBeam(parts.timber, [x, 1.92, z], [x - sign * 0.51, 2.30, z], 0.11, 0.095, endWood);
      addBeam(parts.timber, [x, 1.99, z], [x, 2.30, z - Math.sign(z) * 0.44], 0.095, 0.095, endWood);
      addPart(parts.fittings, [x, 2.33, z + 0.097], [0.036, 0.014, 0.036],
        iron, new THREE.Euler(Math.PI / 2, 0, 0));
    }
  }
  for (const x of [-mastX, mastX]) {
    addPart(parts.timber, [x, 2.33, 0.145], [2.50, 0.15, 0.145], frameWood, new THREE.Euler(0, Math.PI / 2, 0));
  }

  addPart(parts.timber, [0, ridgeY - 0.13, ridgeZ], [roofWidth - 0.07, 0.18, 0.145], frameWood);
  for (const side of [-1, 1]) {
    const slope = new THREE.Euler(side * pitch, 0, 0);
    const z = ridgeZ + side * eaveRun / 2;
    const y = ridgeY - rise / 2;
    const eaveZ = ridgeZ + side * eaveRun;
    for (const x of [-2.04, -1.62, -0.81, 0, 0.81, 1.62, 2.04]) {
      addBeam(parts.timber, [x, ridgeY - 0.093, ridgeZ], [x, eaveY - 0.093, eaveZ], 0.145, 0.088, endWood);
    }
    addPart(parts.timber, [0, eaveY - 0.063, eaveZ], [roofWidth + 0.02, 0.145, 0.068], endWood);
    addPart(parts.timber, [0, y - 0.022, z], [roofWidth, 0.05, slopeLength], frameWood, slope);
    // Standing seams and folded ridge above the timber deck keep the roof profile thin.
    addPart(parts.roof, [0, y + 0.012, z], [roofWidth + 0.038, 0.035, slopeLength + 0.017], roofMetal, slope);
    for (let seam = -4; seam <= 4; seam += 1) {
      addPart(parts.roof, [seam * 0.51, y + 0.044, z], [0.019, 0.032, slopeLength + 0.01], 0x66695b, slope);
    }
    addPart(parts.roof, [0, ridgeY + 0.025, ridgeZ + side * 0.061],
      [roofWidth + 0.055, 0.034, 0.148], 0x5d6054, slope);
  }
}

function createPartBatch(parts: readonly Part[], geometry: THREE.BufferGeometry,
  material: THREE.MeshStandardMaterial): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  parts.forEach(({ position, size, color: tint, rotation }, index) => {
    transform.position.set(...position);
    transform.scale.set(...size);
    transform.quaternion.identity();
    if (rotation instanceof THREE.Euler) transform.setRotationFromEuler(rotation);
    if (rotation instanceof THREE.Quaternion) transform.setRotationFromQuaternion(rotation);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, color.setHex(tint));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export function createCoastRestShelters(sites: readonly CoastRestSite[], wood: THREE.Texture,
  stone: THREE.Texture): THREE.Group {
  const restAreas = new THREE.Group();
  restAreas.name = 'Trail benches and shelters';
  const timberGeometry = createTimberGeometry();
  const footingGeometry = createFootingGeometry();
  const fittingGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
  const roofGeometry = new THREE.BoxGeometry(1, 1, 1);
  const timber = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.81, bumpMap: wood, bumpScale: 0.0025 });
  timber.onBeforeCompile = shader => {
    // Retain the grain from the bark map and soften the deep fissures for planed timber.
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      THREE.ShaderChunk.map_fragment.replace('diffuseColor *= sampledDiffuseColor;',
        'diffuseColor.rgb *= mix(vec3(0.32), sampledDiffuseColor.rgb, 0.69);'));
  };
  const footing = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95, bumpMap: stone, bumpScale: 0.015 });
  const fittings = new THREE.MeshStandardMaterial({ roughness: 0.61, metalness: 0.43 });
  const roof = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.35 });

  for (const site of sites) {
    const height = groundHeight(site.x, site.z);
    const yaw = restSiteYaw(site);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const localGrade = (x: number, z: number) => (
      groundHeight(site.x + x * cos + z * sin, site.z - x * sin + z * cos) - height
    );

    const parts: RestParts = { timber: [], stone: [], fittings: [], roof: [] };
    const sheltered = site.kind === 'shelter';
    addBench(parts, localGrade, sheltered);
    if (sheltered) addShelter(parts, localGrade);

    const model = new THREE.Group();
    model.name = site.name;
    model.position.set(site.x, height, site.z);
    model.rotation.y = yaw;
    model.add(createPartBatch(parts.timber, timberGeometry, timber),
      createPartBatch(parts.stone, footingGeometry, footing),
      createPartBatch(parts.fittings, fittingGeometry, fittings));
    if (sheltered) model.add(createPartBatch(parts.roof, roofGeometry, roof));
    restAreas.add(model);
  }

  return restAreas;
}
