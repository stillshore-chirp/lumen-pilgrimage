import {
  BoxGeometry, DataTexture, Group, InstancedMesh, LinearFilter, Mesh, Object3D,
  RGBAFormat, SRGBColorSpace,
} from 'three';
import type { Material, MeshStandardMaterial, Texture } from 'three';
import { createTenantArchitecture } from './atriumTenantArchitecture';
import { furnishEastTenant } from './atriumTenantEast';
import { addTenantLighting, createTenantFinishes } from './atriumTenantLighting';
import type { TenantLocalLight } from './atriumTenantLighting';
import { ATRIUM_TENANT_COMMON, ATRIUM_TENANTS } from './atriumTenantPlan';
import { furnishRearTenant } from './atriumTenantRear';
import { furnishWestTenant } from './atriumTenantWest';

const FACADE_X = ATRIUM_TENANT_COMMON.halfWidth;

type Side = -1 | 1;
type TenantFinishes = Awaited<ReturnType<typeof createTenantFinishes>>;
type BoxSpec = readonly [x: number, y: number, z: number, width: number, height: number, depth: number, yaw?: number];

function addBox(
  parent: Object3D,
  geometry: BoxGeometry,
  material: Material,
  [x, y, z, width, height, depth, yaw = 0]: BoxSpec,
  name: string,
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  mesh.scale.set(width, height, depth);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addInstancedBoxes(
  parent: Object3D,
  geometry: BoxGeometry,
  material: Material,
  boxes: readonly BoxSpec[],
  name: string,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, boxes.length);
  mesh.name = name;
  const transform = new Object3D();
  boxes.forEach(([x, y, z, width, height, depth, yaw = 0], index) => {
    transform.position.set(x, y, z);
    transform.rotation.set(0, yaw, 0);
    transform.scale.set(width, height, depth);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addWarmStoneFiller(
  root: Group,
  side: Side,
  centerZ: number,
  span: number,
  boxes: BoxGeometry,
  stone: MeshStandardMaterial,
  stoneLight: MeshStandardMaterial,
  metal: MeshStandardMaterial,
  backdrop: MeshStandardMaterial,
  glow: MeshStandardMaterial,
  label: string,
): void {
  const group = new Group();
  group.name = `Atrium ${label} warm stone filler bay`;
  root.add(group);
  const frontX = side * FACADE_X;
  // These filler faces stay behind the facade plane.  At +/-11.56 they leave the
  // concourse clear while preventing the large unlit gaps from reading outside.
  const surfaceX = frontX + side * 0.16;
  const panelX = frontX + side * 0.40;
  addBox(group, boxes, backdrop, [panelX, 1.90, centerZ, 0.14, 3.64, span], `${label} warm inset wall`);
  addBox(group, boxes, stone, [surfaceX, 1.94, centerZ, 0.08, 3.82, span + 0.05], `${label} honed stone face`);

  const count = Math.ceil(span / 2.85);
  const step = span / count;
  const pilasters: BoxSpec[] = [];
  const seams: BoxSpec[] = [];
  const reveals: BoxSpec[] = [];
  for (let index = 0; index <= count; index += 1) {
    const z = centerZ - span * 0.5 + step * index;
    pilasters.push([surfaceX - side * 0.006, 1.98, z, 0.24, 3.86, 0.20]);
    if (index < count) {
      const panelZ = z + step * 0.5;
      const panelDepth = Math.max(0.28, step - 0.30);
      if (span > 1.8) {
        reveals.push([surfaceX - side * 0.040, 2.36, z + step - 0.16, 0.012, 2.46, 0.016]);
      }
      for (let row = 1; row < 4; row += 1) {
        seams.push([surfaceX - side * 0.042, 0.59 + row * 0.79, panelZ, 0.015, 0.010, panelDepth]);
      }
    }
  }
  addInstancedBoxes(group, boxes, stoneLight, pilasters, `${label} repeated warm stone pilasters`);
  addInstancedBoxes(group, boxes, metal, seams, `${label} honed stone horizontal joints`);
  if (reveals.length > 0) addInstancedBoxes(group, boxes, glow, reveals, `${label} narrow wall light reveals`);
  addBox(group, boxes, stoneLight, [surfaceX, 3.88, centerZ, 0.16, 0.12, span + 0.08], `${label} upper stone coping`);
}

function makeDirectoryScreen(finishes: TenantFinishes): MeshStandardMaterial {
  const width = 44;
  const height = 108;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const v = row / (height - 1);
    for (let column = 0; column < width; column += 1) {
      const u = column / (width - 1);
      const light = 24 * Math.sin(v * Math.PI);
      const band = 31 * Math.exp(-((u - 0.24 - v * 0.48) ** 2) * 255 - ((v - 0.54) ** 2) * 44);
      const crease = 16 * Math.exp(-((u + v * 0.8 - 0.97) ** 2) * 540 - ((v - 0.48) ** 2) * 26);
      const index = (row * width + column) * 4;
      pixels[index] = 175 + light - band + crease;
      pixels[index + 1] = 195 + light - band * 0.62 + crease;
      pixels[index + 2] = 224 + light * 0.65 - band * 0.31 + crease;
      pixels[index + 3] = 255;
    }
  }
  const graphic = new DataTexture(pixels, width, height, RGBAFormat);
  graphic.name = 'Original blue abstract directory artwork';
  graphic.colorSpace = SRGBColorSpace;
  graphic.minFilter = LinearFilter;
  graphic.magFilter = LinearFilter;
  graphic.needsUpdate = true;

  const material = finishes.glow('Cool inset directory face', 0xffffff, 0.94);
  material.map = graphic;
  material.emissiveMap = graphic;
  return material;
}

function addConcoursePiers(parent: Group, boxes: BoxGeometry, finishes: TenantFinishes): void {
  const { stone, cream, bronze, dark } = finishes.palette;
  const light = finishes.glow('Pale light in the stone reveals', 0xffd7a5, 0.52);
  const directory = makeDirectoryScreen(finishes);
  const { nearS, rearS } = ATRIUM_TENANT_COMMON;
  for (const [side, orientation] of [[-1, 'west'], [1, 'east']] as const) {
    const bays = ATRIUM_TENANTS.filter(bay => bay.side === orientation).sort((a, b) => a.span[0] - b.span[0]);
    let lastS = nearS;
    for (const bay of bays) {
      const gap = bay.span[0] - lastS;
      if (gap > 0.24) {
        addWarmStoneFiller(parent, side, -(lastS + bay.span[0]) / 2, gap,
          boxes, stone, cream, bronze, dark, light, `${bay.id} approach pier`);
      }
      if (gap >= 1 && (bay.id === 'L2' || bay.id === 'R2')) {
        const z = -(lastS + gap * (side < 0 ? 0.62 : 0.37));
        const x = side * FACADE_X;
        addBox(parent, boxes, dark, [x + side * 0.082, 1.21, z, 0.058, 1.91, 0.70], 'Recessed directory bezel');
        addBox(parent, boxes, directory, [x + side * 0.049, 1.21, z, 0.014, 1.78, 0.59], 'Blue-lit directory artwork');
      }
      lastS = bay.span[1];
    }
    if (rearS - lastS > 0.24) {
      addWarmStoneFiller(parent, side, -(lastS + rearS) / 2, rearS - lastS,
        boxes, stone, cream, bronze, dark, light, `${orientation} rear return pier`);
    }
  }
}

export async function buildAtriumRetail(root: Group, stoneMap: Texture | null) {
  const finishes = await createTenantFinishes(stoneMap);
  const group = new Group();
  group.name = 'Commercial atrium first-floor tenants';
  root.add(group);
  const boxes = new BoxGeometry(1, 1, 1);
  addConcoursePiers(group, boxes, finishes);

  const localLights: TenantLocalLight[] = [];
  for (const bay of ATRIUM_TENANTS) {
    const context = createTenantArchitecture(group, bay, finishes);
    switch (bay.side) {
      case 'west': furnishWestTenant(context); break;
      case 'east': furnishEastTenant(context); break;
      case 'rear': furnishRearTenant(context); break;
    }
    for (const entry of addTenantLighting(context)) {
      entry.light.name = `${entry.id} merchandise light`;
      context.group.add(entry.light);
      localLights.push(entry);
    }
  }

  function setLighting(on: boolean): void {
    finishes.setLighting(on);
    for (const { light, onIntensity } of localLights) light.intensity = on ? onIntensity : 0;
  }

  setLighting(true);
  return { setLighting };
}
