import type { ImmersiveMenuItem } from '../xr/ImmersiveMenu';
import { lakeAngleControls, lakeToggleControls, type LakeSettings } from './world/lake/lakeSettings';
import './lakeEnvironmentPanel.css';

const label = '湖畔の環境設定';

export interface LakeKotoControls {
  readonly kotoPlaying: boolean;
  setKotoPlaying(value: boolean): Promise<void>;
}

function makeButton(text: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  return button;
}

export function createLakeEnvironmentPanel(settings: LakeSettings, onOpen: () => void, koto?: LakeKotoControls) {
  const element = document.createElement('div');
  element.className = 'coast-travel-panel';
  const trigger = makeButton('環境設定');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'lake-environment-dialog');
  trigger.setAttribute('aria-expanded', 'false');

  const dialog = document.createElement('dialog');
  dialog.id = 'lake-environment-dialog';
  dialog.className = 'coast-travel-dialog lake-environment-dialog';
  dialog.setAttribute('aria-labelledby', 'lake-environment-heading');

  const heading = document.createElement('h2');
  heading.id = 'lake-environment-heading';
  heading.textContent = label;
  const close = makeButton('閉じる');
  close.autofocus = true;
  close.addEventListener('click', () => dialog.close());
  const header = document.createElement('header');
  header.className = 'coast-travel-heading';
  header.append(heading, close);

  const content = document.createElement('div');
  content.className = 'lake-environment-content';
  const switches = document.createElement('div');
  switches.className = 'lake-environment-switches';
  switches.setAttribute('role', 'group');
  switches.setAttribute('aria-label', '表示するもの');
  const toggles = lakeToggleControls.map(({ key, label }) => {
    const button = makeButton(label);
    button.addEventListener('click', () => {
      settings.update({ [key]: !settings.state[key] });
      sync();
    });
    switches.append(button);
    return { button, key };
  });
  const kotoButton = koto && makeButton('琴の演奏');
  const audioStatus = document.createElement('p');
  audioStatus.className = 'lake-environment-audio-status';
  audioStatus.setAttribute('role', 'status');
  audioStatus.hidden = true;
  if (koto && kotoButton) {
    switches.append(kotoButton);
    kotoButton.addEventListener('click', async () => {
      audioStatus.hidden = true;
      kotoButton.disabled = true;
      try {
        await koto.setKotoPlaying(!koto.kotoPlaying);
      } catch {
        audioStatus.textContent = '再生できませんでした。もう一度押してください。';
        audioStatus.hidden = false;
      } finally {
        kotoButton.disabled = false;
        sync();
      }
    });
  }

  const sliders = document.createElement('div');
  sliders.className = 'lake-environment-sliders';
  sliders.setAttribute('role', 'group');
  sliders.setAttribute('aria-label', '太陽と月の位置');
  const axes = lakeAngleControls.map(({ key, label, min, max }) => {
    const row = document.createElement('div');
    row.className = 'lake-environment-axis';
    const caption = document.createElement('label');
    caption.htmlFor = `lake-${key}`;
    caption.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = caption.htmlFor;
    input.min = String(min);
    input.max = String(max);
    input.step = '0.1';
    const output = document.createElement('output');
    output.setAttribute('for', input.id);
    output.setAttribute('aria-hidden', 'true');
    input.addEventListener('input', () => {
      settings.update({ [key]: input.valueAsNumber });
      sync();
    });
    row.append(caption, input, output);
    sliders.append(row);
    return { input, output, key };
  });

  const directionHint = document.createElement('p');
  directionHint.className = 'lake-environment-direction';
  directionHint.textContent = '方位は正面が0°、右が90°。';
  const reset = makeButton('太陽と月を既定に戻す');
  reset.addEventListener('click', () => { settings.resetSky(); sync(); });
  content.append(switches, audioStatus, sliders, directionHint, reset);
  dialog.append(header, content);
  element.append(trigger, dialog);

  function sync(): void {
    const { state } = settings;
    for (const { button, key } of toggles) button.setAttribute('aria-pressed', String(state[key]));
    if (koto && kotoButton) kotoButton.setAttribute('aria-pressed', String(koto.kotoPlaying));
    for (const { input, output, key } of axes) {
      const value = state[key].toFixed(1);
      if (input.value !== value) input.value = value;
      input.setAttribute('aria-valuetext', `${value}度`);
      output.value = `${value}°`;
    }
  }

  trigger.addEventListener('click', () => {
    if (dialog.open) return;
    onOpen();
    sync();
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
  });
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  return { element, dialog };
}

export function createLakeEnvironmentXRItems(settings: LakeSettings,
  open: (name: string, items: readonly ImmersiveMenuItem[]) => void, back: () => void, koto?: LakeKotoControls) {
  let pending = false;
  let failed = false;
  function show(): void {
    const toggles = lakeToggleControls.map(({ key, label }) => ({
      label: () => `${label}  ${settings.state[key] ? '表示中' : '非表示'}`,
      invoke: () => settings.update({ [key]: !settings.state[key] }),
    }));
    const axes = lakeAngleControls.map(({ key, label, min, max }) => ({
      label: () => `${label}  ${settings.state[key].toFixed(0)}°`,
      invoke: () => {
        function step(delta: number): void {
          const value = settings.state[key] + delta;
          settings.update({ [key]: min === 0 ? (value + 360) % 360 : Math.max(min, Math.min(max, value)) });
        }
        open(label, [
          { label: () => `現在  ${settings.state[key].toFixed(0)}°` },
          { label: '−5°', invoke: () => step(-5) },
          { label: '+5°', invoke: () => step(5) },
          { label: '環境設定に戻る', invoke: show },
        ]);
      },
    }));
    const kotoRows: ImmersiveMenuItem[] = koto ? [{
      label: () => {
        if (pending) return '琴を準備しています';
        if (failed) return '琴を再生する（再試行）';
        return koto.kotoPlaying ? '琴を停止する' : '琴を再生する';
      },
      enabled: () => !pending,
      invoke: async () => {
        pending = true;
        failed = false;
        try {
          await koto.setKotoPlaying(!koto.kotoPlaying);
        } catch {
          failed = true;
        } finally {
          pending = false;
        }
      },
    }] : [];
    open(label, [
      ...toggles, ...kotoRows, ...axes,
      { label: '太陽と月を既定に戻す', invoke: () => settings.resetSky() },
      { label: '設定に戻る', invoke: back },
    ]);
  }

  return show;
}
