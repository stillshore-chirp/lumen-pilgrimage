import {
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  TubeGeometry,
  Vector3,
} from 'three';
import {
  ATRIUM_GALLERY_EDGE,
  ATRIUM_STAIR_LENGTH,
  ATRIUM_STAIR_STEPS,
  ATRIUM_UPPER_STAIR,
  ATRIUM_UPPER_STAIR_LENGTH,
  ATRIUM_WALK_LEVEL,
  atriumStairFrame,
  atriumStairPoint,
  atriumUpperStairPoint,
} from './atriumLayout';

type AtriumStairStep = (typeof ATRIUM_STAIR_STEPS)[number];
type Point = readonly [number, number, number];

const EPSILON = 1e-6;
const MAIN_SAMPLE_COUNT = Math.max(160, Math.ceil(ATRIUM_STAIR_LENGTH * 10));
const FASCIA_SIDE = -1;
const FASCIA_FALLOFF = [
  [0, .09], [.055, .56], [.115, 1], [.182, .85], [.285, .52], [.43, .25], [.63, .11], [1, .035],
] as const;

class QuadBuilder {
  private readonly positions: number[] = [];
  private readonly uv: number[] = [];

  constructor(private readonly coveLit = false) {}

  addQuad(a: Point, b: Point, c: Point, d: Point, light: readonly [number, number, number, number] = [0, 0, 0, 0]): void {
    const corners = [a, b, c, d];
    for (const index of [0, 1, 2, 0, 2, 3]) {
      this.positions.push(...corners[index]);
      if (this.coveLit) this.uv.push(.25 + .5 * light[index], .5);
    }
  }

  geometry(name: string): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.name = name;
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    if (this.coveLit) geometry.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
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
  const termination = smoothStep((progress - 0.88) / 0.12);
  // The lower landing begins as a modest apron. The west/front side grows
  // into the 1.1–1.5m architectural fascia seen across the upper sweep, then
  // eases down before the gallery landing instead of ending abruptly.
  return 0.22 + 1.27 * onset * (1 - 0.68 * termination);
}

function sideAcross(width: number, side: number, inset: number): number {
  return side * (width * 0.5 - inset);
}

function galleryJoin(side: number, inset: number): number {
  let start = ATRIUM_STAIR_LENGTH - 6;
  let end = ATRIUM_STAIR_LENGTH;
  while (end - start > 0.003) {
    const middle = (start + end) * 0.5;
    const frame = atriumStairFrame(middle);
    const point = atriumStairPoint(middle, sideAcross(frame.width, side, inset));
    if (point.x > -ATRIUM_GALLERY_EDGE) start = middle;
    else end = middle;
  }
  return end;
}

