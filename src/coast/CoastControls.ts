import { Vector3, type PerspectiveCamera } from 'three';
import { COAST_BOUNDS, coastWaterLevel, groundHeight, smoothstep, SPAWN } from './terrain';

export type CoastMovement = 'walk' | 'crouch' | 'wade' | 'swim' | 'dive' | 'flight';

type DivePhase = 'entering' | 'submerged' | 'surfacing';

interface PlanarInput {
  readonly forward: number;
  readonly right: number;
  readonly vertical: number;
}

interface XRView {
  readonly yaw: number;
  readonly headOffset: Vector3;
}

export interface CoastXRMovement extends PlanarInput {
  readonly jump: boolean;
  readonly dive: boolean;
  readonly flight: boolean;
}

export interface CoastControlCallbacks {
  onMovementChange: (movement: CoastMovement) => void;
  onLockChange: (locked: boolean) => void;
  onLockError: () => void;
  // Returning true consumes F before the flight toggle.
  onGrabKey?: () => boolean;
  diveObstacleHeight?: (x: number, z: number) => number | undefined;
}

export interface CoastPose {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly seatedEyeHeight?: number;
  readonly floorY?: number;
}

export interface CoastNavigation {
  readonly bounds: typeof COAST_BOUNDS;
  readonly spawn: CoastPose;
  readonly groundHeight: (x: number, z: number) => number;
  readonly supportAt?: (x: number, z: number, footLimit: number) => number;
  readonly waterLevel?: (x: number, z: number) => number;
  readonly blocksWalking?: (x: number, z: number, foot: number, previousFoot?: number) => boolean;
  // eyeY is the camera/head centre; clearance is its radius in world metres.
  readonly blocksFlight?: (x: number, z: number, eyeY: number, clearance: number) => boolean;
  readonly allowFlight?: boolean;
  readonly flightCeiling: number;
  readonly ceilingHeight?: (x: number, z: number, foot: number) => number;
  readonly walkSpeed?: number;
}

export const EYE_HEIGHT = 1.65;
const CROUCH_EYE_HEIGHT = 1.15;
const WALK_SPEED = 6.4;
const SWIM_SPEED = 4.1;
const WADE_DEPTH = 0.08;
const SWIM_DEPTH = 1.02;
const DIVE_SPEED = 3.6;
const DIVE_VERTICAL_SPEED = 3.0;
const DIVE_ENTRY_DEPTH = 0.72;
const DIVE_START_DEPTH = 1.55;
const DIVE_EXIT_DEPTH = 1.15;
const DIVE_FLOOR_CLEARANCE = 0.68;
const DIVE_SURFACE_CLEARANCE = 0.16;
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
const CAMERA_SURFACE_CLEARANCE = 0.25;
const MAX_WALK_SLOPE = 0.95;
const WALK_SLOPE_EPSILON = 0.000001;
const BOUNDS_PADDING = 0.35;
const MAX_FLIGHT_HEIGHT = 255;
const GAMEPAD_DEADZONE = 0.16;
const XR_WALK_SPEED = 2.7;
const XR_FLIGHT_SPEED = 6;

const coastNavigation: CoastNavigation = {
  bounds: COAST_BOUNDS, spawn: SPAWN, groundHeight, waterLevel: coastWaterLevel,
  flightCeiling: MAX_FLIGHT_HEIGHT,
};

export function groundEyeHeight(movement: CoastMovement): number {
  return movement === 'crouch' ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
}

export class CoastControls {
  private readonly camera: PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: CoastControlCallbacks;
  private readonly navigation: CoastNavigation;
  private readonly keys = new Set<string>();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly movement = new Vector3();
  private readonly viewDirection = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private flying = false;
  private divePhase: DivePhase | null = null;
  private posture: 'walk' | 'crouch' = 'walk';
  private crouchEyeHeight = CROUCH_EYE_HEIGHT;
  private movementMode: CoastMovement = 'walk';
  private verticalVelocity = 0;
  private jumpQueued = false;
  private diveQueued = false;
  private crouchQueued = false;
  private previousGamepadFlight = false;
  private previousGamepadJump = false;
  private previousGamepadDive = false;
  private pointerLockRequestPending = false;
  private desktopInputEnabled = true;
  private disposed = false;

