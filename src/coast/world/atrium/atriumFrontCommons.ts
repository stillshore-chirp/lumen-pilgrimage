import type { Group, Texture, WebGLRenderer } from 'three';
import type { CoastQuality } from '../../CoastWorld';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { buildAtriumFrontGarden } from './atriumFrontGarden';
import { buildAtriumFrontInteriors } from './atriumFrontInteriors';
import { buildAtriumFrontShell } from './atriumFrontShell';

export async function buildAtriumFrontCommons(root: Group, wallStone: Texture | null): Promise<{
  setLighting(on: boolean, time: CoastTimeOfDay): void;
  setQuality(quality: CoastQuality): void;
  prepareRender(renderer: WebGLRenderer): void;
}> {
  buildAtriumFrontShell(root, wallStone);
  buildAtriumFrontGarden(root, wallStone);
  const interiors = await buildAtriumFrontInteriors(root, wallStone);
  return {
    setLighting: (on, time) => interiors.setLighting(on, time),
    setQuality: quality => interiors.setQuality(quality),
    prepareRender: renderer => interiors.prepareRender(renderer),
  };
}
