import type { CoastAudio } from './CoastAudio';
import type { ExplorationWorldId } from './coastDestinations';
import {
  readExplorationSoundSettings,
  saveExplorationSoundSettings,
  type ExplorationSound,
  type ExplorationSoundSettings,
} from './explorationSound';

const worldSounds: Record<ExplorationWorldId, readonly ExplorationSound[]> = {
  coast: ['water', 'birds', 'insects'],
  overlook: ['birds', 'insects', 'traffic'],
  residence: ['traffic', 'wind', 'doors', 'appliances'],
  cinema: ['preview', 'wind'],
  atrium: ['crowd', 'appliances'],
};

const soundLabels: Record<ExplorationSound, string> = {
  water: '水音',
  birds: '鳥の声',
  insects: '虫の声',
  wind: '風音',
  traffic: '交通音',
  doors: '戸の開閉音',
  appliances: '設備音',
  preview: '上映音',
  footsteps: '歩行音',
  crowd: '館内のざわめき',
};

function volumeRow(id: string, label: string, max: number, action = ''): string {
  return `
    <div class="coast-setting-row">
      <label class="coast-label" for="${id}">${label}</label>
      <input id="${id}" type="range" min="0" max="${max}" step="1">
      <span class="coast-setting-value" aria-hidden="true"></span>
      ${action}
    </div>`;
}

