import {
  CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3,
  type BufferGeometry, type Group, type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CINEMA_SPEAKER_EQUIPMENT, type CinemaEquipmentBox } from './cinemaSpeakerGeometry';

export const CINEMA_SPEAKER_DETAIL = {
  cabinetRadius: .012,
  mountRadius: .003,
  grilleRim: .026,
  fixingDiameter: .008,
  supportDiameter: .035,
} as const;

interface Instance {
  readonly matrix: Matrix4;
  readonly envelope: CinemaEquipmentBox;
}

function pose(box: CinemaEquipmentBox): Matrix4 {
  return new Matrix4().compose(box.center, box.rotation, new Vector3(1, 1, 1));
}

function localPose(box: CinemaEquipmentBox, offset: Vector3, rotation = new Quaternion(), scale = new Vector3(1, 1, 1)): Matrix4 {
  const center = offset.applyQuaternion(box.rotation).add(box.center);
  return new Matrix4().compose(center, box.rotation.clone().multiply(rotation), scale);
}

function instanced(group: Group, name: string, geometry: BufferGeometry, material: Material, instances: readonly Instance[]): void {
  const mesh = new InstancedMesh(geometry, material, instances.length);
  mesh.name = name;
  mesh.userData.cinemaEquipmentEnvelopes = instances.map(({ envelope }) => envelope);
  instances.forEach(({ matrix }, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
}

function dimensionalGroups(boxes: readonly CinemaEquipmentBox[]): readonly CinemaEquipmentBox[][] {
  const groups = new Map<string, CinemaEquipmentBox[]>();
  for (const box of boxes) {
    const key = box.size.toArray().join(':');
    const group = groups.get(key);
    if (group) group.push(box);
    else groups.set(key, [box]);
  }
  return [...groups.values()];
}

function grilleRim(width: number, height: number): BufferGeometry {
  const rim = CINEMA_SPEAKER_DETAIL.grilleRim;
  const bars: BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    bars.push(new RoundedBoxGeometry(rim, height - rim, .030, 1, .003)
      .translate(sign * (width - rim) / 2, 0, 0));
    bars.push(new RoundedBoxGeometry(width, rim, .030, 1, .003)
      .translate(0, sign * (height - rim) / 2, 0));
  }
  const geometry = mergeGeometries(bars);
  for (const bar of bars) bar.dispose();
  return geometry;
}

function mountFixings(box: CinemaEquipmentBox): Instance[] {
  const dimensions = box.size.toArray();
  const axis = dimensions.indexOf(Math.min(...dimensions));
  const face = new Vector3();
  // The backplate's outside is local -Z. The wall and roof pads face the room.
  const sign = axis === 0 && box.center.x < 0 ? 1 : -1;
  face.setComponent(axis, sign);
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), face);
  const plane = [0, 1, 2].filter(value => value !== axis);
  const result: Instance[] = [];
  for (const u of [-1, 1]) for (const v of [-1, 1]) {
    const offset = new Vector3();
    offset.setComponent(axis, sign * (dimensions[axis] / 2 - .004));
    offset.setComponent(plane[0], u * dimensions[plane[0]] * .34);
    offset.setComponent(plane[1], v * dimensions[plane[1]] * .34);
    result.push({
      matrix: localPose(box, offset, rotation, new Vector3(CINEMA_SPEAKER_DETAIL.fixingDiameter, .006,
        CINEMA_SPEAKER_DETAIL.fixingDiameter)),
      envelope: box,
    });
  }
  return result;
}

/** Detailed skins remain inside the shared collision/support envelopes. */
export function createCinemaSpeakerEquipment(group: Group): void {
  const boxes = CINEMA_SPEAKER_EQUIPMENT.flatMap(({ boxes }) => boxes);
  const cabinet = new MeshStandardMaterial({ color: 0x272a2d, roughness: .72, metalness: .06 });
  const grille = new MeshStandardMaterial({ color: 0x15191b, roughness: .86, metalness: .15 });
  const metal = new MeshStandardMaterial({ color: 0x3b3d40, roughness: .54, metalness: .65 });
  const fixings: Instance[] = [];

  for (const members of dimensionalGroups(boxes.filter(({ part }) => part === 'cabinet'))) {
    const { x, y, z } = members[0].size;
    instanced(group, 'Rounded cinema speaker enclosures',
      new RoundedBoxGeometry(x, y, z, 2, CINEMA_SPEAKER_DETAIL.cabinetRadius), cabinet,
      members.map(envelope => ({ matrix: pose(envelope), envelope })));
  }
  for (const members of dimensionalGroups(boxes.filter(({ part }) => part === 'grille'))) {
    const { x, y } = members[0].size;
    const rim = CINEMA_SPEAKER_DETAIL.grilleRim;
    instanced(group, 'Recessed cinema speaker grilles', new RoundedBoxGeometry(x - 2 * rim, y - 2 * rim, .004, 1, .002),
      grille, members.map(envelope => ({ matrix: pose(envelope), envelope })));
    instanced(group, 'Cinema speaker grille frames', grilleRim(x, y), metal,
      members.map(envelope => ({ matrix: pose(envelope), envelope })));
    for (const envelope of members) for (const u of [-1, 1]) for (const v of [-1, 1]) {
      fixings.push({
        matrix: localPose(envelope, new Vector3(u * (x - rim) / 2, v * (y - rim) / 2, .014),
          new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(0, 0, 1)),
          new Vector3(CINEMA_SPEAKER_DETAIL.fixingDiameter, .006, CINEMA_SPEAKER_DETAIL.fixingDiameter)),
        envelope,
      });
    }
  }
  for (const members of dimensionalGroups(boxes.filter(({ part }) => part === 'mount'))) {
    const { x, y, z } = members[0].size;
    instanced(group, 'Bevelled cinema speaker mounting plates',
      new RoundedBoxGeometry(x, y, z, 1, CINEMA_SPEAKER_DETAIL.mountRadius), metal,
      members.map(envelope => ({ matrix: pose(envelope), envelope })));
    for (const member of members) fixings.push(...mountFixings(member));
  }
  const supports = boxes.filter(({ part }) => part === 'support');
  instanced(group, 'Tubular cinema speaker supports', new CylinderGeometry(.5, .5, 1, 16), metal,
    supports.map(envelope => ({ matrix: envelope.matrix, envelope })));
  instanced(group, 'Recessed cinema speaker fixings', new CylinderGeometry(.5, .5, 1, 8), metal, fixings);
}
