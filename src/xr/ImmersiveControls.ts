import type { CoastXRMovement } from '../coast/CoastControls';

const STICK_DEADZONE = .18;
const STICK_ACTION = .65;
const STICK_NEUTRAL = .35;
const SNAP_ANGLE = Math.PI / 6;

// The WebXR standard reserves button 4 onward for profile-specific controls.
const TOUCH_PROFILES = new Set([
  'meta-quest-touch-plus-v2', 'meta-quest-touch-plus', 'meta-quest-touch-pro',
  'oculus-touch-v3', 'oculus-touch-v2', 'oculus-touch',
]);

interface Pad {
  readonly source: XRInputSource;
  readonly gamepad: Gamepad;
  readonly touch: boolean;
}

interface Buttons {
  readonly menu: boolean;
  readonly flight: boolean;
  readonly jump: boolean;
  readonly dive: boolean;
}

interface ImmersiveInput extends CoastXRMovement {
  readonly menu: boolean;
  readonly menuStep: number;
  readonly snap: number;
}

const RELEASED = {
  menu: false, flight: false, jump: false, dive: false,
} as const satisfies Buttons;

export const IDLE_XR_INPUT: ImmersiveInput = {
  ...RELEASED, forward: 0, right: 0, vertical: 0, menuStep: 0, snap: 0,
};

function axis(pad: Pad | undefined, index: number): number {
  const value = pad?.gamepad.axes[index] ?? 0;
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function pressed(pad: Pad | undefined, index: number): boolean {
  const button = pad?.gamepad.buttons[index];
  return Boolean(button && (button.pressed || button.value >= .5));
}

export class ImmersiveControls {
  private left?: XRInputSource;
  private right?: XRInputSource;
  private buttons: Buttons = RELEASED;
  private moveReady = false;
  private verticalReady = false;
  private stickReady = false;

  reset(): void {
    this.left = this.right = undefined;
    this.buttons = RELEASED;
    this.moveReady = this.verticalReady = this.stickReady = false;
  }

  pauseMovement(): void {
    this.moveReady = this.verticalReady = false;
  }

  sample(frame: XRFrame, reference: XRReferenceSpace, menuOpen: boolean): ImmersiveInput {
    let left: Pad | undefined;
    let right: Pad | undefined;
    for (const source of frame.session.inputSources) {
      const gamepad = source.gamepad;
      if (source.targetRayMode !== 'tracked-pointer' || gamepad?.mapping !== 'xr-standard'
        || source.handedness === 'none' || !frame.getPose(source.targetRaySpace, reference)) continue;
      const pad: Pad = { source, gamepad, touch: source.profiles.some(profile => TOUCH_PROFILES.has(profile)) };
      if (source.handedness === 'left') left = pad;
      else right = pad;
    }
    const buttons = {
      menu: pressed(left, left?.touch ? 4 : 3),
      flight: Boolean(left?.touch && pressed(left, 5)),
      jump: Boolean(right?.touch && pressed(right, 4)),
      dive: Boolean(right?.touch && pressed(right, 5)),
    };
    const sameLeft = left !== undefined && left.source === this.left;
    const sameRight = right !== undefined && right.source === this.right;
    const menu = sameLeft && buttons.menu && !this.buttons.menu;
    const flight = sameLeft && buttons.flight && !this.buttons.flight;
    const jump = sameRight && buttons.jump && !this.buttons.jump;
    const dive = sameRight && buttons.dive && !this.buttons.dive;
    this.left = left?.source;
    this.right = right?.source;
    this.buttons = buttons;

    const leftX = axis(left, 2), leftY = axis(left, 3);
    const radius = Math.hypot(leftX, leftY);
    if (!sameLeft || menuOpen || menu) this.moveReady = false;
    const strength = this.moveReady && radius > STICK_DEADZONE
      ? (Math.min(radius, 1) - STICK_DEADZONE) / ((1 - STICK_DEADZONE) * radius)
      : 0;
    if (!menuOpen && !menu && radius <= STICK_DEADZONE) this.moveReady = true;

    const rightX = axis(right, 2), rightY = axis(right, 3);
    const stick = menuOpen ? rightY : rightX;
    const isAction = sameRight && this.stickReady && Math.abs(stick) >= STICK_ACTION
      && Math.abs(stick) >= Math.abs(menuOpen ? rightX : rightY);
    if (!sameRight || isAction || menu) this.stickReady = false;
    if (Math.max(Math.abs(rightX), Math.abs(rightY)) <= STICK_NEUTRAL) this.stickReady = true;
    const step = isAction ? Math.sign(stick) : 0;

    if (!sameRight || menuOpen || menu) this.verticalReady = false;
    const vertical = this.verticalReady ? Number(buttons.jump) - Number(buttons.dive) : 0;
    if (!menuOpen && !menu && !buttons.jump && !buttons.dive) this.verticalReady = true;
    return {
      menu, flight, jump, dive, forward: -leftY * strength, right: leftX * strength,
      vertical,
      menuStep: menuOpen ? step : 0, snap: menuOpen ? 0 : -step * SNAP_ANGLE,
    };
  }
}