function addTreadTop(builder: QuadBuilder, step: AtriumStairStep): void {
  const length = step.end - step.start;
  const segments = Math.max(1, Math.ceil(length / 0.42));
  // The gallery finish covers the last landing wherever the two plans overlap.
  const y = step.y === ATRIUM_WALK_LEVEL ? step.y - 0.012 : step.y;
  for (let index = 0; index < segments; index++) {
    const start = step.start + length * index / segments;
    const end = step.start + length * (index + 1) / segments;
    const a = atriumStairFrame(start).width * 0.5;
    const b = atriumStairFrame(end).width * 0.5;
    builder.addQuad(mainPoint(start, -a, y), mainPoint(start, a, y),
      mainPoint(end, b, y), mainPoint(end, -b, y));
  }
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
    const bottom0 = Math.max(0, top0 - 0.34 - .11 * fasciaDepth(along0));
    const bottom1 = Math.max(0, top1 - 0.34 - .11 * fasciaDepth(along1));
    builder.addQuad(
      mainPoint(along0, -frame0.width * 0.5 + 0.08, bottom0),
      mainPoint(along0, frame0.width * 0.5 - 0.08, bottom0),
      mainPoint(along1, frame1.width * 0.5 - 0.08, bottom1),
      mainPoint(along1, -frame1.width * 0.5 + 0.08, bottom1),
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

function addFasciaFace(builder: QuadBuilder, bottom0: Point, bottom1: Point, top1: Point, top0: Point): void {
  const interpolate = (bottom: Point, top: Point, fraction: number): Point =>
    [bottom[0], bottom[1] + (top[1] - bottom[1]) * fraction, bottom[2]];
  for (let row = 1; row < FASCIA_FALLOFF.length; row += 1) {
    const [lower, dim] = FASCIA_FALLOFF[row - 1];
    const [upper, bright] = FASCIA_FALLOFF[row];
    builder.addQuad(interpolate(bottom0, top0, lower), interpolate(bottom1, top1, lower),
      interpolate(bottom1, top1, upper), interpolate(bottom0, top0, upper), [dim, dim, bright, bright]);
  }
}

function roundedFasciaTop(along: number, stop: number): number {
  // Blend across the break in pitch at each intermediate landing, keeping
  // the fascia attached at the first tread and at the upper gallery.
  const radius = Math.max(0, Math.min(1.65, along, stop - along));
  let height = 0;
  for (let sample = -4; sample <= 4; sample += 1) {
    height += atriumStairFrame(along + sample * radius * .25).y * (5 - Math.abs(sample));
  }
  return height / 25 + .045;
}

function addSideFascia(builder: QuadBuilder, side: number, depthScale: number): void {
  const stop = galleryJoin(side, -0.11);
  for (let index = 0; index < MAIN_SAMPLE_COUNT; index += 1) {
    const along0 = stop * index / MAIN_SAMPLE_COUNT;
    const along1 = stop * (index + 1) / MAIN_SAMPLE_COUNT;
    const frame0 = atriumStairFrame(along0);
    const frame1 = atriumStairFrame(along1);
    const outer0 = sideAcross(frame0.width, side, -0.11);
    const outer1 = sideAcross(frame1.width, side, -0.11);
    const inner0 = sideAcross(frame0.width, side, 0.29);
    const inner1 = sideAcross(frame1.width, side, 0.29);
    const top0 = side === FASCIA_SIDE ? roundedFasciaTop(along0, stop) : frame0.y + .035;
    const top1 = side === FASCIA_SIDE ? roundedFasciaTop(along1, stop) : frame1.y + .035;
    const bottom0 = Math.max(0.025, top0 - fasciaDepth(along0) * depthScale);
    const bottom1 = Math.max(0.025, top1 - fasciaDepth(along1) * depthScale);

    // Side, top, underside and return faces make this a continuous structural
    // fascia rather than a thin diagonal ribbon.
    if (side === FASCIA_SIDE) {
      addFasciaFace(builder, mainPoint(along0, outer0, bottom0), mainPoint(along1, outer1, bottom1),
        mainPoint(along1, outer1, top1), mainPoint(along0, outer0, top0));
    } else {
      builder.addQuad(mainPoint(along0, outer0, top0), mainPoint(along1, outer1, top1),
        mainPoint(along1, outer1, bottom1), mainPoint(along0, outer0, bottom0));
    }
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
      [.035, .035, .13, .13],
    );
  }
}

function addMainGlass(builder: QuadBuilder, side: number): void {
  const stop = galleryJoin(side, 0.085);
  for (const step of ATRIUM_STAIR_STEPS) {
    if (step.start >= stop) break;
    const end = Math.min(step.end, stop);
    const bottom = step.y + 0.035;
    for (let start = step.start; start < end; start += 0.45) {
      const next = Math.min(end, start + 0.45);
      const across0 = sideAcross(atriumStairFrame(start).width, side, 0.085);
      const across1 = sideAcross(atriumStairFrame(next).width, side, 0.085);
      builder.addQuad(mainPoint(start, across0, bottom), mainPoint(next, across1, bottom),
        mainPoint(next, across1, bottom + 1.12), mainPoint(start, across0, bottom + 1.12));
    }
  }
}

function createMainRail(side: number, lower: boolean, material: MeshStandardMaterial): Mesh {
  const points: Vector3[] = [];
  const offset = lower ? -0.31 : 0;
  const stop = galleryJoin(side, 0.085);
  for (let index = 0; index <= MAIN_SAMPLE_COUNT; index += 1) {
    const along = stop * index / MAIN_SAMPLE_COUNT;
    const frame = atriumStairFrame(along);
    const across = sideAcross(frame.width, side, 0.085);
    const { x, z } = atriumStairPoint(along, across);
    points.push(new Vector3(x, frame.y + 1.17 + offset, z));
  }
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  const geometry = new TubeGeometry(curve, MAIN_SAMPLE_COUNT, lower ? 0.026 : 0.041, 8, false);
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

function mainPostAlongs(stop: number): readonly number[] {
  const result: number[] = [0];
  for (let index = 0; index < ATRIUM_STAIR_STEPS.length; index += 1) {
    const step = ATRIUM_STAIR_STEPS[index];
    if (step.start >= stop) break;
    if (index % 3 === 0 || step.y !== ATRIUM_STAIR_STEPS[index - 1]?.y) result.push(step.start);
  }
  result.push(stop);
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
    addFasciaFace(builder, [p0.x, bottom0, p0.z], [p1.x, bottom1, p1.z],
      [p1.x, top1, p1.z], [p0.x, top0, p0.z]);
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
  material: MeshStandardMaterial | MeshPhysicalMaterial,
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
    name: 'Warm stone tread risers', color: 0xcbb69c, roughness: 0.81, metalness: 0.02,
  });
  const fasciaFalloff = new DataTexture(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1);
  fasciaFalloff.name = 'Stair fascia reflected-light intensity';
  fasciaFalloff.minFilter = fasciaFalloff.magFilter = LinearFilter;
  fasciaFalloff.needsUpdate = true;
  const fascia = new MeshStandardMaterial({
    name: 'Ivory stair fascia with concealed cove', color: 0xe6d9c3,
    roughness: 0.65, metalness: 0.02, side: DoubleSide, emissive: 0xffe3c4, emissiveMap: fasciaFalloff,
  });
  const fasciaShadow = new MeshStandardMaterial({
    name: 'Warm stone fascia underside', color: 0xd0bfa7, roughness: 0.76,
    side: DoubleSide, emissive: 0xe3c6a5,
  });
  const nosing = new MeshStandardMaterial({
    name: 'Recessed warm gray tread nosing', color: 0x7a6b5d, roughness: 0.71, metalness: 0.04,
  });
  const rail = new MeshStandardMaterial({
    name: 'Reflective brushed champagne stair rail', color: 0xb0a68e, roughness: 0.22, metalness: 0.63,
  });
  const glass = new MeshPhysicalMaterial({
    name: 'Reflective low-iron stair glass', color: 0xaab7b1, roughness: 0.13, metalness: 0.04,
    transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide, forceSinglePass: true,
    ior: 1.47, clearcoat: 0.27, specularIntensity: 0.73,
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

  const frontFascia = new QuadBuilder(true);
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
  for (const side of [-1, 1] as const) {
    for (const along of mainPostAlongs(galleryJoin(side, 0.085))) addMainPost(group, side, along, rail);
  }
  group.add(createMainRail(-1, false, rail));
  group.add(createMainRail(1, false, rail));
  group.add(createMainRail(-1, true, rail));
  group.add(createMainRail(1, true, rail));

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
  const upperFascia = new QuadBuilder(true);
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
  return {
    setLighting(artificialOn: boolean): void {
      fascia.emissiveIntensity = artificialOn ? 1.28 : 0;
      fasciaShadow.emissiveIntensity = artificialOn ? .105 : 0;
    },
  };
}
