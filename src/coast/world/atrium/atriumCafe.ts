import { PointLight } from 'three';
import type { TenantBuildContext } from './atriumTenantArchitecture';
import type { TenantLocalLight } from './atriumTenantLighting';
import { ATRIUM_CAFE_PLAN } from './atriumCafePlan';
import { buildCafeInterior } from './atriumCafeInterior';

/** Approved cafe enclosure, support, furnishings and shared positional speakers. */
export function buildAtriumCafe(context: TenantBuildContext): void {
  const { box, palette } = context;
  const { width, depth, beamBottom, beamTop, frameStations } = ATRIUM_CAFE_PLAN;
  const { sidePosts, postWidth, coreWidth } = ATRIUM_CAFE_PLAN;
  const firstFrame = frameStations[0], lastFrame = frameStations[frameStations.length - 1];
  // The steel core portals support a closed roof above the suspended ceiling.
  // Visible timber lining is a separate, lower finish frame, not the roof beam.
  for (const d of ATRIUM_CAFE_PLAN.frameStations) {
    for (const u of sidePosts) {
      box(palette.dark, u, ATRIUM_CAFE_PLAN.primaryBeamTop / 2, d,
        coreWidth, ATRIUM_CAFE_PLAN.primaryBeamTop, coreWidth, 'Cafe ground-supported steel portal core');
      box(palette.darkWood, u, (beamBottom + .06) / 2, d, postWidth, beamBottom + .06, postWidth, 'Cafe floor-to-head side post');
    }
    box(palette.dark, width / 2, (ATRIUM_CAFE_PLAN.primaryBeamTop + ATRIUM_CAFE_PLAN.primaryBeamBottom) / 2,
      d, width - .36, ATRIUM_CAFE_PLAN.primaryBeamTop - ATRIUM_CAFE_PLAN.primaryBeamBottom,
      .24, 'Cafe concealed primary steel roof beam');
    for (const u of [1.6, 5.05, 8.5]) {
      box(palette.bronze, u, 3.57, d, .02, .06, .02, 'Cafe ceiling hanger to primary beam');
    }
    box(palette.darkWood, width / 2, (beamBottom + beamTop) / 2,
      d, width - .36, beamTop - beamBottom,
      ATRIUM_CAFE_PLAN.beamDepth, 'Cafe supported transverse ceiling beam');
  }
  for (const u of sidePosts) {
    box(palette.darkWood, u, (beamBottom + beamTop) / 2, (firstFrame + lastFrame) / 2,
      postWidth, beamTop - beamBottom, lastFrame - firstFrame + postWidth, 'Cafe continuous side head');
  }
  box(palette.plaster, width / 2, ATRIUM_CAFE_PLAN.roofTop - ATRIUM_CAFE_PLAN.roofDepth / 2,
    depth / 2, width, ATRIUM_CAFE_PLAN.roofDepth, depth, 'Cafe closed roof above suspended ceiling');
  for (const u of [.09, width - .09]) {
    box(palette.plaster, u, (ATRIUM_CAFE_PLAN.ceiling + ATRIUM_CAFE_PLAN.roofTop) / 2,
      depth / 2, .18, ATRIUM_CAFE_PLAN.roofTop - ATRIUM_CAFE_PLAN.ceiling, depth, 'Cafe closed roof side fascia');
  }
  // The front closure is behind the existing dark fascia, whose silhouette is
  // visible in the reference. Do not cover it with a new plaster face at d=0.
  for (const d of [.35, ATRIUM_CAFE_PLAN.depth - .09]) {
    box(palette.plaster, width / 2, (ATRIUM_CAFE_PLAN.ceiling + ATRIUM_CAFE_PLAN.roofTop) / 2,
      d, width - .36, ATRIUM_CAFE_PLAN.roofTop - ATRIUM_CAFE_PLAN.ceiling, .18, 'Cafe closed roof end fascia');
  }
  buildCafeInterior(context);
}

export function addAtriumCafeLighting(context: TenantBuildContext): readonly TenantLocalLight[] {
  return ATRIUM_CAFE_PLAN.ceilingLights.map(({ u, d, y, intensity }, index) => {
    const light = new PointLight(0xffe1b9, intensity, 7.0, 2);
    light.name = `Cafe grouped ceiling light ${index + 1}`;
    light.position.copy(context.point(u, y, d));
    const diffuser = context.glow(`Cafe enclosed opal diffuser ${index + 1}`, 0xffe1b9, .72);
    context.box(context.palette.bronze, u, 3.385, d, 1.15, .13, .24, `Cafe ceiling-fixed luminaire housing ${index + 1}`);
    context.box(diffuser, u, 3.31, d, 1.0, .02, .08, `Cafe recessed optical aperture ${index + 1}`);
    return { id: `cafe-fill-${index + 1}`, light, onIntensity: intensity };
  });
}
