const LIMIT_THRESHOLD_DB = -9;
const LIMIT_RATIO = 20;
const CEILING_KNEE = 0.85;
const CEILING_CURVE = Float32Array.from({ length: 1025 }, (_, index) => {
  const sample = index / 512 - 1;
  const magnitude = Math.abs(sample);
  if (magnitude <= CEILING_KNEE) return sample;
  const t = (magnitude - CEILING_KNEE) / (1 - CEILING_KNEE);
  return Math.sign(sample) * (CEILING_KNEE + (1 - CEILING_KNEE) * (t - t ** 3 / 3));
});

export function connectExplorationOutput(context: BaseAudioContext, master: GainNode): readonly AudioNode[] {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = LIMIT_THRESHOLD_DB;
  limiter.knee.value = 0;
  limiter.ratio.value = LIMIT_RATIO;
  limiter.attack.value = 0;
  limiter.release.value = 0.08;
  // Cancel the compressor's automatic makeup gain to preserve its gain below threshold.
  const trim = context.createGain();
  trim.gain.value = 10 ** (0.6 * LIMIT_THRESHOLD_DB * (1 - 1 / LIMIT_RATIO) / 20);
  // The compressor can pass a very short peak above full scale when loud transients overlap.
  const ceiling = context.createWaveShaper();
  ceiling.curve = CEILING_CURVE;
  master.connect(trim).connect(limiter).connect(ceiling).connect(context.destination);
  return [trim, limiter, ceiling];
}
