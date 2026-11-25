import type { CinemaLightingMode } from './cinemaLighting';

export interface CinemaControls {
  readonly mode: CinemaLightingMode;
  readonly samplePlaying: boolean;
  readonly canStartSample: boolean;
  readonly localScreening: {
    readonly loading: boolean;
    readonly available: boolean;
    readonly playing: boolean;
    readonly duration: number;
    readonly position: number;
    readonly format: string;
    readonly error: string;
    readonly blocked: boolean;
  };
  setMode(mode: CinemaLightingMode): void;
  toggleSample(): void;
  openScreening(files: readonly File[]): Promise<void>;
  toggleScreening(): Promise<void>;
  seekScreening(seconds: number): void;
  closeScreening(): void;
}

export const cinemaLightingModes = [
  ['arrival', '入退場'],
  ['screening', '上映'],
  ['service', '清掃'],
  ['emergency', '非常点検'],
] as const;

function button(label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  return element;
}

function formatTime(seconds: number): string {
  const total = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : '上映操作に失敗しました。素材と再生状態を確認してください。';
}

export function createCinemaPanel(
  controls: CinemaControls, onOpen: () => void, startAudio: () => Promise<void>,
) {
  const element = document.createElement('div');
  element.className = 'coast-travel-panel';
  const trigger = button('上映設定');
  trigger.className = 'coast-travel-toggle';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'cinema-screening-dialog');

  const dialog = document.createElement('dialog');
  dialog.id = 'cinema-screening-dialog';
  dialog.className = 'coast-travel-dialog cinema-screening-dialog';
  dialog.setAttribute('aria-labelledby', 'cinema-screening-heading');
  const content = document.createElement('div');
  content.className = 'coast-travel-content';
  const heading = document.createElement('h2');
  heading.id = 'cinema-screening-heading';
  heading.textContent = '上映設定';
  const close = button('閉じる');
  const header = document.createElement('div');
  header.className = 'coast-travel-heading';
  header.append(heading, close);

  const lighting = document.createElement('div');
  lighting.className = 'coast-row';
  lighting.setAttribute('role', 'group');
  lighting.setAttribute('aria-label', '館内照明');
  const modes = cinemaLightingModes.map(([mode, label]) => {
    const choice = button(label);
    choice.addEventListener('click', () => {
      controls.setMode(mode);
      sync();
    });
    lighting.append(choice);
    return { mode, choice };
  });
  const actions = document.createElement('div');
  actions.className = 'coast-row';
  const sample = button('試映を再生');
  actions.append(sample);

  const screeningActions = document.createElement('div');
  screeningActions.className = 'coast-row cinema-local-screening-actions';
  screeningActions.setAttribute('role', 'group');
  screeningActions.setAttribute('aria-label', '本編上映');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = '.json,.mp4,.wav,.wave,.rf64,.bw64,application/json,video/*,audio/*';
  fileInput.setAttribute('aria-label', '上映素材');
  fileInput.hidden = true;
  const openScreening = button('上映素材を開く');
  const toggleScreening = button('本編を再生');
  const closeScreening = button('上映素材を閉じる');
  screeningActions.append(fileInput, openScreening, toggleScreening, closeScreening);

  const seekRow = document.createElement('div');
  seekRow.className = 'coast-row cinema-local-screening-seek';
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.min = '0';
  seek.step = '1';
  seek.setAttribute('aria-label', '上映位置');
  const time = document.createElement('span');
  time.className = 'cinema-local-screening-time';
  seekRow.append(seek, time);

  const status = document.createElement('p');
  status.id = 'cinema-screening-status';
  status.className = 'cinema-local-screening-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  for (const control of [openScreening, toggleScreening, closeScreening, seek]) {
    control.setAttribute('aria-describedby', status.id);
  }

  content.append(header, lighting, actions, screeningActions, seekRow, status);
  dialog.append(content);
  element.append(trigger, dialog);

  let actionError = '';
  let seeking = false;
  let pendingPosition: number | null = null;

  function screeningStatus(): string {
    const screening = controls.localScreening;
    if (screening.loading) return '上映素材を読み込んでいます。';
    if (controls.mode === 'emergency') return '非常点検中は本編を再生できません。';
    if (actionError) return actionError;
    if (screening.error) return screening.error;
    if (screening.blocked) return '本編を再生できません。上映状態を確認してください。';
    if (!screening.available) return '上映素材が未準備です。JSONと映像・音声の素材を選択してください。';
    if (screening.playing) {
      const position = pendingPosition ?? screening.position;
      return `本編を再生中です。${formatTime(position)} / ${formatTime(screening.duration)}`;
    }
    return screening.format
      ? `上映素材を読み込みました（${screening.format}）。本編を再生できます。`
      : '上映素材を読み込みました。本編を再生できます。';
  }

  function sync(): void {
    const label = controls.samplePlaying ? '試映を停止' : '試映を再生';
    if (sample.textContent !== label) sample.textContent = label;
    sample.disabled = !controls.canStartSample && !controls.samplePlaying;
    for (const { mode, choice } of modes) {
      const selected = String(controls.mode === mode);
      if (choice.getAttribute('aria-pressed') !== selected) choice.setAttribute('aria-pressed', selected);
    }

    const screening = controls.localScreening;
    const duration = Number.isFinite(screening.duration) ? Math.max(0, screening.duration) : 0;
    const position = Number.isFinite(screening.position) ? Math.max(0, screening.position) : 0;
    const shownPosition = pendingPosition ?? position;
    if (pendingPosition !== null && Math.abs(position - pendingPosition) < 0.5) pendingPosition = null;
    if (toggleScreening.textContent !== (screening.playing ? '本編を一時停止' : '本編を再生')) {
      toggleScreening.textContent = screening.playing ? '本編を一時停止' : '本編を再生';
    }
    openScreening.disabled = screening.loading;
    toggleScreening.disabled = screening.loading || (!screening.playing
      && (!screening.available || screening.blocked || controls.mode === 'emergency'));
    closeScreening.disabled = !screening.available && !screening.loading && !screening.error;
    seek.max = String(duration);
    seek.disabled = !screening.available || screening.loading || screening.blocked
      || controls.mode === 'emergency' || duration <= 0;
    if (!seeking) seek.value = String(Math.min(duration, Math.max(0, pendingPosition ?? position)));
    const nextTime = `${formatTime(shownPosition)} / ${formatTime(duration)}`;
    if (time.textContent !== nextTime) time.textContent = nextTime;
    const nextStatus = screeningStatus();
    if (status.textContent !== nextStatus) status.textContent = nextStatus;
  }

  trigger.addEventListener('click', () => {
    onOpen();
    sync();
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => trigger.setAttribute('aria-expanded', 'false'));
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  sample.addEventListener('click', () => {
    controls.toggleSample();
    sync();
    if (controls.samplePlaying) {
      void startAudio();
      dialog.close();
    }
  });

  openScreening.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    if (files.length === 0) return;
    actionError = '';
    pendingPosition = null;
    void controls.openScreening(files).catch(error => {
      actionError = errorMessage(error);
    }).finally(() => {
      fileInput.value = '';
      sync();
    });
    sync();
  });
  toggleScreening.addEventListener('click', () => {
    if (controls.mode === 'emergency' && !controls.localScreening.playing) return;
    actionError = '';
    void controls.toggleScreening().catch(error => {
      actionError = errorMessage(error);
    }).finally(sync);
  });
  closeScreening.addEventListener('click', () => {
    try {
      controls.closeScreening();
      actionError = '';
      pendingPosition = null;
      fileInput.value = '';
    } catch (error) {
      actionError = errorMessage(error);
    }
    sync();
  });
  seek.addEventListener('pointerdown', () => { seeking = true; });
  seek.addEventListener('pointerup', () => { seeking = false; sync(); });
  seek.addEventListener('pointercancel', () => { seeking = false; sync(); });
  seek.addEventListener('input', () => {
    const seconds = Number(seek.value);
    pendingPosition = seconds;
    try {
      controls.seekScreening(seconds);
      actionError = '';
    } catch (error) {
      pendingPosition = null;
      actionError = errorMessage(error);
    }
    sync();
  });
  seek.addEventListener('change', () => { seeking = false; sync(); });
  return { element, dialog, sync };
}
