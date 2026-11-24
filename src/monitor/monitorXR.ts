import {
  BufferGeometry, CanvasTexture, Group, Line, LineBasicMaterial, MathUtils, Matrix4,
  Quaternion, Raycaster, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, type WebXRManager,
} from 'three';
import { MONITOR_MAX_SCALE, MONITOR_MIN_SCALE, type MonitorObject } from './monitorObject';

const PINCH_CLOSE = 0.018;
const PINCH_OPEN = 0.028;
const MIN_TWO_HAND_SPAN = 0.08;
const DIRECT_REACH = 0.15;

interface Input {
  source: XRInputSource;
  beam: Line<BufferGeometry, LineBasicMaterial>;
  position: Vector3;
  rotation: Quaternion;
  pressed: boolean;
  pending: boolean;
  tracked: boolean;
}

interface Grab {
  position: Vector3;
  rotation: Quaternion;
  scale: number;
  anchor: Vector3;
  orientation: Quaternion;
  axis: Vector3;
  span: number;
}

function positionOf(pose: XRPose, out: Vector3): Vector3 {
  const { x, y, z } = pose.transform.position;
  return out.set(x, y, z);
}

function rotationOf(pose: XRPose, out: Quaternion): Quaternion {
  const { x, y, z, w } = pose.transform.orientation;
  return out.set(x, y, z, w);
}

function createGuide() {
  const canvas = document.createElement('canvas');
  canvas.width = 896;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({ map: texture, toneMapped: false });
  const sprite = new Sprite(material);
  sprite.name = 'monitor-xr-guide';
  sprite.scale.set(1.68, 0.18, 1);
  return { canvas, context, texture, material, sprite, message: '' };
}

export class MonitorXR {
  private readonly xr: WebXRManager;
  private readonly rig: Group;
  private readonly monitor: Pick<MonitorObject, 'group' | 'intersect'>;
  private readonly inputs = new Map<XRInputSource, Input>();
  private readonly holders: Input[] = [];
  private readonly beamGeometry = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
  private readonly beamMaterial = new LineBasicMaterial({ color: 0x9cc3da, transparent: true, opacity: 0.52 });
  private readonly targetMaterial = new LineBasicMaterial({ color: 0x70fff0 });
  private readonly ray = new Raycaster();
  private readonly toParent = new Matrix4();
  private readonly parentInverse = new Matrix4();
  private readonly rigRotation = new Quaternion();
  private readonly parentRotation = new Quaternion();
  private readonly tempRotation = new Quaternion();
  private readonly deltaRotation = new Quaternion();
  private readonly tempPosition = new Vector3();
  private readonly thumbPosition = new Vector3();
  private readonly anchor = new Vector3();
  private readonly axis = new Vector3();
  private readonly direction = new Vector3();
  private guide: ReturnType<typeof createGuide> = null;
  private grab: Grab | null = null;
  private session: XRSession | null = null;
  constructor(
    xr: WebXRManager,
    rig: Group,
    monitor: Pick<MonitorObject, 'group' | 'intersect'>,
  ) {
    this.xr = xr;
    this.rig = rig;
    this.monitor = monitor;
  }

  get isGrabbing(): boolean { return this.holders.length > 0; }

  setSession(session: XRSession | null): void {
    if (this.session === session) return;
    this.clearSession();
    this.session = session;
    if (!session) return;
    session.addEventListener('squeezestart', this.onSqueezeStart);
    session.addEventListener('squeezeend', this.onSqueezeEnd);
    session.addEventListener('inputsourceschange', this.onSourcesChange);
    session.addEventListener('visibilitychange', this.onVisibilityChange);
    for (const source of session.inputSources) this.addInput(source);
  }

  update(frame?: XRFrame): string | undefined {
    if (!frame || frame.session !== this.session) return;
    if (frame.session.visibilityState !== 'visible') return;
    const reference = this.xr.getReferenceSpace();
    if (!reference) return;

    this.rig.updateWorldMatrix(true, false);
    this.rig.getWorldQuaternion(this.rigRotation);
    this.toParent.copy(this.rig.matrixWorld);
    this.parentRotation.copy(this.rigRotation);
    const parent = this.monitor.group.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      this.toParent.premultiply(this.parentInverse.copy(parent.matrixWorld).invert());
      parent.getWorldQuaternion(this.tempRotation).invert();
      this.parentRotation.premultiply(this.tempRotation);
    }

    let hands = 0;
    let controllers = 0;
    for (const input of this.inputs.values()) {
      this.sampleInput(frame, reference, input);
      if (input.tracked && input.source.hand) ++hands;
      else if (input.tracked) ++controllers;
    }
    if (!this.monitor.group.visible) this.release();
    if (this.holders.length) {
      if (this.grab) this.applyGrab();
      else this.captureGrab();
    }
    for (const input of this.inputs.values()) this.updatePointer(frame, reference, input);