  constructor(camera: PerspectiveCamera, canvas: HTMLCanvasElement, callbacks: CoastControlCallbacks,
    navigation: CoastNavigation = coastNavigation) {
    this.camera = camera;
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.navigation = navigation;

    this.camera.rotation.order = 'YXZ';
    this.placeCamera(navigation.spawn);
    this.updateMovementMode();

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('focus', this.handleFocusChange);
    document.addEventListener('visibilitychange', this.handleFocusChange);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', this.handlePointerLockError);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('blur', this.handleCanvasBlur);
    this.callbacks.onLockChange(document.pointerLockElement === this.canvas);
  }

  get currentMovement(): CoastMovement {
    return this.movementMode;
  }

  get eyeHeight(): number {
    return this.posture === 'crouch' ? this.crouchEyeHeight : EYE_HEIGHT;
  }

  get isGrounded(): boolean {
    const { x, y, z } = this.camera.position;
    return !this.flying && this.divePhase === null && this.verticalVelocity <= 0
      && y - this.eyeHeight <= this.supportHeight(x, z, y - this.eyeHeight + FOOT_CLEARANCE) + FOOT_CLEARANCE;
  }

  get canUseSceneShortcuts(): boolean {
    const active = document.activeElement;
    return this.canUseSceneInput() && !this.isInteractiveTarget(active) && this.hasSceneFocus(active);
  }

  relocate(pose: CoastPose): void {
    if (this.disposed) return;
    this.clearInput();
    this.syncGamepadButtons();
    this.flying = false;
    this.divePhase = null;
    this.verticalVelocity = 0;
    this.placeCamera(pose);
    this.updateMovementMode();
  }

  private placeCamera(pose: CoastPose): void {
    const x = this.clampX(pose.x);
    const z = this.clampZ(pose.z);
    this.posture = pose.seatedEyeHeight === undefined ? 'walk' : 'crouch';
    this.crouchEyeHeight = pose.seatedEyeHeight ?? CROUCH_EYE_HEIGHT;
    this.camera.position.set(x, this.supportHeight(x, z, (pose.floorY ?? 0) + FOOT_CLEARANCE) + this.eyeHeight, z);
    this.camera.rotation.set(this.clampPitch(pose.pitch), pose.yaw, 0);
  }

