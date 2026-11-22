import { Vector3, type PerspectiveCamera } from 'three';
import { COAST_BOUNDS, groundHeight, SEA_LEVEL, smoothstep, SPAWN } from './terrain';

export type CoastMovement = 'walk' | 'wade' | 'swim' | 'flight';

export interface CoastControlCallbacks {
  onMovementChange: (movement: CoastMovement) => void;
  onLockChange: (locked: boolean) => void;
  onLockError: () => void;
}

const EYE_HEIGHT = 1.65;
const WALK_SPEED = 6.4;
const SWIM_SPEED = 4.1;
const SWIM_DEPTH = 1.02;
const FLIGHT_SPEED = 20.5;
const SPRINT_MULTIPLIER = 1.7;
const LOOK_SPEED = 2.3;
const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.035;
const GRAVITY = 22;
const JUMP_SPEED = 7.8;
const FOOT_CLEARANCE = 0.025;
const MAX_FALL_SPEED = 18;
const MAX_DELTA = 0.05;
const WALK_SAMPLE_DISTANCE = 0.15;
const FLIGHT_SAMPLE_DISTANCE = 0.46;
const MAX_WALK_SLOPE = 0.95;
const WALK_SLOPE_EPSILON = 0.000001;
const BOUNDS_PADDING = 0.35;
const MAX_FLIGHT_HEIGHT = 255;
const GAMEPAD_DEADZONE = 0.16;

export class CoastControls {
  private readonly camera: PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: CoastControlCallbacks;
  private readonly keys = new Set<string>();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly movement = new Vector3();
  private readonly viewDirection = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private flying = false;
  private movementMode: CoastMovement = 'walk';
  private verticalVelocity = 0;
  private jumpQueued = false;
  private previousGamepadFlight = false;
  private previousGamepadJump = false;
  private pointerLockRequestPending = false;
  private inputSuspended = false;
  private disposed = false;

  constructor(camera: PerspectiveCamera, canvas: HTMLCanvasElement, callbacks: CoastControlCallbacks) {
    this.camera = camera;
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(SPAWN.pitch, SPAWN.yaw, 0);
    this.camera.position.set(
      SPAWN.x,
      groundHeight(SPAWN.x, SPAWN.z) + EYE_HEIGHT,
      SPAWN.z
    );

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('focus', this.handleWindowFocus);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', this.handlePointerLockError);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('blur', this.handleCanvasBlur);
    this.callbacks.onLockChange(document.pointerLockElement === this.canvas);
  }

  toggleFlight(): void {
    if (this.disposed) return;

    this.flying = !this.flying;
    this.verticalVelocity = 0;
    this.jumpQueued = false;

    if (!this.flying) {
      const floor = this.supportHeight(this.camera.position.x, this.camera.position.z) + EYE_HEIGHT;
      this.camera.position.y = Math.max(this.camera.position.y, floor);
    }
    this.updateMovementMode();
  }

  requestLock(): void {
    if (this.disposed || this.pointerLockRequestPending || document.pointerLockElement === this.canvas) return;

    this.canvas.focus({ preventScroll: true });
    this.pointerLockRequestPending = true;

    try {
      const request = this.canvas.requestPointerLock();
      if (request && typeof request.then === 'function') {
        void request.catch(() => this.reportPointerLockError());
      }
    } catch {
      this.reportPointerLockError();
    }
  }

  update(dt: number): void {
    if (this.disposed) return;

    const delta = Number.isFinite(dt) ? Math.max(0, Math.min(dt, MAX_DELTA)) : 0;
    const input = this.readMovementInput(delta);
    if (delta === 0 || this.inputSuspended) return;
    const pace = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
      ? SPRINT_MULTIPLIER
      : 1;

    if (this.flying) {
      this.updateFlight(input.forward, input.right, input.vertical, pace, delta);
      return;
    }

    this.updateGroundMovement(input.forward, input.right, pace, delta);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearInput();

    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('focus', this.handleWindowFocus);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('pointerlockerror', this.handlePointerLockError);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('blur', this.handleCanvasBlur);

    this.pointerLockRequestPending = false;
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.canUseSceneKeyboard(event.target)) return;

