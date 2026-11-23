import type { MeshStandardMaterial } from 'three';
import type { FurnitureModel } from './residenceFurnitureModel';

export function fixtureFinish<T extends MeshStandardMaterial>(model: FurnitureModel, diffuser: T, id: string): T {
  const finish = model.tone(diffuser, diffuser.color.getHex());
  finish.name = `Residence light fixture ${id}`;
  finish.userData.residenceFixtureId = id;
  return finish as T;
}