export function bindCoastSoundControls(
  panel: HTMLElement,
  world: ExplorationWorldId,
  audio: Pick<CoastAudio, 'start' | 'isRunning' | 'setMix'>,
  onMasterVolume: (volume: number) => void,
) {
  const adjustableSounds = ['footsteps', ...worldSounds[world]] as const;
  const labels: Partial<Record<ExplorationSound, string>> = world === 'cinema' ? { wind: '換気音' }
    : world === 'atrium' ? { appliances: '換気・設備音' } : {};
  panel.insertAdjacentHTML('beforeend', `
    <div class="coast-sound">
      ${volumeRow('coast-volume', '全体音量', 300, '<button type="button" class="coast-audio"></button>')}
      <details class="coast-sound-details">
        <summary>種類別の音量</summary>
        ${adjustableSounds.map(kind => volumeRow(
          `coast-sound-${kind}`, labels[kind] ?? soundLabels[kind], 100,
          kind === 'footsteps' ? '<button type="button" class="coast-footsteps-audio"></button>' : '',
        )).join('')}
      </details>
      <p class="coast-audio-message" role="status"></p>
      <button type="button" class="coast-audio-retry" hidden>音声を再開</button>
    </div>
  `);
  const environment = panel.querySelector<HTMLButtonElement>('.coast-audio')!;
  const footsteps = panel.querySelector<HTMLButtonElement>('.coast-footsteps-audio')!;
  const message = panel.querySelector<HTMLElement>('.coast-audio-message')!;
  const retry = panel.querySelector<HTMLButtonElement>('.coast-audio-retry')!;
  const listeners = new AbortController();
  let restoreListeners: AbortController | undefined;
  let settings = readExplorationSoundSettings();
  let pendingStart: Promise<void> | undefined;
  let showStartStatus = false;

  function applyMix(): void {
    audio.setMix({
      ...settings,
      environmentOn: settings.environmentOn === true,
      footstepsOn: wantsFootsteps(),
    });
  }

  function applySettings(next: ExplorationSoundSettings): void {
    settings = next;
    applyMix();
    saveExplorationSoundSettings(settings);
    if (!wantsAudio()) stopRestoreRetry();
    sync();
  }

  function wantsFootsteps(): boolean {
    return settings.footstepsOn ?? settings.environmentOn === true;
  }

  function wantsAudio(): boolean {
    return settings.environmentOn === true || wantsFootsteps();
  }

  function stopRestoreRetry(): void {
    restoreListeners?.abort();
    restoreListeners = undefined;
  }

  const environmentText = () => settings.environmentOn ? '環境音をオフ' : '環境音をオン';
  const footstepsText = () => wantsFootsteps() ? '歩行音をオフ' : '歩行音をオン';

  function sync(): void {
    const environmentLabel = environmentText();
    const footstepsLabel = footstepsText();
    if (environment.textContent !== environmentLabel) environment.textContent = environmentLabel;
    if (footsteps.textContent !== footstepsLabel) footsteps.textContent = footstepsLabel;
    const needsResume = wantsAudio() && !audio.isRunning();
    if (retry.hidden === needsResume) retry.hidden = !needsResume;
    if (!needsResume && message.textContent) {
      message.textContent = '';
      showStartStatus = false;
    }
  }

  function startAudio(explicit: boolean): Promise<void> {
    if (audio.isRunning()) return Promise.resolve();
    if (explicit) {
      showStartStatus = true;
      message.textContent = '音声を準備しています。';
    }
    let request: Promise<void>;
    try {
      // Call start again on a gesture even while an automatic resume is pending.
      request = audio.start();
    } catch (error) {
      request = Promise.reject(error);
    }
    if (request === pendingStart) return request;
    pendingStart = request;
    const finish = (running: boolean) => {
      if (listeners.signal.aborted || request !== pendingStart) return;
      pendingStart = undefined;
      stopRestoreRetry();
      message.textContent = !running && showStartStatus && wantsAudio()
        ? '音声を開始できませんでした。「音声を再開」を押してください。' : '';
      showStartStatus = false;
      sync();
    };
    void request.then(() => finish(audio.isRunning()), () => finish(false));
    return request;
  }

  function retryRestoredSound(event: Event): void {
    if (!event.isTrusted || navigator.userActivation?.isActive === false
      || (event instanceof KeyboardEvent && event.repeat)) return;
    // The explicit audio controls apply their setting before their click handlers start audio.
    const activatesButton = event.type === 'click'
      || (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' '));
    if (activatesButton && event.target instanceof Element
      && event.target.closest('.coast-audio, .coast-footsteps-audio, .coast-audio-retry')) return;
    stopRestoreRetry();
    if (wantsAudio()) void startAudio(false);
  }

  function restoreSound(): void {
    stopRestoreRetry();
    if (!wantsAudio() || audio.isRunning()) return;
    restoreListeners = new AbortController();
    window.addEventListener('click', retryRestoredSound, { signal: restoreListeners.signal });
    window.addEventListener('keydown', retryRestoredSound, { signal: restoreListeners.signal });
    void startAudio(false);
  }

  function bindVolume(id: string, initial: number, change: (gain: number) => void) {
    const slider = panel.querySelector<HTMLInputElement>(`#${id}`)!;
    const value = slider.nextElementSibling!;
    const updateValue = () => {
      const text = `${slider.valueAsNumber}%`;
      value.textContent = text;
      slider.setAttribute('aria-valuetext', text);
    };
    const show = (gain: number) => {
      slider.valueAsNumber = Math.round(gain * 100);
      updateValue();
    };
    show(initial);
    slider.addEventListener('input', () => {
      updateValue();
      change(slider.valueAsNumber / 100);
    }, { signal: listeners.signal });
    return show;
  }

  const showMaster = bindVolume('coast-volume', settings.master, master => {
    applySettings({ ...settings, master });
    onMasterVolume(master);
  });
  const showChannels = adjustableSounds.map(kind => ({
    kind,
    show: bindVolume(`coast-sound-${kind}`, settings.levels[kind], gain => {
      applySettings({ ...settings, levels: { ...settings.levels, [kind]: gain } });
    }),
  }));

  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    const previous = settings;
    settings = readExplorationSoundSettings(previous);
    const masterChanged = previous.master !== settings.master;
    const levelsChanged = Object.entries(settings.levels).some(([kind, gain]) =>
      previous.levels[kind as ExplorationSound] !== gain);
    if (masterChanged || levelsChanged || previous.environmentOn !== settings.environmentOn
      || previous.footstepsOn !== settings.footstepsOn) {
      applyMix();
      if (masterChanged) {
        showMaster(settings.master);
        onMasterVolume(settings.master);
      }
      for (const { kind, show } of showChannels) {
        if (previous.levels[kind] !== settings.levels[kind]) show(settings.levels[kind]);
      }
    }
    sync();
    restoreSound();
  }, { signal: listeners.signal });

  function toggleEnvironment(): void {
    const next = settings.environmentOn !== true;
    applySettings({ ...settings, environmentOn: next, footstepsOn: settings.footstepsOn ?? true });
    if (next) void startAudio(true);
  }
  function toggleFootsteps(): void {
    const next = !wantsFootsteps();
    applySettings({ ...settings, footstepsOn: next });
    if (next) void startAudio(true);
  }
  environment.addEventListener('click', toggleEnvironment, { signal: listeners.signal });
  footsteps.addEventListener('click', toggleFootsteps, { signal: listeners.signal });
  retry.addEventListener('click', () => {
    if (wantsAudio()) void startAudio(true);
  }, { signal: listeners.signal });
  applyMix();
  sync();
  restoreSound();
  return {
    get masterVolume() { return settings.master; },
    get environmentLabel() { return environmentText(); },
    get footstepsLabel() { return footstepsText(); },
    toggleEnvironment,
    toggleFootsteps,
    async startForPreview() {
      if (settings.environmentOn === null) {
        applySettings({ ...settings, environmentOn: true, footstepsOn: settings.footstepsOn ?? true });
      }
      if (wantsAudio()) {
        await startAudio(true).catch(() => undefined);
      }
    },
    sync,
    dispose() {
      listeners.abort();
      stopRestoreRetry();
    },
  };
}
