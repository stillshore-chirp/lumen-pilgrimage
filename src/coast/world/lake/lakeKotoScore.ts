import { renderKotoPerformance } from './kotoPerformance';
import { renderPhysicalKotoNote } from './kotoPhysicalModel';

export { LAKE_KOTO_DURATION, LAKE_KOTO_SAMPLE_RATE } from './kotoPerformance';

/** The same original score used by the offline, method-matched comparisons. */
export function renderLakeKoto(): Float32Array<ArrayBuffer> {
  return renderKotoPerformance(renderPhysicalKotoNote);
}