    if (this.isControlKey(event.code)) {
      event.preventDefault();
      if (event.code === 'Space' && !event.repeat && !this.keys.has('Space') && !this.flying) {
        this.jumpQueued = true;
      }
      this.keys.add(event.code);
    }

    if (event.code === 'KeyF') {
      event.preventDefault();
      if (!event.repeat) this.toggleFlight();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;

    this.camera.rotation.y -= event.movementX * MOUSE_SENSITIVITY;
    this.camera.rotation.x = this.clampPitch(
      this.camera.rotation.x - event.movementY * MOUSE_SENSITIVITY
    );
  };

  private readonly handlePointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    this.pointerLockRequestPending = false;
    if (!locked) this.clearInput();
    this.callbacks.onLockChange(locked);
  };

  private readonly handlePointerLockError = (): void => {
    this.reportPointerLockError();
  };

  private readonly handleWindowBlur = (): void => {
    this.inputSuspended = true;
    this.clearInput();
  };

  private readonly handleWindowFocus = (): void => {
    this.inputSuspended = document.visibilityState === 'hidden' || !document.hasFocus();
    this.clearInput();
    this.syncGamepadButtons();
  };

  private readonly handleCanvasBlur = (): void => {
    if (document.pointerLockElement !== this.canvas) this.clearInput();
  };

  private readonly handleVisibilityChange = (): void => {
    this.inputSuspended = document.visibilityState === 'hidden' || !document.hasFocus();
    this.clearInput();
    this.syncGamepadButtons();
  };

  private reportPointerLockError(): void {
    if (!this.pointerLockRequestPending) return;
    this.pointerLockRequestPending = false;
    this.callbacks.onLockError();
  }

  private canUseSceneKeyboard(target: EventTarget | null): boolean {
    if (this.inputSuspended) return false;
    if (this.isInteractiveTarget(target)) return false;
    const active = document.activeElement;
    return active === this.canvas || active === document.body || document.pointerLockElement === this.canvas;
  }

  private isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return target.closest(
      'button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="textbox"]'
    ) !== null;
  }

  private isControlKey(code: string): boolean {
    return code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD'
      || code === 'Space' || code === 'KeyC' || code === 'ShiftLeft' || code === 'ShiftRight';
  }

  private clearInput(): void {
    this.keys.clear();
    this.jumpQueued = false;
  }

  private readMovementInput(dt: number): { forward: number; right: number; vertical: number } {
    if (this.inputSuspended) {
      this.syncGamepadButtons();
      return { forward: 0, right: 0, vertical: 0 };
    }

    let forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    let right = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    let vertical = (this.keys.has('Space') ? 1 : 0) - (this.keys.has('KeyC') ? 1 : 0);

    const gamepad = this.getStandardGamepad();
    if (!gamepad) {
      this.previousGamepadFlight = false;
      this.previousGamepadJump = false;
      return this.normalizePlanarInput(forward, right, vertical);
    }

    const stickForward = this.applyDeadzone(-this.readAxis(gamepad.axes[1]));
    const stickRight = this.applyDeadzone(this.readAxis(gamepad.axes[0]));
    forward += stickForward;
    right += stickRight;

    const ascend = this.readButton(gamepad, 0);
    const descend = this.readButton(gamepad, 1);
    vertical += Number(ascend) - Number(descend);

    const toggle = this.readButton(gamepad, 3);
    if (toggle && !this.previousGamepadFlight) this.toggleFlight();
    if (ascend && !this.previousGamepadJump && !this.flying) this.jumpQueued = true;
    this.previousGamepadFlight = toggle;
    this.previousGamepadJump = ascend;

    const lookX = this.applyDeadzone(this.readAxis(gamepad.axes[2]));
    const lookY = this.applyDeadzone(this.readAxis(gamepad.axes[3]));
    if (lookX !== 0 || lookY !== 0) {
      this.camera.rotation.y -= lookX * LOOK_SPEED * dt;
      this.camera.rotation.x = this.clampPitch(this.camera.rotation.x - lookY * LOOK_SPEED * dt);
    }

    return this.normalizePlanarInput(forward, right, vertical);
  }

  private syncGamepadButtons(): void {
    const gamepad = this.getStandardGamepad();
    this.previousGamepadFlight = gamepad !== null && this.readButton(gamepad, 3);
    this.previousGamepadJump = gamepad !== null && this.readButton(gamepad, 0);
  }

  private normalizePlanarInput(
    forward: number,
    right: number,
    vertical: number
  ): { forward: number; right: number; vertical: number } {
    const horizontalLength = Math.hypot(forward, right);
    if (horizontalLength > 1) {
      forward /= horizontalLength;
      right /= horizontalLength;
    }
    return { forward, right, vertical: Math.max(-1, Math.min(vertical, 1)) };
  }

  private updateGroundMovement(forwardInput: number, rightInput: number, pace: number, dt: number): void {
    const yaw = this.camera.rotation.y;
    this.forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.movement.copy(this.forward).multiplyScalar(forwardInput)
      .addScaledVector(this.right, rightInput);

    const position = this.camera.position;
    const foot = position.y - EYE_HEIGHT;
    const depth = SEA_LEVEL - groundHeight(position.x, position.z);
    const onSupport = this.verticalVelocity <= 0
      && foot <= this.supportHeight(position.x, position.z) + FOOT_CLEARANCE;
    const jumping = this.jumpQueued && onSupport && depth < SWIM_DEPTH;
    this.jumpQueued = false;
    const fallSpeed = jumping ? JUMP_SPEED : this.verticalVelocity;
    const nextVelocity = Math.max(-MAX_FALL_SPEED, fallSpeed - GRAVITY * dt);
    const verticalStep = nextVelocity * dt;

    let followSupport = onSupport && !jumping;
    if (this.movement.lengthSq() > 0) {
      const water = smoothstep(0.12, SWIM_DEPTH, depth);
      const speed = WALK_SPEED * pace * (1 - water) + SWIM_SPEED * water;
      this.movement.multiplyScalar(speed * dt);
      followSupport = this.moveAlongSupport(this.movement.x, this.movement.z, foot, verticalStep, followSupport);
    }

    const floorY = this.supportHeight(position.x, position.z) + EYE_HEIGHT;
    position.y = followSupport ? floorY : Math.max(floorY, position.y + verticalStep);
    this.verticalVelocity = position.y > floorY ? nextVelocity : 0;
    this.updateMovementMode();
  }

  private updateFlight(
    forwardInput: number,
    rightInput: number,
    verticalInput: number,
    pace: number,
    dt: number
  ): void {
    this.camera.getWorldDirection(this.viewDirection);
    this.forward.copy(this.viewDirection);
    this.right.set(Math.cos(this.camera.rotation.y), 0, -Math.sin(this.camera.rotation.y));
    this.movement.copy(this.forward).multiplyScalar(forwardInput)
      .addScaledVector(this.right, rightInput)
      .addScaledVector(this.up, verticalInput);

    if (this.movement.lengthSq() > 1) this.movement.normalize();
    this.movement.multiplyScalar(FLIGHT_SPEED * pace * dt);
    const { x, y, z } = this.camera.position;
    const targetX = this.clampX(x + this.movement.x);
    const targetZ = this.clampZ(z + this.movement.z);
    const targetY = Math.min(y + this.movement.y, MAX_FLIGHT_HEIGHT);
    const steps = Math.ceil(Math.hypot(targetX - x, targetZ - z) / FLIGHT_SAMPLE_DISTANCE);
    let clear = true;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const surface = this.flightFloorHeight(x + (targetX - x) * t, z + (targetZ - z) * t);
      if (y + (targetY - y) * t < surface) {
        clear = false;
        break;
      }
    }
    const safeX = clear ? targetX : x;
    const safeZ = clear ? targetZ : z;
    this.camera.position.set(safeX, Math.max(this.flightFloorHeight(safeX, safeZ), targetY), safeZ);
  }

  private moveAlongSupport(
    deltaX: number, deltaZ: number, foot: number, verticalStep: number, onSupport: boolean
  ): boolean {
    const position = this.camera.position;
    const steps = Math.max(1, Math.ceil(Math.hypot(deltaX, deltaZ) / WALK_SAMPLE_DISTANCE));
    const dx = deltaX / steps;
    const dz = deltaZ / steps;
    let support = this.supportHeight(position.x, position.z);
    let followSupport = onSupport;

    const advance = (stepX: number, stepZ: number, footAtStep: number): boolean => {
      const x = this.clampX(position.x + stepX);
      const z = this.clampZ(position.z + stepZ);
      const distance = Math.hypot(x - position.x, z - position.z);
      if (distance === 0) return false;
      const height = this.supportHeight(x, z);
      const rise = height - support;
      const walkableRise = distance * (MAX_WALK_SLOPE + WALK_SLOPE_EPSILON);
      if (followSupport ? rise > walkableRise : height > footAtStep + FOOT_CLEARANCE) return false;
      if (rise < -walkableRise) followSupport = false;
      position.x = x;
      position.z = z;
      support = height;
      return true;
    };

    for (let step = 1; step <= steps; step += 1) {
      const footAtStep = foot + verticalStep * step / steps;
      if (advance(dx, dz, footAtStep)) continue;
      // At an oblique bank, keep the component that lies along the bank.
      const slide = Math.abs(dx) >= Math.abs(dz)
        ? advance(dx, 0, footAtStep) || advance(0, dz, footAtStep)
        : advance(0, dz, footAtStep) || advance(dx, 0, footAtStep);
      if (!slide) break;
    }
    return followSupport;
  }

  private supportHeight(x: number, z: number): number {
    return Math.max(groundHeight(x, z), SEA_LEVEL - SWIM_DEPTH);
  }

  private flightFloorHeight(x: number, z: number): number {
    return Math.max(groundHeight(x, z) + 0.25, SEA_LEVEL + 0.25);
  }

  private updateMovementMode(): void {
    const depth = SEA_LEVEL - groundHeight(this.camera.position.x, this.camera.position.z);
    let mode: CoastMovement = 'walk';
    if (this.flying) mode = 'flight';
    else if (this.camera.position.y <= SEA_LEVEL + EYE_HEIGHT + 0.03) {
      if (depth >= SWIM_DEPTH) mode = 'swim';
      else if (depth > 0.08) mode = 'wade';
    }
    if (mode === this.movementMode) return;
    this.movementMode = mode;
    this.callbacks.onMovementChange(mode);
  }

  private getStandardGamepad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const gamepad of pads) {
      if (gamepad?.connected && gamepad.mapping === 'standard') return gamepad;
    }
    return null;
  }

  private readAxis(axis: number | undefined): number {
    return Number.isFinite(axis) ? Math.max(-1, Math.min(axis ?? 0, 1)) : 0;
  }

  private applyDeadzone(value: number): number {
    const magnitude = Math.abs(value);
    if (magnitude <= GAMEPAD_DEADZONE) return 0;
    return Math.sign(value) * (magnitude - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE);
  }

  private readButton(gamepad: Gamepad, index: number): boolean {
    const button = gamepad.buttons[index];
    return Boolean(button && (button.pressed || button.value >= 0.5));
  }

  private clampX(x: number): number {
    return Math.max(COAST_BOUNDS.minX + BOUNDS_PADDING, Math.min(x, COAST_BOUNDS.maxX - BOUNDS_PADDING));
  }

  private clampZ(z: number): number {
    return Math.max(COAST_BOUNDS.minZ + BOUNDS_PADDING, Math.min(z, COAST_BOUNDS.maxZ - BOUNDS_PADDING));
  }

  private clampPitch(pitch: number): number {
    return Math.max(-PITCH_LIMIT, Math.min(pitch, PITCH_LIMIT));
  }
}
