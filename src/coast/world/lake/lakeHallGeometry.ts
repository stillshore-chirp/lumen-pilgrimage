import { BoxGeometry, ExtrudeGeometry, Float32BufferAttribute, Mesh, Shape,
  type BufferGeometry, type Group, type Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type XYZ = readonly [x: number, y: number, z: number];
type Axis = 0 | 1 | 2;

const axes = [0, 1, 2] as const;

/** Build one draw per material and assembly, with metre-scaled grain and separate shadow casters. */
export function beginLakeHallAssembly(root: Group, name: string, material: Material, castsShadow = false) {
  const parts: BufferGeometry[] = [];

  function add(geometry: BufferGeometry, centre: XYZ, size: XYZ, grainAxis: Axis, tone: number, uvOffset: number) {
    const { position, uv, normal } = geometry.attributes;
    const tint = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      const point: XYZ = [position.getX(index), position.getY(index), position.getZ(index)];
      const normalAxis = Math.abs(normal.getX(index)) > .5 ? 0 : Math.abs(normal.getY(index)) > .5 ? 1 : 2;
      const inPlane = axes.filter(axis => axis !== normalAxis);
      const u = normalAxis === grainAxis ? inPlane[0] : grainAxis;
      const v = inPlane.find(axis => axis !== u)!;
      const axisNormal = normalAxis === 0 ? normal.getX(index) : normalAxis === 1 ? normal.getY(index) : normal.getZ(index);
      const sign = (v === (u + 1) % 3 ? 1 : -1) * axisNormal;
      uv.setXY(index, point[u] + size[u] / 2 + uvOffset, sign * point[v] + size[v] / 2);
      tint[index * 3] = tint[index * 3 + 1] = tint[index * 3 + 2] = tone;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(tint, 3));
    geometry.translate(...centre);
    parts.push(geometry);
  }

  function box(centre: XYZ, size: XYZ, grainAxis: Axis = 0, tone = 1, uvOffset = 0) {
    add(new BoxGeometry(...size), centre, size, grainAxis, tone, uvOffset);
  }

  // Slabs in an assembly share all attributes and can be batched independently of square stock.
  function slab(centre: XYZ, size: XYZ, bevel: number, grainAxis: Axis = 0, tone = 1, uvOffset = 0) {
    const [width, height, depth] = size;
    const halfX = width / 2 - bevel;
    const halfZ = depth / 2 - bevel;
    const profile = new Shape();
    profile.moveTo(-halfX, -halfZ);
    profile.lineTo(halfX, -halfZ);
    profile.lineTo(halfX, halfZ);
    profile.lineTo(-halfX, halfZ);
    profile.closePath();
    const geometry = new ExtrudeGeometry(profile, {
      depth: height - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2,
    });
    geometry.rotateX(-Math.PI / 2).translate(0, bevel - height / 2, 0);
    add(geometry, centre, size, grainAxis, tone, uvOffset);
  }

  function finish() {
    const geometry = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = castsShadow;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }

  return { box, slab, finish };
}

export type LakeHallAssembly = ReturnType<typeof beginLakeHallAssembly>;
