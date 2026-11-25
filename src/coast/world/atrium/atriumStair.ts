import {
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  TubeGeometry,
  Vector3,
} from 'three';
import {
  ATRIUM_STAIR_LENGTH,
  ATRIUM_STAIR_STEPS,
  ATRIUM_UPPER_STAIR,
  ATRIUM_UPPER_STAIR_LENGTH,
  atriumStairFrame,
  atriumStairPoint,
  atriumUpperStairPoint,
} from './atriumLayout';

type AtriumStairStep = (typeof ATRIUM_STAIR_STEPS)[number];
type Point = readonly [number, number, number];

const EPSILON = 1e-6;
const MAIN_SAMPLE_COUNT = Math.max(160, Math.ceil(ATRIUM_STAIR_LENGTH * 10));
const FASCIA_SIDE = -1;

class QuadBuilder {
  private readonly positions: number[] = [];

  addQuad(a: Point, b: Point, c: Point, d: Point): void {
    for (const corner of [a, b, c, a, c, d]) this.positions.push(...corner);
  }

  geometry(name: string): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.name = name;
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
}

function clampAlong(along: number): number {
  return Math.max(0, Math.min(ATRIUM_STAIR_LENGTH, along));
}

function mainPoint(along: number, across: number, y: number): Point {
  const { x, z } = atriumStairPoint(clampAlong(along), across);
  return [x, y, z];
}

function smoothStep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function fasciaDepth(along: number): number {
  const progress = clampAlong(along) / ATRIUM_STAIR_LENGTH;
  const onset = smoothStep((progress - 0.055) / 0.22);
  const termination = smoothStep((progress - 0.80) / 0.19);
  // The lower landing begins as a modest apron. The west/front side grows
  // into the 1.1–1.5m architectural fascia seen across the upper sweep, then
  // eases down before the gallery landing instead of ending abruptly.
  return 0.22 + 1.28 * onset * (1 - 0.82 * termination);
}

function sideAcross(width: number, side: number, inset: number): number {
  return side * (width * 0.5 - inset);
}

function addTreadTop(builder: QuadBuilder, step: AtriumStairStep): void {
  const startFrame = atriumStairFrame(step.start);
  const endFrame = atriumStairFrame(step.end);
  builder.addQuad(
    mainPoint(step.start, -startFrame.width * 0.5, step.y),
    mainPoint(step.start, startFrame.width * 0.5, step.y),
    mainPoint(step.end, endFrame.width * 0.5, step.y),
    mainPoint(step.end, -endFrame.width * 0.5, step.y),
  );
}

function addTreadRiser(builder: QuadBuilder, step: AtriumStairStep, lowY: number): void {
  const frame = atriumStairFrame(step.start);
  builder.addQuad(
    mainPoint(step.start, -frame.width * 0.5, lowY),
    mainPoint(step.start, frame.width * 0.5, lowY),
    mainPoint(step.start, frame.width * 0.5, step.y),
    mainPoint(step.start, -frame.width * 0.5, step.y),
  );
}

function addTreadNosing(builder: QuadBuilder, step: AtriumStairStep): void {
  const edge = Math.max(0, step.start - 0.007);
  const { width } = atriumStairFrame(edge);
  builder.addQuad(
    mainPoint(edge, -width * 0.5 + 0.015, step.y - 0.048),
    mainPoint(edge, width * 0.5 - 0.015, step.y - 0.048),
    mainPoint(edge, width * 0.5 - 0.015, step.y - 0.006),
    mainPoint(edge, -width * 0.5 + 0.015, step.y - 0.006),
  );
}

