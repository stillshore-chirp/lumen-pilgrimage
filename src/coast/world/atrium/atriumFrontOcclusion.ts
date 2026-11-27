import {
  DataTexture, Float32BufferAttribute, InstancedMesh, LinearFilter, LinearMipmapLinearFilter,
  Mesh, MeshStandardMaterial, NoColorSpace, RedFormat, Vector3,
} from 'three';
import type { BufferGeometry, Object3D } from 'three';

export type FrontAoContact = Readonly<{
  u: number;
  v: number;
  width: number;
  height: number;
  shape: 'rect' | 'ellipse';
  falloff: number;
  /** Final local indirect-light loss, capped at .35; overlapping contacts do not multiply. */
  strength: number;
}>;

export type FrontAoReceiver = Readonly<{
  mesh: Mesh;
  /** World-space corner at u=0, v=0; all dimensions and contacts are in metres. */
  origin: readonly [number, number, number];
  /** Orthogonal world-space unit axes; their cross product faces the receiving side. */
  uAxis: readonly [number, number, number];
  vAxis: readonly [number, number, number];
  width: number;
  height: number;
  contacts: readonly FrontAoContact[];
}>;

type ReceiverTile = {
  receiver: FrontAoReceiver;
  contacts: readonly FrontAoContact[];
  width: number;
  height: number;
  x: number;
  y: number;
};

const maxAtlasSize = 2048;
const padding = 8;
const planeTolerance = .003;

function validReceiver(receiver: FrontAoReceiver): boolean {
  const { origin, uAxis, vAxis, width, height } = receiver;
  if (![...origin, ...uAxis, ...vAxis, width, height].every(Number.isFinite)
    || width <= 0 || height <= 0) return false;
  const u = new Vector3(...uAxis), v = new Vector3(...vAxis);
  return Math.abs(u.lengthSq() - 1) < .0001 && Math.abs(v.lengthSq() - 1) < .0001
    && Math.abs(u.dot(v)) < .0001;
}

function validContact(contact: FrontAoContact): boolean {
  return [contact.u, contact.v, contact.width, contact.height, contact.falloff, contact.strength]
    .every(Number.isFinite) && contact.width > 0 && contact.height > 0
    && contact.falloff > 0 && contact.strength > 0;
}

function packTiles(tiles: ReceiverTile[]): number | undefined {
  // Large architectural planes use fewer texels than the small shelf/contact surfaces.
  // The finite density reduction keeps this facility within one 2048-square R8 atlas.
  for (let attempt = 0; attempt < 13; attempt += 1) {
    const scale = .8 ** attempt;
    for (const tile of tiles) {
      const { receiver } = tile;
      const density = (receiver.width * receiver.height > 16 ? 32 : 64) * scale;
      tile.width = Math.max(4, Math.ceil(receiver.width * density) + 1);
      tile.height = Math.max(4, Math.ceil(receiver.height * density) + 1);
    }
    const ordered = [...tiles].sort((a, b) => b.height - a.height);
    for (let size = 512; size <= maxAtlasSize; size *= 2) {
      // Reserve the lower-left corner as the common neutral sample.
      let x = 32, y = 0, rowHeight = 32;
      let fits = true;
      for (const tile of ordered) {
        const width = tile.width + padding * 2, height = tile.height + padding * 2;
        if (width > size || height > size) { fits = false; break; }
        if (x + width > size) { x = 0; y += rowHeight; rowHeight = 0; }
        if (y + height > size) { fits = false; break; }
        tile.x = x + padding;
        tile.y = y + padding;
        x += width;
        rowHeight = Math.max(rowHeight, height);
      }
      if (fits) return size;
    }
  }
  return undefined;
}