  releaseInput(): void {
    this.clearInput();
    this.syncGamepadButtons();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  toggleFlight(): void {
    if (this.disposed || this.navigation.allowFlight === false) return;

    this.flying = !this.flying;
    this.setPosture('walk');
    this.verticalVelocity = 0;
    this.jumpQueued = false;
    this.diveQueued = false;
    this.crouchQueued = false;

    if (this.divePhase !== null) {
      const { x, z } = this.camera.position;
      this.camera.position.y = Math.max(this.camera.position.y, this.flightFloorHeight(x, z));
      this.divePhase = null;
    } else if (!this.flying) {
      const floor = this.supportHeight(this.camera.position.x, this.camera.position.z) + EYE_HEIGHT;
      this.camera.position.y = Math.max(this.camera.position.y, floor);
    }
    this.updateMovementMode();
  }

  setDesktopInputEnabled(enabled: boolean): void {
    this.desktopInputEnabled = enabled;
    this.releaseInput();
  }

  requestLock(): void {
    if (!this.desktopInputEnabled || this.disposed || this.pointerLockRequestPending || document.pointerLockElement === this.canvas) return;

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
    if (!this.canUseSceneInput()) {
      this.syncGamepadButtons();
      return;
    }

    const delta = this.frameDelta(dt);
    const input = this.readMovementInput(delta);
    if (delta === 0) return;
    const pace = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? SPRINT_MULTIPLIER : 1;
    this.advance(input, pace, delta);
  }

  updateXR(dt: number, input: CoastXRMovement, view: XRView): void {
    if (this.disposed) return;
    const delta = this.frameDelta(dt);
    if (input.flight) this.toggleFlight();
    if (input.jump && !this.flying) this.jumpQueued = true;
    if (input.dive && !this.flying) this.diveQueued = true;
    if (delta > 0) this.advance(this.normalizePlanarInput(input.forward, input.right, input.vertical), 1, delta, view);
  }

  alignDesktopView(yaw: number, pitch: number): void {
    this.camera.rotation.set(this.clampPitch(pitch), yaw, 0);
  }

  private frameDelta(dt: number): number {
    return Number.isFinite(dt) ? Math.max(0, Math.min(dt, MAX_DELTA)) : 0;
  }

  private advance(input: PlanarInput, pace: number, delta: number, view?: XRView): void {
    const offset = view && view.headOffset.lengthSq() > 0.000001 ? view.headOffset : undefined;
    if (this.flying) {
      this.updateFlight(input, pace, delta, view?.yaw, offset);
      return;
    }

    if (this.divePhase === null && this.diveQueued && input.vertical <= 0) {
      const { x, y, z } = this.camera.position;
      const water = this.waterLevel(x, z);
      const ground = this.navigation.groundHeight(x, z);
      if (water - ground >= DIVE_START_DEPTH && y <= water + EYE_HEIGHT - SWIM_DEPTH + FOOT_CLEARANCE
        && this.diveFloorY(x, z, ground) <= water - DIVE_SURFACE_CLEARANCE) {
        this.divePhase = 'entering';
        this.verticalVelocity = 0;
      }
    }
    this.setPlanarMovement(input.forward, input.right, view?.yaw);
    if (this.divePhase !== null) this.updateDive(input.vertical, delta, offset);
    else this.updateGroundMovement(pace, delta, Boolean(view), offset);
    this.diveQueued = false;
    this.crouchQueued = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearInput();

    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('focus', this.handleFocusChange);
    document.removeEventListener('visibilitychange', this.handleFocusChange);
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
    if (!this.canUseSceneKeyboard(event)) return;
    if (event.code === 'KeyC' && (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey)) return;

    if (this.isControlKey(event.code)) {
      event.preventDefault();
      if (event.code === 'Space' && !event.repeat && !this.keys.has('Space') && !this.flying) {
        this.jumpQueued = true;
      }
      if (event.code === 'KeyC' && !event.repeat && !this.keys.has('KeyC') && !this.flying) {
        this.diveQueued = true;
        this.crouchQueued = !this.crouchQueued;
      }
      this.keys.add(event.code);
    }

    if (event.code === 'KeyF' && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!event.repeat && !this.callbacks.onGrabKey?.()) this.toggleFlight();
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
    this.clearInput();
  };

  private readonly handleFocusChange = (): void => {
    this.clearInput();
    this.syncGamepadButtons();
  };

  private readonly handleCanvasBlur = (): void => {
    if (document.pointerLockElement !== this.canvas) this.clearInput();
  };

  private reportPointerLockError(): void {
    if (!this.pointerLockRequestPending) return;
    this.pointerLockRequestPending = false;
    this.callbacks.onLockError();
  }

  private canUseSceneInput(): boolean {
    return this.desktopInputEnabled && document.visibilityState !== 'hidden' && document.hasFocus();
  }

  private canUseSceneKeyboard(event: KeyboardEvent): boolean {
    if (!this.canUseSceneInput()) return false;
    const { target } = event;
    const active = document.activeElement;
    if (target instanceof Element && target === active
      && target.closest('.coast-ui :is(button[type="button"], summary, input[type="range"])')
      && !target.closest('dialog')) {
      return !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey
        && (this.isPlanarControlKey(event.code) || (event.code === 'KeyC' && this.movementMode === this.posture));
    }
    if (this.isInteractiveTarget(target)) return false;
    return this.hasSceneFocus(active);
  }

  private hasSceneFocus(active: Element | null): boolean {
    return active === this.canvas || active === document.body || document.pointerLockElement === this.canvas;
  }

  private isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return target.closest(
      'button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="textbox"]'
    ) !== null;
  }

  private isControlKey(code: string): boolean {
    return this.isPlanarControlKey(code) || code === 'Space' || code === 'KeyC';
  }

