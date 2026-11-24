export type WorldLightingMode = 'auto' | 'on' | 'off';
export type WorldLightingState = WorldLightingMode | 'custom';

export interface WorldLightingControl {
  readonly artificialLightingMode: WorldLightingState;
  readonly artificialLightingUnavailableReason?: string;
  setArtificialLightingMode(mode: WorldLightingMode): void;
}

export const worldLightingChoices = [
  { mode: 'on', label: '一括点灯' },
  { mode: 'off', label: '一括消灯' },
  { mode: 'auto', label: '既定' },
] as const;

export function bindWorldLightingControl(element: HTMLElement, world: WorldLightingControl) {
  const buttons = worldLightingChoices.map(({ mode, label }) => {
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
  const status = document.createElement('p');
  status.className = 'coast-lighting-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  element.append(status);

  let previousMode: WorldLightingState | undefined;
  let previousReason: string | undefined;
  function sync(): void {
    const current = world.artificialLightingMode;
    const reason = world.artificialLightingUnavailableReason;
    if (previousMode === current && previousReason === reason) return;
    if (previousReason !== reason) {
      status.hidden = reason === undefined;
      status.textContent = reason ?? '';
    }
    previousMode = current;
    previousReason = reason;
    for (const { mode, button } of buttons) {
      button.disabled = reason !== undefined;
      button.setAttribute('aria-pressed', String(mode === current));
    }
  }
  sync();
  return sync;
}
