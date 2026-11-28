import { createCinemaConvolutionPreparer, type CinemaConvolutionPath } from './cinemaConvolution';

export interface CinemaKernelBank {
  readonly speaker: number;
  readonly lags: Uint16Array;
  readonly kernels: Float32Array;
  readonly timeKernels: Float32Array;
}

export interface CinemaKernelBankState {
  readonly type: 'bank-state';
  readonly stateId: number;
  readonly baseStateId: number | null;
  readonly pathCount: number;
  readonly gains: Float32Array;
  readonly updates: readonly { readonly index: number; readonly bank: CinemaKernelBank }[];
}

/** Owns control cache; submitted bank buffers are copies and may be transferred. */
export function createCinemaKernelBankPreparer(hrir: Float32Array) {
  const prepareKernel = createCinemaConvolutionPreparer(hrir);
  let previous: readonly CinemaConvolutionPath[] | undefined;
  let stateId = 0, resyncEpoch = 0;
  let needsFull = true;
  let pending: object | undefined;

  function prepare(paths: readonly CinemaConvolutionPath[]) {
    if (pending) throw new Error('A cinema bank submission is already pending');
    if (!Number.isSafeInteger(stateId + 1)) throw new RangeError('Cinema bank state overflow');
    if (paths.length > 105) throw new RangeError('Invalid cinema bank path count');
    prepareKernel.assertImmutable(paths);
    const full = needsFull || !previous || paths.length !== previous.length
      || paths.some((path, index) => path.speaker !== previous![index].speaker
        || path.delaySamples !== previous![index].delaySamples || path.filter !== previous![index].filter);
    const gains = new Float32Array(paths.length * 2);
    const updates: { index: number; bank: CinemaKernelBank }[] = [];
    const transfer: ArrayBuffer[] = [gains.buffer];
    paths.forEach((path, index) => {
      if (!Number.isFinite(path.gain) || !Number.isFinite(path.send)) throw new RangeError('Invalid cinema bank gain');
      gains[index * 2] = path.gain; gains[index * 2 + 1] = path.send;
      const changed = full || path.direction !== previous![index].direction;
      if (!changed) return;
      const packet = prepareKernel([path]);
      const bank = { speaker: path.speaker, lags: packet.lags, kernels: packet.kernels, timeKernels: packet.timeKernels };
      updates.push({ index, bank });
      const lags = bank.lags.buffer, kernels = bank.kernels.buffer, time = bank.timeKernels.buffer;
      if (!(lags instanceof ArrayBuffer) || !(kernels instanceof ArrayBuffer) || !(time instanceof ArrayBuffer)) {
        throw new RangeError('Cinema bank output must own transferable buffers');
      }
      transfer.push(lags, kernels, time);
    });
    const message: CinemaKernelBankState = { type: 'bank-state', stateId: stateId + 1,
      baseStateId: full ? null : stateId, pathCount: paths.length, gains, updates };
    const token = {}, epoch = resyncEpoch;
    pending = token;
    return { message, transfer,
      commit() {
        if (pending !== token) throw new Error('Stale cinema bank submission');
        // Commit only after postMessage succeeds; retain no transferred output buffer.
        previous = paths.map(path => ({ ...path }));
        stateId = message.stateId; needsFull = epoch !== resyncEpoch; pending = undefined;
      },
      cancel() { if (pending === token) { pending = undefined; needsFull = true; } },
    };
  }
  return { prepare,
    requestFull() { resyncEpoch += 1; needsFull = true; },
    clear() { previous = undefined; stateId = 0; needsFull = true; pending = undefined; prepareKernel.clear(); },
  };
}
