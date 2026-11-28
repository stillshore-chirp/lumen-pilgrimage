import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Material } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { createTenantFinishes, TenantPalette } from './atriumTenantLighting';
import { ATRIUM_TENANT_COMMON, ATRIUM_TENANT_GLAZING_DEPTH, tenantEntryGeometry, tenantWidth, tenantWorldPoint } from './atriumTenantPlan';
import type { TenantBay, TenantFixture } from './atriumTenantPlan';

export interface TenantBuildContext {
  bay: TenantBay;
  group: Group;
  palette: TenantPalette;
  point(u: number, y: number, d: number): Vector3;
  box(material: Material, u: number, y: number, d: number, w: number, h: number, l: number, name?: string): Mesh;
  cylinder(material: Material, u: number, y: number, d: number, radius: number, height: number, name?: string): Mesh;
  glow(name: string, color: number, onIntensity: number): MeshStandardMaterial;
}

type TenantFinishes = Pick<Awaited<ReturnType<typeof createTenantFinishes>>, 'palette' | 'glow'>;
type SolidFinish = Exclude<keyof TenantPalette, 'glass' | 'caseGlass'>;

interface StorefrontProfile {
  floor: SolidFinish;
  wall: SolidFinish;
  back: SolidFinish;
  ceiling: SolidFinish;
  reveal: SolidFinish;
  frame: SolidFinish;
  // Nominal fixed-pane width, frame sightline, and the height of its foot, in metres.
  glazing: readonly [pitch: number, frameWidth: number, sill: number];
}

const storefrontProfiles: Readonly<Record<TenantBay['id'], StorefrontProfile>> = {
  L1: { floor: 'lightWood', wall: 'wood', back: 'wood', ceiling: 'cream', reveal: 'wood', frame: 'darkWood', glazing: [1.20, .028, .026] },
  L2: { floor: 'stone', wall: 'dark', back: 'dark', ceiling: 'plaster', reveal: 'bronze', frame: 'bronze', glazing: [.95, .038, .12] },
  L3: { floor: 'stone', wall: 'lightWood', back: 'plaster', ceiling: 'cream', reveal: 'stone', frame: 'bronze', glazing: [.80, .032, .048] },
  L4: { floor: 'cream', wall: 'plaster', back: 'lightWood', ceiling: 'cream', reveal: 'stone', frame: 'brass', glazing: [1.22, .028, .036] },
  L5: { floor: 'wood', wall: 'plaster', back: 'wood', ceiling: 'cream', reveal: 'stone', frame: 'bronze', glazing: [1, .025, .046] },
  R1: { floor: 'stone', wall: 'cream', back: 'cream', ceiling: 'cream', reveal: 'stone', frame: 'bronze', glazing: [1.35, .017, .11] },
  R2: { floor: 'stone', wall: 'plaster', back: 'plaster', ceiling: 'cream', reveal: 'stone', frame: 'bronze', glazing: [1.02, .035, .055] },
  R3: { floor: 'cream', wall: 'plaster', back: 'plaster', ceiling: 'cream', reveal: 'stone', frame: 'brass', glazing: [1, .027, .033] },
  R4: { floor: 'stone', wall: 'dark', back: 'dark', ceiling: 'dark', reveal: 'dark', frame: 'bronze', glazing: [.85, .023, .033] },
  F1: { floor: 'stone', wall: 'dark', back: 'dark', ceiling: 'dark', reveal: 'dark', frame: 'bronze', glazing: [1.18, .028, .12] },
  F2: { floor: 'cream', wall: 'plaster', back: 'plaster', ceiling: 'cream', reveal: 'cream', frame: 'brass', glazing: [1.27, .020, .018] },
};

const GLASS = .0135;
const WALL_THICKNESS = .18;
const BACK_WALL_THICKNESS = .20;

