type Block = readonly [x: number, y: number, z: number, width: number, height: number, depth: number];

// All heights in this plan are relative to the main deck, in metres.
export const PAVILION_CENTER_Z = 19.1;
export const PAVILION_WING_Z = 21.45;
export const PAVILION_BODY: Block = [0, 4.96, 20.34, 20.6, 9.92, 20.70];
export const PAVILION_THRESHOLD: Block = [0, 0.08, 9.30, 10.90, 0.16, 1.47];
export const PAVILION_ROOF_COURSES: readonly Block[] = [
  [0, 9.85, 20.33, 21.01, 0.26, 21.08],
  [0, 10.02, 20.33, 21.34, 0.13, 21.31],
  [0, 10.25, 20.33, 19.74, 0.44, 20.08],
  [0, 10.51, 20.33, 19.97, 0.14, 20.29],
];
export const PAVILION_DRUM = [
  [10.63, 8.75, 0.28], [10.92, 8.68, 0.37], [11.48, 8.22, 0.78],
  [11.96, 8.46, 0.17], [12.14, 8.14, 0.25], [12.31, 7.91, 0.14],
] as const;
export const PAVILION_DOME = {
  spring: 12.36, radius: 7.53, height: 5.65, profilePoints: 20,
  seamOffset: 0.024, seamRadius: 0.035, raisedPanelOffset: 0.045, raisedPanelRise: 0.046,
} as const;

export function pavilionWing(side: number): Block {
  return [16.8 * side, 3.45, PAVILION_WING_Z, 14.25, 6.9, 18.1];
}

export function pavilionEntrancePier(side: number): Block {
  return [5.7 * side, 3.97, 9.59, 2.93, 7.94, 1.64];
}

export function pavilionRoof(side: number): readonly Block[] {
  const x = 16.8 * side;
  if (side > 0) return [
    [x, 7.59, 26.95, 13.82, 0.80, 6.65],
    [x, 8.04, 26.95, 14.08, 0.14, 6.88],
    [x, 8.13, 26.95, 14.05, 0.06, 6.86],
  ];
  return [
    [x, 7.41, PAVILION_WING_Z + 0.26, 13.79, 0.43, 17.45],
    [x, 7.69, PAVILION_WING_Z + 0.26, 13.95, 0.13, 17.54],
    [-21.7, 8.3, PAVILION_WING_Z + 0.08, 3.45, 1.49, 16.83],
    [-21.7, 9.065, PAVILION_WING_Z + 0.08, 3.65, 0.17, 16.97],
    [-21.7, 9.28, PAVILION_WING_Z + 0.08, 2.96, 0.30, 16.32],
    [-21.7, 9.44, PAVILION_WING_Z + 0.08, 3.06, 0.054, 16.44],
  ];
}

export function pavilionDomeProfile(): readonly { radius: number; height: number }[] {
  return Array.from({ length: PAVILION_DOME.profilePoints }, (_, i) => {
    const angle = i / (PAVILION_DOME.profilePoints - 1) * Math.PI * 0.5;
    return { radius: Math.max(0.015, PAVILION_DOME.radius * Math.cos(angle)), height: PAVILION_DOME.height * Math.sin(angle) };
  });
}

export function pavilionWingCornice(side: number): Block {
  return [16.8 * side, 7.13, PAVILION_WING_Z - 0.035, 14.91, 0.13, 18.53];
}
const flightBlocks: readonly Block[] = [PAVILION_BODY, ...PAVILION_ROOF_COURSES,
  pavilionWing(-1), pavilionWing(1), pavilionEntrancePier(-1), pavilionEntrancePier(1),
  ...pavilionRoof(-1), ...pavilionRoof(1), pavilionWingCornice(-1), pavilionWingCornice(1)];
const domeProfile = pavilionDomeProfile();

export function blocksPavilionFlight(x: number, z: number, relativeEyeY: number, clearance: number): boolean {
  if (flightBlocks.some(([cx, cy, cz, width, height, depth]) =>
    Math.abs(x - cx) <= width / 2 + clearance && Math.abs(relativeEyeY - cy) <= height / 2 + clearance
    && Math.abs(z - cz) <= depth / 2 + clearance)) return true;

  const dz = z - PAVILION_CENTER_Z;
  for (const [cy, radius, height] of PAVILION_DRUM) {
    if (Math.abs(relativeEyeY - cy) > height / 2 + clearance) continue;
    const apothem = radius * Math.cos(Math.PI / 8) + clearance;
    let inside = true;
    for (let face = 0; face < 8; face++) {
      const angle = Math.PI / 4 + face * Math.PI / 4;
      if (x * Math.sin(angle) + dz * Math.cos(angle) > apothem) inside = false;
    }
    if (inside) return true;
  }

  const y = relativeEyeY - PAVILION_DOME.spring;
  const shell = Math.max(PAVILION_DOME.seamOffset + PAVILION_DOME.seamRadius,
    Math.hypot(PAVILION_DOME.raisedPanelOffset, PAVILION_DOME.raisedPanelRise));
  const radiusWithShell = clearance + shell;
  if (y >= -radiusWithShell && y <= PAVILION_DOME.height + radiusWithShell) {
    let radius = domeProfile.at(-1)!.radius;
    for (let i = 1; i < domeProfile.length; i++) {
      const a = domeProfile[i - 1], b = domeProfile[i];
      if (y > b.height) continue;
      const t = Math.max(0, Math.min(1, (y - a.height) / (b.height - a.height)));
      radius = a.radius + (b.radius - a.radius) * t;
      break;
    }
    const r = Math.hypot(x, dz);
    if (y >= 0 && y <= PAVILION_DOME.height && r <= radius) return true;
    // In the axial section, Euclidean distance to the profile also protects the
    // top and sloping normals; adding radius only horizontally misses the crown.
    for (let i = 1; i < domeProfile.length; i++) {
      const a = domeProfile[i - 1], b = domeProfile[i];
      const dr = b.radius - a.radius, dy = b.height - a.height;
      const t = Math.max(0, Math.min(1, ((r - a.radius) * dr + (y - a.height) * dy) / (dr * dr + dy * dy)));
      if (Math.hypot(r - a.radius - t * dr, y - a.height - t * dy) <= radiusWithShell) return true;
    }
  }
  return Math.hypot(x, relativeEyeY - 18.24, dz) <= 0.16 + clearance;
}
