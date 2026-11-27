import {
  Box3, BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, LatheGeometry, Mesh,
  CatmullRomCurve3, MeshStandardMaterial, PlaneGeometry, SpotLight, TorusGeometry, TubeGeometry, Vector2, Vector3, Vector4,
} from 'three';
import type { Material, Object3D, Texture, WebGLRenderer } from 'three';
import type { CoastQuality } from '../../CoastWorld';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import {
  ATRIUM_FRONT_CENTRAL_JOINERY, ATRIUM_FRONT_END_BAYS, ATRIUM_FRONT_GARDEN, ATRIUM_FRONT_GLAZING, ATRIUM_FRONT_LIGHTING, ATRIUM_FRONT_ROOM_FIXTURES,
  ATRIUM_FRONT_TENANTS, ATRIUM_FRONT_UPPER_BOUNDS, ATRIUM_FRONT_UPPER_ROOMS, atriumFrontTenantPoint,
} from './atriumFrontPlan';
import type { AtriumFrontLocalFixture, AtriumFrontTenant } from './atriumFrontPlan';
import { createFrontMaterials } from './atriumFrontMaterials';
import type { FrontMaterials } from './atriumFrontMaterials';
import { getAtriumFrontSurfaces } from './atriumFrontShell';
import { applyAtriumFrontOcclusion } from './atriumFrontOcclusion';
import type { FrontAoContact, FrontAoReceiver } from './atriumFrontOcclusion';

type Rect = Readonly<{ x: number; z: number; width: number; depth: number; height: number }>;
type PhysicalContact = { object: Object3D; shape: 'rect' | 'ellipse'; strength: number; falloff: number };
type OcclusionInputs = {
  contacts: PhysicalContact[];
  tops: Mesh[];
  backs: { mesh: Mesh; occluders: Object3D[] }[];
};
type Build = { group: Group; palette: FrontMaterials; occlusion: OcclusionInputs };
type FixtureLight = { light: SpotLight; onIntensity: number };
type Receiver = { on: { value: number }; material: MeshStandardMaterial };

function addMesh(build: Build, geometry: BufferGeometry, material: Material, name: string,
  x: number, y: number, z: number): Mesh {
  if (material instanceof MeshStandardMaterial && material.vertexColors && !geometry.hasAttribute('color')) {
    geometry.setAttribute('color', new Float32BufferAttribute(
      new Float32Array(geometry.getAttribute('position').count * 3).fill(1), 3));
  }
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  build.group.add(mesh);
  return mesh;
}

// UVs carry metres; texture frequency therefore survives furniture dimension changes.
function metreUV(geometry: BufferGeometry, width: number, height: number, depth: number): BufferGeometry {
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < uv.count; i += 1) {
    const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i));
    uv.setXY(i, uv.getX(i) * (nx > .7 ? depth : width), uv.getY(i) * (ny > .7 ? depth : height));
  }
  return geometry;
}

function box(build: Build, material: Material, x: number, y: number, z: number,
  width: number, height: number, depth: number, name: string, radius = 0): Mesh {
  const geometry = radius > 0
    ? new RoundedBoxGeometry(width, height, depth, 2, Math.min(radius, width / 3, height / 3, depth / 3))
    : new BoxGeometry(width, height, depth);
  return addMesh(build, metreUV(geometry, width, height, depth), material, name, x, y, z);
}