  private isPlanarControlKey(code: string): boolean {
    return code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD'
      || code === 'ShiftLeft' || code === 'ShiftRight';
  }

  private clearInput(): void {
    this.keys.clear();
    this.jumpQueued = false;
    this.diveQueued = false;
    this.crouchQueued = false;
  }

  private readMovementInput(dt: number): { forward: number; right: number; vertical: number } {
    let forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    let right = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    let vertical = (this.keys.has('Space') ? 1 : 0) - (this.keys.has('KeyC') ? 1 : 0);

    const gamepad = this.getStandardGamepad();
    if (!gamepad) {
      this.previousGamepadFlight = false;
      this.previousGamepadJump = false;
      this.previousGamepadDive = false;
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
    if (descend && !this.previousGamepadDive && !this.flying) this.diveQueued = true;
    this.previousGamepadFlight = toggle;
    this.previousGamepadJump = ascend;
    this.previousGamepadDive = descend;

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
    this.previousGamepadDive = gamepad !== null && this.readButton(gamepad, 1);
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

  private setPlanarMovement(forwardInput: number, rightInput: number, yaw = this.camera.rotation.y): void {
    this.forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.movement.copy(this.forward).multiplyScalar(forwardInput)
      .addScaledVector(this.right, rightInput);
  }

  private updateGroundMovement(pace: number, dt: number, immersive: boolean, offset?: Vector3): void {
    const position = this.camera.position;
    const foot = position.y - this.eyeHeight;
    const depth = this.waterLevel(position.x, position.z) - this.navigation.groundHeight(position.x, position.z);
    const onSupport = this.isGrounded;
    if (this.crouchQueued && onSupport && depth <= WADE_DEPTH) {
      this.setPosture(this.posture === 'walk' ? 'crouch' : 'walk');
    }
    const jumping = this.jumpQueued && onSupport && depth < SWIM_DEPTH;
    this.jumpQueued = false;
    const fallSpeed = jumping ? JUMP_SPEED : this.verticalVelocity;
    const nextVelocity = Math.max(-MAX_FALL_SPEED, fallSpeed - GRAVITY * dt);
    const verticalStep = Math.min(nextVelocity * dt, this.ceilingY(position.x, position.z) - position.y);

    let followedFloor = onSupport && !jumping
      ? this.supportHeight(position.x, position.z, foot + FOOT_CLEARANCE) : undefined;
    if (this.movement.lengthSq() > 0) {
      const water = smoothstep(0.12, SWIM_DEPTH, depth);
      const walkSpeed = this.navigation.walkSpeed ?? WALK_SPEED;
      const normalSpeed = walkSpeed * pace * (1 - water) + SWIM_SPEED * water;
      const speed = immersive ? Math.min(normalSpeed, XR_WALK_SPEED) : normalSpeed;
      this.movement.multiplyScalar(speed * dt);
      followedFloor = this.moveAlongSupport(this.movement.x, this.movement.z, foot, verticalStep, followedFloor, offset);
    }

    const support = followedFloor ?? this.supportHeight(position.x, position.z, foot + FOOT_CLEARANCE);
    const floorY = support + this.eyeHeight;
    const ceilingY = this.ceilingY(position.x, position.z, support);
    const targetY = followedFloor !== undefined ? floorY : Math.max(floorY, Math.min(ceilingY, position.y + verticalStep));
    // Support changes have already been checked at each horizontal step, including its height.
    position.y = followedFloor !== undefined ? targetY : this.limitHeadY(position, targetY, offset);
    const hitCeiling = nextVelocity > 0 && (position.y >= ceilingY || position.y < targetY);
    this.verticalVelocity = position.y > floorY && !hitCeiling ? nextVelocity : 0;
    if (this.posture === 'crouch'
      && this.waterLevel(position.x, position.z) - this.navigation.groundHeight(position.x, position.z) > WADE_DEPTH) {
      this.setPosture('walk');
    }
    this.updateMovementMode();
  }

  private setPosture(posture: 'walk' | 'crouch'): void {
    if (posture === this.posture) return;
    const foot = this.camera.position.y - this.eyeHeight;
    this.posture = posture;
    const { x, z } = this.camera.position;
    this.camera.position.y = Math.min(this.ceilingY(x, z), foot + this.eyeHeight);
  }

  private updateDive(verticalInput: number, dt: number, offset?: Vector3): void {
    const position = this.camera.position;
    const { x, z } = position;
    const water = this.waterLevel(x, z);
    const ground = this.navigation.groundHeight(x, z);
    const floor = this.diveFloorY(x, z, ground);
    const ceiling = water - DIVE_SURFACE_CLEARANCE;
    const step = DIVE_VERTICAL_SPEED * dt;
    if (this.jumpQueued || verticalInput > 0 || water - ground < DIVE_EXIT_DEPTH || floor > ceiling) {
      this.divePhase = 'surfacing';
    } else if (this.divePhase === 'surfacing' && this.diveQueued && water - ground >= DIVE_START_DEPTH) {
      this.divePhase = 'entering';
    }
    this.jumpQueued = false;

    if (this.divePhase === 'surfacing') {
      const swimY = Math.max(ground, water - SWIM_DEPTH) + EYE_HEIGHT;
      position.y = this.limitHeadY(position, Math.min(swimY, Math.max(floor, position.y + step)), offset);
    } else {
      // Finish the initial dip even for a tap, then keep the chosen depth on release.
      const entryY = Math.max(floor, water - DIVE_ENTRY_DEPTH);
      const holdY = this.divePhase === 'entering' ? entryY : ceiling;
      const target = verticalInput < 0 ? floor : Math.min(holdY, position.y);
      position.y = this.limitHeadY(position, Math.max(floor, target, position.y - step), offset);
      if (position.y <= entryY) this.divePhase = 'submerged';
    }

    this.movement.multiplyScalar(DIVE_SPEED * dt);
    this.moveAlongDiveFloor(this.movement.x, this.movement.z, offset);
    if (this.divePhase === 'surfacing' && position.y >= this.supportHeight(position.x, position.z) + EYE_HEIGHT) {
      this.divePhase = null;
    }
    this.updateMovementMode();
  }

  private moveAlongDiveFloor(deltaX: number, deltaZ: number, offset?: Vector3): void {
    const position = this.camera.position;
    const steps = Math.ceil(Math.hypot(deltaX, deltaZ) / WALK_SAMPLE_DISTANCE);
    if (steps === 0) return;
    const dx = deltaX / steps;
    const dz = deltaZ / steps;
    const advance = (stepX: number, stepZ: number): boolean => {
      const x = this.clampX(position.x + stepX);
      const z = this.clampZ(position.z + stepZ);
      const distance = Math.hypot(x - position.x, z - position.z);
      if (distance === 0) return false;
      const ground = this.navigation.groundHeight(x, z);
      const water = this.waterLevel(x, z);
      if (water - ground <= WADE_DEPTH) return false;
      const floor = this.diveFloorY(x, z, ground);
      if ((this.divePhase !== 'surfacing' && floor > water - DIVE_SURFACE_CLEARANCE)
        || floor > position.y + distance * (MAX_WALK_SLOPE + WALK_SLOPE_EPSILON)) return false;
      const y = Math.max(position.y, floor);
      if (!this.headCanFollow(position.x, position.y, position.z, x, y, z, offset)) return false;
      position.set(x, y, z);
      return true;
    };

    for (let step = 0; step < steps; step += 1) {
      if (advance(dx, dz)) continue;
      const slide = Math.abs(dx) >= Math.abs(dz)
        ? advance(dx, 0) || advance(0, dz)
        : advance(0, dz) || advance(dx, 0);
      if (!slide) break;
    }
  }

  private updateFlight(input: PlanarInput, pace: number, dt: number, headYaw?: number, offset?: Vector3): void {
    if (headYaw === undefined) {
      this.camera.getWorldDirection(this.viewDirection);
      const yaw = this.camera.rotation.y;
      this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      this.movement.copy(this.viewDirection).multiplyScalar(input.forward).addScaledVector(this.right, input.right);
    } else {
      this.setPlanarMovement(input.forward, input.right, headYaw);
    }
    this.movement.addScaledVector(this.up, input.vertical);

    if (this.movement.lengthSq() > 1) this.movement.normalize();
    const speed = headYaw === undefined ? FLIGHT_SPEED : XR_FLIGHT_SPEED;
    this.movement.multiplyScalar(speed * pace * dt);
    const { x, y, z } = this.camera.position;
    const targetX = this.clampX(x + this.movement.x);
    const targetZ = this.clampZ(z + this.movement.z);
    const indoor = this.navigation.ceilingHeight !== undefined;
    const ceiling = Math.min(this.navigation.flightCeiling, this.ceilingY(x, z));
    const floor = indoor ? this.flightFloorHeight(x, z) : -Infinity;
    const targetY = this.limitHeadY(this.camera.position, Math.min(ceiling, Math.max(floor, y + this.movement.y)), offset);
    const sampleDistance = indoor ? WALK_SAMPLE_DISTANCE : FLIGHT_SAMPLE_DISTANCE;
    const steps = Math.max(1, Math.ceil(Math.hypot(targetX - x, targetY - y, targetZ - z) / sampleDistance));
    let previousX = x, previousY = y, previousZ = z;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const sampleX = x + (targetX - x) * t, sampleZ = z + (targetZ - z) * t;
      const sampleY = y + (targetY - y) * t;
      const blocked = this.navigation.blocksFlight
        ? this.navigation.blocksFlight(sampleX, sampleZ, sampleY, CAMERA_SURFACE_CLEARANCE)
        : this.navigation.blocksWalking?.(sampleX, sampleZ, sampleY - CAMERA_SURFACE_CLEARANCE);
      if (blocked || sampleY < this.flightFloorHeight(sampleX, sampleZ) || sampleY > this.ceilingY(sampleX, sampleZ)
        || !this.headCanFollow(previousX, previousY, previousZ, sampleX, sampleY, sampleZ, offset)) {
        break;
      }
      previousX = sampleX;
      previousY = sampleY;
      previousZ = sampleZ;
    }
    this.camera.position.set(previousX, previousY, previousZ);
  }

  private moveAlongSupport(
    deltaX: number, deltaZ: number, foot: number, verticalStep: number, followedFloor: number | undefined, offset?: Vector3
  ): number | undefined {
    const position = this.camera.position;
    const steps = Math.max(1, Math.ceil(Math.hypot(deltaX, deltaZ) / WALK_SAMPLE_DISTANCE));
    const dx = deltaX / steps;
    const dz = deltaZ / steps;
    let support = followedFloor ?? this.supportHeight(position.x, position.z, foot + FOOT_CLEARANCE);
    let followSupport = followedFloor !== undefined;

    const advance = (stepX: number, stepZ: number, footAtStep: number): boolean => {
      const x = this.clampX(position.x + stepX);
      const z = this.clampZ(position.z + stepZ);
      const distance = Math.hypot(x - position.x, z - position.z);
      if (distance === 0) return false;
      const walkableRise = distance * (MAX_WALK_SLOPE + WALK_SLOPE_EPSILON);
      const previousFoot = followSupport ? support : footAtStep;
      const height = this.supportHeight(x, z, followSupport ? support + walkableRise : footAtStep + FOOT_CLEARANCE);
      const nextFoot = followSupport ? height : footAtStep;
      if (this.navigation.blocksWalking?.(x, z, nextFoot, previousFoot)
        || nextFoot + this.eyeHeight > this.ceilingY(x, z, height)) return false;
      const rise = height - support;
      if (followSupport ? rise > walkableRise : height > footAtStep + FOOT_CLEARANCE) return false;
      if (!this.headCanFollow(position.x, previousFoot + this.eyeHeight, position.z,
        x, nextFoot + this.eyeHeight, z, offset)) return false;
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
    return followSupport ? support : undefined;
  }

  private headCanFollow(x: number, y: number, z: number,
    nextX: number, nextY: number, nextZ: number, offset?: Vector3): boolean {
    if (!offset || !this.headBlocked(nextX + offset.x, nextY + offset.y, nextZ + offset.z)) return true;
    // During overlap, a retreat on one axis cannot offset advancing into clearance on the other.
    const xAlongHeadOffset = (nextX - x) * offset.x;
    const yAlongHeadOffset = this.flying ? (nextY - y) * offset.y : 0;
    const zAlongHeadOffset = (nextZ - z) * offset.z;
    const retreating = xAlongHeadOffset <= 0 && yAlongHeadOffset <= 0 && zAlongHeadOffset <= 0
      && (xAlongHeadOffset < 0 || yAlongHeadOffset < 0 || zAlongHeadOffset < 0);
    return retreating && this.headBlocked(x + offset.x, y + offset.y, z + offset.z);
  }

  private headBlocked(x: number, y: number, z: number): boolean {
    const foot = y - CAMERA_SURFACE_CLEARANCE;
    const blocked = this.flying && this.navigation.blocksFlight
      ? this.navigation.blocksFlight(x, z, y, CAMERA_SURFACE_CLEARANCE)
      : this.navigation.blocksWalking?.(x, z, foot) === true;
    return this.clampX(x) !== x || this.clampZ(z) !== z || foot < this.navigation.groundHeight(x, z)
      || y > this.ceilingY(x, z) || blocked;
  }

  private limitHeadY(position: Vector3, targetY: number, offset?: Vector3): number {
    if (!offset || targetY === position.y) return targetY;
    const x = position.x + offset.x, z = position.z + offset.z;
    if (targetY > position.y) return Math.min(targetY, Math.max(position.y, this.ceilingY(x, z) - offset.y));
    const floor = this.navigation.groundHeight(x, z) + CAMERA_SURFACE_CLEARANCE - offset.y;
    return Math.max(targetY, Math.min(position.y, floor));
  }

  private supportHeight(x: number, z: number, footLimit = this.camera.position.y - this.eyeHeight + FOOT_CLEARANCE): number {
    const ground = this.navigation.supportAt?.(x, z, footLimit) ?? this.navigation.groundHeight(x, z);
    return Math.max(ground, this.waterLevel(x, z) - SWIM_DEPTH);
  }

  private flightFloorHeight(x: number, z: number): number {
    return Math.max(this.navigation.groundHeight(x, z), this.waterLevel(x, z)) + CAMERA_SURFACE_CLEARANCE;
  }

  private ceilingY(x: number, z: number, foot = this.camera.position.y - this.eyeHeight): number {
    return (this.navigation.ceilingHeight?.(x, z, foot) ?? Infinity) - CAMERA_SURFACE_CLEARANCE;
  }

  private waterLevel(x: number, z: number): number {
    return this.navigation.waterLevel?.(x, z) ?? -Infinity;
  }

  private diveFloorY(x: number, z: number, ground: number): number {
    return Math.max(ground, this.callbacks.diveObstacleHeight?.(x, z) ?? ground) + DIVE_FLOOR_CLEARANCE;
  }

  private updateMovementMode(): void {
    const { x, y, z } = this.camera.position;
    const water = this.waterLevel(x, z);
    const depth = water - this.navigation.groundHeight(x, z);
    let mode: CoastMovement = this.posture;
    if (this.flying) mode = 'flight';
    else if (this.divePhase !== null) mode = 'dive';
    else if (y <= water + EYE_HEIGHT + 0.03) {
      if (depth >= SWIM_DEPTH) mode = 'swim';
      else if (depth > WADE_DEPTH) mode = 'wade';
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
    const { minX, maxX } = this.navigation.bounds;
    return Math.max(minX + BOUNDS_PADDING, Math.min(x, maxX - BOUNDS_PADDING));
  }

  private clampZ(z: number): number {
    const { minZ, maxZ } = this.navigation.bounds;
    return Math.max(minZ + BOUNDS_PADDING, Math.min(z, maxZ - BOUNDS_PADDING));
  }

  private clampPitch(pitch: number): number {
    return Math.max(-PITCH_LIMIT, Math.min(pitch, PITCH_LIMIT));
  }
}
