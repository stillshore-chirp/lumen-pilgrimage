/**
 * A reduced, bidirectionally coupled string/body model, not a bank of independently
 * triggered sines. Parameter provenance and limitations: docs/lake/koto-physical-research.md.
 * All coordinates are mass-normalized; SI units are used before output calibration.
 */
export interface PhysicalKotoNote {
  readonly frequency: number;
  readonly velocity: number;
  /** Speaking-length fraction from the player's fixed bridge; movable bridge is at 1. */
  readonly pluckPosition?: number;
  readonly pressSemitones?: number;
  readonly dampAt?: number;
  readonly duration?: number;
  readonly seed?: number;
  /** Optional measurement sink; it does not change the rendered waveform. */
  readonly diagnostics?: PhysicalKotoDiagnostics;
}

export interface PhysicalKotoDiagnostics {
  initialEnergyJ: number;
  maximumEnergyJ: number;
  finalEnergyJ: number;
  maximumRelativeEnergyRise: number;
  stringModesPerPlane: number;
}

export interface PhysicalKotoString {
  readonly lengthM: number;
  readonly linearDensityKgPerM: number;
  readonly tensionN: number;
  readonly bendingStiffnessNm2: number;
  readonly inharmonicity: number;
  readonly fundamentalDecaySeconds: number;
}

const PI = Math.PI;
const DENSITY = 1380;
const DIAMETER = 0.001;
const AREA = PI * DIAMETER ** 2 / 4;
const YOUNG_MODULUS = 11e9;
const BENDING_STIFFNESS = YOUNG_MODULUS * PI * DIAMETER ** 4 / 64 * 0.23;
const LINEAR_DENSITY = DENSITY * AREA;
const WAVE_SPEED = 2 * 0.472 * 392;
const STRING_PATH_LENGTH = 1.50;
const OUTPUT_GAIN = 5;
const PRESS_START = 0.10;
const PRESS_END = 0.36;
const COEFFICIENT_BLOCK = 16;

/** Match both poles of an isolated damped mode through inverse bilinear mapping. */
function matchedPole(frequency: number, sigma: number, sampleRate: number): readonly [number, number] {
  const decay = Math.exp(-sigma / sampleRate);
  const angle = Math.sqrt((2 * PI * frequency) ** 2 - sigma ** 2) / sampleRate;
  const oscillatoryPart = 4 * decay * Math.sin(angle / 2) ** 2;
  const denominator = (1 + decay) ** 2 - oscillatoryPart;
  // These sum-of-squares forms avoid subtracting nearly equal cosines at low f.
  return [
    4 * sampleRate ** 2 * ((1 - decay) ** 2 + oscillatoryPart) / denominator,
    4 * sampleRate * -Math.expm1(-2 * sigma / sampleRate) / denominator,
  ];
}

// Only the first five frequencies are anchored to the koto study. Remaining
// frequencies, masses, Q and radiation weights are explicit design assumptions.
const BODY_MODES = [
  [85, 8, 0.85], [100, 12, 0.45], [157, 12, 0.90],
  [184, 16, 0.55], [202, 19, 0.65], [291, 19, 0.50],
  [377, 23, 0.42], [499, 26, 0.38], [637, 29, 0.31],
  [823, 33, 0.28], [1087, 36, 0.24], [1423, 40, 0.21],
  [1879, 43, 0.18], [2477, 46, 0.16], [3251, 49, 0.14],
  [4273, 51, 0.12], [5623, 53, 0.11], [7411, 55, 0.10],
  [9767, 57, 0.09], [12889, 59, 0.08],
] as const;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function decayRate(frequency: number): number {
  return 0.70 + 0.00028 * frequency + 2.2e-7 * frequency ** 2;
}

export function describePhysicalKotoString(frequency: number): PhysicalKotoString {
  if (!Number.isFinite(frequency) || frequency < 80 || frequency > 2000) {
    throw new RangeError('Koto frequency must be between 80 and 2000 Hz.');
  }
  const lengthM = WAVE_SPEED / (2 * frequency);
  const tensionN = 4 * LINEAR_DENSITY * lengthM ** 2 * frequency ** 2
    - PI ** 2 * BENDING_STIFFNESS / lengthM ** 2;
  return {
    lengthM, linearDensityKgPerM: LINEAR_DENSITY, tensionN,
    bendingStiffnessNm2: BENDING_STIFFNESS,
    inharmonicity: PI ** 2 * BENDING_STIFFNESS / (tensionN * lengthM ** 2),
    fundamentalDecaySeconds: Math.log(1000) / decayRate(frequency),
  };
}