function addMainUnderbody(builder: QuadBuilder): void {
  for (let index = 0; index < MAIN_SAMPLE_COUNT; index += 1) {
    const along0 = ATRIUM_STAIR_LENGTH * index / MAIN_SAMPLE_COUNT;
    const along1 = ATRIUM_STAIR_LENGTH * (index + 1) / MAIN_SAMPLE_COUNT;
    const frame0 = atriumStairFrame(along0);
    const frame1 = atriumStairFrame(along1);
    // Leave space for the lowest horizontal tread at each end of the curved wedge.
    const top0 = Math.max(0.035, frame0.y - 0.19);
    const top1 = Math.max(0.035, frame1.y - 0.19);
    const bottom0 = Math.max(0, top0 - 0.38);
    const bottom1 = Math.max(0, top1 - 0.38);
    builder.addQuad(
      mainPoint(along0, -frame0.width * 0.5 + 0.08, top0),
      mainPoint(along1, -frame1.width * 0.5 + 0.08, top1),
      mainPoint(along1, frame1.width * 0.5 - 0.08, top1),
      mainPoint(along0, frame0.width * 0.5 - 0.08, top0),
    );
    builder.addQuad(
      mainPoint(along0, -frame0.width * 0.5 + 0.08, bottom0),
      mainPoint(along0, -frame0.width * 0.5 + 0.08, top0),
      mainPoint(along1, -frame1.width * 0.5 + 0.08, top1),
      mainPoint(along1, -frame1.width * 0.5 + 0.08, bottom1),
    );
    builder.addQuad(
      mainPoint(along1, frame1.width * 0.5 - 0.08, bottom1),
      mainPoint(along1, frame1.width * 0.5 - 0.08, top1),
      mainPoint(along0, frame0.width * 0.5 - 0.08, top0),
      mainPoint(along0, frame0.width * 0.5 - 0.08, bottom0),
    );
  }
}

function addSideFascia(builder: QuadBuilder, side: number, depthScale: number): void {
  for (let index = 0; index < MAIN_SAMPLE_COUNT; index += 1) {
    const along0 = ATRIUM_STAIR_LENGTH * index / MAIN_SAMPLE_COUNT;
    const along1 = ATRIUM_STAIR_LENGTH * (index + 1) / MAIN_SAMPLE_COUNT;
    const frame0 = atriumStairFrame(along0);
    const frame1 = atriumStairFrame(along1);
    const outer0 = sideAcross(frame0.width, side, -0.11);
    const outer1 = sideAcross(frame1.width, side, -0.11);
    const inner0 = sideAcross(frame0.width, side, 0.29);
    const inner1 = sideAcross(frame1.width, side, 0.29);
    const top0 = frame0.y + 0.035;
    const top1 = frame1.y + 0.035;
    const bottom0 = Math.max(0.025, top0 - fasciaDepth(along0) * depthScale);
    const bottom1 = Math.max(0.025, top1 - fasciaDepth(along1) * depthScale);

    // Side, top, underside and return faces make this a continuous structural
    // fascia rather than a thin diagonal ribbon.
    builder.addQuad(
      mainPoint(along0, outer0, top0), mainPoint(along1, outer1, top1),
      mainPoint(along1, outer1, bottom1), mainPoint(along0, outer0, bottom0),
    );
    builder.addQuad(
      mainPoint(along0, inner0, bottom0), mainPoint(along1, inner1, bottom1),
      mainPoint(along1, inner1, top1), mainPoint(along0, inner0, top0),
    );
    builder.addQuad(
      mainPoint(along0, outer0, top0), mainPoint(along1, outer1, top1),
      mainPoint(along1, inner1, top1), mainPoint(along0, inner0, top0),
    );
    builder.addQuad(
      mainPoint(along0, inner0, bottom0), mainPoint(along1, inner1, bottom1),
      mainPoint(along1, outer1, bottom1), mainPoint(along0, outer0, bottom0),
    );
  }
}

