import { Matrix4, Raycaster, Vector3, type Group } from 'three';
import type { DesktopGrabTarget, GrabOcclusion } from './DesktopGrab';
import { FloorGrabPosition } from './floorGrabPosition';

type FloorTarget = DesktopGrabTarget & {
  readonly xrGripAnchor: Vector3;
  readonly floorHeight: NonNullable<DesktopGrabTarget['floorHeight']>;
};

const AIM_HINT_INTERVAL_MS = 120;

function gripSpace(source: XRInputSource): XRSpace | undefined {
  if (source.hand || source.handedness === 'none' || source.targetRayMode !== 'tracked-pointer'
    || source.gamepad?.mapping !== 'xr-standard' || !source.gamepad.buttons[1]) return;
  return source.gripSpace;
}

function sourceConnected(source: XRInputSource, session: XRSession): boolean {
  for (const input of session.inputSources) {
    if (input === source) return true;
  }
  return false;
}

export class WorldXRGrab {
  private readonly pressed = new Set<XRInputSource>();
  private readonly floor = new FloorGrabPosition();
  private readonly ray = new Raycaster();
  private readonly rayPose = new Matrix4();
  private readonly position = new Vector3();
  private readonly gripOffset = new Vector3();
  private targets: readonly FloorTarget[] = [];
  private isOccluded?: GrabOcclusion;
  private held?: { target: FloorTarget; source: XRInputSource; space: XRSpace };
  private nextHintAt = 0;
  private aimLabel?: string;

  constructor(private readonly rig: Group) {}

  get isGrabbing(): boolean { return this.held !== undefined; }

  bind(targets?: readonly DesktopGrabTarget[], isOccluded?: GrabOcclusion): void {
    this.release();
    this.targets = targets?.filter((target): target is FloorTarget => Boolean(target.xrGripAnchor && target.floorHeight)) ?? [];
    this.isOccluded = isOccluded;
  }

  start({ inputSource, frame }: XRInputSourceEvent, reference: XRReferenceSpace | null): void {
    if (!this.targets.length || this.pressed.has(inputSource)) return;
    const space = gripSpace(inputSource);
    if (!space) return;
    this.pressed.add(inputSource);
    if (!reference || this.held || !sourceConnected(inputSource, frame.session)) return;
    const grip = frame.getPose(space, reference);
    if (!grip || grip.emulatedPosition) return;
    const target = this.pick(frame, reference, inputSource);
    if (!target) return;
    this.floor.begin(target);
    target.object.localToWorld(this.gripOffset.copy(target.xrGripAnchor)).sub(target.object.getWorldPosition(this.position));
    this.held = { target, source: inputSource, space };
    this.carry(target, grip);
  }

  end({ inputSource, frame }: XRInputSourceEvent, reference: XRReferenceSpace | null): void {
    this.pressed.delete(inputSource);
    if (this.held?.source !== inputSource) return;
    if (reference) this.updateHold(frame, reference);
    this.release();
  }

  removeSources(sources: readonly XRInputSource[]): void {
    for (const source of sources) {
      this.pressed.delete(source);
      if (this.held?.source === source) this.release();
    }
  }

  reset(): void {
    this.release();
    this.pressed.clear();
  }

  releaseUnavailable(): void {
    if (this.held && !this.held.target.available()) this.release();
    this.clearHint();
  }

  release(): void {
    if (this.held) this.floor.release(this.held.target);
    this.held = undefined;
    this.clearHint();
  }

  update(frame: XRFrame, reference: XRReferenceSpace): string | undefined {
    if (this.held) {
      this.updateHold(frame, reference);
      if (this.held) return `グリップを離す  ${this.held.target.label}を置く`;
    }
    if (!this.targets.length) return;
    const now = performance.now();
    if (now < this.nextHintAt) return this.aimLabel;
    this.nextHintAt = now + AIM_HINT_INTERVAL_MS;
    this.aimLabel = undefined;
    for (const source of frame.session.inputSources) {
      const space = gripSpace(source);
      if (!space || this.pressed.has(source)) continue;
      const target = this.pick(frame, reference, source);
      if (!target) continue;
      const grip = frame.getPose(space, reference);
      if (!grip || grip.emulatedPosition) continue;
      this.aimLabel = `グリップ  ${target.label}を掴む`;
      break;
    }
    return this.aimLabel;
  }

  private clearHint(): void {
    this.aimLabel = undefined;
    this.nextHintAt = 0;
  }

  private updateHold(frame: XRFrame, reference: XRReferenceSpace): void {
    const held = this.held!;
    if (held.target.available() && sourceConnected(held.source, frame.session)) {
      const grip = frame.getPose(held.space, reference);
      if (grip && !grip.emulatedPosition) {
        this.carry(held.target, grip);
        return;
      }
    }
    this.release();
  }

  private carry(target: FloorTarget, grip: XRPose): void {
    const { x, y, z } = grip.transform.position;
    this.position.set(x, y, z).applyMatrix4(this.rig.matrixWorld).sub(this.gripOffset);
    this.floor.carry(target, this.position);
  }

  private pick(frame: XRFrame, reference: XRReferenceSpace, source: XRInputSource): FloorTarget | undefined {
    if (!this.targets.some(target => target.available())) return;
    const aim = frame.getPose(source.targetRaySpace, reference);
    if (!aim || aim.emulatedPosition) return;
    this.rayPose.fromArray(aim.transform.matrix).premultiply(this.rig.matrixWorld);
    this.ray.ray.origin.setFromMatrixPosition(this.rayPose);
    this.ray.ray.direction.set(0, 0, -1).transformDirection(this.rayPose);
    let nearest: FloorTarget | undefined;
    let distance = Infinity;
    for (const target of this.targets) {
      if (!target.available()) continue;
      const hit = target.hitDistance(this.ray);
      if (hit === undefined || hit <= 0 || hit > target.reach || hit >= distance) continue;
      nearest = target;
      distance = hit;
    }
    return nearest && !this.isOccluded?.(this.ray, nearest.object, distance) ? nearest : undefined;
  }
}
