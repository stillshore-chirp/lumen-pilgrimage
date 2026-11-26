import { BoxGeometry, Float32BufferAttribute, Mesh, type Group, type Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type XYZ = readonly [x: number, y: number, z: number];
type Axis = 0 | 1 | 2;

const axes = [0, 1, 2] as const;

/** Build one draw per material and assembly, with metre-scaled grain and separate shadow casters. */
export function beginLakeHallAssembly(root: Group, name: string, material: Material, castsShadow = false) {
  const parts: BoxGeometry[] = [];

  function box(centre: XYZ, size: XYZ, grainAxis: Axis = 0, tone = 1, uvOffset = 0) {
    const geometry = new BoxGeometry(...size);
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

  return { box, finish };
}

export type LakeHallAssembly = ReturnType<typeof beginLakeHallAssembly>;
