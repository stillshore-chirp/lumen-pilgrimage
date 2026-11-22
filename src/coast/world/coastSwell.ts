export const COAST_SWELL_PERIOD = 6.8;

const swellLead = 0.30;
const swellDrift = [
  { amplitude: 0.14, x: 0.045, z: -0.031 },
  { amplitude: 0.045, x: 0.137, z: 0.081 },
] as const;

/** The landward breaker arrives near phase 0.46, then leaves a quieter backwash. */
export function coastSwellPhase(elapsed: number, x: number, z: number): number {
  let cycles = elapsed / COAST_SWELL_PERIOD + swellLead;
  for (const drift of swellDrift) {
    cycles += drift.amplitude * Math.sin(x * drift.x + z * drift.z);
  }
  return cycles - Math.floor(cycles);
}

export const coastSwellGLSL = /* glsl */`
  float swellCycles(float elapsed, vec2 p) {
    return elapsed / ${COAST_SWELL_PERIOD} + ${swellLead}
      ${swellDrift.map(drift =>
        `+ ${drift.amplitude} * sin(dot(p, vec2(${drift.x}, ${drift.z})))`).join('\n      ')};
  }
`;
