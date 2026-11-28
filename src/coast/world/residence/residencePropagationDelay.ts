// Two running delay taps retain input history. Only the silent tap changes time;
// their linear crossfade avoids changing playback rate during a route update.
export function createResidencePropagationDelay(context: BaseAudioContext, destination: AudioNode) {
  const input = context.createGain();
  const taps = Array.from({ length: 2 }, (_, index) => {
    const delay = context.createDelay(1);
    const level = context.createGain();
    level.gain.value = Number(index === 0);
    input.connect(delay).connect(level).connect(destination);
    return { delay, level };
  });
  let previous = -1;
  let active = 0;
  let availableAt = 0;
  let disposed = false;
  return {
    input,
    update(seconds: number, now: number): void {
      if (disposed) return;
      const delay = Number.isFinite(seconds) ? Math.max(0, Math.min(.99, seconds)) : 0;
      if (previous < 0) {
        for (const tap of taps) tap.delay.delayTime.setValueAtTime(delay, now);
        previous = delay;
      } else if (now >= availableAt && Math.abs(delay - previous) > 1e-6) {
        const next = 1 - active;
        taps[next].delay.delayTime.setValueAtTime(delay, now);
        for (const [index, tap] of taps.entries()) {
          tap.level.gain.cancelScheduledValues(now);
          tap.level.gain.setValueAtTime(Number(index === active), now);
          tap.level.gain.linearRampToValueAtTime(Number(index === next), now + .04);
        }
        active = next;
        previous = delay;
        availableAt = now + .04;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      input.disconnect();
      for (const tap of taps) { tap.delay.disconnect(); tap.level.disconnect(); }
    },
  };
}