function rod(build: Build, material: Material, a: Vector3, b: Vector3, radius: number, name: string): void {
  const direction = b.clone().sub(a);
  const mesh = addMesh(build, new CylinderGeometry(radius, radius, direction.length(), 10), material, name,
    (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
}

function table(build: Build, rect: Rect, surface: Material, floor: number, name: string): void {
  const { palette } = build;
  const top = box(build, surface, rect.x, floor + rect.height - .032, rect.z,
    rect.width, .064, rect.depth, `${name} solid top with eased edges`, .014);
  build.occlusion.tops.push(top);
  const legTop = floor + rect.height - .064;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = rect.x + sx * (rect.width / 2 - .11);
    const z = rect.z + sz * (rect.depth / 2 - .11);
    const foot = box(build, palette.darkOak, x, (floor + legTop) / 2, z, .055, legTop - floor, .055,
      `${name} floor-supported leg`, .006);
    build.occlusion.contacts.push({ object: foot, shape: 'rect', strength: .30, falloff: .06 });
  }
  for (const sz of [-1, 1]) {
    box(build, palette.darkOak, rect.x, legTop - .055, rect.z + sz * (rect.depth / 2 - .11),
      rect.width - .20, .11, .035, `${name} apron below top`);
  }
}

/** Binding is a volume: two cover boards, rounded spine and a recessed page block. */
function book(build: Build, x: number, bottom: number, z: number, height: number,
  thickness: number, depth: number, variant: number, name: string, flat = false, yaw = 0): void {
  const group = new Group();
  group.name = name;
  group.position.set(x, bottom, z);
  group.rotation.y = yaw;
  const local: Build = { group, palette: build.palette, occlusion: build.occlusion };
  const cover = build.palette.covers[variant % build.palette.covers.length];
  const board = .003;
  box(local, build.palette.paper, 0, height / 2, .003, thickness - board * 2,
    height - .009, depth - .014, `${name} unprinted page block`);
  for (const sign of [-1, 1]) {
    const coverBoard = box(local, cover, sign * (thickness - board) / 2, height / 2, 0,
      board, height, depth, `${name} cloth covered board`);
    if (flat && sign < 0) build.occlusion.tops.push(coverBoard);
  }
  const spine = addMesh(local, new CylinderGeometry(1, 1, height, 8), cover,
    `${name} low polygon rounded binding spine`, 0, height / 2, -depth / 2 + .0035);
  spine.scale.set(thickness / 2, 1, .004);
  // Quiet horizontal tooling on the spine, with no cover text or external artwork.
  if (variant % 3 === 0) for (const ratio of [.18, .82]) {
    box(local, build.palette.paper, 0, height * ratio, -depth / 2 - .0005,
      thickness * .65, .002, .0015, `${name} unlettered spine tooling`);
  }
  if (flat) {
    group.rotation.z = -Math.PI / 2;
    group.position.y += thickness / 2;
    group.position.x -= height / 2;
  }
  build.group.add(group);
  build.occlusion.contacts.push({ object: group, shape: 'rect', strength: .20, falloff: .035 });
}

function bookGroup(build: Build, left: number, shelfY: number, z: number,
  count: number, seed: number, maxWidth: number): void {
  let cursor = left;
  for (let i = 0; i < count; i += 1) {
    const thickness = .021 + ((i * 7 + seed * 3) % 7) * .005;
    if (cursor + thickness > left + maxWidth) break;
    const height = .205 + ((i * 5 + seed * 2) % 8) * .014;
    const depth = .15 + ((i * 3 + seed) % 4) * .012;
    book(build, cursor + thickness / 2, shelfY, z + (i % 3) * .005,
      height, thickness, depth, i + seed, 'grouped clothbound volume');
    cursor += thickness + .0025;
  }
}

function shelf(build: Build, rect: Rect, floor: number, mode: 'books' | 'craft', name: string): void {
  const { palette } = build;
  const firstChild = build.group.children.length;
  const back = box(build, palette.darkOak, rect.x, floor + rect.height / 2, rect.z + rect.depth / 2 - .010,
    rect.width, rect.height, .020, `${name} visible backing`);
  const levels = mode === 'books' ? 5 : 4;
  const bayCount = Math.max(2, Math.round(rect.width / 1.1));
  const bayWidth = (rect.width - .06) / bayCount;
  for (let bay = 0; bay <= bayCount; bay += 1) {
    box(build, palette.oak, rect.x - rect.width / 2 + .015 + bayWidth * bay,
      floor + rect.height / 2, rect.z, .030, rect.height, rect.depth, `${name} vertical divider`);
  }
  for (let row = 0; row <= levels; row += 1) {
    const y = floor + .07 + row * (rect.height - .10) / levels;
    const board = box(build, palette.oak, rect.x, y, rect.z, rect.width, .028, rect.depth, `${name} shelf with front edge`);
    build.occlusion.tops.push(board);
    if (row === levels) continue;
    for (let bay = 0; bay < bayCount; bay += 1) {
      const left = rect.x - rect.width / 2 + .045 + bay * bayWidth;
      if (mode === 'books') {
        const count = (row + bay) % 4 === 0 ? 8 : 16;
        bookGroup(build, left + .025, y + .014, rect.z - .035, count, row * 3 + bay, bayWidth - .12);
        if ((row + bay) % 3 === 1) {
          book(build, left + bayWidth - .28, y + .014, rect.z - .015,
            .22, .035, .16, bay + row + 2, 'horizontal shelf folio', true);
        }
      } else {
        ceramic(build, left + bayWidth * .28, y + .014, rect.z - .035,
          .17 + (row + bay) % 3 * .035, .075 + bay % 2 * .015, (row + bay) % 3,
          palette.glaze[(row + bay) % palette.glaze.length], 'shelved ceramic with open mouth');
        if ((row + bay) % 2 === 0) ceramic(build, left + bayWidth * .70, y + .014, rect.z + .025,
          .13, .095, 1, palette.glaze[(row + bay + 2) % palette.glaze.length], 'small shelved bowl');
      }
    }
  }
  const plinth = box(build, palette.darkOak, rect.x, floor + .035, rect.z, rect.width - .08, .070,
    rect.depth - .04, `${name} continuous recessed plinth`);
  build.occlusion.contacts.push({ object: plinth, shape: 'rect', strength: .28, falloff: .055 });
  build.occlusion.backs.push({ mesh: back, occluders: build.group.children.slice(firstChild).filter(item => item !== back) });
}

/** Closed lathe section travels up the outside, over the lip, down the inside. */
function ceramic(build: Build, x: number, bottom: number, z: number, height: number,
  radius: number, form: number, material: Material, name: string): void {
  const vase = [
    [0, 0], [.42, 0], [.48, .035], [.48, .10], [.67, .17], [.91, .31], [1, .48],
    [.96, .60], [.78, .74], [.47, .85], [.45, .96], [.50, 1], [.39, 1], [.36, .94],
    [.38, .85], [.69, .72], [.86, .58], [.88, .46], [.77, .30], [.49, .18], [0, .15],
  ];
  const bowl = [
    [0, 0], [.40, 0], [.46, .04], [.46, .12], [.59, .19], [.77, .40], [.93, .72],
    [1, .95], [.98, 1], [.91, 1], [.88, .77], [.71, .45], [.47, .27], [0, .24],
  ];
  const cup = [
    [0, 0], [.57, 0], [.61, .05], [.61, .12], [.80, .17], [.86, .40], [.94, .94],
    [1, .98], [.98, 1], [.87, 1], [.83, .91], [.76, .38], [.65, .24], [0, .22],
  ];
  const points = (form % 3 === 0 ? vase : form % 3 === 1 ? bowl : cup)
    .map(([r, y]) => new Vector2(r * radius, y * height));
  const geometry = new LatheGeometry(points, 28);
  const colors: number[] = [];
  const insideStart = form % 3 === 0 ? 12 : form % 3 === 1 ? 9 : 9;
  for (let i = 0; i < geometry.getAttribute('position').count; i += 1) {
    const profileIndex = i % points.length;
    // Interior clay and enclosed surfaces receive less indirect light; keep the
    // open mouth legible without adding a black cap or an emitting surface.
    const tone = profileIndex >= insideStart ? .52 + .27 * points[profileIndex].y / height : 1;
    colors.push(tone, tone, tone);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const mesh = addMesh(build, geometry, material, name, x, bottom, z);
  mesh.userData.frontCeramic = { form: form % 3, height, radius, hollow: true };
  // The unglazed foot is inset, touches the support and does not cap the vessel mouth.
  const foot = addMesh(build, new CylinderGeometry(radius * .40, radius * .40, height * .018, 20),
    build.palette.clay, `${name} unglazed foot`, x, bottom + height * .009, z);
  build.occlusion.contacts.push({ object: foot, shape: 'ellipse', strength: .30, falloff: .045 });
}

function craftDisplay(build: Build, rect: Rect, top: number, seed: number): void {
  const { palette } = build;
  const items = [
    { x: -.31, z: -.04, h: .35, r: .115, form: 0 },
    { x: .08, z: .08, h: .16, r: .145, form: 1 },
    { x: .34, z: -.09, h: .23, r: .085, form: 2 },
  ];
  const scale = Math.min(1, rect.width / 1.3);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    ceramic(build, rect.x + item.x * scale, top, rect.z + item.z,
      item.h, item.r, item.form, palette.glaze[(i + seed) % palette.glaze.length],
      'original ceramic display vessel');
  }
  const tray = addMesh(build, new LatheGeometry([
    new Vector2(0, 0), new Vector2(.22, 0), new Vector2(.27, .013), new Vector2(.27, .025),
    new Vector2(.245, .025), new Vector2(.21, .012), new Vector2(0, .012),
  ], 32), palette.wood, 'turned oak tray with shallow rim', rect.x - rect.width * .30, top, rect.z + .08);
  tray.scale.z = .65;
  build.occlusion.contacts.push({ object: tray, shape: 'ellipse', strength: .22, falloff: .035 });
}

function paperDisplay(build: Build, rect: Rect, top: number): void {
  for (let i = 0; i < 3; i += 1) {
    book(build, rect.x - rect.width * .27 + i * .012, top + i * .035, rect.z - .05,
      .26, .035, .20, 2 + i, 'stacked closed binding sample', true, .08 * (i - 1));
  }
  for (let i = 0; i < 5; i += 1) {
    const sample = box(build, i % 2 ? build.palette.paper : build.palette.felt,
      rect.x + rect.width * .22 + i * .008, top + .002 + i * .0025,
      rect.z + .025, .27, .0018, .32, 'unprinted paper and cloth sample fan');
    sample.rotation.y = (i - 2) * .09;
  }
}

function seat(build: Build, rect: Rect, floor: number, name: string, backTop: number, seatTop = .45): void {
  const { palette } = build;
  const cushionTop = floor + seatTop;
  const cushionDepth = rect.depth - .12;
  box(build, palette.darkOak, rect.x, floor + .25, rect.z, rect.width - .12, .14, rect.depth - .10,
    `${name} closed timber seat frame`, .016);
  const count = Math.max(2, Math.round(rect.width / .75));
  for (let i = 0; i < count; i += 1) {
    const x = rect.x - rect.width / 2 + (i + .5) * rect.width / count;
    box(build, palette.fabric, x, cushionTop - .065, rect.z - .018,
      rect.width / count - .018, .13, cushionDepth, `${name} separate upholstered cushion`, .035);
    const back = box(build, palette.fabric, x, floor + (.48 + backTop) / 2, rect.z + rect.depth / 2 - .09,
      rect.width / count - .018, backTop - .48, .16, `${name} upholstered back with seam gap`, .035);
    back.rotation.x = -.045;
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const foot = box(build, palette.bronze, rect.x + sx * (rect.width / 2 - .14), floor + .095,
      rect.z + sz * (rect.depth / 2 - .12), .040, .190, .040, `${name} bronze foot`);
    build.occlusion.contacts.push({ object: foot, shape: 'rect', strength: .30, falloff: .055 });
  }
  for (const sx of [-1, 1]) box(build, palette.oak, rect.x + sx * (rect.width / 2 - .025),
    floor + .58, rect.z, .045, .10, rect.depth - .03, `${name} timber arm`, .012);
  for (const sx of [-1, 1]) box(build, palette.darkOak, rect.x + sx * (rect.width / 2 - .12),
    floor + (.24 + backTop - .04) / 2, rect.z + rect.depth / 2 - .055,
    .035, backTop - .28, .035, `${name} supported back post`);
  box(build, palette.darkOak, rect.x, floor + .46, rect.z + rect.depth / 2 - .055,
    rect.width - .20, .10, .035, `${name} back support rail`);
}

function curtain(build: Build, rect: Rect, floor: number, bottom: number, top: number): void {
  const width = rect.width;
  const height = top - bottom;
  const thickness = .008;
  const columns = 72, rows = 10;
  const front = new PlaneGeometry(width, height, columns, rows);
  const source = front.getAttribute('position');
  const sourceUV = front.getAttribute('uv');
  const positions: number[] = [], uv: number[] = [], colors: number[] = [];
  const indices: number[] = [];
  for (let side = 0; side < 2; side += 1) {
    for (let i = 0; i < source.count; i += 1) {
      const x = source.getX(i), y = source.getY(i);
      const fold = Math.cos((x / width + .5) * Math.PI * 28);
      positions.push(x, y, fold * rect.depth * .39 + Math.sin(y * 1.4) * .006 + side * thickness);
      uv.push(sourceUV.getX(i) * width, sourceUV.getY(i) * height);
      const tone = (.88 + fold * .10) * (side ? .96 : 1);
      colors.push(tone, tone, tone);
    }
  }
  const original = front.index!;
  for (let i = 0; i < original.count; i += 3) {
    const a = original.getX(i), b = original.getX(i + 1), c = original.getX(i + 2);
    // Common side looks toward -Z. The rear follows exactly the same wave,
    // offset by real thickness; rotating the wave would intersect the cloth.
    indices.push(a, c, b, a + source.count, b + source.count, c + source.count);
  }
  const perimeter: number[] = [];
  for (let col = 0; col <= columns; col += 1) perimeter.push(col);
  for (let row = 1; row <= rows; row += 1) perimeter.push(row * (columns + 1) + columns);
  for (let col = columns - 1; col >= 0; col -= 1) perimeter.push(rows * (columns + 1) + col);
  for (let row = rows - 1; row > 0; row -= 1) perimeter.push(row * (columns + 1));
  for (let i = 0; i < perimeter.length; i += 1) {
    const a = perimeter[i], b = perimeter[(i + 1) % perimeter.length];
    indices.push(a, b + source.count, b, a, a + source.count, b + source.count);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.frontCurtain = { thickness, closed: true, pairedVertexCount: source.count };
  front.dispose();
  build.palette.curtain.vertexColors = true;
  addMesh(build, geometry, build.palette.curtain, 'salon thick closed curtain with hanging folds',
    rect.x, floor + bottom + height / 2, rect.z);
  rod(build, build.palette.bronze,
    new Vector3(rect.x - width / 2, floor + top + .025, rect.z),
    new Vector3(rect.x + width / 2, floor + top + .025, rect.z), .014, 'curtain support rail');
}

function tenantBuild(parent: Build, tenant: AtriumFrontTenant): Build {
  const group = new Group();
  group.name = `Front ${tenant.id} ${tenant.name} furnishings`;
  const point = atriumFrontTenantPoint(tenant, 0, 0);
  group.position.set(point.x, 0, point.z);
  group.rotation.y = tenant.side < 0 ? -Math.PI / 2 : Math.PI / 2;
  parent.group.add(group);
  return { group, palette: parent.palette, occlusion: parent.occlusion };
}

function tenantRect(tenant: AtriumFrontTenant, fixture: AtriumFrontLocalFixture): Rect {
  return {
    x: (tenant.side < 0 ? 1 : -1) * (fixture.u + fixture.width / 2),
    z: fixture.d + fixture.depth / 2,
    width: fixture.width, depth: fixture.depth, height: fixture.height,
  };
}

function storeInterior(parent: Build, tenant: AtriumFrontTenant): void {
  const build = tenantBuild(parent, tenant);
  const { palette } = build;
  const front = tenantRect(tenant, tenant.fixtures.frontTable);
  const middle = tenantRect(tenant, tenant.fixtures.middleDisplay);
  const back = tenantRect(tenant, tenant.fixtures.backShelf);
  const service = tenantRect(tenant, tenant.fixtures.serviceCounter);
  table(build, front, tenant.id === 'W' ? palette.oak : palette.stone, 0, `${tenant.id} low display table`);
  table(build, middle, tenant.id === 'W' ? palette.darkOak : palette.stone, 0, `${tenant.id} middle display`);
  shelf(build, back, 0, tenant.id === 'W' ? 'books' : 'craft', `${tenant.id} deep display shelf`);
  if (tenant.id === 'W') {
    paperDisplay(build, front, front.height);
    paperDisplay(build, middle, middle.height);
  } else {
    craftDisplay(build, front, front.height, 0);
    craftDisplay(build, middle, middle.height, 2);
  }
  const cabinet = box(build, palette.darkOak, service.x, .44, service.z, service.width - .08, .88, service.depth - .06,
    `${tenant.id} service cabinet with toe recess`, .014);
  build.occlusion.contacts.push({ object: cabinet, shape: 'rect', strength: .25, falloff: .055 });
  box(build, palette.stone, service.x, service.height - .020, service.z,
    service.width, .040, service.depth, `${tenant.id} service worktop`, .010);
  const sign = tenant.side < 0 ? 1 : -1;
  for (const u of tenant.entryU) {
    box(build, tenant.id === 'W' ? palette.oak : palette.bronze,
      sign * u, tenant.entryHeight / 2, tenant.entryRecess + .04,
      .090, tenant.entryHeight, .080, `${tenant.id} recessed inner portal stile`);
  }
  box(build, tenant.id === 'W' ? palette.oak : palette.bronze,
    sign * (tenant.entryU[0] + tenant.entryU[1]) / 2, tenant.entryHeight + .045,
    tenant.entryRecess + .04, tenant.entryU[1] - tenant.entryU[0] + .09, .09, .080,
    `${tenant.id} recessed portal lintel`);
}

function upperInteriors(build: Build): void {
  const { palette } = build;
  for (const fixture of ATRIUM_FRONT_ROOM_FIXTURES) {
    const room = ATRIUM_FRONT_UPPER_ROOMS.find(item => item.id === fixture.room);
    if (!room) continue;
    const { bounds } = fixture;
    const rect = {
      x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2,
      width: bounds.maxX - bounds.minX, depth: bounds.maxZ - bounds.minZ, height: fixture.top,
    };
    const floor = room.floorY;
    if (fixture.kind === 'bookshelf') shelf(build, rect, floor, 'books', 'reading room grouped bookcase');
    else if (fixture.kind === 'readingTable') {
      table(build, rect, palette.oak, floor, 'communal reading table');
      for (let i = 0; i < 3; i += 1) book(build, rect.x - .70 + i * .72,
        floor + rect.height, rect.z + .05, .28, .038, .21, i + 1, 'closed reading room folio', true, .10 * i);
    } else if (fixture.kind === 'banquette' || fixture.kind === 'bench') {
      seat(build, rect, floor, `${room.id} built in seat`, fixture.top);
    } else if (fixture.kind === 'curtain') curtain(build, rect, floor, fixture.bottom, fixture.top);
    else if (fixture.kind === 'lowCase') {
      table(build, rect, palette.stone, floor, 'gallery low sample table');
      if (rect.x < 0) paperDisplay(build, rect, floor + rect.height);
      else craftDisplay(build, rect, floor + rect.height, 1);
    } else if (fixture.kind === 'woodPanel') {
      const height = fixture.top - fixture.bottom;
      box(build, palette.oak,
        rect.x, floor + fixture.bottom + height / 2, rect.z, rect.width, height, rect.depth,
        `${room.id} supported timber ${fixture.kind}`);
      const count = Math.round(rect.width / .18);
      for (let i = 1; i < count; i += 1) box(build, palette.bronze,
        rect.x - rect.width / 2 + rect.width * i / count, floor + fixture.bottom + height / 2,
        bounds.minZ - .001, .003, height - .025, .002, 'fine vertical timber joint');

    }
  }
}


function rectFromBounds(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, height: number): Rect {
  return { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2,
    width: bounds.maxX - bounds.minX, depth: bounds.maxZ - bounds.minZ, height };
}

/** A continuous library wall with a supported, recessed reading place. */
function centralLibrary(build: Build): void {
  const plan = ATRIUM_FRONT_CENTRAL_JOINERY.readingLibrary;
  const room = ATRIUM_FRONT_UPPER_ROOMS.find(item => item.id === 'reading')!;
  const { niche } = plan;
  const depth = plan.backZ - plan.frontZ;
  for (const [left, right] of [[plan.minX, niche.minX], [niche.maxX, plan.maxX]]) {
    shelf(build, { x: (left + right) / 2, z: (plan.frontZ + plan.backZ) / 2,
      width: right - left, depth, height: plan.height }, room.floorY, 'books', 'central built in library');
  }
  const nicheWidth = niche.maxX - niche.minX;
  const nicheDepth = niche.backZ - niche.frontZ;
  const cx = (niche.minX + niche.maxX) / 2;
  const cz = (niche.frontZ + niche.backZ) / 2;
  const firstNiche = build.group.children.length;
  const lining = box(build, build.palette.fabric, cx, room.floorY + plan.height / 2, niche.backZ - .022,
    nicheWidth, plan.height, .044, 'reading alcove soft rear lining');
  for (const x of [niche.minX, niche.maxX]) box(build, build.palette.darkOak,
    x, room.floorY + plan.height / 2, cz, .060, plan.height, nicheDepth, 'deep reading alcove side return');
  box(build, build.palette.darkOak, cx, room.floorY + plan.height - .055, cz,
    nicheWidth, .110, nicheDepth, 'reading alcove timber head');
  seat(build, { x: cx, z: cz, width: nicheWidth - .09, depth: nicheDepth - .04,
    height: niche.backTop }, room.floorY, 'integrated reading alcove bench', niche.backTop, niche.seatY);
  const diffuser = build.palette.diffuser('reading alcove concealed task diffuser', .30);
  box(build, diffuser, cx, room.floorY + plan.height - .080, niche.frontZ + .15,
    nicheWidth - .28, .012, .035, 'reading alcove protected task strip');
  build.occlusion.backs.push({ mesh: lining,
    occluders: build.group.children.slice(firstNiche).filter(item => item !== lining) });
}

/** Original large material studies, supported and separated in depth. */
function materialComposition(build: Build, rect: Rect, floor: number, bottom: number,
  kind: 'paper-stone' | 'ceramic-wood', name: string): void {
  const { palette } = build;
  const height = rect.height - bottom;
  const frontZ = rect.z - rect.depth / 2;
  const backing = box(build, palette.darkOak, rect.x, floor + bottom + height / 2,
    rect.z + rect.depth / 2 - .020, rect.width, height, .040, `${name} thick supported backing`);
  const occluders: Object3D[] = [];
  if (bottom > 0) {
    // Wall mounted displays are tied back to the real room back wall, rather
    // than suspended as freestanding sheets above the floor.
    for (const sx of [-1, 1]) for (const ratio of [.25, .75]) {
      const backZ = ATRIUM_FRONT_UPPER_BOUNDS.maxZ;
      box(build, palette.bronze, rect.x + sx * rect.width * .36,
        floor + bottom + height * ratio, (backZ + rect.z + rect.depth / 2) / 2,
        .045, .045, Math.max(.03, backZ - rect.z - rect.depth / 2), `${name} wall fixing bracket`);
    }
  } else {
    const foot = box(build, palette.darkOak, rect.x, floor + .055, rect.z,
      rect.width, .11, rect.depth, `${name} floor plinth`);
    build.occlusion.contacts.push({ object: foot, shape: 'rect', strength: .25, falloff: .05 });
  }
  if (kind === 'paper-stone') {
    for (let i = 0; i < 4; i += 1) {
      occluders.push(box(build, i % 2 ? palette.stone : palette.felt,
        rect.x - rect.width * .23, floor + bottom + .38 + i * height * .205,
        frontZ - .035 - i % 2 * .025, rect.width * .38, height * .17, .09,
        'large mineral relief section with open joint', .008));
    }
    for (let i = 0; i < 3; i += 1) {
      const mesh = box(build, i === 1 ? palette.paper : palette.wood,
        rect.x + rect.width * .20 + i * .022, floor + bottom + height * .51,
        frontZ - .09 - i * .027, rect.width * .34, height * (.68 - i * .04), .022,
        'large layered paper and wood sample panel');
      mesh.rotation.z = (i - 1) * .035;
      occluders.push(mesh);
    }
  } else {
    for (let i = 0; i < 5; i += 1) occluders.push(box(build,
      i % 2 ? palette.wood : palette.oak, rect.x - rect.width * .31 + i * rect.width * .11,
      floor + bottom + height * .50, frontZ - .035 - (i % 3) * .025,
      rect.width * .065, height * (.72 + i % 2 * .10), .065, 'material archive timber cross section'));
    for (let i = 0; i < 2; i += 1) {
      const radius = Math.min(.34, rect.width * .115) * (i ? .78 : 1);
      const ring = addMesh(build, new TorusGeometry(radius, .045, 8, 32), palette.glaze[i ? 1 : 0],
        'large hollow ceramic study ring', rect.x + rect.width * .23,
        floor + bottom + height * (.32 + i * .35), frontZ - .10);
      ring.userData.frontCeramic = { form: 'ring', hollow: true };
      occluders.push(ring);
      box(build, palette.bronze, ring.position.x, ring.position.y, frontZ - .035,
        .025, .025, .14, 'ceramic study ring mounting peg');
    }
  }
  build.occlusion.backs.push({ mesh: backing, occluders });
}

function bindingPress(build: Build, x: number, top: number, z: number): void {
  const { palette } = build;
  const base = box(build, palette.darkOak, x, top + .024, z, .82, .048, .46,
    'display bookbinding press base', .010);
  build.occlusion.contacts.push({ object: base, shape: 'rect', strength: .25, falloff: .045 });
  for (const side of [-1, 1]) box(build, palette.oak, x + side * .33, top + .39, z,
    .075, .72, .12, 'book press upright');
  box(build, palette.darkOak, x, top + .72, z, .82, .10, .18, 'book press supported header');
  box(build, palette.oak, x, top + .14, z, .56, .045, .34, 'book press lower platen');
  book(build, x, top + .164, z, .24, .030, .20, 3, 'closed binding under display press', true);
  box(build, palette.darkOak, x, top + .2165, z, .54, .045, .32, 'book press upper platen');
  rod(build, palette.bronze, new Vector3(x, top + .237, z), new Vector3(x, top + .84, z),
    .018, 'book press threaded spindle core');
  const helix: Vector3[] = [];
  for (let i = 0; i <= 100; i += 1) {
    const angle = i / 100 * Math.PI * 20;
    helix.push(new Vector3(x + Math.cos(angle) * .023, top + .27 + i / 100 * .45,
      z + Math.sin(angle) * .023));
  }
  addMesh(build, new TubeGeometry(new CatmullRomCurve3(helix), 100, .0035, 5, false), palette.bronze,
    'book press continuous helical thread', 0, 0, 0);
  const wheel = addMesh(build, new TorusGeometry(.115, .009, 6, 24), palette.bronze,
    'book press handwheel', x, top + .84, z);
  wheel.rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i += 1) {
    const angle = i / 3 * Math.PI * 2;
    rod(build, palette.bronze, new Vector3(x, top + .84, z),
      new Vector3(x + Math.cos(angle) * .115, top + .84, z + Math.sin(angle) * .115), .006,
      'book press handwheel spoke');
  }
}

function addedFrontUses(build: Build): void {
  centralLibrary(build);
  const gallery = ATRIUM_FRONT_UPPER_ROOMS.find(item => item.id === 'gallery')!;
  for (const display of ATRIUM_FRONT_CENTRAL_JOINERY.galleryDisplays) {
    materialComposition(build, rectFromBounds(display.bounds, display.top), gallery.floorY, display.bottom,
      display.id, `gallery ${display.id} built in study`);
  }
  for (const bay of ATRIUM_FRONT_END_BAYS) {
    const back = rectFromBounds(bay.backFitting, bay.backFitting.height);
    const display = rectFromBounds(bay.table, bay.table.height);
    table(build, display, bay.id === 'W' ? build.palette.oak : build.palette.stone,
      bay.floorY, `${bay.id} end alcove study table`);
    if (bay.id === 'W') {
      shelf(build, back, bay.floorY, 'books', 'binding archive wall of books and paper');
      bindingPress(build, display.x + display.width * .15, bay.floorY + display.height, display.z);
      paperDisplay(build, { ...display, x: display.x - display.width * .27, width: 1.2 }, bay.floorY + display.height);
    } else {
      materialComposition(build, back, bay.floorY, 0, 'ceramic-wood', 'craft end alcove material wall');
      craftDisplay(build, display, bay.floorY + display.height, 1);
    }
  }
}

function recessedFixture(build: Build, x: number, y: number, z: number,
  width: number, depth: number, name: string, lit = true): void {
  const { palette } = build;
  box(build, palette.dark, x, y + .094, z, width, .008, depth, `${name} closed housing back`);
  for (const side of [-1, 1]) {
    box(build, palette.dark, x + side * (width / 2 - .008), y + .045, z,
      .016, .090, depth, `${name} side source shielding`);
    box(build, palette.dark, x, y + .045, z + side * (depth / 2 - .008),
      width - .032, .090, .016, `${name} end source shielding`);
  }
  const face = lit ? palette.diffuser(`${name} concealed diffuser`, .55) : palette.dark;
  box(build, face, x, y + .080, z, width - .036, .006, depth - .036, `${name} recessed luminous face`);

}

function spot(build: Build, source: Vector3, target: Vector3, intensity: number,
  distance: number, angle: number, name: string): FixtureLight {
  const light = new SpotLight(0xffe6c6, intensity, distance, angle, .55, 2);
  light.name = name;
  light.position.copy(source);
  light.target.position.copy(target);
  light.castShadow = false;
  light.target.name = `${name} target`;
  light.userData.frontLighting = { source: source.toArray(), target: target.toArray(), normallyOn: true };
  build.group.add(light, light.target);
  return { light, onIntensity: intensity };
}

/** Add bounded diffuse irradiance, retaining PBR response and the wall's own texture.
 * This is a local baked-light approximation, not an emitting wall or a lux claim. */
function receivedLight(material: MeshStandardMaterial, bounds: Vector4, gain: number): Receiver {
  const on = { value: 1 };
  const color = new Color(0xffe4c0).multiplyScalar(gain);
  material.onBeforeCompile = shader => {
    shader.uniforms.frontLocalOn = on;
    shader.uniforms.frontLocalBounds = { value: bounds };
    shader.uniforms.frontLocalIrradiance = { value: color };
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec3 frontSurfacePoint;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nfrontSurfacePoint = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 frontSurfacePoint;
      uniform float frontLocalOn;
      uniform vec4 frontLocalBounds;
      uniform vec3 frontLocalIrradiance;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float frontAcross = smoothstep(frontLocalBounds.x, frontLocalBounds.x + .28, frontSurfacePoint.x)
          * (1.0 - smoothstep(frontLocalBounds.y - .28, frontLocalBounds.y, frontSurfacePoint.x));
        float frontDepth = smoothstep(frontLocalBounds.z - .08, frontLocalBounds.z + .08, frontSurfacePoint.z)
          * (1.0 - smoothstep(frontLocalBounds.w - .08, frontLocalBounds.w + .08, frontSurfacePoint.z));
        float frontVertical = .68 + .16 * sin(frontSurfacePoint.y * .83);
        reflectedLight.indirectDiffuse += BRDF_Lambert(material.diffuseColor)
          * frontLocalIrradiance * frontLocalOn * frontAcross * frontDepth * frontVertical;`);
  };
  material.customProgramCacheKey = () => 'atrium-front-local-diffuse-v1';
  material.userData.frontReceivedLight = on;
  material.needsUpdate = true;
  return { material, on };
}


type WorldContact = { box: Box3; shape: 'rect' | 'ellipse'; strength: number; falloff: number };

function horizontalReceiver(mesh: Mesh, contacts: readonly WorldContact[]): FrontAoReceiver {
  const bounds = new Box3().setFromObject(mesh);
  const y = bounds.max.y;
  const projected: FrontAoContact[] = [];
  for (const contact of contacts) {
    const center = contact.box.getCenter(new Vector3());
    if (Math.abs(contact.box.min.y - y) > .004 || center.x < bounds.min.x || center.x > bounds.max.x
      || center.z < bounds.min.z || center.z > bounds.max.z) continue;
    projected.push({ u: center.x - bounds.min.x, v: bounds.max.z - center.z,
      width: contact.box.max.x - contact.box.min.x, height: contact.box.max.z - contact.box.min.z,
      shape: contact.shape, strength: contact.strength, falloff: contact.falloff });
  }
  return { mesh, origin: [bounds.min.x, y, bounds.max.z], uAxis: [1, 0, 0], vAxis: [0, 0, -1],
    width: bounds.max.x - bounds.min.x, height: bounds.max.z - bounds.min.z, contacts: projected };
}

function wallReceiver(mesh: Mesh, occluders: readonly Object3D[] = []): FrontAoReceiver {
  const bounds = new Box3().setFromObject(mesh);
  const size = bounds.getSize(new Vector3());
  let origin: [number, number, number], uAxis: [number, number, number];
  let width: number;
  if (size.x < size.z) {
    const west = bounds.getCenter(new Vector3()).x < 0;
    origin = west ? [bounds.max.x, bounds.min.y, bounds.max.z] : [bounds.min.x, bounds.min.y, bounds.min.z];
    uAxis = west ? [0, 0, -1] : [0, 0, 1];
    width = size.z;
  } else {
    origin = [bounds.max.x, bounds.min.y, bounds.min.z];
    uAxis = [-1, 0, 0];
    width = size.x;
  }
  const height = size.y;
  const contacts: FrontAoContact[] = [
    { u: width / 2, v: .005, width, height: .01, shape: 'rect', falloff: .07, strength: .16 },
    { u: width / 2, v: height - .005, width, height: .01, shape: 'rect', falloff: .07, strength: .16 },
    { u: .005, v: height / 2, width: .01, height, shape: 'rect', falloff: .06, strength: .15 },
    { u: width - .005, v: height / 2, width: .01, height, shape: 'rect', falloff: .06, strength: .15 },
  ];
  const axis = new Vector3(...uAxis);
  const corner = new Vector3(...origin);
  for (const occluder of occluders) {
    const box = new Box3().setFromObject(occluder);
    if (box.isEmpty()) continue;
    let minU = Infinity, maxU = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {
      const u = new Vector3(x, origin[1], z).sub(corner).dot(axis);
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    }
    const minV = Math.max(0, box.min.y - bounds.min.y);
    const maxV = Math.min(height, box.max.y - bounds.min.y);
    minU = Math.max(0, minU); maxU = Math.min(width, maxU);
    if (maxU <= minU || maxV <= minV) continue;
    contacts.push({ u: (minU + maxU) / 2, v: (minV + maxV) / 2,
      width: maxU - minU, height: maxV - minV, shape: 'rect',
      falloff: .045, strength: occluder instanceof Group ? .15 : .22 });
  }
  return { mesh, origin, uAxis, vAxis: [0, 1, 0], width, height, contacts };
}

function ceilingReceiver(mesh: Mesh, ceilingMeshes: readonly Mesh[]): FrontAoReceiver {
  const bounds = new Box3().setFromObject(mesh);
  const width = bounds.max.x - bounds.min.x, height = bounds.max.z - bounds.min.z;
  const coplanar = ceilingMeshes.filter(peer => peer !== mesh).map(peer => new Box3().setFromObject(peer))
    .filter(peer => Math.abs(peer.min.y - bounds.min.y) < .003);
  const contacts: FrontAoContact[] = [];
  const epsilon = .001;
  // Equipment cut-outs split a continuous ceiling into rectangles. An edge
  // covered by a coplanar neighbour is a modelling partition, not a joint.
  // Remove those covered intervals; keep only real outer and opening edges.
  for (const edge of ['minX', 'maxX', 'minZ', 'maxZ'] as const) {
    const alongZ = edge === 'minX' || edge === 'maxX';
    const coordinate = edge === 'minX' ? bounds.min.x : edge === 'maxX' ? bounds.max.x
      : edge === 'minZ' ? bounds.min.z : bounds.max.z;
    const outside = coordinate + (edge === 'minX' || edge === 'minZ' ? -epsilon : epsilon);
    let visible: [number, number][] = [[alongZ ? bounds.min.z : bounds.min.x,
      alongZ ? bounds.max.z : bounds.max.x]];
    for (const peer of coplanar) {
      const coversOutside = alongZ ? peer.min.x <= outside && peer.max.x >= outside
        : peer.min.z <= outside && peer.max.z >= outside;
      if (!coversOutside) continue;
      const cutStart = alongZ ? peer.min.z : peer.min.x;
      const cutEnd = alongZ ? peer.max.z : peer.max.x;
      visible = visible.flatMap(([a, b]): [number, number][] => {
        if (cutEnd <= a + epsilon || cutStart >= b - epsilon) return [[a, b]];
        const pieces: [number, number][] = [];
        if (cutStart > a + epsilon) pieces.push([a, Math.min(b, cutStart)]);
        if (cutEnd < b - epsilon) pieces.push([Math.max(a, cutEnd), b]);
        return pieces;
      });
      if (!visible.length) break;
    }
    for (const [a, b] of visible) {
      if (b - a <= epsilon) continue;
      contacts.push({
        u: alongZ ? edge === 'minX' ? .005 : width - .005 : (a + b) / 2 - bounds.min.x,
        v: alongZ ? (a + b) / 2 - bounds.min.z : edge === 'minZ' ? .005 : height - .005,
        width: alongZ ? .01 : b - a, height: alongZ ? b - a : .01,
        shape: 'rect', falloff: .065, strength: .16,
      });
    }
  }
  return { mesh, origin: [bounds.min.x, bounds.min.y, bounds.min.z], uAxis: [1, 0, 0], vAxis: [0, 0, 1],
    width, height, contacts };
}

function contactOcclusion(root: Group, build: Build): void {
  root.updateWorldMatrix(true, true);
  const surfaces = getAtriumFrontSurfaces(root);
  const contacts = build.occlusion.contacts.map(item => ({
    box: new Box3().setFromObject(item.object), shape: item.shape, strength: item.strength, falloff: item.falloff,
  }));
  const receivers: FrontAoReceiver[] = build.occlusion.tops.map(mesh => horizontalReceiver(mesh, contacts));
  receivers.push(...build.occlusion.backs.map(item => wallReceiver(item.mesh, item.occluders)));
  if (surfaces) {
    receivers.push(...surfaces.floorMeshes.map(mesh => horizontalReceiver(mesh, contacts)));
    receivers.push(...surfaces.ceilingMeshes.map(mesh => ceilingReceiver(mesh, surfaces.ceilingMeshes)));
    const walls = [surfaces.gardenBackWall, ...Object.values(surfaces.tenantBackWalls),
      ...Object.values(surfaces.upperBackWalls), ...Object.values(surfaces.endBayBackWalls)];
    receivers.push(...walls.map(surface => wallReceiver(surface.mesh)));
  }
  applyAtriumFrontOcclusion(surfaces ? [surfaces.shellGroup, build.group] : [build.group], receivers);
  build.group.userData.frontContactOcclusion = {
    receivers: receivers.length, actualSupports: contacts.length,
    indirectLossRange: [.15, .35], derivedFromGeometry: true,
  };
}

/** Furniture, original objects and local artificial lighting; shell/garden own their surfaces. */
export async function buildAtriumFrontInteriors(root: Group, wallStone: Texture | null): Promise<{
  setLighting(on: boolean, time: CoastTimeOfDay): void;
  setQuality(quality: CoastQuality): void;
  prepareRender(renderer: WebGLRenderer): void;
}> {
  const group = new Group();
  group.name = 'Atrium front original interiors and local lighting';
  root.add(group);
  const palette = createFrontMaterials(wallStone);
  const build: Build = { group, palette, occlusion: { contacts: [], tops: [], backs: [] } };
  for (const tenant of ATRIUM_FRONT_TENANTS) storeInterior(build, tenant);
  upperInteriors(build);
  addedFrontUses(build);
  const lights: FixtureLight[] = [];
  const lightPlan = ATRIUM_FRONT_LIGHTING;
  for (const x of lightPlan.gardenWallWash.x) recessedFixture(build, x, lightPlan.opticalY,
    lightPlan.gardenWallWash.z, .24, .16, 'G1 garden wallwasher');
  lights.push(spot(build,
    new Vector3(0, lightPlan.opticalY, lightPlan.gardenWallWash.z),
    new Vector3(0, 1.90, lightPlan.gardenWallWash.targetZ), 14, 10, 1.12,
    'G1 five-source wallwash aggregate'));
  const g2 = lightPlan.gardenViewing;
  recessedFixture(build, g2.x, g2.y, g2.z, .24, .24, 'G2 tree viewing');
  const viewing = spot(build, new Vector3(g2.x, g2.y, g2.z),
    new Vector3(g2.target.x, g2.target.y, g2.target.z), 38, g2.distance, g2.halfAngle, 'G2 foliage viewing');
  lights.push(viewing);
  const shadow = viewing.light.shadow;
  viewing.light.castShadow = true;
  viewing.light.target.name = 'G2 foliage target';
  shadow.autoUpdate = false;
  shadow.mapSize.set(g2.shadowMapSize.light, g2.shadowMapSize.light);
  shadow.camera.near = g2.shadowNear;
  shadow.camera.far = viewing.light.distance;
  shadow.normalBias = .003;
  shadow.bias = -.00012;
  shadow.camera.updateProjectionMatrix();
  let lightingOn = true;
  let shadowPending = true;
  let quality: CoastQuality = 'light';
  // No light-specific layer claim: r184 shadow casters are culled by the
  // standard square frustum, which can include real nearby walls/supports.
  shadow.needsUpdate = true;
  const g4 = lightPlan.gardenGrowing;
  recessedFixture(build, g4.x, g4.y, g4.z, g4.width, g4.depth, 'G4 growing equipment reservation, normally off', false);
  for (const tenant of ATRIUM_FRONT_TENANTS) {
    const target = tenant.fixtures.frontTable;
    const u = target.u + target.width / 2;
    const d = target.d + target.depth / 2;
    const y = tenant.ceilingY - .02;
    const sourceD = d + (y - target.height) * Math.tan(Math.PI / 6);
    const source = atriumFrontTenantPoint(tenant, u, sourceD);
    const aimed = atriumFrontTenantPoint(tenant, u, d);
    lights.push(spot(build, new Vector3(source.x, y, source.z),
      new Vector3(aimed.x, target.height, aimed.z), 62, 8, .68, `${tenant.id} tabletop local flood`));
    for (const item of [tenant.fixtures.frontTable, tenant.fixtures.middleDisplay]) {
      const center = atriumFrontTenantPoint(tenant, item.u + item.width / 2,
        item.d + item.depth / 2 + (y - item.height) * Math.tan(Math.PI / 6));
      recessedFixture(build, center.x, y, center.z, .16, .16, `${tenant.id} exhibit ceiling fixture`);
    }
    const shelfPoint = atriumFrontTenantPoint(tenant,
      tenant.fixtures.backShelf.u + tenant.fixtures.backShelf.width / 2, tenant.fixtures.backShelf.d - .12);
    recessedFixture(build, shelfPoint.x, y, shelfPoint.z, .08,
      tenant.fixtures.backShelf.width - .15, `${tenant.id} hidden shelf light`);
  }
  for (const room of ATRIUM_FRONT_UPPER_ROOMS) {
    const offset = (room.ceilingY - room.floorY) / 3;
    for (const [left, right] of ATRIUM_FRONT_GLAZING.upperBays) {
      const count = Math.max(1, Math.ceil((right - left) / (offset * 1.3)) - 1);
      for (let i = 0; i < count; i += 1) recessedFixture(build,
        left + (right - left) * (i + .5) / count, room.ceilingY - .02,
        ATRIUM_FRONT_UPPER_BOUNDS.maxZ - offset, .36, .08, `${room.id} concealed rear wall light`);
    }
  }
  const surfaces = getAtriumFrontSurfaces(root);
  const receivers: Receiver[] = [];
  if (surfaces) {
    const garden = ATRIUM_FRONT_GARDEN;
    receivers.push(receivedLight(surfaces.gardenBackWall.material,
      new Vector4(garden.bounds.minX, garden.bounds.maxX, garden.backWallZ - .15, garden.backWallZ + .2), .48));
    for (const tenant of ATRIUM_FRONT_TENANTS) {
      const a = atriumFrontTenantPoint(tenant, 0, tenant.depth);
      receivers.push(receivedLight(surfaces.tenantBackWalls[tenant.id].material,
        new Vector4(a.x - .20, a.x + .20, tenant.z[0], tenant.z[1]), .32));
    }
    for (const bay of ATRIUM_FRONT_END_BAYS) receivers.push(receivedLight(surfaces.endBayBackWalls[bay.id].material,
      new Vector4(bay.x[0], bay.x[1], bay.backZ - .18, bay.backZ + .22), .25));
    for (const room of ATRIUM_FRONT_UPPER_ROOMS) receivers.push(receivedLight(
      surfaces.upperBackWalls[room.id].material, new Vector4(ATRIUM_FRONT_UPPER_BOUNDS.minX, ATRIUM_FRONT_UPPER_BOUNDS.maxX,
        ATRIUM_FRONT_UPPER_BOUNDS.maxZ - .18, ATRIUM_FRONT_UPPER_BOUNDS.maxZ + .22), .35));
  }
  contactOcclusion(root, build);
  return {
    setLighting(on, time) {
      const night = time === 'night';
      if (on !== lightingOn) shadowPending = true;
      lightingOn = on;
      shadow.needsUpdate = on && shadowPending;
      palette.setLighting(on, night);
      for (const record of lights) record.light.intensity = on ? record.onIntensity * (night ? .86 : 1) : 0;
      for (const receiver of receivers) receiver.on.value = on ? 1 : 0;
      // G4 has a dark physical baffle only: no hidden grow light, timer or new UI.
      group.userData.frontLighting = { on, time, growLightOn: false, spotLights: lights.length };
    },
    setQuality(next) {
      if (next === quality) return;
      quality = next;
      shadow.map?.dispose();
      shadow.mapPass?.dispose();
      shadow.map = null;
      shadow.mapPass = null;
      const size = g2.shadowMapSize[next];
      shadow.mapSize.set(size, size);
      shadowPending = true;
      shadow.needsUpdate = lightingOn;
    },
    prepareRender(renderer) {
      if (!lightingOn || !shadowPending) return;
      if (shadow.map && !shadow.needsUpdate) {
        shadowPending = false;
        return;
      }
      // Reflector temporarily disables renderer.shadowMap.autoUpdate. Request
      // the standard first reflection render to populate the same static map
      // used by the main view and both XR eyes; never call shadow.render here.
      shadow.needsUpdate = true;
      renderer.shadowMap.needsUpdate = true;
    },
  };
}