function contactDistance(contact: FrontAoContact, u: number, v: number): number {
  const x = Math.abs(u - contact.u), y = Math.abs(v - contact.v);
  const a = contact.width / 2, b = contact.height / 2;
  if (contact.shape === 'rect') return Math.hypot(Math.max(0, x - a), Math.max(0, y - b));
  if ((x / a) ** 2 + (y / b) ** 2 <= 1) return 0;
  if (Math.abs(a - b) < .00001) return Math.hypot(x, y) - a;
  // The closest point of an ellipse solves one monotone scalar equation outside it.
  // Bounded bisection preserves the contact's metre-sized falloff for oval feet too.
  let low = 0, high = Math.max(a, b) * Math.hypot(x, y);
  for (let i = 0; i < 16; i += 1) {
    const t = (low + high) / 2;
    const extent = (a * x / (t + a * a)) ** 2 + (b * y / (t + b * b)) ** 2;
    if (extent > 1) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return Math.hypot(x - a * a * x / (t + a * a), y - b * b * y / (t + b * b));
}

function paintTile(data: Uint8Array, size: number, tile: ReceiverTile): void {
  const { receiver, width, height } = tile;
  for (const contact of tile.contacts) {
    const left = Math.max(0, Math.floor((contact.u - contact.width / 2 - contact.falloff)
      / receiver.width * (width - 1)));
    const right = Math.min(width - 1, Math.ceil((contact.u + contact.width / 2 + contact.falloff)
      / receiver.width * (width - 1)));
    const bottom = Math.max(0, Math.floor((contact.v - contact.height / 2 - contact.falloff)
      / receiver.height * (height - 1)));
    const top = Math.min(height - 1, Math.ceil((contact.v + contact.height / 2 + contact.falloff)
      / receiver.height * (height - 1)));
    for (let y = bottom; y <= top; y += 1) for (let x = left; x <= right; x += 1) {
      const distance = contactDistance(contact, x / (width - 1) * receiver.width,
        y / (height - 1) * receiver.height);
      if (distance >= contact.falloff) continue;
      const t = distance / contact.falloff;
      const loss = Math.min(.35, contact.strength) * (1 - t * t * (3 - 2 * t));
      const index = (tile.y + y) * size + tile.x + x;
      // Native aoMapIntensity=1 makes R=1-loss; contacts saturate instead of multiplying.
      data[index] = Math.min(data[index], Math.round(255 * (1 - loss)));
    }
  }
}

function makeAtlas(tiles: ReceiverTile[], size: number): DataTexture {
  const data = new Uint8Array(size * size).fill(255);
  for (const tile of tiles) paintTile(data, size, tile);
  const atlas = new DataTexture(data, size, size, RedFormat);
  atlas.name = 'Front facility geometry contact approximation, white neutral R8 atlas';
  atlas.colorSpace = NoColorSpace;
  atlas.channel = 1;
  atlas.magFilter = LinearFilter;
  atlas.minFilter = LinearMipmapLinearFilter;
  // Automatic whole-atlas mip averaging would darken the common white sample.
  // Each explicit level keeps that corner white, including the final 1x1 level.
  atlas.mipmaps = [{ data, width: size, height: size }];
  let previous = data, width = size;
  while (width > 1) {
    const nextWidth = width / 2;
    const next = new Uint8Array(nextWidth * nextWidth);
    for (let y = 0; y < nextWidth; y += 1) for (let x = 0; x < nextWidth; x += 1) {
      const index = y * 2 * width + x * 2;
      next[y * nextWidth + x] = Math.round((previous[index] + previous[index + 1]
        + previous[index + width] + previous[index + width + 1]) / 4);
    }
    next[0] = 255;
    atlas.mipmaps.push({ data: next, width: nextWidth, height: nextWidth });
    previous = next;
    width = nextWidth;
  }
  atlas.generateMipmaps = false;
  atlas.needsUpdate = true;
  return atlas;
}

function receiverGeometry(mesh: Mesh, tiles: readonly ReceiverTile[], size: number): BufferGeometry {
  const source = mesh.geometry;
  // A face can share indexed vertices with an unrelated side. Separate triangle
  // corners here so the rear and edge faces retain their neutral UVs.
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const position = geometry.getAttribute('position');
  const uv = new Float32BufferAttribute(new Float32Array(position.count * 2).fill(.5 / size), 2);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const faceNormal = new Vector3(), edge = new Vector3(), point = new Vector3();
  for (const tile of tiles) {
    const { receiver } = tile;
    const origin = new Vector3(...receiver.origin), u = new Vector3(...receiver.uAxis);
    const v = new Vector3(...receiver.vAxis), normal = new Vector3().crossVectors(u, v);
    for (let i = 0; i + 2 < position.count; i += 3) {
      a.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, i + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, i + 2).applyMatrix4(mesh.matrixWorld);
      faceNormal.subVectors(b, a).cross(edge.subVectors(c, a)).normalize();
      if (faceNormal.dot(normal) < .7) continue;
      const corners = [a, b, c];
      const projected = corners.map(corner => {
        point.copy(corner).sub(origin);
        return { u: point.dot(u), v: point.dot(v), distance: Math.abs(point.dot(normal)) };
      });
      if (projected.some(corner => corner.distance > planeTolerance || corner.u < -planeTolerance
        || corner.u > receiver.width + planeTolerance || corner.v < -planeTolerance
        || corner.v > receiver.height + planeTolerance)) continue;
      for (let corner = 0; corner < 3; corner += 1) {
        const value = projected[corner];
        const s = Math.max(0, Math.min(1, value.u / receiver.width));
        const t = Math.max(0, Math.min(1, value.v / receiver.height));
        uv.setXY(i + corner, (tile.x + .5 + s * (tile.width - 1)) / size,
          (tile.y + .5 + t * (tile.height - 1)) / size);
      }
    }
  }
  geometry.setAttribute('uv1', uv);
  return geometry;
}