function addFasciaLight(builder: QuadBuilder): void {
  const stripInset = -0.115;
  for (let index = 0; index < MAIN_SAMPLE_COUNT; index += 1) {
    const along0 = ATRIUM_STAIR_LENGTH * index / MAIN_SAMPLE_COUNT;
    const along1 = ATRIUM_STAIR_LENGTH * (index + 1) / MAIN_SAMPLE_COUNT;
    const frame0 = atriumStairFrame(along0);
    const frame1 = atriumStairFrame(along1);
    const across0 = sideAcross(frame0.width, FASCIA_SIDE, stripInset);
    const across1 = sideAcross(frame1.width, FASCIA_SIDE, stripInset);
    const depth0 = fasciaDepth(along0);
    const depth1 = fasciaDepth(along1);
    const bottom0 = Math.max(0.05, frame0.y + 0.035 - depth0);
    const bottom1 = Math.max(0.05, frame1.y + 0.035 - depth1);
    builder.addQuad(
      mainPoint(along0, across0, bottom0 + 0.035),
      mainPoint(along1, across1, bottom1 + 0.035),
      mainPoint(along1, across1, bottom1 + 0.105),
      mainPoint(along0, across0, bottom0 + 0.105),
    );
  }
}

function addFasciaWash(builder: QuadBuilder): void {
  for (let index = 0; index < MAIN_SAMPLE_COUNT; index += 1) {
    const along0 = ATRIUM_STAIR_LENGTH * index / MAIN_SAMPLE_COUNT;
    const along1 = ATRIUM_STAIR_LENGTH * (index + 1) / MAIN_SAMPLE_COUNT;
    const frame0 = atriumStairFrame(along0);
    const frame1 = atriumStairFrame(along1);
    const across0 = sideAcross(frame0.width, FASCIA_SIDE, -0.12);
    const across1 = sideAcross(frame1.width, FASCIA_SIDE, -0.12);
    const depth0 = fasciaDepth(along0);
    const depth1 = fasciaDepth(along1);
    const bottom0 = Math.max(0.05, frame0.y + 0.035 - depth0);
    const bottom1 = Math.max(0.05, frame1.y + 0.035 - depth1);
    builder.addQuad(
      mainPoint(along0, across0, bottom0 + 0.13),
      mainPoint(along1, across1, bottom1 + 0.13),
      mainPoint(along1, across1, bottom1 + 0.42),
      mainPoint(along0, across0, bottom0 + 0.42),
    );
  }
}

function addMainGlass(builder: QuadBuilder, side: number): void {
  for (const step of ATRIUM_STAIR_STEPS) {
    const startFrame = atriumStairFrame(step.start);
    const endFrame = atriumStairFrame(step.end);
    const across0 = sideAcross(startFrame.width, side, 0.085);
    const across1 = sideAcross(endFrame.width, side, 0.085);
    const bottom = step.y + 0.035;
    builder.addQuad(
      mainPoint(step.start, across0, bottom), mainPoint(step.end, across1, bottom),
      mainPoint(step.end, across1, bottom + 1.12), mainPoint(step.start, across0, bottom + 1.12),
    );
  }
}

