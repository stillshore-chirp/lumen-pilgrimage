import type { CinemaRenderSpeaker } from './cinemaSpeakers';

type Station = { readonly index: number; readonly x: number; readonly y: number; readonly z: number };
type BankPair = readonly [readonly Station[], readonly Station[]];
type RoutingTarget = Float32Array | Float64Array;

const HALF_PI = Math.PI / 2;
const POSITION_TOLERANCE = 1e-9;

function sine(fraction: number): number {
  return fraction <= 0 ? 0 : fraction >= 1 ? 1 : Math.sin(fraction * HALF_PI);
}

function cosine(fraction: number): number {
  return fraction <= 0 ? 1 : fraction >= 1 ? 0 : Math.cos(fraction * HALF_PI);
}

function smoothStep(lower: number, upper: number, coordinate: number): number {
  const fraction = Math.max(0, Math.min(1, (coordinate - lower) / (upper - lower)));
  return fraction * fraction * (3 - 2 * fraction);
}

function validateBanks(pair: BankPair): void {
  const [left, right] = pair;
  if (left.length < 2 || left.length !== right.length || !(right[0].x > left[0].x)) {
    throw new Error('Cinema routing requires two aligned banks with equal station counts');
  }
  for (const bank of pair) {
    const first = bank[0];
    const last = bank[bank.length - 1];
    if (!(last.z > first.z)) throw new Error('Cinema bank depth must increase');
    for (let station = 0; station < bank.length; station += 1) {
      const current = bank[station];
      const fraction = (current.z - first.z) / (last.z - first.z);
      if (Math.abs(current.x - first.x) > POSITION_TOLERANCE
        || Math.abs(current.y - (first.y + fraction * (last.y - first.y))) > POSITION_TOLERANCE
        || (station > 0 && !(current.z > bank[station - 1].z))) {
        throw new Error('Cinema bank stations must be straight with positive depth intervals');
      }
      if (Math.abs(left[station].y - right[station].y) > POSITION_TOLERANCE
        || Math.abs(left[station].z - right[station].z) > POSITION_TOLERANCE) {
        throw new Error('Cinema left and right bank stations must share Y/Z coordinates');
      }
    }
  }
}

function validateRow(row: readonly Station[]): void {
  if (row.length < 2) throw new Error('Cinema routing requires at least two row stations');
  for (let station = 1; station < row.length; station += 1) {
    if (!(row[station].x > row[station - 1].x)
      || Math.abs(row[station].y - row[0].y) > POSITION_TOLERANCE
      || Math.abs(row[station].z - row[0].z) > POSITION_TOLERANCE) {
      throw new Error('Cinema row stations must share Y/Z and have positive X intervals');
    }
  }
}

/**
 * Prepare the fixed auditorium banks once. A write produces a calibrated unit
 * spatial shape; programme dB and listener propagation belong to later stages.
 */
export function createCinemaObjectRouter(speakers: readonly CinemaRenderSpeaker[]) {
  const stations = (kind: CinemaRenderSpeaker['kind']) => speakers
    .flatMap((speaker, index) => speaker.kind === kind ? [{
      index, x: speaker.position[0], y: speaker.position[1], z: speaker.position[2],
    }] : []);
  const screen = stations('screen').sort((a, b) => a.x - b.x);
  const rear = stations('rear').sort((a, b) => a.x - b.x);
  const banks = (kind: 'side' | 'top'): BankPair => {
    const group = stations(kind);
    if (group.some(station => station.x === 0)) throw new Error('Cinema banks must be left or right');
    return [
      group.filter(station => station.x < 0).sort((a, b) => a.z - b.z),
      group.filter(station => station.x > 0).sort((a, b) => a.z - b.z),
    ];
  };
  for (const speaker of speakers) {
    if (!speaker.position.every(Number.isFinite) || !Number.isFinite(speaker.gain) || speaker.gain < 0) {
      throw new Error('Cinema routing needs finite positions and nonnegative calibration gains');
    }
  }
  const side = banks('side');
  const top = banks('top');
  validateRow(screen);
  validateRow(rear);
  validateBanks(side);
  validateBanks(top);

  function addPair(
    row: readonly Station[], coordinate: number, axis: 'x' | 'z',
    output: RoutingTarget, stride: number, column: number, gain: number,
  ): void {
    if (gain === 0) return;
    let upper = 0;
    while (upper < row.length && row[upper][axis] < coordinate) upper += 1;
    if (upper === 0 || upper === row.length) {
      const station = row[upper === 0 ? 0 : row.length - 1];
      output[station.index * stride + column] += gain;
      return;
    }
    const lower = row[upper - 1];
    const higher = row[upper];
    const fraction = (coordinate - lower[axis]) / (higher[axis] - lower[axis]);
    output[lower.index * stride + column] += gain * cosine(fraction);
    output[higher.index * stride + column] += gain * sine(fraction);
  }

  function addBank(
    pair: BankPair, x: number, y: number, z: number,
    output: RoutingTarget, stride: number, column: number, gain: number,
  ): void {
    if (gain === 0) return;
    const first = pair[0][0];
    const last = pair[0][pair[0].length - 1];
    const dy = last.y - first.y;
    const dz = last.z - first.z;
    // Projection onto the actual straight Y/Z bank, not an assumed horizontal row.
    const stationZ = first.z + ((y - first.y) * dy + (z - first.z) * dz) / (dy * dy + dz * dz) * dz;
    const across = (x - first.x) / (pair[1][0].x - first.x);
    addPair(pair[0], stationZ, 'z', output, stride, column, gain * cosine(across));
    addPair(pair[1], stationZ, 'z', output, stride, column, gain * sine(across));
  }

  return {
    /** Clear/write one output column without per-call arrays, sorting or vectors. */
    write(x: number, y: number, z: number, output: RoutingTarget, stride = 1, column = 0): boolean {
      if (!Number.isSafeInteger(stride) || stride < 1 || !Number.isSafeInteger(column)
        || column < 0 || column >= stride || output.length < (speakers.length - 1) * stride + column + 1) {
        throw new RangeError('Cinema object routing target does not contain the requested column');
      }
      for (let index = 0; index < speakers.length; index += 1) output[index * stride + column] = 0;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
      // The two-metre bands are a rendering assumption around the former hard
      // category boundaries. Outside them the original screen/side/rear/top roles remain.
      const elevation = smoothStep(13, 15, y);
      const front = smoothStep(4, 6, z);
      const back = smoothStep(46, 48, z);
      const below = cosine(elevation);
      addPair(screen, x, 'x', output, stride, column, below * cosine(front));
      addBank(side, x, y, z, output, stride, column, below * sine(front) * cosine(back));
      addPair(rear, x, 'x', output, stride, column, below * sine(front) * sine(back));
      addBank(top, x, y, z, output, stride, column, sine(elevation));

      let energy = 0;
      for (let index = 0; index < speakers.length; index += 1) {
        const offset = index * stride + column;
        const value = output[offset] * speakers[index].gain;
        output[offset] = value;
        energy += value * value;
      }
      const length = Math.sqrt(energy);
      const active = length > 0 && Number.isFinite(length);
      for (let index = 0; index < speakers.length; index += 1) {
        const offset = index * stride + column;
        output[offset] = active ? output[offset] / length : 0;
      }
      return active;
    },
  };
}
