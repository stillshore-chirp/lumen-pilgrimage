export type WorldLightingMode = 'auto' | 'on' | 'off';
export type WorldLightingState = WorldLightingMode | 'custom';

export interface WorldLightingControl {
  readonly artificialLightingMode: WorldLightingState;
  setArtificialLightingMode(mode: WorldLightingMode): void;
}

const choices = [
  { mode: 'on', label: '一括点灯' },
  { mode: 'off', label: '一括消灯' },
  { mode: 'auto', label: '既定' },
] as const;

export function bindWorldLightingControl(element: HTMLElement, world: WorldLightingControl) {
  const buttons = choices.map(({ mode, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      world.setArtificialLightingMode(mode);
      sync();
    });
    element.append(button);
    return { mode, button };
  });
  let previous: WorldLightingState | undefined;
  function sync(): void {
    const current = world.artificialLightingMode;
    if (previous === current) return;
    previous = current;
    for (const { mode, button } of buttons) button.setAttribute('aria-pressed', String(mode === current));
  }
  sync();
  return sync;
}
