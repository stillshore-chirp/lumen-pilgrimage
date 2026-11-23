import type { CinemaLightingMode } from './cinemaLighting';

export interface CinemaControls {
  readonly mode: CinemaLightingMode;
  readonly samplePlaying: boolean;
  readonly canStartSample: boolean;
  setMode(mode: CinemaLightingMode): void;
  toggleSample(): void;
}

const lightingModes = [
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

export function createCinemaPanel(
  controls: CinemaControls, onOpen: () => void, leave: () => void, startAudio: () => Promise<void>,
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
  const modes = lightingModes.map(([mode, label]) => {
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
  const exit = button('入り江へ戻る');
  actions.append(sample, exit);
  content.append(header, lighting, actions);
  dialog.append(content);
  element.append(trigger, dialog);

  function sync(): void {
    const label = controls.samplePlaying ? '試映を停止' : '試映を再生';
    if (sample.textContent !== label) sample.textContent = label;
    sample.disabled = !controls.canStartSample && !controls.samplePlaying;
    for (const { mode, choice } of modes) {
      const selected = String(controls.mode === mode);
      if (choice.getAttribute('aria-pressed') !== selected) choice.setAttribute('aria-pressed', selected);
    }
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
  exit.addEventListener('click', leave);
  return { element, dialog, sync };
}
