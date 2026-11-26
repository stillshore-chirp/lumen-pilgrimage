import type { MeshStandardMaterial } from 'three';
import type { TenantBuildContext } from './atriumTenantArchitecture';

type RearFixture = TenantBuildContext['bay']['fixtures'][number];
type FixtureRect = readonly [u: number, d: number, width: number, length: number];

const CASE_TOP_THICKNESS = .045;

function fixtureRect(fixture: RearFixture): FixtureRect {
  return fixture.rect;
}

function fixtureCenter(rect: FixtureRect): { u: number; d: number } {
  return { u: rect[0] + rect[2] / 2, d: rect[1] + rect[3] / 2 };
}

function addCase(
  context: TenantBuildContext,
  fixture: RearFixture,
  finish: MeshStandardMaterial,
  edge: MeshStandardMaterial,
  glow: MeshStandardMaterial,
): void {
  const rect = fixtureRect(fixture);
  const center = fixtureCenter(rect);
  const width = rect[2];
  const length = rect[3];
  const height = fixture.height;
  const bodyHeight = Math.max(.08, height - CASE_TOP_THICKNESS);
  context.box(finish, center.u, bodyHeight / 2, center.d, width, bodyHeight, length, `${fixture.id} body`);
  context.box(edge, center.u, height - CASE_TOP_THICKNESS / 2, center.d,
    width + .025, CASE_TOP_THICKNESS, length + .025, `${fixture.id} stone edge`);
  context.box(glow,
    center.u, height - .009, center.d, Math.max(.16, width - .18), .018, Math.max(.16, length - .18),
    `${fixture.id} concealed top light`);

  const postHeight = Math.max(.32, height - .20);
  const postY = .10 + postHeight / 2;
  const postU = Math.max(.04, width / 2 - .045);
  const postD = Math.max(.04, length / 2 - .045);
  for (const [index, offset] of ([
    [-postU, -postD], [postU, -postD], [-postU, postD], [postU, postD],
  ] as const).entries()) {
    context.box(edge, center.u + offset[0], postY, center.d + offset[1], .035, postHeight, .035,
      `${fixture.id} glass corner ${index}`);
  }

  // Keep an explicit transparent top for the low cases. The separate edge and
  // emissive line preserve the layered reading when the camera approaches obliquely.
  context.box(context.palette.caseGlass, center.u, height - .009, center.d,
    Math.max(.12, width - .14), .018, Math.max(.12, length - .14), `${fixture.id} low iron glass`);
}

function addShelf(
  context: TenantBuildContext,
  fixture: RearFixture,
  finish: MeshStandardMaterial,
  edge: MeshStandardMaterial,
  glow: MeshStandardMaterial,
): void {
  const rect = fixtureRect(fixture);
  const center = fixtureCenter(rect);
  const height = fixture.height;
  const d = rect[1];
  const width = rect[2];
  const length = rect[3];
  const backDepth = Math.min(.06, length);
  const backD = d + length - backDepth / 2;
  context.box(finish, center.u, height / 2, backD, width, height, backDepth, `${fixture.id} back panel`);
  const sideU = Math.max(.02, width / 2 - .025);
  for (const side of [-1, 1] as const) {
    context.box(edge, center.u + side * sideU, height / 2, center.d, .035, height, length,
      `${fixture.id} side upright ${side}`);
  }
  const shelfCount = Math.max(3, Math.min(6, Math.floor(height / .38)));
  for (let index = 0; index < shelfCount; index += 1) {
    const y = .32 + (height - .52) * index / Math.max(1, shelfCount - 1);
    context.box(edge, center.u, y, d + .02, width - .06, .035, length - .08,
      `${fixture.id} shelf ${index + 1}`);
    context.box(glow, center.u, y + .028, d + .025, Math.max(.18, width - .16), .012, .018,
      `${fixture.id} shelf light ${index + 1}`);
  }
}

function addCounter(
  context: TenantBuildContext,
  fixture: RearFixture,
  finish: MeshStandardMaterial,
  edge: MeshStandardMaterial,
): void {
  const rect = fixtureRect(fixture);
  const center = fixtureCenter(rect);
  const u = rect[0];
  const d = rect[1];
  const width = rect[2];
  const length = rect[3];
  const height = fixture.height;
  const bodyHeight = Math.max(.12, height - .08);
  context.box(finish, center.u, bodyHeight / 2, center.d, width, bodyHeight, length, `${fixture.id} cabinet`);
  context.box(edge, center.u, height - .04, center.d, width + .04, .08, length + .03, `${fixture.id} top`);
  const divisions = Math.max(1, Math.floor(width / .55));
  for (let index = 1; index < divisions; index += 1) {
    const uLine = u + width * index / divisions;
    context.box(edge, uLine, bodyHeight / 2, d - .006, .018, bodyHeight - .08, .028,
      `${fixture.id} front division ${index}`);
  }
}

function addTable(
  context: TenantBuildContext,
  fixture: RearFixture,
  finish: MeshStandardMaterial,
  edge: MeshStandardMaterial,
): void {
  const rect = fixtureRect(fixture);
  const center = fixtureCenter(rect);
  const width = rect[2];
  const length = rect[3];
  const height = fixture.height;
  context.box(finish, center.u, height - .04, center.d, width, .08, length, `${fixture.id} top`);
  const legHeight = Math.max(.12, height - .08);
  const legU = Math.max(.08, width / 2 - .12);
  const legD = Math.max(.08, length / 2 - .12);
  for (const [index, offset] of ([
    [-legU, -legD], [legU, -legD], [-legU, legD], [legU, legD],
  ] as const).entries()) {
    context.cylinder(edge, center.u + offset[0], legHeight / 2, center.d + offset[1], .025, legHeight,
      `${fixture.id} leg ${index}`);
  }
}

function addGenericFixture(
  context: TenantBuildContext,
  fixture: RearFixture,
  finish: MeshStandardMaterial,
): void {
  const rect = fixtureRect(fixture);
  const center = fixtureCenter(rect);
  context.box(finish, center.u, fixture.height / 2, center.d, rect[2], fixture.height, rect[3], fixture.id);
}

function addFixture(context: TenantBuildContext, fixture: RearFixture, glow: MeshStandardMaterial): void {
  const isF1 = context.bay.id === 'F1';
  const shelfFinish = isF1 ? context.palette.darkWood : context.palette.lightWood;
  const caseFinish = isF1 ? context.palette.dark : context.palette.cream;
  const edge = isF1 ? context.palette.bronze : context.palette.brass;
  switch (fixture.type) {
    case 'case':
      addCase(context, fixture, caseFinish, edge, glow);
      break;
    case 'shelf':
      addShelf(context, fixture, shelfFinish, edge, glow);
      break;
    case 'counter':
      addCounter(context, fixture, shelfFinish, edge);
      break;
    case 'table':
      addTable(context, fixture, context.palette.white, edge);
      break;
    case 'wall':
    case 'other':
      // The architecture lane owns the rear wall finish and F2 sleeve/vertical
      // slit envelope; keeping these IDs out of the furniture pass prevents overlap.
      break;
    default:
      addGenericFixture(context, fixture, shelfFinish);
      break;
  }
}

/** Build the display fixtures inside a single rear tenant bay. */
export function furnishRearTenant(context: TenantBuildContext): void {
  const warm = context.bay.id === 'F1' ? 0xffbd8a : 0xffdfb2;
  const glow = context.glow(`${context.bay.id} tenant display glow`, warm, context.bay.id === 'F1' ? .68 : .82);
  for (const fixture of context.bay.fixtures) addFixture(context, fixture, glow);
}