function createMainRail(side: number, lower: boolean, material: MeshStandardMaterial): Mesh {
  const points: Vector3[] = [];
  const offset = lower ? -0.31 : 0;
  for (let index = 0; index <= MAIN_SAMPLE_COUNT; index += 1) {
    const along = ATRIUM_STAIR_LENGTH * index / MAIN_SAMPLE_COUNT;
    const frame = atriumStairFrame(along);
    const across = sideAcross(frame.width, side, 0.085);
    const { x, z } = atriumStairPoint(along, across);
    points.push(new Vector3(x, frame.y + 1.17 + offset, z));
  }
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  const geometry = new TubeGeometry(curve, MAIN_SAMPLE_COUNT, lower ? 0.034 : 0.047, 8, false);
  geometry.name = lower ? 'Lower brushed stair rail' : 'Upper brushed stair rail';
  const mesh = new Mesh(geometry, material);
  mesh.name = geometry.name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addMainPost(group: Group, side: number, along: number, material: MeshStandardMaterial): void {
  const frame = atriumStairFrame(along);
  const across = sideAcross(frame.width, side, 0.085);
  const { x, z } = atriumStairPoint(along, across);
  const height = 1.19;
  const post = new Mesh(new CylinderGeometry(0.022, 0.027, height, 8), material);
  post.name = 'Sparse brushed-glass stair post';
  post.position.set(x, frame.y + 0.045 + height * 0.5, z);
  post.castShadow = true;
  post.receiveShadow = true;
  group.add(post);
}

function mainPostAlongs(): readonly number[] {
  const result: number[] = [0];
  for (let index = 0; index < ATRIUM_STAIR_STEPS.length; index += 1) {
    const step = ATRIUM_STAIR_STEPS[index];
    if (index % 3 === 0 || step.y !== ATRIUM_STAIR_STEPS[index - 1]?.y) result.push(step.start);
  }
  result.push(ATRIUM_STAIR_LENGTH);
  return result.filter((along, index) => index === 0 || Math.abs(along - result[index - 1]) > EPSILON);
}

function upperPointAtY(along: number, across: number, y: number): Point {
  const base = atriumUpperStairPoint(along, across);
  return [base.x, y, base.z];
}

function upperHalfWidth(along: number): number {
  return ATRIUM_UPPER_STAIR.width * 0.5
    * (1 - 0.12 * Math.max(0, Math.min(1, along / ATRIUM_UPPER_STAIR_LENGTH)));
}

function addUpperTreadTop(builder: QuadBuilder, start: number, end: number, y: number): void {
  const startWidth = upperHalfWidth(start);
  const endWidth = upperHalfWidth(end);
  builder.addQuad(
    upperPointAtY(start, -startWidth, y), upperPointAtY(start, startWidth, y),
    upperPointAtY(end, endWidth, y), upperPointAtY(end, -endWidth, y),
  );
}

function addUpperFascia(builder: QuadBuilder, side: number): void {
  const samples = Math.max(72, Math.ceil(ATRIUM_UPPER_STAIR_LENGTH * 8));
  const depth = 0.56;
  for (let index = 0; index < samples; index += 1) {
    const along0 = ATRIUM_UPPER_STAIR_LENGTH * index / samples;
    const along1 = ATRIUM_UPPER_STAIR_LENGTH * (index + 1) / samples;
    const width0 = upperHalfWidth(along0);
    const width1 = upperHalfWidth(along1);
    const outer0 = side * (width0 + 0.08);
    const outer1 = side * (width1 + 0.08);
    const inner0 = side * (width0 - 0.23);
    const inner1 = side * (width1 - 0.23);
    const p0 = atriumUpperStairPoint(along0, outer0);
    const p1 = atriumUpperStairPoint(along1, outer1);
    const q0 = atriumUpperStairPoint(along0, inner0);
    const q1 = atriumUpperStairPoint(along1, inner1);
    const top0 = p0.y + 0.035;
    const top1 = p1.y + 0.035;
    const bottom0 = Math.max(0.02, top0 - depth);
    const bottom1 = Math.max(0.02, top1 - depth);
    builder.addQuad([p0.x, top0, p0.z], [p1.x, top1, p1.z], [q1.x, top1, q1.z], [q0.x, top0, q0.z]);
    builder.addQuad([p0.x, bottom0, p0.z], [q0.x, bottom0, q0.z], [q1.x, bottom1, q1.z], [p1.x, bottom1, p1.z]);
    builder.addQuad([p0.x, top0, p0.z], [p1.x, top1, p1.z], [p1.x, bottom1, p1.z], [p0.x, bottom0, p0.z]);
    builder.addQuad([q0.x, bottom0, q0.z], [q1.x, bottom1, q1.z], [q1.x, top1, q1.z], [q0.x, top0, q0.z]);
  }
}

function addUpperGlass(builder: QuadBuilder, side: number): void {
  const stepCount = ATRIUM_UPPER_STAIR.risers;
  for (let index = 0; index < stepCount; index += 1) {
    const along0 = ATRIUM_UPPER_STAIR_LENGTH * index / stepCount;
    const along1 = ATRIUM_UPPER_STAIR_LENGTH * (index + 1) / stepCount;
    const p0 = atriumUpperStairPoint(along0, side * (upperHalfWidth(along0) - 0.06));
    const p1 = atriumUpperStairPoint(along1, side * (upperHalfWidth(along1) - 0.06));
    builder.addQuad(
      [p0.x, p0.y + 0.05, p0.z], [p1.x, p1.y + 0.05, p1.z],
      [p1.x, p1.y + 1.02, p1.z], [p0.x, p0.y + 1.02, p0.z],
    );
  }
}

function createUpperRail(side: number, material: MeshStandardMaterial): Mesh {
  const points: Vector3[] = [];
  const samples = Math.max(72, Math.ceil(ATRIUM_UPPER_STAIR_LENGTH * 8));
  for (let index = 0; index <= samples; index += 1) {
    const along = ATRIUM_UPPER_STAIR_LENGTH * index / samples;
    const base = atriumUpperStairPoint(along, side * (upperHalfWidth(along) - 0.06));
    points.push(new Vector3(base.x, base.y + 1.10, base.z));
  }
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  const geometry = new TubeGeometry(curve, samples, 0.039, 8, false);
  geometry.name = 'Upper diagonal connector brushed rail';
  const mesh = new Mesh(geometry, material);
  mesh.name = geometry.name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addUpperPost(group: Group, side: number, along: number, material: MeshStandardMaterial): void {
  const base = atriumUpperStairPoint(along, side * (upperHalfWidth(along) - 0.06));
  const height = 1.08;
  const post = new Mesh(new CylinderGeometry(0.022, 0.026, height, 8), material);
  post.name = 'Upper diagonal connector glass post';
  post.position.set(base.x, base.y + 0.04 + height * 0.5, base.z);
  post.castShadow = true;
  post.receiveShadow = true;
  group.add(post);
}

function addMesh(group: Group, geometry: BufferGeometry,
  material: MeshStandardMaterial | MeshBasicMaterial | MeshPhysicalMaterial,
  name: string, castShadow = true, receiveShadow = true): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  group.add(mesh);
  return mesh;
}

/**
 * Build both visible stair systems. Navigation and collision remain owned by
 * the atrium layout; this module only contributes scene-owned drawables.
 */
export function buildAtriumStair(root: Group): { setLighting: (artificialOn: boolean) => void } {
  const group = new Group();
  group.name = 'Commercial atrium sweeping stair';
  root.add(group);

  const stone = new MeshStandardMaterial({
    name: 'Warm honed ivory stair stone', color: 0xe9dbca, roughness: 0.72, metalness: 0.02,
  });
  const riser = new MeshStandardMaterial({
    name: 'Warm stone tread risers', color: 0xc3af97, roughness: 0.84, metalness: 0.02,
  });
  const fascia = new MeshStandardMaterial({
    name: 'Continuous light ivory architectural fascia', color: 0xe6d9c3,
    roughness: 0.58, metalness: 0.01, side: DoubleSide, emissive: 0x785135, emissiveIntensity: .25,
  });
  const fasciaShadow = new MeshStandardMaterial({
    name: 'Warm stone fascia underside', color: 0xc8b69e, roughness: 0.72,
    side: DoubleSide,
  });
  const nosing = new MeshStandardMaterial({
    name: 'Recessed warm gray tread nosing', color: 0x68584e, roughness: 0.71, metalness: 0.04,
  });
  const rail = new MeshStandardMaterial({
    name: 'Muted brushed graphite stair rail', color: 0x646761, roughness: 0.46, metalness: 0.28,
  });
  const glass = new MeshPhysicalMaterial({
    name: 'Brushed low-iron stair glass', color: 0x9cb0af, roughness: 0.16, metalness: 0.03,
    transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide, forceSinglePass: true,
    ior: 1.46, clearcoat: 0.26,
  });
  const fasciaGlow = new MeshBasicMaterial({
    name: 'Tucked lower-edge stair glow', color: 0xffd39a, toneMapped: false,
    transparent: true, opacity: 0.95, side: DoubleSide, forceSinglePass: true,
  });
  const fasciaWash = new MeshBasicMaterial({
    name: 'Soft fascia light wash', color: 0xffbd7b, toneMapped: false,
    transparent: true, opacity: 0.16, side: DoubleSide, forceSinglePass: true,
  });
  const upperGlow = new MeshBasicMaterial({
    name: 'Upper connector lower-edge glow', color: 0xffcc8f, toneMapped: false,
    transparent: true, opacity: 0.56, side: DoubleSide,
  });

  const tops = new QuadBuilder();
  const risers = new QuadBuilder();
  const nosings = new QuadBuilder();
  for (let index = 0; index < ATRIUM_STAIR_STEPS.length; index += 1) {
    const step: AtriumStairStep = ATRIUM_STAIR_STEPS[index];
    addTreadTop(tops, step);
    const previous = ATRIUM_STAIR_STEPS[index - 1];
    const lowY = previous?.y ?? 0;
    if (step.y > lowY + EPSILON) {
      addTreadRiser(risers, step, lowY);
      addTreadNosing(nosings, step);
    }
  }
  addMesh(group, tops.geometry('Sweeping stair honed stone treads and landings'), stone,
    'Sweeping stair honed stone treads and landings');
  addMesh(group, risers.geometry('Sweeping stair vertical risers'), riser,
    'Sweeping stair vertical risers');
  addMesh(group, nosings.geometry('Recessed tread nosings'), nosing, 'Recessed tread nosings');

  const underbody = new QuadBuilder();
  addMainUnderbody(underbody);
  addMesh(group, underbody.geometry('Continuous sweeping stair underbody'), fasciaShadow,
    'Continuous sweeping stair underbody');

  const frontFascia = new QuadBuilder();
  addSideFascia(frontFascia, FASCIA_SIDE, 1);
  addMesh(group, frontFascia.geometry('Continuous thick west front ivory fascia'), fascia,
    'Continuous thick west front ivory fascia');
  const rearFascia = new QuadBuilder();
  addSideFascia(rearFascia, 1, 0.34);
  addMesh(group, rearFascia.geometry('Slim rear stair stringer'), fasciaShadow,
    'Slim rear stair stringer');

  const glassPanels = new QuadBuilder();
  addMainGlass(glassPanels, -1);
  addMainGlass(glassPanels, 1);
  addMesh(group, glassPanels.geometry('Main stair brushed glass balustrades'), glass,
    'Main stair brushed glass balustrades', false, false);
  for (const along of mainPostAlongs()) {
    addMainPost(group, -1, along, rail);
    addMainPost(group, 1, along, rail);
  }
  group.add(createMainRail(-1, false, rail));
  group.add(createMainRail(1, false, rail));
  group.add(createMainRail(-1, true, rail));
  group.add(createMainRail(1, true, rail));

  const lowerEdge = new QuadBuilder();
  const wash = new QuadBuilder();
  addFasciaLight(lowerEdge);
  addFasciaWash(wash);
  addMesh(group, lowerEdge.geometry('Tucked linear light under west fascia'), fasciaGlow,
    'Tucked linear light under west fascia', false, false);
  addMesh(group, wash.geometry('Soft grazing wash across west fascia'), fasciaWash,
    'Soft grazing wash across west fascia', false, false);

  const upperTreads = new QuadBuilder();
  const upperRisers = new QuadBuilder();
  const upperGlass = new QuadBuilder();
  const upperRise = (ATRIUM_UPPER_STAIR.end.y - ATRIUM_UPPER_STAIR.start.y) / ATRIUM_UPPER_STAIR.risers;
  for (let index = 0; index < ATRIUM_UPPER_STAIR.risers; index += 1) {
    const along0 = ATRIUM_UPPER_STAIR_LENGTH * index / ATRIUM_UPPER_STAIR.risers;
    const along1 = ATRIUM_UPPER_STAIR_LENGTH * (index + 1) / ATRIUM_UPPER_STAIR.risers;
    const y = ATRIUM_UPPER_STAIR.start.y + (index + 1) * upperRise;
    addUpperTreadTop(upperTreads, along0, along1, y);
    const lowY = index === 0 ? ATRIUM_UPPER_STAIR.start.y : y - upperRise;
    const width = upperHalfWidth(along0);
    upperRisers.addQuad(
      upperPointAtY(along0, -width, lowY), upperPointAtY(along0, width, lowY),
      upperPointAtY(along0, width, y), upperPointAtY(along0, -width, y),
    );
  }
  addUpperGlass(upperGlass, -1);
  addUpperGlass(upperGlass, 1);
  addMesh(group, upperTreads.geometry('Upper connector tapered ivory treads'), stone,
    'Upper connector tapered ivory treads');
  addMesh(group, upperRisers.geometry('Upper connector stone risers'), riser,
    'Upper connector stone risers');
  const upperFascia = new QuadBuilder();
  addUpperFascia(upperFascia, -1);
  addUpperFascia(upperFascia, 1);
  addMesh(group, upperFascia.geometry('Upper connector light ivory fascias'), fascia,
    'Upper connector light ivory fascias');
  addMesh(group, upperGlass.geometry('Upper connector brushed glass'), glass,
    'Upper connector brushed glass', false, false);
  for (const side of [-1, 1] as const) {
    group.add(createUpperRail(side, rail));
    for (let index = 0; index <= 7; index += 1) {
      addUpperPost(group, side, ATRIUM_UPPER_STAIR_LENGTH * index / 7, rail);
    }
  }
  const upperLight = new QuadBuilder();
  const upperLightSamples = Math.max(72, Math.ceil(ATRIUM_UPPER_STAIR_LENGTH * 8));
  for (let index = 0; index < upperLightSamples; index += 1) {
    const along0 = ATRIUM_UPPER_STAIR_LENGTH * index / upperLightSamples;
    const along1 = ATRIUM_UPPER_STAIR_LENGTH * (index + 1) / upperLightSamples;
    const p0 = atriumUpperStairPoint(along0, -(ATRIUM_UPPER_STAIR.width * 0.5 + 0.085));
    const p1 = atriumUpperStairPoint(along1, -(ATRIUM_UPPER_STAIR.width * 0.5 + 0.085));
    upperLight.addQuad(
      [p0.x, p0.y - 0.46, p0.z], [p1.x, p1.y - 0.46, p1.z],
      [p1.x, p1.y - 0.39, p1.z], [p0.x, p0.y - 0.39, p0.z],
    );
  }
  addMesh(group, upperLight.geometry('Upper connector tucked light'), upperGlow,
    'Upper connector tucked light', false, false);

  return {
    setLighting(artificialOn: boolean): void {
      fascia.emissiveIntensity = artificialOn ? .25 : 0;
      fasciaGlow.color.setHex(artificialOn ? 0xffd39a : 0x4d4035);
      fasciaGlow.opacity = artificialOn ? 0.95 : 0.10;
      fasciaWash.color.setHex(artificialOn ? 0xffbd7b : 0x514238);
      fasciaWash.opacity = artificialOn ? 0.16 : 0.025;
      upperGlow.color.setHex(artificialOn ? 0xffcc8f : 0x534337);
      upperGlow.opacity = artificialOn ? 0.56 : 0.06;
      fasciaGlow.needsUpdate = true;
      fasciaWash.needsUpdate = true;
      upperGlow.needsUpdate = true;
    },
  };
}