export function createTenantArchitecture(root: Group, bay: TenantBay, finishes: TenantFinishes): TenantBuildContext {
  const group = new Group();
  group.name = `Atrium tenant ${bay.id}`;
  root.add(group);

  const point: TenantBuildContext['point'] = (u, y, d) => {
    const { x, z } = tenantWorldPoint(bay, u, d);
    return new Vector3(x, y, z);
  };
  const boxGeometry = new BoxGeometry(1, 1, 1);
  let cylinderGeometry: CylinderGeometry | undefined;
  // The box is symmetric along d. Keep its width along u without mirroring the west or rear group.
  const yaw = bay.side === 'rear' ? 0 : Math.PI / 2;

  const box: TenantBuildContext['box'] = (material, u, y, d, w, h, l, name = '') => {
    const mesh = new Mesh(boxGeometry, material);
    mesh.name = name;
    mesh.position.copy(point(u, y, d));
    mesh.rotation.y = yaw;
    mesh.scale.set(w, h, l);
    mesh.castShadow = !material.transparent;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const cylinder: TenantBuildContext['cylinder'] = (material, u, y, d, radius, height, name = '') => {
    cylinderGeometry ??= new CylinderGeometry(1, 1, 1, 12);
    const mesh = new Mesh(cylinderGeometry, material);
    mesh.name = name;
    mesh.position.copy(point(u, y, d));
    mesh.scale.set(radius, height, radius);
    mesh.castShadow = !material.transparent;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const context: TenantBuildContext = { bay, group, palette: finishes.palette, point, box, cylinder, glow: finishes.glow };
  const width = tenantWidth(bay);
  const profile = storefrontProfiles[bay.id];
  addRoom(context, width, profile);
  addStorefront(context, width, profile);
  addFinishDetails(context, width);
  addInteriorConstruction(context, profile);
  return context;
}

// BoxGeometry uses turns of the box for UV axes. Scale them to metres so on a long
// fascia the fine stone texture and vertical wood marks retain their local scale.
function surface(
  context: TenantBuildContext, finish: SolidFinish, u: number, y: number, d: number,
  w: number, h: number, l: number, name: string,
): Mesh {
  const material = context.palette[finish];
  const mesh = context.box(material, u, y, d, w, h, l, name);
  if (!(material instanceof MeshStandardMaterial) || (!material.map && !material.bumpMap && !material.normalMap)) return mesh;
  const geometry = mesh.geometry.clone();
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    const horizontal = normal.getX(i) ? l : w;
    const vertical = normal.getY(i) ? l : h;
    uv.setXY(i, uv.getX(i) * horizontal, uv.getY(i) * vertical);
  }
  mesh.geometry = geometry;
  return mesh;
}

function pane(context: TenantBuildContext, u: number, y: number, d: number, w: number, h: number, isReturn = false): void {
  const mesh = new Mesh(new RoundedBoxGeometry(w, h, GLASS, 1, .003), context.palette.glass);
  mesh.name = `${context.bay.id} low-iron ${isReturn ? 'door return' : 'show window'}`;
  mesh.position.copy(context.point(u, y, d));
  const yaw = context.bay.side === 'rear' ? 0 : Math.PI / 2;
  mesh.rotation.y = yaw + (isReturn ? Math.PI / 2 : 0);
  context.group.add(mesh);
}

function addRoom(context: TenantBuildContext, width: number, profile: StorefrontProfile): void {
  const { bay, box, palette } = context;
  const { id, depth, ceiling } = bay;
  const [, , setback] = bay.entry;
  surface(context, profile.floor, width / 2, -.045, depth / 2, width, .09, depth, `${id} tenant floor at FL0`);
  // Depth is measured to the finished back face. The blockwork closes the room behind it.
  surface(context, profile.back, width / 2, ceiling / 2, depth + BACK_WALL_THICKNESS / 2,
    width, ceiling, BACK_WALL_THICKNESS, `${id} finished back wall`);
  surface(context, profile.ceiling, width / 2, ceiling + .045, (depth + setback) / 2,
    width, .09, depth - setback, `${id} full depth ceiling`);
  for (const u of [WALL_THICKNESS / 2, width - WALL_THICKNESS / 2]) {
    surface(context, profile.wall, u, ceiling / 2, (depth + .075) / 2,
      WALL_THICKNESS, ceiling, depth - .075, `${id} side wall with visible return`);
    const skirting = u < width / 2 ? WALL_THICKNESS + .008 : width - WALL_THICKNESS - .008;
    box(palette[profile.frame], skirting, .038, (depth + setback) / 2,
      .016, .076, depth - setback, `${id} flush side skirting`);
  }
  box(palette[profile.frame], width / 2, .038, depth - .009,
    width - WALL_THICKNESS * 2, .076, .018, `${id} rear skirting`);

  // The doorway can sit below the main portal head even when the shop ceiling drops behind it.
  const portalHead = bay.elevation.portalHead;
  const entryGeometry = tenantEntryGeometry(bay);
  surface(context, profile.reveal, width / 2, portalHead + .031, entryGeometry.soffitDepth / 2,
    width, .062, entryGeometry.soffitDepth, `${id} storefront soffit reveal`);
  if (portalHead > ceiling) {
    box(palette[profile.ceiling], width / 2, (portalHead + ceiling) / 2, setback + .032,
      width, portalHead - ceiling, .064, `${id} ceiling transition`);
  }
}

function addOakPortal(context: TenantBuildContext, width: number): void {
  const { bay, box, palette, glow } = context;
  const { ceiling, depth, elevation: { portalHead } } = bay;
  const light = glow('L1 warm oak portal inset diffuser', 0xffd5a0, 1.10);
  // Place the light inside the 35 mm channel, in front of its darker backing.
  for (const end of [-1, 1]) {
    const u = width / 2 + end * (width / 2 - .045);
    surface(context, 'wood', u, portalHead / 2, .062, .090, portalHead, .120, 'L1 oak portal upright');
    const channelU = u - end * .066;
    box(palette.darkWood, channelU, portalHead / 2, .106, .035, portalHead, .069, 'L1 portal light channel');
    box(light, channelU, portalHead / 2 + .012, .068, .019, portalHead - .056, .013, 'L1 recessed portal light');
  }
  surface(context, 'wood', width / 2, portalHead + .045, .062, width, .090, .120, 'L1 oak portal lintel');
  box(palette.darkWood, width / 2, portalHead + .105, .106, width - .180, .035, .069, 'L1 upper light channel');
  box(light, width / 2, portalHead + .105, .068, width - .190, .019, .014, 'L1 continuous portal light');

  // Narrow seams read on the side wall from the oblique concourse view.
  for (let d = .19; d < depth - .07; d += .123) {
    box(palette.darkWood, width - WALL_THICKNESS - .001, ceiling / 2 + .030, d,
      .002, ceiling - .110, .003, 'L1 vertical oak joint');
  }
  for (let u = .24; u < width - .22; u += .123) {
    box(palette.darkWood, u, ceiling / 2 + .030, depth - .001,
      .003, ceiling - .110, .002, 'L1 rear oak joint');
  }
}

function addFinishDetails(context: TenantBuildContext, width: number): void {
  const { bay, box, palette, glow } = context;
  const { id, depth, ceiling, entry: [low, high, setback], entryHeight, elevation } = bay;
  switch (id) {
    case 'L1':
      addOakPortal(context, width);
      break;
    case 'L2': {
      const opal = glow('L2 reflected white upper cove', 0xfff2df, .94);
      const band = elevation.bands.find(({ kind }) => kind === 'light');
      if (band) {
        box(palette.bronze, width / 2, band.low - .011, .046, width, .024, .071, 'L2 cove shadow break');
        box(opal, width / 2, band.low + .018, .026, width - .064, .026, .014, 'L2 upper cove inner edge');
      }
      break;
    }
    case 'L3': {
      box(palette.bronze, low - .022, elevation.portalHead / 2, .085, .044, elevation.portalHead, .166, 'L3 dark portal wing trim');
      const diffuser = glow('L3 recessed entry warm line', 0xffdfb0, .68);
      box(diffuser, (low + high) / 2, entryHeight + .043, setback - .052, high - low - .09, .017, .017, 'L3 recessed entry diffuser');
      break;
    }
    case 'L5': {
      const sign = glow('L5 small opal marker', 0xffe4bb, .75);
      box(sign, (low + high) / 2, elevation.portalHead + .22, .007, .62, .105, .012, 'L5 opal marker with a blank face');
      break;
    }
    case 'R1': {
      const diffuser = glow('R1 champagne ceiling cove', 0xffe4bc, .57);
      box(palette.brass, width / 2, ceiling - .045, depth - .20, width - .38, .037, .090, 'R1 ceiling cove channel');
      box(diffuser, width / 2, ceiling - .067, depth - .20, width - .42, .017, .035, 'R1 rear ceiling light');
      break;
    }
    case 'R2': {
      // A short timber acoustic lining over the service side of the cafe.
      for (let u = .46; u < 2.19; u += .12) {
        box(palette.wood, u, ceiling - .024, 2.27, .054, .048, 2.53, 'R2 timber ceiling lining');
      }
      break;
    }
    case 'R3': {
      const diffuser = glow('R3 pale window side light', 0xffe9cc, .61);
      box(diffuser, width - .205, 1.65, .155, .022, 2.91, .024, 'R3 champagne jamb diffuser');
      break;
    }
    case 'F1': {
      const diffuser = glow('F1 warm entrance edge', 0xffd19d, .68);
      box(diffuser, width / 2, elevation.portalHead + .045, .006, width - .11, .023, .012, 'F1 warm edge under unmarked fascia');
      box(palette.bronze, low - .130, ceiling - .011, depth / 2 + .10, .032, .022, depth - .68, 'F1 lengthwise ceiling reveal');
      break;
    }
  }
}

function addAdjustableShelves(
  context: TenantBuildContext, id: string, left: number, face: number, width: number, spans: number, finish: SolidFinish,
): void {
  const { box, palette } = context;
  const span = width / spans;
  for (let i = 0; i < spans; i++) {
    const u = left + (i + .5) * span;
    for (const side of [-1, 1]) {
      box(palette.bronze, u + side * (span / 2 - .080), 1.35, face - .009, .018, 2.23, .018, `${id} adjustable rail`);
    }
    for (const y of [.60, 1.19, 1.79]) {
      box(palette[finish], u, y, face - .075, span - .114, .029, .150, `${id} shallow shelf`);
    }
  }
}

function addRearAccent(context: TenantBuildContext, item: TenantFixture): void {
  const { box, palette, glow } = context;
  const { id, height, rect: [left, front, width, length] } = item;
  const center = left + width / 2;
  const warm = glow('F1 accent panel hidden warm edge', 0xffc897, .38);
  const surroundDepth = .052;
  surface(context, 'dark', center, height / 2, front + (length + surroundDepth) / 2,
    width, height, length - surroundDepth, `${id} floating microcement support`);
  box(warm, center, height / 2, front + .046, width - .005, height - .005, .012, `${id} recessed light in shadow joint`);
  box(palette.dark, center, height / 2, front + .018, width - .040, height - .040, .036, `${id} microcement face`);
}

function addOpalBackWall(context: TenantBuildContext, item: TenantFixture): void {
  const { box, palette, glow } = context;
  const { id, height, rect: [left, front, width, length] } = item;
  const u = left + width / 2;
  const revealDepth = .039;
  const side = width * .14;
  const apron = .225;
  const head = .235;
  const panelWidth = width - side * 2;
  const panelHeight = height - apron - head;
  const opal = glow('F2 warm rear opal wall', 0xeed6ad, .43);
  const cove = glow('F2 recessed warm cove diffuser', 0xffddb4, .75);
  surface(context, 'plaster', u, height / 2, front + (length + revealDepth) / 2,
    width, height, length - revealDepth, `${id} mineral wall backing`);
  for (const edge of [left + side / 2, left + width - side / 2]) {
    surface(context, 'plaster', edge, height / 2, front + revealDepth / 2,
      side, height, revealDepth, `${id} mineral wall jamb`);
  }
  surface(context, 'plaster', u, apron / 2, front + revealDepth / 2, panelWidth, apron, revealDepth, `${id} mineral wall apron`);
  surface(context, 'plaster', u, height - head / 2, front + revealDepth / 2, panelWidth, head, revealDepth, `${id} mineral wall head`);
  box(palette.cream, u, apron + panelHeight / 2, front + .026, panelWidth, panelHeight, .025, `${id} opal panel fine surround`);
  box(opal, u, apron + panelHeight / 2, front + .014,
    panelWidth - .034, panelHeight - .034, .012, `${id} recessed opal surface`);
  const ceiling = context.bay.ceiling;
  box(palette.cream, u, height - .022, front + .027, width - .030, .044, .054, `${id} cove fascia`);
  box(cove, u, (height + ceiling) / 2, front + .043, width - .068, .021, .033, `${id} continuous ceiling cove diffuser`);
}

function addInteriorConstruction(context: TenantBuildContext, profile: StorefrontProfile): void {
  const { bay, box, palette, glow } = context;
  for (const item of bay.fixtures) {
    const { id, type, height, rect: [u, d, w, l] } = item;
    if (id === 'F2-08') {
      const diffuser = glow('F2 soft warm right slit', 0xffe7c6, .36);
      surface(context, 'cream', u + w / 2, height / 2, d + (l + .025) / 2, w, height, l - .025, `${id} slit housing`);
      box(palette.brass, u + w / 2, height / 2, d + .015, w, height, .023, `${id} slit edge`);
      box(diffuser, u + w / 2, height / 2, d + .007, w - .036, height - .050, .014, `${id} right opal slit`);
      continue;
    }
    // These two side and rear panels are furnished with their east shops.
    if (type !== 'wall' || id === 'R1-11' || id === 'R3-04') continue;
    const centerU = u + w / 2;
    const centerD = d + l / 2;
    switch (id) {
      case 'L1-09': {
        const wash = glow('L1 warm rear oak cove', 0xffd2a1, .61);
        const coveHeight = .075;
        surface(context, 'wood', centerU, (height - coveHeight) / 2, centerD,
          w, height - coveHeight, l, `${id} oak display wall`);
        surface(context, 'wood', centerU, height - coveHeight / 2, centerD + .016,
          w, coveHeight, l - .032, `${id} oak cove backing`);
        for (let edge = u + .45; edge < u + w - .15; edge += .45) {
          box(palette.darkWood, edge, (height - coveHeight) / 2, d - .0005,
            .003, height - coveHeight - .035, .002, `${id} oak panel joint`);
        }
        box(palette.wood, centerU, height - .018, d + .017, w, .036, .034, `${id} oak cove lip`);
        box(wash, centerU, height - .051, d + .010, w - .034, .014, .013, `${id} continuous rear diffuser`);
        break;
      }
      case 'L2-11': {
        surface(context, 'dark', centerU, height / 2, centerD, w, height, l, `${id} dark display wall and booth backing`);
        const partitions = bay.fixtures.filter(part => part.type === 'wall' && part.rect[1] < d);
        const boothEnd = Math.max(u, ...partitions.map(part => part.rect[0] + part.rect[2]));
        const displayStart = boothEnd + .105;
        const displayWidth = u + w - displayStart - .10;
        addAdjustableShelves(context, id, displayStart, d, displayWidth, 4, 'darkWood');
        const wash = glow('L2 rear display warm vertical diffuser', 0xffce9a, .34);
        for (const index of [1, 2, 3]) {
          box(wash, displayStart + displayWidth * index / 4, 1.43, d - .006,
            .015, 2.21, .012, `${id} vertical wall wash`);
        }
        break;
      }
      case 'L3-08':
        surface(context, 'plaster', centerU, height / 2, centerD, w, height, l, `${id} mineral display wall`);
        addAdjustableShelves(context, id, centerU - 1.18, d, 2.36, 2, 'lightWood');
        break;
      case 'L4-08': {
        surface(context, 'lightWood', centerU, height / 2, centerD + .015, w, height, l - .030, `${id} ribbed rear backing`);
        for (let rib = u + .11; rib < u + w - .055; rib += .18) {
          box(palette.brass, rib, height / 2, d + .015, .020, height - .144, .030, `${id} champagne relief rib`);
        }
        const wash = glow('L4 warm rear rib wash', 0xffd6a3, .57);
        box(palette.brass, centerU, height - .027, d + .020, w, .054, .040, `${id} wall wash lip`);
        box(wash, centerU, height - .069, d + .021, w - .065, .018, .014, `${id} concealed warm wash slot`);
        break;
      }
      case 'L5-07':
        surface(context, 'wood', centerU, height / 2, centerD, w, height, l, `${id} shallow shelf backing`);
        addAdjustableShelves(context, id, u + .095, d, w - .19, 2, 'lightWood');
        break;
      case 'R4-05': {
        surface(context, 'dark', centerU, height / 2, centerD, w, height, l, `${id} stair-side matte partition`);
        box(palette.bronze, u + w + .001, 1.24, d + 1.19, .005, .84, .42, `${id} flush service-hatch perimeter`);
        box(palette.dark, u + w + .004, 1.24, d + 1.19, .004, .827, .407, `${id} inset access hatch`);
        break;
      }
      case 'F1-05':
        addRearAccent(context, item);
        break;
      case 'F1-06': {
        const lower = surface(context, 'dark', centerU, .9, centerD, w, 1.8, l, `${id} sealed microcement below 1800 mm`);
        const sealed = palette.dark.clone();
        sealed.name = 'F1 sealed lower microcement';
        sealed.roughness = .69;
        lower.material = sealed;
        surface(context, 'dark', centerU, (height + 1.8) / 2, centerD, w, height - 1.8, l, `${id} matte rear wall above dado`);
        const wash = glow('F1 concealed wall washer', 0xffd4a3, .42);
        box(palette.dark, centerU, height + .041, d + .032, w, .046, .064, `${id} rear ceiling washer baffle`);
        box(wash, centerU, height + .013, d + .008, w - .055, .014, .014, `${id} warm wall washer diffuser`);
        break;
      }
      case 'F2-07':
        addOpalBackWall(context, item);
        break;
      default:
        surface(context, profile.wall, centerU, (height - .017) / 2, centerD, w, height - .017, l, `${id} fitting room partition`);
        box(palette[profile.frame], centerU, height - .0085, centerD, w, .017, l, `${id} partition edge cap`);
    }
  }
}

function fixedGlazing(context: TenantBuildContext, profile: StorefrontProfile, low: number, high: number): void {
  const { bay, box, palette } = context;
  const { id, elevation: { portalHead } } = bay;
  const [pitch, frameWidth, sill] = profile.glazing;
  const frameDepth = id === 'L2' ? .055 : .042;
  const frame = palette[profile.frame];
  const extent = high - low;
  const count = Math.max(1, Math.round(extent / pitch));
  const step = extent / count;
  const paneHeight = portalHead - sill - .019;
  const paneCenterY = sill + paneHeight / 2;
  const joint = id === 'R1' ? .012 : .009;
  const d = ATRIUM_TENANT_GLAZING_DEPTH;
  box(frame, (low + high) / 2, portalHead - .018, d, extent, .036, frameDepth, `${id} fixed glass head rail`);
  box(frame, (low + high) / 2, sill / 2, d, extent, sill, id === 'R1' ? .102 : .061, `${id} fixed glass sill`);
  for (let i = 0; i < count; i++) {
    pane(context, low + step * (i + .5), paneCenterY, d, step - joint, paneHeight);
  }
  for (let i = 0; i <= count; i++) {
    const u = Math.max(low + frameWidth / 2, Math.min(high - frameWidth / 2, low + step * i));
    box(frame, u, paneCenterY, d, frameWidth, paneHeight, frameDepth, `${id} fixed glass mullion`);
  }
  if (id === 'L4') {
    // The narrow ribs sit behind the glass without taking part in the mullion grid.
    for (let u = low + .075; u < high - .025; u += .18) {
      box(palette.brass, u, paneCenterY, d + GLASS / 2 + .021, .020, paneHeight, .028, `${id} champagne rib`);
    }
  }
  if (id === 'R2' && high <= bay.entry[0]) {
    box(frame, (low + high) / 2, 1.04, d, extent, .025, .040, `${id} low window divider`);
  }
}

function addDoorway(context: TenantBuildContext, profile: StorefrontProfile): void {
  const { bay, box, palette } = context;
  const { id, entry: [low, high, setback], entryHeight, elevation: { portalHead } } = bay;
  const width = high - low;
  const mid = (low + high) / 2;
  const frame = palette[profile.frame];
  const isOpenPortal = bay.frontage.some(segment => segment.kind === 'open');
  const jambWidth = id === 'L1' ? .055 : .042;
  const transom = portalHead - entryHeight;
  const track = id === 'L4' || id === 'F2' ? palette.brass : palette.bronze;

  // The frame stands outside the designed clear opening, including at the rear jamb.
  for (const [edge, direction] of [[low, -1], [high, 1]] as const) {
    const jambU = edge + direction * jambWidth / 2;
    box(frame, jambU, portalHead / 2, setback, jambWidth, portalHead, .080, `${id} recessed entrance jamb`);
    const adjacent = bay.frontage.find(segment => Math.abs((direction < 0 ? segment.u[1] : segment.u[0]) - edge) < .001);
    if (adjacent?.kind === 'glass') {
      const returnHeight = entryHeight - .038;
      const returnStart = ATRIUM_TENANT_GLAZING_DEPTH + .026;
      pane(context, jambU, returnHeight / 2 + .018, (setback + returnStart) / 2,
        setback - returnStart, returnHeight, true);
      box(frame, jambU, .015, (setback + returnStart) / 2, .028, .030, setback - returnStart, `${id} fixed return foot`);
      box(frame, jambU, entryHeight + .012, (setback + returnStart) / 2,
        .028, .024, setback - returnStart, `${id} fixed return head`);
    } else {
      surface(context, profile.reveal, jambU, portalHead / 2, (setback + .050) / 2,
        jambWidth, portalHead, setback + .050, `${id} solid entry reveal`);
    }
  }
  box(track, mid, -.0008, .012, width, .003, .018, `${id} flush floor finish transition`);
  if (!isOpenPortal) {
    box(track, mid, -.0008, setback, width, .003, .018, `${id} recessed flush door track`);
    box(frame, mid, entryHeight + .0275, setback, width, .055, .084, `${id} recessed sliding door head`);
    pane(context, mid, entryHeight + (transom + .049) / 2, setback, width - .012, transom - .061);
    box(frame, mid, portalHead - .016, setback, width, .032, .063, `${id} transom head frame`);
  } else {
    surface(context, profile.reveal, mid, entryHeight + transom / 2, setback,
      width, transom, tenantEntryGeometry(bay).lintelDepth, `${id} open entrance lintel`);
    if (id === 'R4') {
      box(frame, mid, entryHeight + .008, setback - .026, width - .036, .016, .034, `${id} concealed shutter slot`);
    }
  }
}

function addStorefront(context: TenantBuildContext, width: number, profile: StorefrontProfile): void {
  const { bay, palette, box, glow } = context;
  const { id, elevation, frontage, entry: [, , setback] } = bay;
  for (let i = 0; i < frontage.length; i++) {
    const { kind, u: [low, high] } = frontage[i];
    if (kind === 'wall') {
      const height = elevation.portalHead;
      surface(context, profile.reveal, (low + high) / 2, height / 2, (setback + .046) / 2,
        high - low, height, setback + .046, `${id} finished storefront wing wall`);
    } else if (kind === 'glass') {
      // The several viewing zones in R1's design share a single panel grid.
      let edge = high;
      while (frontage[i + 1]?.kind === 'glass') edge = frontage[++i].u[1];
      fixedGlazing(context, profile, low, edge);
    }
  }
  addDoorway(context, profile);

  const rearReveal = ATRIUM_TENANT_COMMON.rearReveals.find(reveal => reveal.id === id);
  const cap = rearReveal?.head ?? ATRIUM_TENANT_COMMON.soffit;
  // Close the header above the scenery opening. The visible bands sit on a different plane.
  surface(context, profile.reveal, width / 2, (cap + elevation.portalHead) / 2, .194,
    width, cap - elevation.portalHead, .120, `${id} header backing`);
  for (const { low, high, kind } of elevation.bands) {
    if (kind === 'plant') continue;
    const middleY = (low + high) / 2;
    const height = high - low;
    if (kind === 'light') {
      surface(context, 'cream', width / 2, middleY, .095, width, height, .122, `${id} opal header housing`);
      const opal = glow(`${id} translucent upper storefront band`, id === 'L2' ? 0xfff0dc : 0xffe3bd, id === 'L2' ? .78 : .42);
      box(opal, width / 2, middleY, .041, width - .046, height - .040, .015, `${id} softly lit upper band`);
    } else {
      const facade = kind === 'warm' ? palette[profile.reveal] : palette[profile.frame];
      const finish = id === 'R4' ? new MeshStandardMaterial({ name: 'Matte blue-grey fasciaboard', color: 0x495560, roughness: .72 }) : facade;
      const bandDepth = id === 'L1' ? .144 : .069;
      box(finish, width / 2, middleY, bandDepth, width, height, .120, `${id} unmarked storefront band`);
    }
  }
}