interface Plane {
  readonly q: Float64Array;
  readonly v: Float64Array;
  readonly a: Float64Array;
  readonly g: Float64Array;
  readonly stiffness: Float64Array;
  readonly damping: Float64Array;
  readonly inverseDiagonal: Float64Array;
  readonly work: Float64Array;
  readonly radiation: Float64Array;
  readonly stringModes: number;
  readonly constraintMass: number;
  readonly lossScale: number;
  readonly string: PhysicalKotoString;
  spring: number;
  inverse00: number;
  inverse01: number;
  inverse11: number;
}

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function stringModeFrequency(string: PhysicalKotoString, mode: number, tension: number): number {
  const waveNumber = PI * mode / string.lengthM;
  return Math.sqrt((tension * waveNumber ** 2
    + string.bendingStiffnessNm2 * waveNumber ** 4) / string.linearDensityKgPerM) / (2 * PI);
}

function createPlane(
  string: PhysicalKotoString, sampleRate: number, position: number,
  displacement: number, touchSeconds: number, horizontal: boolean, maximumPress: number, random: () => number,
): Plane {
  const cutoff = Math.min(18000, sampleRate * 0.38);
  const stringCutoff = cutoff / 2 ** (maximumPress / 12);
  let stringModes = 1;
  while (stringModes < 96
    && stringModeFrequency(string, stringModes + 1, string.tensionN) < stringCutoff) stringModes += 1;
  const body = BODY_MODES.filter(([frequency]) => frequency < cutoff);
  const count = stringModes + body.length;
  const array = () => new Float64Array(count);
  const q = array();
  const v = array();
  const a = array();
  const g = array();
  const stiffness = array();
  const damping = array();
  const radiation = array();
  const modalMass = string.linearDensityKgPerM * string.lengthM / 2;
  const sqrtMass = Math.sqrt(modalMass);
  const bridgeCoordinate = clamp((STRING_PATH_LENGTH - string.lengthM) / STRING_PATH_LENGTH, 0.12, 0.88);

  for (let i = 0; i < stringModes; i += 1) {
    const mode = i + 1;
    const frequency = stringModeFrequency(string, mode, string.tensionN);
    const finiteContact = Math.exp(-0.5 * (2 * PI * frequency * touchSeconds) ** 2);
    // Fourier coefficient of a triangular displacement; finite contact rounds its corner.
    const coefficient = 2 * displacement * Math.sin(PI * mode * position)
      / (PI ** 2 * mode ** 2 * position * (1 - position));
    q[i] = sqrtMass * coefficient * finiteContact * (1 + (random() - 0.5) * 0.035);
    a[i] = Math.sqrt(2 * string.linearDensityKgPerM * string.lengthM)
      * (mode % 2 ? 1 : -1) / (PI * mode);
  }

  for (let j = 0; j < body.length; j += 1) {
    const i = stringModes + j;
    const [frequency, quality, mass] = body[j];
    const shape = Math.cos((j + 1) * PI * bridgeCoordinate + (horizontal ? 0.7 : 0));
    const bridgeShape = Math.sign(shape || 1) * (0.22 + 0.78 * Math.abs(shape));
    // Separate transverse axes approximate an anisotropic bridge; their effective
    // masses differ. Torsion and off-diagonal polarization coupling are not solved.
    g[i] = bridgeShape / Math.sqrt(mass * (horizontal ? 3.2 : 1));
    const pole = matchedPole(frequency, PI * frequency / quality, sampleRate);
    stiffness[i] = pole[0];
    damping[i] = pole[1];
    radiation[i] = (j % 3 === 1 ? -1 : 1) / Math.sqrt(mass)
      * (frequency / 300) ** 0.35 / (1 + (frequency / 6500) ** 1.7);
  }

  return {
    q, v, a, g, stiffness, damping, radiation,
    inverseDiagonal: array(), work: array(), stringModes,
    constraintMass: string.linearDensityKgPerM * string.lengthM / 3,
    lossScale: horizontal ? 0.72 : 1,
    string,
    spring: 0, inverse00: 0, inverse01: 0, inverse11: 0,
  };
}