/** Apply once to the two new facility roots, before their opaque meshes are batched. */
export function applyAtriumFrontOcclusion(
  roots: readonly Object3D[], receivers: readonly FrontAoReceiver[],
): void {
  const meshes = new Set<Mesh>();
  const sceneRoots = new Set<Object3D>();
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse(object => { if (object instanceof Mesh) meshes.add(object); });
    let ancestor = root;
    while (ancestor.parent) ancestor = ancestor.parent;
    sceneRoots.add(ancestor);
  }
  const tiles: ReceiverTile[] = [];
  for (const receiver of receivers) {
    if (!meshes.has(receiver.mesh) || receiver.mesh instanceof InstancedMesh || !validReceiver(receiver)) continue;
    const contacts = receiver.contacts.filter(validContact);
    if (contacts.length > 0) tiles.push({ receiver, contacts, width: 0, height: 0, x: 0, y: 0 });
  }
  if (tiles.length === 0) return;
  const size = packTiles(tiles);
  if (!size) return;
  const atlas = makeAtlas(tiles, size);
  const byMesh = new Map<Mesh, ReceiverTile[]>();
  for (const tile of tiles) {
    const group = byMesh.get(tile.receiver.mesh) ?? [];
    group.push(tile);
    byMesh.set(tile.receiver.mesh, group);
  }
  const neutralCopies = new Map<BufferGeometry, BufferGeometry>();
  const replaced = new Set<BufferGeometry>();
  const materials = new Set<MeshStandardMaterial>();
  for (const mesh of meshes) {
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const pbr = list.filter((material): material is MeshStandardMaterial => material instanceof MeshStandardMaterial);
    if (pbr.length === 0) continue;
    for (const material of pbr) materials.add(material);
    const source = mesh.geometry;
    const meshTiles = byMesh.get(mesh);
    if (meshTiles) mesh.geometry = receiverGeometry(mesh, meshTiles, size);
    else {
      let geometry = neutralCopies.get(source);
      if (!geometry) {
        geometry = source.clone();
        const count = geometry.getAttribute('position').count;
        geometry.setAttribute('uv1', new Float32BufferAttribute(new Float32Array(count * 2).fill(.5 / size), 2));
        neutralCopies.set(source, geometry);
      }
      mesh.geometry = geometry;
    }
    replaced.add(source);
  }
  for (const material of materials) {
    material.aoMap = atlas;
    material.aoMapIntensity = 1;
    material.needsUpdate = true;
  }
  if (materials.size === 0) atlas.dispose();
  // Roots own new scene resources. Preserve any shared source still attached
  // elsewhere in the scene; release only geometries orphaned by these copies.
  for (const root of sceneRoots) root.traverse(object => {
    if (object instanceof Mesh) replaced.delete(object.geometry);
  });
  for (const geometry of replaced) geometry.dispose();
}
