import { Vector3, type PerspectiveCamera } from 'three';
import { COAST_BOUNDS, groundHeight, POOL, SEA_LEVEL, SPAWN } from './terrain';

export interface CoastControlCallbacks {
  onFlightChange: (flying: boolean) => void;
  onLockChange: (locked: boolean) => void;
  onLockError: () => void;
}

const EYE_HEIGHT = 1.65;
const WALK_SPEED = 4.4;
const FLIGHT_SPEED = 7.5;
const SPRINT_MULTIPLIER = 1.7;
const LOOK_SPEED = 2.3;
const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.035;
const GRAVITY = 22;
const MAX_FALL_SPEED = 18;
const MAX_DELTA = 0.05;
const WALK_SAMPLE_DISTANCE = 0.15;
const MAX_WALK_SLOPE = 0.95;
const WALK_SLOPE_EPSILON = 0.000001;
const WALKABLE_SEA_CLEARANCE = 0.08;
const POOL_WALK_CLEARANCE = 0.16;
const BOUNDS_PADDING = 0.35;
const MAX_FLIGHT_HEIGHT = 110;
const GAMEPAD_DEADZONE = 0.16;
const POOL_SAFE_LANDING_RADIUS = 14;

type SafeLanding = { x: number; z: number };

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
  private verticalVelocity = 0;
  private previousGamepadFlight = false;
  private pointerLockRequestPending = false;
  private inputSuspended = false;
  private disposed = false;

  constructor(camera: PerspectiveCamera, canvas: HTMLCanvasElement, callbacks: CoastControlCallbacks) {
    this.camera = camera;
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(0.055, SPAWN.yaw, 0);
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

    if (!this.flying) {
      this.moveToSafeLandingIfNeeded();
    }

    this.callbacks.onFlightChange(this.flying);
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

    this.updateWalking(input.forward, input.right, pace, delta);
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
    this.previousGamepadFlight = this.readGamepadFlightButton();
  };

  private readonly handleCanvasBlur = (): void => {
    if (document.pointerLockElement !== this.canvas) this.clearInput();
  };

  private readonly handleVisibilityChange = (): void => {
    this.inputSuspended = document.visibilityState === 'hidden' || !document.hasFocus();
    this.clearInput();
    if (!this.inputSuspended) this.previousGamepadFlight = this.readGamepadFlightButton();
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
    this.verticalVelocity = 0;
  }

  private readMovementInput(dt: number): { forward: number; right: number; vertical: number } {
    if (this.inputSuspended) {
      this.previousGamepadFlight = this.readGamepadFlightButton();
      return { forward: 0, right: 0, vertical: 0 };
    }

    let forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    let right = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    let vertical = (this.keys.has('Space') ? 1 : 0) - (this.keys.has('KeyC') ? 1 : 0);

    const gamepad = this.getStandardGamepad();
    if (!gamepad) {
      this.previousGamepadFlight = false;
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
    this.previousGamepadFlight = toggle;

    const lookX = this.applyDeadzone(this.readAxis(gamepad.axes[2]));
    const lookY = this.applyDeadzone(this.readAxis(gamepad.axes[3]));
    if (lookX !== 0 || lookY !== 0) {
      this.camera.rotation.y -= lookX * LOOK_SPEED * dt;
      this.camera.rotation.x = this.clampPitch(this.camera.rotation.x - lookY * LOOK_SPEED * dt);
    }

    return this.normalizePlanarInput(forward, right, vertical);
  }

  private readGamepadFlightButton(): boolean {
    const gamepad = this.getStandardGamepad();
    return gamepad ? this.readButton(gamepad, 3) : false;
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

  private updateWalking(forwardInput: number, rightInput: number, pace: number, dt: number): void {
    const yaw = this.camera.rotation.y;
    this.forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.movement.copy(this.forward).multiplyScalar(forwardInput)
      .addScaledVector(this.right, rightInput);

    if (this.movement.lengthSq() > 0) {
      this.movement.multiplyScalar(WALK_SPEED * pace * dt);
      this.moveOnWalkableGround(this.movement.x, this.movement.z);
    }

    const floorY = groundHeight(this.camera.position.x, this.camera.position.z) + EYE_HEIGHT;
    if (this.camera.position.y <= floorY) {
      this.camera.position.y = floorY;
      this.verticalVelocity = 0;
    } else {
      this.verticalVelocity = Math.max(-MAX_FALL_SPEED, this.verticalVelocity - GRAVITY * dt);
      this.camera.position.y = Math.max(floorY, this.camera.position.y + this.verticalVelocity * dt);
      if (this.camera.position.y <= floorY) this.verticalVelocity = 0;
    }
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
    const startX = this.camera.position.x;
    const startZ = this.camera.position.z;
    this.camera.position.add(this.movement);

    this.camera.position.x = this.clampX(this.camera.position.x);
    this.camera.position.z = this.clampZ(this.camera.position.z);
    const requestedY = this.camera.position.y;
    let safeFloor = this.flightFloorHeight(this.camera.position.x, this.camera.position.z);
    if ((this.camera.position.x !== startX || this.camera.position.z !== startZ) && requestedY < safeFloor) {
      this.camera.position.x = startX;
      this.camera.position.z = startZ;
      safeFloor = this.flightFloorHeight(startX, startZ);
    }
    this.camera.position.y = Math.max(safeFloor, Math.min(requestedY, MAX_FLIGHT_HEIGHT));
  }

  private moveOnWalkableGround(deltaX: number, deltaZ: number): void {
    const startX = this.camera.position.x;
    const startZ = this.camera.position.z;
    const candidateX = this.clampX(startX + deltaX);
    const candidateZ = this.clampZ(startZ + deltaZ);
    const actualDeltaX = candidateX - startX;
    const actualDeltaZ = candidateZ - startZ;
    const distance = Math.hypot(actualDeltaX, actualDeltaZ);
    if (distance === 0) return;

    const steps = Math.max(1, Math.ceil(distance / WALK_SAMPLE_DISTANCE));
    const allowedHeightDelta = distance / steps * (MAX_WALK_SLOPE + WALK_SLOPE_EPSILON);
    let lastX = startX;
    let lastZ = startZ;
    let lastHeight = groundHeight(startX, startZ);

    for (let step = 1; step <= steps; step += 1) {
      const fraction = step / steps;
      const x = startX + actualDeltaX * fraction;
      const z = startZ + actualDeltaZ * fraction;
      const height = groundHeight(x, z);
      if (!this.isWalkable(x, z, height) || Math.abs(height - lastHeight) > allowedHeightDelta) break;
      lastX = x;
      lastZ = z;
      lastHeight = height;
    }

    this.camera.position.x = lastX;
    this.camera.position.z = lastZ;
  }

  private isWalkable(x: number, z: number, terrain = groundHeight(x, z)): boolean {
    if (terrain < SEA_LEVEL + WALKABLE_SEA_CLEARANCE) return false;

    const poolRadius = Math.hypot((x - POOL.x) / POOL.radiusX, (z - POOL.z) / POOL.radiusZ);
    return poolRadius >= 1.22 || terrain >= POOL.y - POOL_WALK_CLEARANCE;
  }

  private flightFloorHeight(x: number, z: number): number {
    const terrainFloor = groundHeight(x, z) + 0.25;
    const seaFloor = SEA_LEVEL + 0.2;
    const poolRadius = Math.hypot((x - POOL.x) / POOL.radiusX, (z - POOL.z) / POOL.radiusZ);
    const poolFloor = poolRadius < 1.22 ? POOL.y + 0.25 : Number.NEGATIVE_INFINITY;
    return Math.max(terrainFloor, seaFloor, poolFloor);
  }

  private moveToSafeLandingIfNeeded(): void {
    const x = this.camera.position.x;
    const z = this.camera.position.z;
    if (!this.isWalkable(x, z)) {
      const landing = this.findNearestWalkablePoint(x, z);
      this.camera.position.x = landing.x;
      this.camera.position.z = landing.z;
    }

    const floorY = groundHeight(this.camera.position.x, this.camera.position.z) + EYE_HEIGHT;
    if (this.camera.position.y < floorY) this.camera.position.y = floorY;
  }

  private findNearestWalkablePoint(originX: number, originZ: number): SafeLanding {
    const angleCount = 16;
    const radiusStep = 0.5;
    for (let radius = radiusStep; radius <= POOL_SAFE_LANDING_RADIUS; radius += radiusStep) {
      for (let angleIndex = 0; angleIndex < angleCount; angleIndex += 1) {
        const angle = angleIndex * (Math.PI * 2 / angleCount);
        const x = this.clampX(originX + Math.cos(angle) * radius);
        const z = this.clampZ(originZ + Math.sin(angle) * radius);
        if (!this.isWalkable(x, z)) continue;
        return { x, z };
      }
    }

    return { x: SPAWN.x, z: SPAWN.z };
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