function updatePlane(plane: Plane, tension: number, damp: number, sampleRate: number): void {
  const h = 1 / sampleRate;
  for (let i = 0; i < plane.stringModes; i += 1) {
    const frequency = stringModeFrequency(plane.string, i + 1, tension);
    // Matching only frequency leaves the high-mode decay too slow. Match the
    // conjugate poles, retaining a positive stiffness and nonnegative damping.
    const pole = matchedPole(frequency, decayRate(frequency) * plane.lossScale + damp, sampleRate);
    plane.stiffness[i] = pole[0];
    plane.damping[i] = pole[1];
  }
  plane.spring = tension / plane.string.lengthM;
  let alpha = 0;
  let beta = 0;
  for (let i = 0; i < plane.q.length; i += 1) {
    const inverse = 1 / (1 + h * plane.damping[i] / 2 + h ** 2 * plane.stiffness[i] / 4);
    plane.inverseDiagonal[i] = inverse;
    alpha += plane.a[i] ** 2 * inverse;
    beta += plane.g[i] ** 2 * inverse;
  }
  // Woodbury inverse of D + a gᵀ + g aᵀ + (c + h²k/4) g gᵀ.
  const topLeft = alpha - plane.constraintMass - h ** 2 * plane.spring / 4;
  const determinant = topLeft * beta - 1;
  plane.inverse00 = beta / determinant;
  plane.inverse01 = -1 / determinant;
  plane.inverse11 = topLeft / determinant;
}

function advancePlane(plane: Plane, sampleRate: number): number {
  const h = 1 / sampleRate;
  const { q, v, a, g, work, inverseDiagonal, stiffness } = plane;
  let av = 0;
  let gv = 0;
  let gq = 0;
  for (let i = 0; i < q.length; i += 1) {
    av += a[i] * v[i];
    gv += g[i] * v[i];
    gq += g[i] * q[i];
  }
  let aw = 0;
  let gw = 0;
  const bridgeTerm = av + plane.constraintMass * gv - h * plane.spring * gq / 2;
  for (let i = 0; i < q.length; i += 1) {
    const rhs = v[i] + a[i] * gv + g[i] * bridgeTerm - h * stiffness[i] * q[i] / 2;
    work[i] = inverseDiagonal[i] * rhs;
    aw += a[i] * work[i];
    gw += g[i] * work[i];
  }
  const first = plane.inverse00 * aw + plane.inverse01 * gw;
  const second = plane.inverse01 * aw + plane.inverse11 * gw;
  let radiation = 0;
  for (let i = 0; i < q.length; i += 1) {
    const midpointVelocity = work[i] - inverseDiagonal[i] * (a[i] * first + g[i] * second);
    q[i] += h * midpointVelocity;
    // Output v(t_i), then advance to t_(i+1). A midpoint output stamped t_i
    // otherwise introduces a sample-rate-dependent half-step lead.
    radiation += plane.radiation[i] * v[i];
    v[i] = 2 * midpointVelocity - v[i];
  }
  return radiation;
}

function energy(plane: Plane): number {
  let total = 0;
  let av = 0;
  let gv = 0;
  let gq = 0;
  for (let i = 0; i < plane.q.length; i += 1) {
    total += plane.v[i] ** 2 + plane.stiffness[i] * plane.q[i] ** 2;
    av += plane.a[i] * plane.v[i];
    gv += plane.g[i] * plane.v[i];
    gq += plane.g[i] * plane.q[i];
  }
  return (total + 2 * av * gv + plane.constraintMass * gv ** 2 + plane.spring * gq ** 2) / 2;
}

function pressFraction(time: number): number {
  const x = clamp((time - PRESS_START) / (PRESS_END - PRESS_START), 0, 1);
  return x * x * x * (10 + x * (-15 + 6 * x));
}

