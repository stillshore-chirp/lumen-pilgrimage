// Appliances use a monotonic clock so a slow renderer cannot extend the set time.
export function createApplianceCycle(now: () => number) {
  let remaining = 0;
  let end: number | null = null;
  let completions = 0;
  let finished = false;

  function advance(): void {
    if (end === null) return;
    remaining = Math.max(0, end - now());
    if (remaining === 0) {
      end = null;
      completions++;
      finished = true;
    }
  }

  return {
    get running() { return end !== null; },
    get remaining() { return remaining; },
    get finished() { return finished; },
    get completions() { return completions; },
    advance,
    set(seconds: number) {
      if (end !== null || !Number.isFinite(seconds) || seconds < 0) return;
      remaining = seconds;
      finished = false;
    },
    start() {
      if (end !== null || remaining <= 0) return;
      end = now() + remaining;
      finished = false;
    },
    stop() {
      advance();
      end = null;
    },
  };
}

export function applianceTime(seconds: number): string {
  const rounded = Math.ceil(seconds);
  return `${Math.floor(rounded / 60).toString().padStart(2, '0')}:${(rounded % 60).toString().padStart(2, '0')}`;
}
