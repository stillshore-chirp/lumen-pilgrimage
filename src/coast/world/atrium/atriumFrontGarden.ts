import {
  BufferGeometry, CatmullRomCurve3, Color, DataTexture, ExtrudeGeometry, Float32BufferAttribute,
  Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, Path, RGBAFormat,
  Shape, UnsignedByteType, Vector2, Vector3,
} from 'three';
import type { Texture } from 'three';
import { ATRIUM_FRONT_GARDEN } from './atriumFrontPlan';
import type { AtriumFrontPoint } from './atriumFrontPlan';

type Random = () => number;

function gardenRandom(): Random {
  let state = 269147;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Opaque, closed geometry: leaves have curved laminae, undersides and thin edges. */
class GardenSurface {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];
  private readonly undersideIndices: number[] = [];
  private readonly uvs: number[] = [];
  private hasLeafUV = false;

  vertex(point: Vector3, color: Color, uv?: Vector2): number {
    const index = this.positions.length / 3;
    this.positions.push(point.x, point.y, point.z);
    this.colors.push(color.r, color.g, color.b);
    this.uvs.push(uv?.x ?? 0, uv?.y ?? 0);
    if (uv) this.hasLeafUV = true;
    return index;
  }

  triangle(a: number, b: number, c: number, underside = false): void {
    (underside ? this.undersideIndices : this.indices).push(a, b, c);
  }

  tube(points: readonly Vector3[], startRadius: number, endRadius: number, color: Color, sides = 7): void {
    const rings: number[][] = [];
    for (const [index, point] of points.entries()) {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const tangent = next.clone().sub(previous).normalize();
      const reference = Math.abs(tangent.y) > .9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
      const side = new Vector3().crossVectors(tangent, reference).normalize();
      const across = new Vector3().crossVectors(side, tangent).normalize();
      const fraction = index / (points.length - 1);
      const radius = startRadius + (endRadius - startRadius) * fraction;
      const ring: number[] = [];
      for (let segment = 0; segment < sides; segment++) {
        const angle = segment / sides * Math.PI * 2;
        const vertex = point.clone().addScaledVector(side, Math.cos(angle) * radius)
          .addScaledVector(across, Math.sin(angle) * radius);
        ring.push(this.vertex(vertex, color.clone().multiplyScalar(.94 + .07 * Math.sin(angle + index * .7))));
      }
      rings.push(ring);
    }
    for (let index = 0; index < rings.length - 1; index++) {
      for (let side = 0; side < sides; side++) {
        const next = (side + 1) % sides;
        this.triangle(rings[index][side], rings[index + 1][side], rings[index][next]);
        this.triangle(rings[index][next], rings[index + 1][side], rings[index + 1][next]);
      }
    }
    const bottom = this.vertex(points[0], color);
    const top = this.vertex(points[points.length - 1], color);
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides;
      this.triangle(bottom, rings[0][side], rings[0][next]);
      this.triangle(top, rings[rings.length - 1][next], rings[rings.length - 1][side]);
    }
  }

  leaf(base: Vector3, direction: Vector3, length: number, width: number, droop: number,
    color: Color, broad: boolean, roll: number): void {
    const segments = broad ? 11 : 7;
    const columns = broad ? 5 : 3;
    const axis = direction.clone().normalize();
    const horizontal = new Vector3(axis.x, 0, axis.z).normalize();
    const horizontalSide = new Vector3(horizontal.z, 0, -horizontal.x);
    // Reuse the existing roll sample: no added RNG calls may move a branch, petiole or clump.
    const phase = Math.min(.9999, Math.max(0, (roll + .16) / .32));
    const mature = broad && phase < .55;
    const young = broad && phase >= .85;
    const bladeLength = length * (young ? .68 / .835 : 1);
    const bladeWidth = width * (young ? .73 : 1);
    const centerAt = (t: number): Vector3 => {
      if (!broad) {
        const point = base.clone().addScaledVector(axis, length * t);
        point.y -= length * (droop * t * t + .10 * t ** 4);
        return point;
      }
      const horizontalDistance = mature ? .22 * t + .48 * t * t
        : young ? .20 * t + .17 * t * t : .34 * t + .17 * t * t;
      const rise = mature ? .98 * t - .26 * t * t - .20 * t ** 4
        : young ? .98 * t - .12 * t * t - .025 * t ** 4 : .94 * t - .20 * t * t - .06 * t ** 4;
      return base.clone().addScaledVector(horizontal, bladeLength * horizontalDistance)
        .add(new Vector3(0, bladeLength * rise, 0));
    };
    const thickness = broad ? .0009 : .0004;
    const backColor = color.clone().lerp(new Color(0x73806a), .18).multiplyScalar(1.04);
    const layers: number[][][] = [];
    for (const layer of [1, -1]) {
      const rows: number[][] = [];
      for (let row = 0; row <= segments; row++) {
        const t = row / segments;
        const center = centerAt(t);
        const tangent = centerAt(Math.min(1, t + .001)).sub(centerAt(Math.max(0, t - .001))).normalize();
        const twist = broad ? roll + Math.sin(phase * Math.PI * 2) * .17 * t : roll * (1 + .55 * t);
        const side = horizontalSide.clone().applyAxisAngle(tangent, twist);
        const normal = new Vector3().crossVectors(tangent, side).normalize();
        const halfWidth = Math.max(.0002, Math.pow(Math.sin(Math.PI * t), broad ? .60 : .85) * bladeWidth * .5);
        const camber = Math.sin(Math.PI * t) * bladeWidth * (broad ? (young ? .13 : .065) : .035);
        rows.push(Array.from({ length: columns }, (_, column) => {
          const across = column / (columns - 1) * 2 - 1;
          const rib = Math.sin(Math.PI * t) * (broad ? .0013 : .0003) * Math.exp(-across * across * 36);
          const point = center.clone().addScaledVector(side, across * halfWidth)
            .addScaledVector(normal, camber * (1 - across * across) + rib + layer * thickness * .5);
          const tone = (layer > 0 ? color : backColor).clone()
            .multiplyScalar((.91 + t * .12) * (1 + .025 * Math.exp(-across * across * 36)));
          return this.vertex(point, tone, new Vector2((across + 1) / 2, t));
        }));
      }
      layers.push(rows);
    }
    for (let row = 0; row < segments; row++) {
      for (let across = 0; across < columns - 1; across++) {
        const [a, b] = [layers[0][row][across], layers[0][row][across + 1]];
        const [c, d] = [layers[0][row + 1][across], layers[0][row + 1][across + 1]];
        this.triangle(a, c, b);
        this.triangle(b, c, d);
        const [e, f] = [layers[1][row][across], layers[1][row][across + 1]];
        const [g, h] = [layers[1][row + 1][across], layers[1][row + 1][across + 1]];
        this.triangle(e, f, g, true);
        this.triangle(f, h, g, true);
      }
      for (const edge of [0, columns - 1]) {
        const a = layers[0][row][edge], b = layers[1][row][edge];
        const c = layers[0][row + 1][edge], d = layers[1][row + 1][edge];
        if (edge === 0) {
          this.triangle(a, b, c, true);
          this.triangle(b, d, c, true);
        } else {
          this.triangle(a, c, b, true);
          this.triangle(b, c, d, true);
        }
      }
    }
    for (const row of [0, segments]) {
      for (let across = 0; across < columns - 1; across++) {
        const a = layers[0][row][across], b = layers[0][row][across + 1];
        const c = layers[1][row][across], d = layers[1][row][across + 1];
        if (row === 0) {
          this.triangle(a, b, c, true);
          this.triangle(b, d, c, true);
        } else {
          this.triangle(a, c, b, true);
          this.triangle(b, c, d, true);
        }
      }
    }
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    if (this.hasLeafUV) geometry.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex([...this.indices, ...this.undersideIndices]);
    if (this.undersideIndices.length) {
      geometry.addGroup(0, this.indices.length, 0);
      geometry.addGroup(this.indices.length, this.undersideIndices.length, 1);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function addSurface(root: Group, surface: GardenSurface,
  material: MeshStandardMaterial | MeshStandardMaterial[], name: string): Mesh {
  const mesh = new Mesh(surface.geometry(), material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function leafNormalMap(broad: boolean): DataTexture {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  const width = broad ? .10 : .025;
  const length = broad ? .40 : .175;
  const relief = (u: number, v: number): number => {
    const along = Math.max(0, Math.min(1, v));
    const across = Math.max(0, Math.min(1, u));
    const taper = Math.pow(Math.sin(Math.PI * along), .6);
    const vein = broad
      ? .00012 * Math.cos(across * Math.PI * 36 + .17 * Math.sin(along * Math.PI * 2))
      : .000025 * Math.cos((along * 10.5 - Math.abs(across - .5) * 2.7) * Math.PI * 2);
    const midrib = (broad ? .00018 : .00005) * Math.exp(-Math.pow((across - .5) / .025, 2));
    return (vein + midrib) * taper;
  };
  const step = 1 / size;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const u = (column + .5) / size, v = (row + .5) / size;
      const x = -(relief(u + step, v) - relief(u - step, v)) / (2 * step * width);
      const y = -(relief(u, v + step) - relief(u, v - step)) / (2 * step * length);
      const normal = new Vector3(x, y, 1).normalize();
      const offset = (row * size + column) * 4;
      pixels.set([Math.round((normal.x * .5 + .5) * 255),
        Math.round((normal.y * .5 + .5) * 255), Math.round((normal.z * .5 + .5) * 255), 255], offset);
    }
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  texture.name = broad ? 'Front Aspidistra fine parallel-vein normals' : 'Front Alii fine pinnate-vein normals';
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 2;
  texture.needsUpdate = true;
  return texture;
}

function leafMaterials(broad: boolean): MeshStandardMaterial[] {
  const normalMap = leafNormalMap(broad);
  const species = broad ? 'Aspidistra' : 'Alii';
  return [false, true].map(underside => new MeshStandardMaterial({
    name: `Front ${species} ${underside ? 'matte grey-green underside' : 'curved green upper lamina'}`,
    color: 0xffffff, vertexColors: true, metalness: 0,
    roughness: underside ? .81 : broad ? .59 : .61,
    normalMap, normalScale: new Vector2(broad ? .85 : .60, broad ? .85 : .60),
  }));
}

function insetOutline(outline: readonly AtriumFrontPoint[], inset: number): AtriumFrontPoint[] {
  return outline.map((point, index) => {
    const previous = outline[(index + outline.length - 1) % outline.length];
    const next = outline[(index + 1) % outline.length];
    const before = new Vector2(point.x - previous.x, point.z - previous.z).normalize();
    const after = new Vector2(next.x - point.x, next.z - point.z).normalize();
    const inwardBefore = new Vector2(-before.y, before.x);
    const inwardAfter = new Vector2(-after.y, after.x);
    const bisector = inwardBefore.add(inwardAfter).normalize();
    const distance = inset / bisector.dot(inwardAfter);
    return { x: point.x + bisector.x * distance, z: point.z + bisector.y * distance };
  });
}

function roundedPath(outline: readonly AtriumFrontPoint[], radius: number): Shape {
  const shape = new Shape();
  for (const [index, point] of outline.entries()) {
    const previous = outline[(index + outline.length - 1) % outline.length];
    const next = outline[(index + 1) % outline.length];
    const start = new Vector2(previous.x - point.x, previous.z - point.z).normalize().multiplyScalar(radius);
    const end = new Vector2(next.x - point.x, next.z - point.z).normalize().multiplyScalar(radius);
    if (index === 0) shape.moveTo(point.x + start.x, -point.z - start.y);
    else shape.lineTo(point.x + start.x, -point.z - start.y);
    shape.quadraticCurveTo(point.x, -point.z, point.x + end.x, -point.z - end.y);
  }
  shape.closePath();
  return shape;
}

function insideOutline(x: number, z: number, outline: readonly AtriumFrontPoint[]): boolean {
  return outline.every((point, index) => {
    const next = outline[(index + 1) % outline.length];
    return (next.x - point.x) * (z - point.z) - (next.z - point.z) * (x - point.x) >= 0;
  });
}

function addPlantingBed(root: Group, wallStone: Texture | null, random: Random): void {
  const { planting, floorY, tree } = ATRIUM_FRONT_GARDEN;
  const inner = insetOutline(planting.outline, planting.edgeWidth);
  const stoneShape = roundedPath(planting.outline, planting.cornerRadius);
  const hole = roundedPath(inner, planting.cornerRadius - planting.edgeWidth);
  stoneShape.holes.push(new Path(hole.getPoints(5).reverse()));
  const edge = new ExtrudeGeometry(stoneShape, {
    depth: planting.edgeTopY - floorY, bevelEnabled: false, curveSegments: 5,
  });
  edge.rotateX(-Math.PI / 2);
  edge.translate(0, floorY, 0);
  const stone = new MeshStandardMaterial({
    name: 'Front garden warm grey limestone edge', color: 0xbdb5a6,
    roughness: .72, metalness: 0, map: wallStone,
  });
  const curb = new Mesh(edge, stone);
  curb.name = 'Front garden continuous rounded six-sided stone curb';
  curb.castShadow = true;
  curb.receiveShadow = true;
  root.add(curb);

  const soilGeometry = new ExtrudeGeometry(roundedPath(inner, planting.cornerRadius - planting.edgeWidth), {
    depth: planting.soilY - floorY - .008, bevelEnabled: false, curveSegments: 5,
  });
  soilGeometry.rotateX(-Math.PI / 2);
  soilGeometry.translate(0, floorY + .008, 0);
  const soil = new Mesh(soilGeometry, new MeshStandardMaterial({
    name: 'Front garden aerated dark potting substrate', color: 0x30271e, roughness: 1, metalness: 0,
  }));
  soil.name = 'Front garden solid substrate soil surface';
  soil.receiveShadow = true;
  root.add(soil);

  const bark = new GardenSurface();
  const chipColor = new Color(0x4c3b2b);
  const barkBounds = planting.outline.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x), maxX: Math.max(bounds.maxX, point.x),
    minZ: Math.min(bounds.minZ, point.z), maxZ: Math.max(bounds.maxZ, point.z),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  for (let index = 0; index < 950; index++) {
    const x = barkBounds.minX + random() * (barkBounds.maxX - barkBounds.minX);
    const z = barkBounds.minZ + random() * (barkBounds.maxZ - barkBounds.minZ);
    if (!insideOutline(x, z, inner) || Math.hypot(x - tree.x, z - tree.z) < .23) continue;
    const length = .028 + random() * .040;
    const width = .008 + random() * .013;
    const angle = random() * Math.PI * 2;
    const axis = new Vector3(Math.cos(angle), .025, Math.sin(angle));
    const side = new Vector3(-axis.z, 0, axis.x);
    const center = new Vector3(x, planting.soilY + .004 + random() * .006, z);
    const color = chipColor.clone().multiplyScalar(.72 + random() * .52);
    const a = bark.vertex(center.clone().addScaledVector(axis, -length / 2).addScaledVector(side, -width / 2), color);
    const b = bark.vertex(center.clone().addScaledVector(axis, length / 2).addScaledVector(side, -width / 2), color);
    const c = bark.vertex(center.clone().addScaledVector(axis, length / 2).addScaledVector(side, width / 2), color);
    const d = bark.vertex(center.clone().addScaledVector(axis, -length / 2).addScaledVector(side, width / 2), color);
    const tip = bark.vertex(center.clone().add(new Vector3(0, .006, 0)), color.clone().multiplyScalar(1.12));
    bark.triangle(a, tip, b); bark.triangle(b, tip, c);
    bark.triangle(c, tip, d); bark.triangle(d, tip, a);
    bark.triangle(a, b, d); bark.triangle(b, c, d);
  }
  addSurface(root, bark, new MeshStandardMaterial({
    name: 'Front garden fine bark mulch', color: 0xffffff, roughness: .98, vertexColors: true,
  }), 'Front garden scattered fine bark with exposed root collar');
}

function addAlii(root: Group, random: Random): void {
  const { tree, planting } = ATRIUM_FRONT_GARDEN;
  const group = new Group();
  group.name = 'Front garden one narrow-leaf Alii fig';
  group.position.set(tree.x, 0, tree.z);
  root.add(group);
  const wood = new GardenSurface(), foliage = new GardenSurface();
  const bark = new Color(0x736555), leaf = new Color(0x425b3b);
  const soil = planting.soilY;
  const height = tree.topY - soil;
  const trunk = new CatmullRomCurve3([
    new Vector3(0, soil - .024, 0), new Vector3(.025, soil + height * .15, -.018),
    new Vector3(-.025, soil + height * .36, .025), new Vector3(.055, soil + height * .56, -.01),
    new Vector3(.015, soil + height * .75, .035), new Vector3(.045, tree.topY - .14, .015),
  ]);
  wood.tube(trunk.getPoints(24), tree.trunkDiameter / 2, .0036, bark, 10);
  for (let index = 0; index < 6; index++) {
    const angle = index * Math.PI / 3 + random() * .3;
    const radius = .22 + random() * .09;
    const direction = new Vector3(Math.cos(angle), 0, Math.sin(angle));
    const rootCurve = new CatmullRomCurve3([
      new Vector3(0, soil + .075, 0), direction.clone().multiplyScalar(.07).setY(soil + .031),
      direction.clone().multiplyScalar(radius * .63).setY(soil + .008),
      direction.clone().multiplyScalar(radius).setY(soil - .015),
    ]);
    wood.tube(rootCurve.getPoints(5), .028, .0035, bark, 7);
  }

  let leafCount = 0;
  const addLeaf = (anchor: Vector3, angle: number, newLeaf: boolean): void => {
    const direction = new Vector3(Math.cos(angle), -.12 + random() * .18, Math.sin(angle)).normalize();
    const base = anchor.clone().addScaledVector(direction, .012);
    wood.tube([anchor, base], .0008, .0005, bark, 4);
    const color = (newLeaf ? new Color(0x79805a) : leaf.clone()).multiplyScalar(.86 + random() * .24);
    foliage.leaf(base, direction, .15 + random() * .05, .02 + random() * .01,
      .25 + random() * .18, color, false, -.7 + random() * 1.4);
    leafCount++;
  };
  const trunkAtHeight = (y: number): Vector3 => {
    let low = 0, high = 1;
    for (let step = 0; step < 14; step++) {
      const middle = (low + high) * .5;
      if (trunk.getPoint(middle).y < y) low = middle;
      else high = middle;
    }
    return trunk.getPoint((low + high) * .5);
  };
  // Unequal branch origins and alternating nodes avoid a palm-like ring or a spherical crown.
  const crownRadius = tree.crownWidth / 2;
  for (let branch = 0; branch < 8; branch++) {
    const baseY = tree.branchStartY + branch * ((tree.topY - .35 - tree.branchStartY) / 7);
    const base = trunkAtHeight(baseY);
    const angle = branch * 2.39996 + .25 + (random() - .5) * .28;
    const spread = crownRadius * (.60 + .13 * Math.sin(branch / 8 * Math.PI));
    const tip = new Vector3(Math.cos(angle) * spread, Math.min(tree.topY - .16, baseY + .12), Math.sin(angle) * spread);
    const arch = base.clone().lerp(tip, .57);
    arch.y += .15;
    const main = new CatmullRomCurve3([base, arch, tip]);
    wood.tube(main.getPoints(9), .017 - branch * .0013, .0023, bark, 7);
    for (let twig = 0; twig < 5; twig++) {
      const along = .28 + twig * .14;
      const origin = main.getPoint(along);
      const twigAngle = angle + (twig % 2 ? 1 : -1) * (.32 + random() * .48);
      const radius = crownRadius * (.70 + random() * .12);
      const end = new Vector3(Math.cos(twigAngle) * radius,
        Math.min(tree.topY - .07, origin.y + .05 + random() * .09), Math.sin(twigAngle) * radius);
      const middle = origin.clone().lerp(end, .52).add(new Vector3(0, .055, 0));
      const curve = new CatmullRomCurve3([origin, middle, end]);
      wood.tube(curve.getPoints(5), .0046, .0011, bark, 5);
      for (let node = 0; node < 9; node++) {
        const point = curve.getPoint(.12 + node * .105);
        const leafAngle = twigAngle + (node % 2 ? 1 : -1) * (.65 + random() * .35);
        addLeaf(point, leafAngle, branch > 5 && node === 8);
      }
    }
  }
  const apex = trunk.getPoint(.97);
  for (let index = 0; index < 8; index++) addLeaf(apex.clone().add(new Vector3(0, index * .006, 0)), index * 2.4, true);
  addSurface(group, wood, new MeshStandardMaterial({
    name: 'Front Alii grey-brown bark and thin petioles', color: 0xffffff, roughness: .91, vertexColors: true,
  }), 'Front Alii continuous bent trunk branches roots and petioles');
  const crown = addSurface(group, foliage, leafMaterials(false),
    'Front Alii alternate curved narrow leaves with solid undersides');
  crown.userData.atriumPlant = { species: 'Alii', leafCount, soilY: soil };
}

function addAspidistra(root: Group, random: Random): void {
  const { planting, lowPlantGroups } = ATRIUM_FRONT_GARDEN;
  const foliage = new GardenSurface(), petioles = new GardenSurface();
  const inner = insetOutline(planting.outline, .22);
  const leafColor = new Color(0x3e5839), stemColor = new Color(0x526047);
  const centers: { x: number; z: number }[] = [];
  let leafCount = 0;
  for (const [groupIndex, group] of lowPlantGroups.entries()) {
    for (let clump = 0; clump < group.count; clump++) {
      let x = group.x, z = group.z;
      for (let attempt = 0; attempt < 300; attempt++) {
        const angle = random() * Math.PI * 2, radius = Math.sqrt(random());
        x = group.x + Math.cos(angle) * radius * group.width * .5;
        z = group.z + Math.sin(angle) * radius * group.depth * .5;
        if (insideOutline(x, z, inner) && centers.every(point => Math.hypot(x - point.x, z - point.z) > .17)) break;
      }
      centers.push({ x, z });
      const count = 5 + Math.floor(random() * 3);
      const clumpYaw = random() * Math.PI * 2;
      for (let index = 0; index < count; index++) {
        const angle = clumpYaw + index * 2.39996 + (random() - .5) * .4;
        const rise = (group.topY - planting.soilY) * (.71 + random() * .28);
        const petioleHeight = rise * (.46 + random() * .05);
        const offset = .015 + random() * .035;
        const base = new Vector3(x + Math.cos(angle) * offset, planting.soilY - .006, z + Math.sin(angle) * offset);
        const bladeBase = base.clone().add(new Vector3(Math.cos(angle) * .035, petioleHeight, Math.sin(angle) * .035));
        const midpoint = base.clone().lerp(bladeBase, .55).add(new Vector3(0, .01, 0));
        petioles.tube([base, midpoint, bladeBase], .0034, .0018, stemColor, 5);
        const direction = new Vector3(Math.cos(angle) * .436, .90, Math.sin(angle) * .436).normalize();
        const length = (rise - petioleHeight) / .68;
        const color = leafColor.clone().multiplyScalar(.88 + random() * .22 + (index === 0 ? .12 : 0));
        foliage.leaf(bladeBase, direction, length, .078 + random() * .047,
          .22, color, true, (random() - .5) * .32);
        leafCount++;
      }
    }
    root.userData[`atriumAspidistraGroup${groupIndex}`] = { count: group.count, center: [group.x, group.z] };
  }
  addSurface(root, petioles, new MeshStandardMaterial({
    name: 'Front Aspidistra grounded long petioles', color: 0xffffff, roughness: .88, vertexColors: true,
  }), 'Front Aspidistra petioles growing directly from the soil');
  const leaves = addSurface(root, foliage, leafMaterials(true),
    'Front Aspidistra three uneven groups of erect leathery leaves');
  leaves.userData.atriumPlant = { species: 'Aspidistra elatior', clumps: centers, leafCount, soilY: planting.soilY };
}

/** All created GPU resources belong to the supplied scene's existing disposal path. */
export function buildAtriumFrontGarden(root: Group, wallStone: Texture | null): void {
  const group = new Group();
  group.name = 'Front enclosed light garden planting';
  root.add(group);
  const random = gardenRandom();
  addPlantingBed(group, wallStone, random);
  addAlii(group, random);
  addAspidistra(group, random);
}