export function renderPhysicalKotoNote(note: PhysicalKotoNote, sampleRate = 48000): Float32Array<ArrayBuffer> {
  const duration = note.duration ?? 6;
  const press = note.pressSemitones ?? 0;
  const dampAt = note.dampAt ?? Infinity;
  if (!Number.isInteger(sampleRate) || sampleRate < 24000 || sampleRate > 192000
    || !Number.isFinite(duration) || duration < 0.05 || duration > 30
    || !Number.isFinite(note.velocity) || note.velocity < 0 || note.velocity > 1
    || !Number.isFinite(press) || press < 0 || press > 3
    || (note.dampAt !== undefined && (!Number.isFinite(dampAt) || dampAt < 0))
    || (note.pluckPosition !== undefined && (!Number.isFinite(note.pluckPosition)
      || note.pluckPosition < 0.03 || note.pluckPosition > 0.45))
    || (note.seed !== undefined && !Number.isFinite(note.seed))) {
    throw new RangeError('Invalid physical koto note parameters.');
  }
  const string = describePhysicalKotoString(note.frequency);
  const samples = new Float32Array(Math.round(duration * sampleRate));
  if (note.velocity === 0) {
    if (note.diagnostics) Object.assign(note.diagnostics, {
      initialEnergyJ: 0, maximumEnergyJ: 0, finalEnergyJ: 0,
      maximumRelativeEnergyRise: 0, stringModesPerPlane: 0,
    });
    return samples;
  }
  const random = randomGenerator(note.seed ?? 0x4b4f544f);
  const position = clamp((note.pluckPosition ?? (0.105 + 0.034 * (1 - note.velocity)))
    + (random() - 0.5) * 0.006, 0.03, 0.45);
  const angle = PI * (0.21 + (random() - 0.5) * 0.035);
  const displacement = 0.0028 * note.velocity ** 1.08;
  const touchSeconds = 0.000022 + 0.000080 * (1 - note.velocity) ** 1.4;
  const planes = [
    createPlane(string, sampleRate, position, displacement * Math.cos(angle), touchSeconds, false, press, random),
    createPlane(string, sampleRate, position, displacement * Math.sin(angle), touchSeconds * 1.14, true, press, random),
  ];
  for (const plane of planes) updatePlane(plane, string.tensionN, 0, sampleRate);
  const initialEnergy = planes.reduce((sum, plane) => sum + energy(plane), 0);
  let maximumEnergy = initialEnergy;
  let previousEnergy = initialEnergy;
  let maximumRelativeEnergyRise = 0;
  let highpass = 0;
  let previousInput = 0;
  let filterState1 = 0;
  let filterState2 = 0;
  const highpassPole = Math.exp(-2 * PI * 35 / sampleRate);
  const filterAngle = 2 * PI * Math.min(13500, sampleRate * 0.40) / sampleRate;
  const filterCosine = Math.cos(filterAngle);
  const filterAlpha = Math.sin(filterAngle) / Math.SQRT2;
  const b0 = (1 - filterCosine) / (2 * (1 + filterAlpha));
  const a1 = -2 * filterCosine / (1 + filterAlpha);
  const a2 = (1 - filterAlpha) / (1 + filterAlpha);
  const fadeSamples = Math.min(Math.round(sampleRate * 0.08), Math.floor(samples.length / 4));

  for (let i = 0; i < samples.length; i += 1) {
    const time = i / sampleRate;
    if (i % COEFFICIENT_BLOCK === 0) {
      const ratioSquared = 2 ** (press * pressFraction(time) / 6);
      // Keep the fundamental target exact despite bending stiffness. Stretch from
      // the pluck is deliberately omitted until calibrated koto transient data exists.
      const bendingTension = PI ** 2 * string.bendingStiffnessNm2 / string.lengthM ** 2;
      const tension = (string.tensionN + bendingTension) * ratioSquared - bendingTension;
      const damp = time >= dampAt ? Math.log(1000) / 0.10
        * Math.min(1, (time - dampAt) / 0.012) : 0;
      for (const plane of planes) updatePlane(plane, tension, damp, sampleRate);
    }
    const input = advancePlane(planes[0], sampleRate) + advancePlane(planes[1], sampleRate);
    highpass = highpassPole * (highpass + input - previousInput);
    previousInput = input;
    const lowpass = b0 * highpass + filterState1;
    filterState1 = 2 * b0 * highpass - a1 * lowpass + filterState2;
    filterState2 = b0 * highpass - a2 * lowpass;
    const start = Math.min(1, i / Math.max(1, Math.round(sampleRate * 0.00035)));
    const end = i >= samples.length - fadeSamples
      ? Math.sin((samples.length - 1 - i) / Math.max(1, fadeSamples) * PI / 2) ** 2 : 1;
    samples[i] = lowpass * OUTPUT_GAIN * start * end;
    if (note.diagnostics && (i % COEFFICIENT_BLOCK === COEFFICIENT_BLOCK - 1 || i === samples.length - 1)) {
      const currentEnergy = planes.reduce((sum, plane) => sum + energy(plane), 0);
      maximumEnergy = Math.max(maximumEnergy, currentEnergy);
      maximumRelativeEnergyRise = Math.max(maximumRelativeEnergyRise,
        (currentEnergy - previousEnergy) / Math.max(initialEnergy, Number.MIN_VALUE));
      previousEnergy = currentEnergy;
    }
  }
  if (note.diagnostics) Object.assign(note.diagnostics, {
    initialEnergyJ: initialEnergy,
    maximumEnergyJ: maximumEnergy,
    finalEnergyJ: planes.reduce((sum, plane) => sum + energy(plane), 0),
    maximumRelativeEnergyRise,
    stringModesPerPlane: planes[0].stringModes,
  });
  return samples;
}
