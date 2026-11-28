import { registerTenantWalkFixture } from './atriumTenantWalking';
import {
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import type { TenantBuildContext } from './atriumTenantArchitecture';

type Fixture = TenantBuildContext['bay']['fixtures'][number];
type Palette = TenantBuildContext['palette'];
type StoreVariant = 'wood' | 'black' | 'small' | 'gold';
type GarmentShape = 'shirt' | 'coat' | 'dress';

interface WestAssets {
  palette: Palette;
  clothGeometry: readonly PlaneGeometry[];
  curtainGeometry: PlaneGeometry;
  clothMaterials: readonly MeshStandardMaterial[];
  curtainMaterial: MeshStandardMaterial;
  darkCurtainMaterial: MeshStandardMaterial;
  softGlow: MeshStandardMaterial;
  caseGlow: MeshStandardMaterial;
}

const cachedAssets = new WeakMap<Palette, WestAssets>();

function garmentProfile(shape: GarmentShape, drop: number): number {
  if (shape === 'shirt') {
    if (drop < 0.08) return 0.28 + drop / 0.08 * 0.34;
    if (drop < 0.20) return 0.62 + (drop - 0.08) / 0.12 * 0.43;
    if (drop < 0.36) return 1.05 - (drop - 0.20) / 0.16 * 0.26;
    if (drop < 0.75) return 0.79;
    return 0.79 + (drop - 0.75) / 0.25 * 0.07;
  }
  if (shape === 'coat') {
    if (drop < 0.10) return 0.30 + drop / 0.10 * 0.40;
    if (drop < 0.22) return 0.70 + (drop - 0.10) / 0.12 * 0.38;
    if (drop < 0.40) return 1.08 - (drop - 0.22) / 0.18 * 0.24;
    if (drop < 0.78) return 0.84;
    return 0.84 + (drop - 0.78) / 0.22 * 0.08;
  }
  if (drop < 0.08) return 0.26 + drop / 0.08 * 0.38;
  if (drop < 0.20) return 0.64 + (drop - 0.08) / 0.12 * 0.25;
  if (drop < 0.47) return 0.89 - (drop - 0.20) / 0.27 * 0.33;
  if (drop < 0.64) return 0.56 + (drop - 0.47) / 0.17 * 0.25;
  return 0.81 + (drop - 0.64) / 0.36 * 0.19;
}

function clothGeometry(shape: GarmentShape, pattern: number): PlaneGeometry {
  const geometry = new PlaneGeometry(1, 1, 16, 14);
  const positions = geometry.getAttribute('position');
  const colors: number[] = [];
  const base = new Color(0xffffff);
  const columns = 16;
  const rows = 14;
  for (let row = 0; row <= rows; row += 1) {
    const drop = row / rows;
    for (let column = 0; column <= columns; column += 1) {
      const across = column / columns * 2 - 1;
      const index = row * (columns + 1) + column;
      const profile = garmentProfile(shape, drop);
      const folds = Math.cos(across * 17.0 + drop * 3.2) * (0.010 + drop * 0.025);
      const sideFold = Math.abs(across) ** 1.8 * Math.sin(drop * 13.0 + across * 4.0) * 0.018;
      const hem = Math.sin(across * 9.0 + pattern * 1.4) * 0.018 * drop ** 2;
      positions.setX(index, across * profile * 0.5);
      positions.setY(index, 0.5 - drop);
      positions.setZ(index, folds + sideFold + hem);

      let tone = 0.88 + Math.cos(across * 12.0 + drop * 2.4) * 0.075;
      if (pattern === 1) tone += (Math.cos(across * 26.0 + drop * 2.0) > 0.35 ? 0.16 : -0.08);
      if (pattern === 2) tone += Math.sin(across * 18.0) * Math.sin(drop * 17.0) * 0.16;
      if (shape === 'dress' && drop > 0.62) tone += Math.sin(across * 10.0) * 0.045;
      tone = Math.min(1, Math.max(0.42, tone));
      base.setRGB(tone, tone, tone);
      colors.push(base.r, base.g, base.b);
    }
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Keep fitting curtains rectangular; garment profiles are intentionally shaped. */
function curtainGeometry(): PlaneGeometry {
  const geometry = new PlaneGeometry(1, 1, 12, 8);
  const positions = geometry.getAttribute('position');
  const colors: number[] = [];
  const base = new Color(0xffffff);
  for (let row = 0; row <= 8; row += 1) {
    const drop = row / 8;
    for (let column = 0; column <= 12; column += 1) {
      const across = column / 12 * 2 - 1;
      const index = row * 13 + column;
      positions.setZ(index, Math.cos(across * 13.0 + drop * 1.7) * (0.012 + drop * 0.020));
      const tone = 0.91 + Math.cos(across * 11.0 + drop * 2.0) * 0.055;
      base.setRGB(tone, tone, tone);
      colors.push(base.r, base.g, base.b);
    }
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function clothMaterial(base: MeshStandardMaterial, color: number, name: string): MeshStandardMaterial {
  const material = base.clone();
  material.name = name;
  material.color.setHex(color);
  material.vertexColors = true;
  material.roughness = 0.92;
  material.side = DoubleSide;
  return material;
}

function assetsFor(context: TenantBuildContext): WestAssets {
  const existing = cachedAssets.get(context.palette);
  if (existing) return existing;

  const { palette } = context;
  const garmentColors = [
    0x43536b, 0xb66f56, 0xe2d4c2, 0x70556a, 0x5a8290, 0xb29c80, 0x77796a,
  ];
  const assets: WestAssets = {
    palette,
    clothGeometry: [
      clothGeometry('shirt', 0), clothGeometry('shirt', 1),
      clothGeometry('coat', 0), clothGeometry('coat', 1),
      clothGeometry('dress', 0), clothGeometry('dress', 1),
    ],
    curtainGeometry: curtainGeometry(),
    clothMaterials: garmentColors.map((color, index) =>
      clothMaterial(palette.fabric, color, `west unbranded garment ${index + 1}`)),
    curtainMaterial: clothMaterial(palette.fabric, 0x766860, 'west fitting curtain warm gray'),
    darkCurtainMaterial: clothMaterial(palette.fabric, 0x35353b, 'west fitting curtain charcoal'),
    softGlow: context.glow('west soft display light', 0xffe3c2, 0.78),
    caseGlow: context.glow('west case tray light', 0xffe6c6, 1.05),
  };
  cachedAssets.set(palette, assets);
  return assets;
}

function fixture(context: TenantBuildContext, id: string): Fixture {
  const found = context.bay.fixtures.find(item => item.id === id);
  if (!found) throw new Error(`Missing west tenant fixture: ${id}`);
  return found;
}

function bounds(item: Fixture): { u: number; d: number; width: number; length: number; height: number } {
  const [u, d, width, length] = item.rect;
  return { u, d, width, length, height: item.height };
}

function center(item: Fixture): { u: number; d: number; width: number; length: number; height: number } {
  const value = bounds(item);
  return {
    ...value,
    u: value.u + value.width * 0.5,
    d: value.d + value.length * 0.5,
  };
}

function addGarment(
  context: TenantBuildContext,
  assets: WestAssets,
  u: number,
  d: number,
  baseY: number,
  width: number,
  height: number,
  index: number,
  shape: GarmentShape,
  pattern: number,
  name: string,
): void {
  const shapeIndex = shape === 'shirt' ? 0 : shape === 'coat' ? 2 : 4;
  const garment = new Mesh(assets.clothGeometry[shapeIndex + (pattern % 2)],
    assets.clothMaterials[index % assets.clothMaterials.length]);
  garment.name = name;
  garment.position.copy(context.point(u, baseY + height * 0.5, d));
  garment.rotation.y = Math.PI * 0.5;
  garment.rotation.z = Math.sin(index * 1.37) * 0.045;
  garment.scale.set(width, height, 1);
  garment.castShadow = true;
  garment.receiveShadow = true;
  context.group.add(garment);
}

function addCurtain(
  context: TenantBuildContext,
  assets: WestAssets,
  u: number,
  d: number,
  width: number,
  railY: number,
  dark: boolean,
  name: string,
): void {
  const floorGap = 0.035;
  const railThickness = 0.025;
  const height = railY - railThickness * 0.5 - floorGap;
  const curtain = new Mesh(assets.curtainGeometry, dark ? assets.darkCurtainMaterial : assets.curtainMaterial);
  curtain.name = name;
  curtain.position.copy(context.point(u, floorGap + height * 0.5, d));
  curtain.rotation.y = Math.PI * 0.5;
  curtain.scale.set(width, height, 1);
  curtain.castShadow = true;
  curtain.receiveShadow = true;
  context.group.add(curtain);
}

function addRack(
  context: TenantBuildContext,
  assets: WestAssets,
  item: Fixture,
  variant: StoreVariant,
): void {
  const p = assets.palette;
  const { u, d, width, length, height } = center(item);
  const metal = variant === 'wood' || variant === 'gold' ? p.brass : p.dark;
  const shelf = variant === 'wood' ? p.lightWood : variant === 'black' ? p.darkWood : p.wood;
  const postHeight = Math.max(0.78, height - 0.06);
  for (const side of [-1, 1]) {
    context.box(metal, u + side * (width * 0.5 - 0.025), postHeight * 0.5, d,
      0.035, postHeight, 0.035, `${item.id} rack upright`);
  }
  context.box(metal, u, height - 0.07, d, Math.max(0.18, width - 0.04), 0.035, 0.035,
    `${item.id} rack rail`);
  context.box(shelf, u, 0.24, d, Math.max(0.18, width - 0.08), 0.075, Math.max(0.14, length - 0.08),
    `${item.id} lower shelf`);

  const quantity = Math.max(4, Math.min(7, Math.round(width / 0.20)));
  const garmentBaseHeight = Math.min(0.98, Math.max(0.68, height - 0.36));
  for (let index = 0; index < quantity; index += 1) {
    const fraction = (index + 0.5) / quantity;
    const garmentU = u + (fraction - 0.5) * Math.max(0.12, width - 0.10);
    const garmentD = d - length * 0.34;
    const shape: GarmentShape = index % 3 === 0 ? 'shirt' : index % 3 === 1 ? 'coat' : 'dress';
    const shapeHeight = shape === 'shirt' ? Math.min(0.78, garmentBaseHeight) : garmentBaseHeight;
    const itemHeight = shapeHeight * (0.92 + (index % 3) * 0.04);
    const itemWidth = (shape === 'shirt' ? 0.22 : shape === 'coat' ? 0.27 : 0.25)
      * (0.94 + (index % 2) * 0.06);
    const garmentBase = Math.max(0.25, height - 0.16 - itemHeight);
    const garmentIndex = index + item.id.length;
    addGarment(context, assets, garmentU, garmentD, garmentBase, itemWidth, itemHeight,
      garmentIndex, shape, (garmentIndex + index) % 2, `${item.id} ${shape} garment ${index + 1}`);
    context.box(metal, garmentU, height - 0.15, garmentD, 0.018, 0.08, 0.018,
      `${item.id} hanger ${index + 1}`);
  }
}

function addWallLineDisplay(
  context: TenantBuildContext,
  assets: WestAssets,
  item: Fixture,
  variant: StoreVariant,
): void {
  const p = assets.palette;
  const { u, d, width, length, height } = bounds(item);
  const centerU = u + width * 0.5;
  const centerD = d + length * 0.5;
  const metal = variant === 'wood' ? p.brass : p.dark;
  const shelf = variant === 'wood' ? p.lightWood : p.white;
  const shelfWidth = Math.max(0.12, width - 0.035);
  const shelfLength = Math.max(0.18, length - 0.08);
  context.box(shelf, centerU, 0.245, centerD, shelfWidth, 0.070, shelfLength,
    `${item.id} wall-line lower folded shelf`);
  context.box(metal, centerU, height - 0.105, centerD, shelfWidth, 0.035, shelfLength,
    `${item.id} wall-line long garment rail`);
  for (const side of [-1, 1]) {
    context.box(metal, centerU + side * Math.max(0.035, shelfWidth * 0.42), height * 0.50, centerD,
      0.018, height - 0.19, 0.018, `${item.id} wall-line end support`);
  }

  const isL1 = item.id === 'L1-15';
  const shapes: readonly GarmentShape[] = isL1
    ? ['coat', 'dress', 'shirt']
    : ['dress', 'shirt', 'coat', 'dress'];
  const materialIndices = isL1 ? [5, 1, 0] : [2, 5, 2, 4];
  const garmentWidth = Math.min(width - 0.055, isL1 ? 0.215 : 0.175);
  const garmentHeight = Math.min(height - 0.34, isL1 ? 0.95 : 1.12);
  for (let index = 0; index < shapes.length; index += 1) {
    const fraction = (index + 0.5) / shapes.length;
    const garmentD = d + fraction * length;
    const shape = shapes[index];
    const itemHeight = garmentHeight * (shape === 'shirt' ? 0.80 : shape === 'dress' ? 0.96 : 1);
    const baseY = Math.max(0.30, height - 0.16 - itemHeight);
    addGarment(context, assets, centerU, garmentD, baseY, garmentWidth, itemHeight,
      materialIndices[index], shape, index % 2, `${item.id} wall-line ${shape} ${index + 1}`);
    context.box(metal, centerU, height - 0.15, garmentD, 0.018, 0.08, 0.018,
      `${item.id} wall-line hanger ${index + 1}`);
  }

  // The pale lower stacks make the long L2 display legible even when garments overlap in perspective.
  if (!isL1) {
    for (let index = 0; index < 3; index += 1) {
      const stackD = d + (index + 0.5) * length / 3;
      context.box(index % 2 === 0 ? p.cream : p.lightWood, centerU, 0.35, stackD,
        Math.max(0.12, width - 0.07), 0.11, Math.min(0.28, length / 4),
        `${item.id} folded light fabric stack ${index + 1}`);
      context.box(p.white, centerU, 0.415, stackD, Math.max(0.11, width - 0.085), 0.025,
        Math.min(0.25, length / 4 - 0.02), `${item.id} folded stack highlight ${index + 1}`);
    }
  }
}

function addShelf(
  context: TenantBuildContext,
  assets: WestAssets,
  item: Fixture,
  variant: StoreVariant,
): void {
  const p = assets.palette;
  const { u, d, width, length, height } = center(item);
  const shelfMaterial = variant === 'wood' ? p.wood : variant === 'gold' ? p.lightWood : p.darkWood;
  const edgeMaterial = variant === 'gold' ? p.brass : p.dark;
  for (const side of [-1, 1]) {
    context.box(edgeMaterial, u + side * (width * 0.5 - 0.018), height * 0.5, d,
      0.036, height, 0.036, `${item.id} shelf upright`);
  }
  const rows = Math.max(2, Math.min(5, Math.floor((height - 0.22) / 0.42)));
  for (let row = 0; row < rows; row += 1) {
    const shelfY = 0.18 + row * ((height - 0.30) / Math.max(1, rows - 1));
    context.box(shelfMaterial, u, shelfY, d, Math.max(0.16, width - 0.055), 0.045,
      Math.max(0.12, length - 0.045), `${item.id} shelf ${row + 1}`);
    for (let index = 0; index < 2; index += 1) {
      const itemU = u + (index - 0.5) * Math.min(0.25, width * 0.34);
      const itemD = d - length * 0.18;
      const itemHeight = 0.10 + ((row + index) % 2) * 0.035;
      context.box(index % 2 === 0 ? p.cream : p.brass, itemU, shelfY + 0.075 + itemHeight * 0.5,
        itemD, 0.11, itemHeight, Math.min(0.12, Math.max(0.06, length * 0.32)),
        `${item.id} small item ${row + 1}-${index + 1}`);
    }
  }
}

function addCase(
  context: TenantBuildContext,
  assets: WestAssets,
  item: Fixture,
  variant: StoreVariant,
): void {
  const p = assets.palette;
  const { u, d, width, length, height } = center(item);
  const baseHeight = Math.max(0.62, height - 0.28);
  const baseMaterial = variant === 'black' ? p.dark : variant === 'gold' ? p.cream : p.stone;
  const trimMaterial = variant === 'wood' ? p.brass : variant === 'gold' ? p.brass : p.dark;
  context.box(baseMaterial, u, baseHeight * 0.5, d, width - 0.04, baseHeight, length - 0.04,
    `${item.id} case base`);
  context.box(trimMaterial, u, baseHeight + 0.012, d, width, 0.025, length,
    `${item.id} case rim`);
  context.box(assets.caseGlow, u, baseHeight + 0.032, d - length * 0.04,
    Math.max(0.12, width - 0.12), 0.018, Math.max(0.10, length - 0.12), `${item.id} lit tray`);
  context.box(p.caseGlass, u, baseHeight + 0.14, d, Math.max(0.12, width - 0.05), 0.26,
    Math.max(0.10, length - 0.05), `${item.id} low case glass`);
  for (let index = 0; index < 3; index += 1) {
    const itemU = u + (index - 1) * Math.min(0.20, width * 0.25);
    const itemD = d + (index % 2 === 0 ? -0.08 : 0.08) * Math.min(1, length);
    context.box(index === 1 ? p.brass : p.cream, itemU, baseHeight + 0.07,
      itemD, 0.10, 0.10 + (index % 2) * 0.04, Math.min(0.10, length * 0.28),
      `${item.id} case object ${index + 1}`);
  }
}

function addTable(
  context: TenantBuildContext,
  assets: WestAssets,
  item: Fixture,
  variant: StoreVariant,
): void {
  const p = assets.palette;
  const { u, d, width, length, height } = center(item);
  const top = variant === 'black' ? p.white : variant === 'gold' ? p.cream : p.wood;
  const leg = variant === 'wood' ? p.brass : p.dark;
  context.box(top, u, height - 0.04, d, width, 0.08, length, `${item.id} table top`);
  for (const du of [-1, 1]) {
    for (const dd of [-1, 1]) {
      context.box(leg, u + du * Math.max(0.05, width * 0.33), 0.28,
        d + dd * Math.max(0.05, length * 0.31), 0.045, 0.56, 0.045, `${item.id} table leg`);
    }
  }
  for (let index = 0; index < 2; index += 1) {
    context.box(index === 0 ? p.lightWood : p.cream, u + (index - 0.5) * width * 0.28,
      height + 0.075 + index * 0.055, d - length * 0.08, width * 0.22, 0.055,
      Math.max(0.12, length * 0.34), `${item.id} folded stack ${index + 1}`);
  }
}

function addCounter(
  context: TenantBuildContext,
  assets: WestAssets,
  item: Fixture,
  variant: StoreVariant,
): void {
  const p = assets.palette;
  const { u, d, width, length, height } = center(item);
  const front = variant === 'wood' ? p.wood : variant === 'gold' ? p.cream : p.darkWood;
  const top = variant === 'black' ? p.dark : variant === 'gold' ? p.brass : p.wood;
  context.box(front, u, height * 0.48, d, width, height * 0.92, length, `${item.id} counter front`);
  context.box(top, u, height - 0.035, d, width + 0.02, 0.07, length + 0.02, `${item.id} counter top`);
  context.box(p.brass, u - width * 0.22, height + 0.075, d - length * 0.12,
    0.18, 0.09, 0.12, `${item.id} register`);
  context.box(assets.softGlow, u + width * 0.18, height + 0.038, d - length * 0.20,
    width * 0.28, 0.018, length * 0.18, `${item.id} counter task light`);
}

function addSeat(
  context: TenantBuildContext,
  assets: WestAssets,
  item: Fixture,
): void {
  const p = assets.palette;
  const { u, d, width, length, height } = center(item);
  context.box(p.fabric, u, height - 0.07, d, width, 0.14, length, `${item.id} upholstered seat`);
  for (const side of [-1, 1]) {
    context.box(p.dark, u + side * Math.max(0.05, width * 0.34), height * 0.42, d,
      0.035, height * 0.84, 0.035, `${item.id} seat leg`);
  }
  context.box(assets.softGlow, u, height + 0.018, d - length * 0.36,
    Math.max(0.12, width * 0.55), 0.012, 0.018, `${item.id} seat edge highlight`);
}

function furnishFixture(
  context: TenantBuildContext,
  assets: WestAssets,
  item: Fixture,
  variant: StoreVariant,
): void {
  const walkingStart = context.group.children.length;
  if (item.id === 'L1-15' || item.id === 'L2-19') {
    addWallLineDisplay(context, assets, item, variant);
    registerTenantWalkFixture(context.group, walkingStart, {
      tenantId: context.bay.id, fixtureId: item.id, kind: item.type === 'rack' ? 'rack' : 'rigid',
    });
    return;
  }
  switch (item.type) {
    case 'rack':
      addRack(context, assets, item, variant);
      break;
    case 'shelf':
      addShelf(context, assets, item, variant);
      break;
    case 'case':
      addCase(context, assets, item, variant);
      break;
    case 'table':
      addTable(context, assets, item, variant);
      break;
    case 'counter':
      addCounter(context, assets, item, variant);
      break;
    case 'seat':
      addSeat(context, assets, item);
      break;
    case 'plant':
    case 'wall':
    case 'other':
      // Walls and any architectural enclosures belong to the shared architecture lane.
      break;
    default:
      break;
  }
  registerTenantWalkFixture(context.group, walkingStart, {
    tenantId: context.bay.id, fixtureId: item.id, kind: item.type === 'rack' ? 'rack' : 'rigid',
  });
}

function addMirror(context: TenantBuildContext, material: MeshStandardMaterial, u: number, wallD: number, name: string): void {
  // The mirror is fixed to the concourse-facing side of the rear partition.
  const d = wallD - 0.009;
  context.box(material, u, 1.23, d, 0.56, 1.65, 0.018, name);
  context.box(material, u, 1.23, d - 0.014, 0.035, 1.71, 0.010, `${name} edge`);
}

function addL1FittingRoom(context: TenantBuildContext, assets: WestAssets): void {
  const walkingStart = context.group.children.length;
  addCurtain(context, assets, 4.205, 6.285, 1.05, 2.42, false, 'L1 fitting room privacy curtain');
  context.box(assets.palette.brass, 4.205, 2.42, 6.285, 1.05, 0.025, 0.025, 'L1 fitting curtain rail');
  addMirror(context, assets.palette.caseGlass, 4.205, 8.115, 'L1 fitting room mirror');
  registerTenantWalkFixture(context.group, walkingStart, {
    tenantId: context.bay.id, fixtureId: 'L1-privacy', kind: 'cloth',
  });
}

function addL2FittingRooms(context: TenantBuildContext, assets: WestAssets): void {
  const walkingStart = context.group.children.length;
  const rooms = [
    { u: 1.175, mirrorU: 1.18, name: 'A' },
    { u: 2.995, mirrorU: 3.00, name: 'B' },
  ];
  for (const room of rooms) {
    addCurtain(context, assets, room.u, 7.095, 1.05, 2.42, true, `L2 fitting room ${room.name} curtain`);
    context.box(assets.palette.dark, room.u, 2.42, 7.095, 1.05, 0.025, 0.025,
      `L2 fitting room ${room.name} curtain rail`);
    addMirror(context, assets.palette.caseGlass, room.mirrorU, 9.30, `L2 fitting room ${room.name} mirror`);
  }
  registerTenantWalkFixture(context.group, walkingStart, {
    tenantId: context.bay.id, fixtureId: 'L2-privacy', kind: 'cloth',
  });
}

function addL2WhiteForeground(context: TenantBuildContext, assets: WestAssets): void {
  const p = assets.palette;
  for (const id of ['L2-02', 'L2-03'] as const) {
    const walkingStart = context.group.children.length;
    const item = center(fixture(context, id));
    context.box(p.white, item.u, item.height + 0.012, item.d,
      Math.max(0.14, item.width - 0.08), 0.025, Math.max(0.10, item.length - 0.08),
      `${id} white foreground plinth`);
    registerTenantWalkFixture(context.group, walkingStart, {
      tenantId: context.bay.id, fixtureId: id, kind: 'rigid',
    });
  }
}

function furnishL1(context: TenantBuildContext, assets: WestAssets): void {
  addL1FittingRoom(context, assets);
  for (const item of context.bay.fixtures) furnishFixture(context, assets, item, 'wood');
}

function furnishL2(context: TenantBuildContext, assets: WestAssets): void {
  addL2WhiteForeground(context, assets);
  addL2FittingRooms(context, assets);
  for (const item of context.bay.fixtures) furnishFixture(context, assets, item, 'black');
}

function furnishL3(context: TenantBuildContext, assets: WestAssets): void {
  for (const item of context.bay.fixtures) furnishFixture(context, assets, item, 'small');
}

function furnishL4(context: TenantBuildContext, assets: WestAssets): void {
  for (const item of context.bay.fixtures) furnishFixture(context, assets, item, 'gold');
}

function furnishL5(context: TenantBuildContext, assets: WestAssets): void {
  for (const item of context.bay.fixtures) furnishFixture(context, assets, item, 'small');
}

/** Build the west-side tenant fixtures and product foregrounds from the design fixtures. */
export function furnishWestTenant(context: TenantBuildContext): void {
  const assets = assetsFor(context);
  switch (context.bay.id) {
    case 'L1':
      furnishL1(context, assets);
      break;
    case 'L2':
      furnishL2(context, assets);
      break;
    case 'L3':
      furnishL3(context, assets);
      break;
    case 'L4':
      furnishL4(context, assets);
      break;
    case 'L5':
      furnishL5(context, assets);
      break;
    default:
      break;
  }
}
