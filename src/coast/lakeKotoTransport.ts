export interface LakeKotoControls {
  readonly kotoPlaying: boolean;
  setKotoPlaying(value: boolean): Promise<void>;
}

/** A second action cancels preparation; stale completion cannot overwrite the new action. */
export function createLakeKotoTransport(audio: LakeKotoControls) {
  const events = new EventTarget();
  let pending = false;
  let failed = false;
  let generation = 0;
  const notify = () => events.dispatchEvent(new Event('change'));
  return {
    get playing() { return audio.kotoPlaying; },
    get pending() { return pending; },
    get failed() { return failed; },
    observe(listener: () => void) { events.addEventListener('change', listener); },
    async toggle() {
      const play = !pending && !audio.kotoPlaying;
      const request = ++generation;
      pending = play;
      failed = false;
      notify();
      try {
        await audio.setKotoPlaying(play);
      } catch {
        if (request === generation) failed = true;
      } finally {
        if (request === generation) {
          pending = false;
          notify();
        }
      }
    },
  };
}