    const grip = controllers ? 'グリップで掴む' : '';
    const pinch = hands ? '親指と人差し指でつまむ' : '';
    const message = [grip, pinch, hands + controllers >= 2 ? '両手を広げて拡大' : ''].filter(Boolean).join(' ・ ')
      || 'モニター操作用のVR入力を追跡できません。';
    this.updateGuide(message);
    return message;
  }

  release(): void {
    this.holders.length = 0;
    this.grab = null;
    for (const input of this.inputs.values()) {
      input.pending = false;
      input.beam.visible = false;
    }
  }

  dispose(): void {
    this.clearSession();
    this.beamGeometry.dispose();
    this.beamMaterial.dispose();
    this.targetMaterial.dispose();
    this.guide?.sprite.removeFromParent();
    this.guide?.material.dispose();
    this.guide?.texture.dispose();
  }

  private readonly onSqueezeStart = (event: XRInputSourceEvent): void => {
    const input = this.inputs.get(event.inputSource);
    if (this.session?.visibilityState !== 'visible' || !this.monitor.group.visible
      || !input || input.source.hand || input.pressed) return;
    input.pressed = true;
    input.pending = true;
  };

  private readonly onSqueezeEnd = (event: XRInputSourceEvent): void => {
    const input = this.inputs.get(event.inputSource);
    if (!input || input.source.hand) return;
    input.pending = false;
    input.pressed = false;
    this.drop(input);
  };

  private readonly onSourcesChange = (event: XRInputSourcesChangeEvent): void => {
    for (const source of event.removed) this.removeInput(source);
    for (const source of event.added) this.addInput(source);
  };

  private readonly onVisibilityChange = (): void => {
    if (this.session?.visibilityState === 'visible') return;
    this.release();
    for (const input of this.inputs.values()) input.pressed = Boolean(input.source.hand);
  };

  private clearSession(): void {
    this.session?.removeEventListener('squeezestart', this.onSqueezeStart);
    this.session?.removeEventListener('squeezeend', this.onSqueezeEnd);
    this.session?.removeEventListener('inputsourceschange', this.onSourcesChange);
    this.session?.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.session = null;
    for (const source of this.inputs.keys()) this.removeInput(source);
    this.release();
    if (this.guide) this.guide.sprite.visible = false;
  }

  private addInput(source: XRInputSource): void {
    if (this.inputs.has(source) || source.targetRayMode !== 'tracked-pointer' || (!source.hand && !source.gripSpace)) return;
    if (!source.hand && source.gamepad?.mapping === 'xr-standard' && !source.gamepad.buttons[1]) return;
    const beam = new Line(this.beamGeometry, this.beamMaterial);
    beam.visible = false;
    beam.frustumCulled = false;
    this.rig.add(beam);
    this.inputs.set(source, {
      source, beam, position: new Vector3(), rotation: new Quaternion(),
      pressed: Boolean(source.hand), pending: false, tracked: false,
    });
  }

  private removeInput(source: XRInputSource): void {
    const input = this.inputs.get(source);
    if (!input) return;
    input.beam.removeFromParent();
    this.drop(input);
    this.inputs.delete(source);
  }

  private drop(input: Input): void {
    const index = this.holders.indexOf(input);
    if (index < 0) return;
    this.holders.splice(index, 1);
    this.grab = null;
  }

  private sampleInput(frame: XRFrame, reference: XRReferenceSpace, input: Input): void {
    const { hand, gripSpace } = input.source;
    input.tracked = hand ? this.sampleHand(frame, reference, input, hand) : false;
    if (!hand && gripSpace) {
      const grip = frame.getPose(gripSpace, reference);
      if (grip && !grip.emulatedPosition) {
        positionOf(grip, input.position);
        rotationOf(grip, input.rotation);
        input.tracked = true;
      }
    }
    if (input.tracked) {
      input.position.applyMatrix4(this.toParent);
      input.rotation.premultiply(this.parentRotation);
    } else {
      if (hand) input.pressed = true;
      input.pending = false;
      this.drop(input);
    }
  }

  private sampleHand(frame: XRFrame, reference: XRReferenceSpace, input: Input, hand: XRHand): boolean {
    const indexSpace = hand.get('index-finger-tip');
    const thumbSpace = hand.get('thumb-tip');
    const wristSpace = hand.get('wrist');
    if (!indexSpace || !thumbSpace || !wristSpace || !frame.getJointPose) return false;
    const index = frame.getJointPose(indexSpace, reference);
    const thumb = frame.getJointPose(thumbSpace, reference);
    const wrist = frame.getJointPose(wristSpace, reference);
    if (!index || !thumb || !wrist) return false;
    positionOf(index, input.position);
    positionOf(thumb, this.thumbPosition);
    const distance = input.position.distanceTo(this.thumbPosition);
    input.position.lerp(this.thumbPosition, 0.5);
    rotationOf(wrist, input.rotation);
    if (distance >= PINCH_OPEN && input.pressed) {
      input.pressed = false;
      input.pending = false;
      this.drop(input);
    } else if (distance <= PINCH_CLOSE && !input.pressed) {
      input.pressed = true;
      input.pending = true;
    }
    return true;
  }

  private updatePointer(frame: XRFrame, reference: XRReferenceSpace, input: Input): void {
    input.beam.visible = false;
    if (!input.tracked || !this.monitor.group.visible || this.holders.includes(input)) return;
    const target = frame.getPose(input.source.targetRaySpace, reference);
    let hit = false;
    if (target) {
      positionOf(target, input.beam.position);
      rotationOf(target, input.beam.quaternion);
      this.tempPosition.copy(input.beam.position).applyMatrix4(this.rig.matrixWorld);
      this.tempRotation.multiplyQuaternions(this.rigRotation, input.beam.quaternion);
      this.ray.set(this.tempPosition, this.direction.set(0, 0, -1).applyQuaternion(this.tempRotation));
      this.ray.far = Infinity;
      const intersection = this.monitor.intersect(this.ray);
      hit = Boolean(intersection);
      input.beam.visible = true;
      input.beam.scale.z = intersection?.distance ?? 2.5;
      input.beam.material = intersection ? this.targetMaterial : this.beamMaterial;
    }
    if (!input.pending) return;
    input.pending = false;
    const first = this.holders[0];
    if (this.holders.length >= 2 || (first && (
      (first.source.handedness !== 'none' && first.source.handedness === input.source.handedness)
      || first.position.distanceTo(input.position) < MIN_TWO_HAND_SPAN
    ))) return;
    if (!hit && (!input.source.hand || !this.withinReach(input.position))) return;
    this.holders.push(input);
    input.beam.visible = false;
    this.captureGrab();
  }

  private withinReach(position: Vector3): boolean {
    const parent = this.monitor.group.parent;
    this.tempPosition.copy(position);
    if (parent) this.tempPosition.applyMatrix4(parent.matrixWorld);
    this.monitor.group.getWorldPosition(this.direction).sub(this.tempPosition);
    if (this.direction.lengthSq() === 0) return true;
    this.ray.set(this.tempPosition, this.direction.normalize());
    this.ray.far = DIRECT_REACH;
    return Boolean(this.monitor.intersect(this.ray));
  }

  private captureGrab(): void {
    const [first, second] = this.holders;
    const { position, quaternion, scale } = this.monitor.group;
    const axis = second ? second.position.clone().sub(first.position) : new Vector3();
    const span = axis.length();
    const anchor = first.position.clone();
    if (second) anchor.lerp(second.position, 0.5);
    this.grab = {
      position: position.clone(), rotation: quaternion.clone(), scale: scale.x,
      anchor, orientation: first.rotation.clone().invert(), axis: axis.normalize(), span,
    };
    this.deltaRotation.identity();
  }

  private applyGrab(): void {
    const grab = this.grab!;
    const [first, second] = this.holders;
    this.anchor.copy(first.position);
    let scale = grab.scale;
    if (second) {
      this.anchor.lerp(second.position, 0.5);
      const span = this.axis.subVectors(second.position, first.position).length();
      scale = MathUtils.clamp(grab.scale * span / grab.span, MONITOR_MIN_SCALE, MONITOR_MAX_SCALE);
      if (span > 0.0001) this.deltaRotation.setFromUnitVectors(grab.axis, this.axis.divideScalar(span));
    } else {
      this.deltaRotation.multiplyQuaternions(first.rotation, grab.orientation);
    }
    const group = this.monitor.group;
    // A ray grab can start meters from the screen. Preserve its distance when rotating or scaling.
    group.position.copy(grab.position).add(this.anchor).sub(grab.anchor);
    group.quaternion.multiplyQuaternions(this.deltaRotation, grab.rotation);
    group.scale.setScalar(scale);
  }

  private updateGuide(message: string): void {
    if (typeof document === 'undefined') return;
    if (!this.guide) {
      this.guide = createGuide();
      if (!this.guide) return;
      this.guide.sprite.position.set(0, -0.98, 0.02);
      this.monitor.group.add(this.guide.sprite);
    }
    const { canvas, context, sprite, texture } = this.guide;
    sprite.visible = this.monitor.group.visible && !this.holders.length;
    if (this.guide.message === message) return;
    this.guide.message = message;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#101d2eef';
    context.beginPath();
    context.roundRect(0, 0, canvas.width, canvas.height, 22);
    context.fill();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '500 35px sans-serif';
    context.fillStyle = '#edf7ff';
    context.fillText(message, canvas.width / 2, canvas.height / 2, canvas.width - 44);
    texture.needsUpdate = true;
  }
}
