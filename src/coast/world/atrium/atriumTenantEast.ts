import {
  BoxGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import type { TenantBuildContext } from './atriumTenantArchitecture';
import { buildAtriumCafe } from './atriumCafe';

type Fixture = TenantBuildContext['bay']['fixtures'][number];
type Mount = NonNullable<TenantBuildContext['bay']['mounts']>[number];
type PaletteMaterial = TenantBuildContext['palette'][keyof TenantBuildContext['palette']];

const PRODUCT_COLORS = [0xb16e4e, 0xd4b47c, 0xc9d2d2, 0x8c9eae, 0x8f6b70, 0xe8d8bd];

function tint(base: PaletteMaterial, name: string, color: number, roughness = 0.42): PaletteMaterial {
  const material = base.clone();
  material.name = name;
  material.color.setHex(color);
  material.roughness = roughness;
  return material;
}

function fixture(context: TenantBuildContext, id: string): Fixture | undefined {
  return context.bay.fixtures.find(item => item.id === id);
}

function fixtureRect(item: Fixture): readonly [number, number, number, number] {
  return item.rect;
}

function addTable(
  context: TenantBuildContext,
  item: Fixture,
  topMaterial: PaletteMaterial,
  legMaterial: PaletteMaterial,
  name: string,
): void {
  const [u, d, width, depth] = fixtureRect(item);
  const top = item.height;
  context.box(topMaterial, u + width * 0.5, top - 0.04, d + depth * 0.5,
    width, 0.08, depth, `${name} top`);
  const legHeight = Math.max(0.18, top - 0.08);
  const legWidth = Math.min(0.07, width * 0.08);
  const legDepth = Math.min(0.07, depth * 0.14);
  for (const sideU of [0.12, 0.88]) {
    for (const sideD of [0.18, 0.82]) {
      context.box(legMaterial, u + width * sideU, legHeight * 0.5, d + depth * sideD,
        legWidth, legHeight, legDepth, `${name} leg`);
    }
  }
}

function addCase(
  context: TenantBuildContext,
  item: Fixture,
  baseMaterial: PaletteMaterial,
  frameMaterial: PaletteMaterial,
  glassMaterial: PaletteMaterial,
  name: string,
): void {
  const [u, d, width, depth] = fixtureRect(item);
  const top = item.height;
  const baseHeight = Math.max(0.42, top - 0.18);
  context.box(baseMaterial, u + width * 0.5, baseHeight * 0.5, d + depth * 0.5,
    width - 0.04, baseHeight, depth - 0.04, `${name} base`);
  context.box(glassMaterial, u + width * 0.5, top - 0.09, d + depth * 0.5,
    width - 0.06, 0.18, depth - 0.06, `${name} glass hood`);
  context.box(frameMaterial, u + width * 0.5, top - 0.015, d + 0.025,
    width, 0.03, 0.05, `${name} front rim`);
  context.box(frameMaterial, u + 0.025, top - 0.015, d + depth * 0.5,
    0.05, 0.03, depth, `${name} side rim`);
}

function addShelf(
  context: TenantBuildContext,
  item: Fixture,
  backing: PaletteMaterial,
  shelfMaterial: PaletteMaterial,
  shelfGlow: MeshStandardMaterial | undefined,
  name: string,
  rows: number,
  rearTrim?: PaletteMaterial,
): void {
  const [u, d, width, depth] = fixtureRect(item);
  const top = item.height;
  const boardDepth = Math.max(0.16, depth * 0.72);
  const backingThickness = Math.min(0.06, depth * 0.20);
  const backingFace = d + boardDepth - backingThickness;
  context.box(backing, u + width * 0.5, top * 0.5, backingFace + backingThickness * 0.5,
    width, top, backingThickness, `${name} back`);
  for (let index = 0; index < rows; index += 1) {
    const fraction = rows === 1 ? 0.5 : index / (rows - 1);
    const y = 0.23 + (top - 0.34) * fraction;
    context.box(shelfMaterial, u + width * 0.5, y, d + boardDepth * 0.5,
      width - 0.05, 0.035, boardDepth, `${name} shelf ${index + 1}`);
    if (shelfGlow) {
      context.box(shelfGlow, u + width * 0.5, y - 0.024, d + 0.025,
        width - 0.12, 0.012, 0.018, `${name} shelf light ${index + 1}`);
      if (rearTrim) {
        context.box(shelfGlow, u + width * 0.5, y - 0.024, backingFace - 0.008,
          width - 0.24, 0.010, 0.016, `${name} backing light ${index + 1}`);
      }
    }
  }

  if (!rearTrim) return;
  const divisions = Math.max(2, Math.round(width / 0.95));
  const backingShade = tint(backing, `${name} backing shade`, 0xb9a78f, 0.72);
  for (let index = 0; index <= divisions; index += 1) {
    const frameU = u + 0.035 + (width - 0.07) * index / divisions;
    context.box(rearTrim, frameU, (top - 0.12) * 0.5, d + 0.016,
      0.014, top - 0.12, 0.024, `${name} vertical frame ${index + 1}`);
    if (index > 0 && index < divisions) {
      context.box(backingShade, frameU, (top - 0.20) * 0.5, backingFace - 0.006,
        0.018, top - 0.20, 0.012, `${name} backing seam ${index}`);
    }
  }
}

function addWallPanel(
  context: TenantBuildContext,
  item: Fixture,
  material: PaletteMaterial,
  trim: PaletteMaterial,
  name: string,
): void {
  const [u, d, width, depth] = fixtureRect(item);
  context.box(material, u + width * 0.5, item.height * 0.5, d + depth * 0.5,
    width, item.height, depth, name);
  context.box(trim, u + width * 0.5, item.height - 0.06, d - 0.012,
    width, 0.045, 0.024, `${name} top reveal`);
  context.box(trim, u + width * 0.5, 0.075, d - 0.012,
    width, 0.15, 0.024, `${name} base reveal`);
}

function addPlant(
  context: TenantBuildContext,
  item: Fixture,
  potMaterial: PaletteMaterial,
  leafMaterial: PaletteMaterial,
  name: string,
): void {
  const [u, d, width, depth] = fixtureRect(item);
  const potRadius = Math.min(width, depth) * 0.33;
  const potHeight = Math.min(0.34, item.height * 0.22);
  const centerU = u + width * 0.5;
  const centerD = d + depth * 0.5;
  context.cylinder(potMaterial, centerU, potHeight * 0.5, centerD,
    potRadius, potHeight, `${name} pot`);
  const stem = tint(leafMaterial, `${name} stem`, 0x405540, 0.82);
  context.cylinder(stem, centerU, potHeight + 0.26, centerD, 0.025, 0.52, `${name} stem`);
  const leaves = [
    [-0.24, 0.24, -0.06, 0.74, -0.36],
    [0.22, 0.30, 0.02, 0.68, 0.30],
    [-0.10, 0.54, 0.04, 0.85, -0.12],
    [0.15, 0.67, -0.04, 0.76, 0.22],
    [0.00, 0.92, 0.00, 0.62, 0.02],
  ] as const;
  leaves.forEach(([du, lift, dd, length, tilt], index) => {
    const leaf = context.box(leafMaterial, centerU + du, potHeight + lift, centerD + dd,
      0.09, length, 0.22, `${name} leaf ${index + 1}`);
    leaf.rotation.z = tilt;
    leaf.rotation.y = (index - 2) * 0.42;
  });
}

function addLineLight(
  context: TenantBuildContext,
  item: Fixture,
  material: MeshStandardMaterial,
  name: string,
): void {
  const [u, d, width, depth] = fixtureRect(item);
  const y = Math.min(context.bay.ceiling - 0.10, item.height - 0.10);
  context.box(material, u + width * 0.5, y, d + depth * 0.5,
    width, 0.035, depth, name);
}

function localBasis(context: TenantBuildContext): { u: Vector3; d: Vector3; up: Vector3 } {
  const origin = context.point(0, 0, 0);
  const u = context.point(1, 0, 0).sub(origin).normalize();
  const d = context.point(0, 0, 1).sub(origin).normalize();
  return { u, d, up: new Vector3(0, 1, 0) };
}

type InstanceSpec = {
  u: number;
  d: number;
  width: number;
  depth: number;
  bottom: number;
  top: number;
};

function addLocalInstances(
  context: TenantBuildContext,
  material: MeshStandardMaterial | MeshPhysicalMaterial,
  instances: readonly InstanceSpec[],
  name: string,
): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, instances.length);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const basis = localBasis(context);
  const rotation = new Matrix4().makeBasis(basis.u, basis.up, basis.d);
  const transform = new Object3D();
  instances.forEach((instance, index) => {
    const height = instance.top - instance.bottom;
    const center = context.point(instance.u + instance.width * 0.5,
      instance.bottom + height * 0.5, instance.d + instance.depth * 0.5);
    transform.position.copy(center);
    transform.quaternion.setFromRotationMatrix(rotation);
    transform.scale.set(instance.width, height, instance.depth);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  context.group.add(mesh);
  return mesh;
}

function addHangingTransparentStrips(context: TenantBuildContext, mount: Mount): void {
  const [u, d, width, depth] = mount.rect;
  const mainPitch = mount.id === 'R1-M01' ? 0.12 : 0.065;
  const innerPitch = mount.id === 'R1-M01' ? 0.12 : 0.13;
  const strips: InstanceSpec[] = [];
  const rows = [d + depth * 0.28, d + depth * 0.72];
  rows.forEach((rowD, rowIndex) => {
    const pitch = rowIndex === 0 ? mainPitch : innerPitch;
    const count = Math.max(1, Math.floor(width / pitch));
    for (let index = 0; index < count; index += 1) {
      const fraction = (index + 0.5) / count;
      const variation = 0.20 + 0.70 * (0.5 + 0.5 * Math.sin(index * 2.31 + rowIndex * 1.7));
      const top = mount.top;
      const bottom = top - (top - mount.bottom) * variation;
      strips.push({
        u: u + width * fraction,
        d: rowD,
        width: 0.008,
        depth: 0.012,
        bottom,
        top,
      });
    }
  });
  const glass = new MeshPhysicalMaterial({
    name: `${mount.id} transparent suspended strips`,
    color: 0xe3efe8,
    roughness: 0.12,
    metalness: 0.02,
    transmission: 0.12,
    transparent: true,
    opacity: 0.30,
    depthWrite: false,
    side: DoubleSide,
  });
  addLocalInstances(context, glass, strips, `${mount.id} suspended transparent strips`);
}

function addR1LightBundle(context: TenantBuildContext, mount: Mount, material: MeshStandardMaterial): void {
  const [u, d, width, depth] = mount.rect;
  const instances: InstanceSpec[] = [];
  for (let index = 0; index < 4; index += 1) {
    const fraction = (index + 0.5) / 4;
    instances.push({
      u: u + width * fraction,
      d: d + depth * (0.20 + 0.60 * ((index + 1) % 3) / 3),
      width: 0.008,
      depth: 0.025,
      bottom: mount.bottom + 0.018 * index,
      top: mount.top,
    });
  }
  addLocalInstances(context, material, instances, `${mount.id} dimmable vertical light bundle`);
}

function addBottle(
  context: TenantBuildContext,
  material: PaletteMaterial,
  capMaterial: PaletteMaterial,
  u: number,
  d: number,
  base: number,
  radius: number,
  height: number,
  name: string,
): void {
  context.cylinder(material, u, base + height * 0.5, d, radius, height, `${name} bottle`);
  context.cylinder(capMaterial, u, base + height + 0.018, d, radius * 0.58, 0.036, `${name} cap`);
  context.box(capMaterial, u, base + height * 0.46, d - radius * 0.80,
    radius * 1.25, height * 0.18, 0.012, `${name} label`);
}

function addBoxProduct(
  context: TenantBuildContext,
  material: PaletteMaterial,
  u: number,
  d: number,
  base: number,
  width: number,
  depth: number,
  height: number,
  name: string,
): void {
  context.box(material, u, base + height * 0.5, d, width, height, depth, `${name} box`);
  context.box(tint(material, `${name} label material`, 0xf4e7cf, 0.55), u, base + height * 0.52,
    d - depth * 0.51, width * 0.66, height * 0.20, 0.012, `${name} label`);
}

function addR1ProductRun(
  context: TenantBuildContext,
  item: Fixture,
  materialSet: readonly PaletteMaterial[],
  indexOffset: number,
  count: number,
  name: string,
  surfaceBase?: number,
): void {
  const [u, d, width, depth] = fixtureRect(item);
  const base = surfaceBase ?? item.height + 0.025;
  const insideCase = surfaceBase !== undefined;
  for (let index = 0; index < count; index += 1) {
    const fraction = (index + 0.5) / count;
    const productU = u + width * (0.16 + fraction * 0.68);
    const productD = d + depth * (0.30 + (index % 2) * 0.30);
    const material = materialSet[(index + indexOffset) % materialSet.length];
    if ((index + indexOffset) % 3 === 1) {
      addBottle(context, material, context.palette.brass, productU, productD, base,
        0.034 + (index % 3) * 0.006,
        insideCase ? 0.09 + (index % 3) * 0.016 : 0.14 + (index % 4) * 0.028,
        `${name} ${index + 1}`);
    } else {
      addBoxProduct(context, material, productU, productD, base, 0.12 + (index % 2) * 0.025,
        0.08 + (index % 3) * 0.012,
        insideCase ? 0.09 + (index % 3) * 0.016 : 0.12 + (index % 4) * 0.025,
        `${name} ${index + 1}`);
    }
  }
}

function addR1ShelfProducts(
  context: TenantBuildContext,
  item: Fixture,
  materialSet: readonly PaletteMaterial[],
  rows: number,
  name: string,
): void {
  const [u, d, width, depth] = fixtureRect(item);
  for (let row = 0; row < rows; row += 1) {
    const y = 0.23 + (item.height - 0.34) * (rows === 1 ? 0.5 : row / (rows - 1));
    const count = Math.max(3, Math.floor(width / 0.52));
    for (let index = 0; index < count; index += 1) {
      const productU = u + width * ((index + 0.5) / count);
      const productD = d + depth * 0.47;
      const material = materialSet[(index + row) % materialSet.length];
      if ((index + row) % 2 === 0) {
        addBottle(context, material, context.palette.brass, productU, productD, y + 0.02,
          0.028 + (index % 2) * 0.008, 0.12 + ((index + row) % 3) * 0.028, `${name} ${row + 1}-${index + 1}`);
      } else {
        addBoxProduct(context, material, productU, productD, y + 0.02,
          0.12, 0.08, 0.12 + ((index + row) % 3) * 0.025, `${name} ${row + 1}-${index + 1}`);
      }
    }
  }
}

function addR1SideWallShelf(
  context: TenantBuildContext,
  item: Fixture,
  shelfGlow: MeshStandardMaterial,
  productMaterials: readonly PaletteMaterial[],
): void {
  const [u, d, width, length] = fixtureRect(item);
  const { height } = item;
  const backU = u + width * 0.84;
  const frontU = u + width * 0.07;
  const displayStart = d + length * 0.10;
  const displayEnd = d + length * 0.97;
  const displayLength = displayEnd - displayStart;
  const displayCenter = (displayStart + displayEnd) * 0.5;
  const shelfLevels = [0.22, 0.41, 0.60, 0.80].map(level => height * level);

  // The backing is intentionally narrow in u: the fixed side wall remains the
  // background while the new rack reads as a shallow, wall-mounted display.
  context.box(context.palette.plaster, backU, height * 0.5, d + length * 0.5,
    0.045, height, length, 'R1-12 wall shelf backing');
  for (const [index, level] of shelfLevels.entries()) {
    const shelfMaterial = index % 2 === 0 ? context.palette.cream : context.palette.stone;
    context.box(shelfMaterial, u + width * 0.43, level, displayCenter,
      width * 0.79, 0.035, displayLength, `R1-12 pale shelf ${index + 1}`);
    // A very thin warm edge and under-shelf line keeps the face legible through
    // the glazing without introducing a hard white rectangle.
    context.box(context.palette.brass, frontU, level + 0.018, displayCenter,
      0.018, 0.022, displayLength, `R1-12 champagne shelf edge ${index + 1}`);
    context.box(shelfGlow, frontU - 0.014, level - 0.026, displayCenter,
      0.012, 0.012, displayLength * 0.92, `R1-12 soft shelf underlight ${index + 1}`);
  }

  for (const terminalD of [displayStart, displayEnd]) {
    context.box(context.palette.brass, frontU, height * 0.5, terminalD,
      0.018, height, 0.026, `R1-12 champagne end trim ${terminalD.toFixed(2)}`);
  }

  const wallProducts = [
    ...productMaterials.slice(0, 2).map((material, index) =>
      tint(material, `R1-12 milky product ${index + 1}`, index === 0 ? 0xe5dfd4 : 0xd8d0c1, 0.50)),
    tint(context.palette.cream, 'R1-12 pale stone product', 0xcac0ae, 0.48),
    tint(context.palette.plaster, 'R1-12 soft white product', 0xf0e8dc, 0.56),
  ];
  const positions = [
    [.08, .24, .48, .72, .90],
    [.15, .34, .58, .82],
    [.05, .26, .45, .66, .86],
    [.19, .40, .62, .85],
  ] as const;
  positions.forEach((depths, row) => {
    const base = shelfLevels[row] + 0.024;
    depths.forEach((fraction, index) => {
      const material = wallProducts[(index + row) % wallProducts.length];
      const productD = displayStart + fraction * displayLength;
      const productU = u + width * ((index + row) % 2 === 0 ? 0.36 : 0.56);
      const productName = `R1-12 wall display ${row + 1}-${index + 1}`;
      if ((index + row) % 3 === 1) {
        addBottle(context, material, context.palette.brass, productU, productD, base,
          0.027 + ((index + row) % 2) * 0.007, 0.095 + ((index + row) % 3) * 0.018,
          `${productName} tester`);
      } else {
        addBoxProduct(context, material, productU, productD, base,
          0.10 + ((index + row) % 2) * 0.022, 0.075, 0.095 + ((index + row) % 3) * 0.018,
          `${productName} box`);
      }
    });
  });
}

function furnishR1(context: TenantBuildContext): void {
  const { palette } = context;
  const shelfGlow = context.glow('East R1 warm shelf edge', 0xf1bd79, 1.35);
  const verticalGlow = context.glow('East R1 long vertical light bundles', 0xf6d09e, 2.10);
  const productMaterials = PRODUCT_COLORS.map((color, index) =>
    tint(palette.white, `East R1 product tone ${index + 1}`, color, 0.28 + (index % 3) * 0.12));
  const stone = palette.cream;
  const bronze = palette.bronze;

  const table01 = fixture(context, 'R1-01');
  const table02 = fixture(context, 'R1-02');
  if (table01) {
    addTable(context, table01, palette.lightWood, bronze, 'R1 low table A');
    addR1ProductRun(context, table01, productMaterials, 0, 8, 'R1 low table A product');
  }
  if (table02) {
    addTable(context, table02, palette.lightWood, bronze, 'R1 low table B');
    addR1ProductRun(context, table02, productMaterials, 3, 6, 'R1 low table B product');
  }

  for (const id of ['R1-03', 'R1-04', 'R1-07', 'R1-08']) {
    const item = fixture(context, id);
    if (!item) continue;
    addCase(context, item, stone, bronze, palette.caseGlass, `${id} display case`);
    addR1ProductRun(context, item, productMaterials, id.endsWith('03') ? 2 : 5, 5, `${id} product`, item.height - 0.17);
  }

  const shelfRows = new Map<string, number>([
    ['R1-05', 4], ['R1-06', 4], ['R1-09', 5], ['R1-10', 5],
  ]);
  for (const [id, rows] of shelfRows) {
    const item = fixture(context, id);
    if (!item) continue;
    const rearTrim = id === 'R1-09' || id === 'R1-10' ? palette.brass : undefined;
    addShelf(context, item, palette.plaster, palette.lightWood, shelfGlow, `${id} shelf`, rows, rearTrim);
    addR1ShelfProducts(context, item, productMaterials, rows, `${id} product`);
  }
  const rearWall = fixture(context, 'R1-11');
  if (rearWall) addWallPanel(context, rearWall, palette.plaster, palette.cream, 'R1 rear wall finish');

  const sideWallShelf = fixture(context, 'R1-12');
  if (sideWallShelf) addR1SideWallShelf(context, sideWallShelf, shelfGlow, productMaterials);

  for (const mount of context.bay.mounts ?? []) {
    if (mount.id === 'R1-M01' || mount.id === 'R1-M02') addHangingTransparentStrips(context, mount);
    if (mount.id.startsWith('R1-M0') && mount.id > 'R1-M02') addR1LightBundle(context, mount, verticalGlow);
  }
}

function furnishR2(context: TenantBuildContext): void {
  buildAtriumCafe(context);
}

function furnishR3(context: TenantBuildContext): void {
  const { palette } = context;
  const brightGlow = context.glow('East R3 bright shelf and glass light', 0xffe2b4, 1.25);
  const products = [
    tint(palette.white, 'East R3 ivory product', 0xf0e8d8, 0.42),
    tint(palette.lightWood, 'East R3 pale product', 0xc8b99a, 0.48),
    tint(palette.plaster, 'East R3 blue product', 0x9aaebb, 0.36),
  ];
  for (const id of ['R3-01', 'R3-02']) {
    const item = fixture(context, id);
    if (!item) continue;
    addCase(context, item, palette.cream, palette.brass, palette.caseGlass, `${id} bright case`);
    addR1ProductRun(context, item, products, id.endsWith('01') ? 0 : 1, 4, `${id} bright product`, item.height - 0.17);
  }
  const middleShelf = fixture(context, 'R3-03');
  if (middleShelf) {
    addShelf(context, middleShelf, palette.plaster, palette.white, brightGlow, 'R3 middle wall shelf', 4);
    addR1ShelfProducts(context, middleShelf, products, 4, 'R3 middle shelf product');
  }
  const leftPanel = fixture(context, 'R3-04');
  if (leftPanel) addWallPanel(context, leftPanel, palette.plaster, palette.white, 'R3 left wall panel');
  const rearShelf = fixture(context, 'R3-05');
  if (rearShelf) {
    addShelf(context, rearShelf, palette.cream, palette.white, brightGlow, 'R3 rear shelf', 4);
    addR1ShelfProducts(context, rearShelf, products, 4, 'R3 rear shelf product');
  }
  const plant = fixture(context, 'R3-06');
  if (plant) addPlant(context, plant, palette.cream, tint(palette.dark, 'East R3 small leaf', 0x658064, 0.82), 'R3 left rear planter');
  const light = fixture(context, 'R3-07');
  if (light) addLineLight(context, light, brightGlow, 'R3 right continuous glass-side light');
}

function furnishR4(context: TenantBuildContext): void {
  const { palette } = context;
  const dimGlow = context.glow('East R4 low shelf light', 0xc9d9de, 0.72);
  const entryCase = fixture(context, 'R4-01');
  if (entryCase) {
    addCase(context, entryCase, palette.darkWood, palette.dark, palette.caseGlass, 'R4 narrow entry case');
    addBoxProduct(context, palette.cream, entryCase.rect[0] + entryCase.rect[2] * 0.5,
      entryCase.rect[1] + entryCase.rect[3] * 0.45, entryCase.height + 0.02,
      0.11, 0.10, 0.14, 'R4 entry case box');
  }
  const sideShelf = fixture(context, 'R4-02');
  if (sideShelf) {
    addShelf(context, sideShelf, palette.darkWood, palette.lightWood, dimGlow, 'R4 narrow side shelf', 5);
    addR1ShelfProducts(context, sideShelf, [palette.cream, palette.white, palette.lightWood], 5, 'R4 side shelf product');
  }
  for (const id of ['R4-03', 'R4-04']) {
    const item = fixture(context, id);
    if (!item) continue;
    addShelf(context, item, palette.darkWood, palette.lightWood, dimGlow, `${id} rear shelf`, 2);
    addR1ShelfProducts(context, item, [palette.cream, palette.white], 2, `${id} rear shelf product`);
  }
  const line = fixture(context, 'R4-06');
  if (line) addLineLight(context, line, dimGlow, 'R4 low depth light');
}

export function furnishEastTenant(context: TenantBuildContext): void {
  if (context.bay.id === 'R1') furnishR1(context);
  else if (context.bay.id === 'R2') furnishR2(context);
  else if (context.bay.id === 'R3') furnishR3(context);
  else if (context.bay.id === 'R4') furnishR4(context);
}
