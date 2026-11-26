import { Euler, Group, Matrix4, PerspectiveCamera, Vector3, type Scene, type WebXRManager } from 'three';
import { ImmersiveControls } from '../xr/ImmersiveControls';
import { ImmersiveMenu, type ImmersiveMenuItem } from '../xr/ImmersiveMenu';
import { ImmersiveSession } from '../xr/ImmersiveSession';
import type { CoastControls } from './CoastControls';
import type { DesktopGrabTarget, GrabOcclusion } from './DesktopGrab';
import { WorldXRGrab } from './WorldXRGrab';

interface Binding {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: CoastControls;
  readonly openMenu: () => void;
  readonly onMenuOpen: () => void;
  readonly interaction: (viewer: PerspectiveCamera) => string | null;
  readonly interact: (viewer: PerspectiveCamera) => void;
  readonly blocking: () => boolean;
  readonly status: () => string;
  readonly grabTargets?: readonly DesktopGrabTarget[];
  readonly grabOccluded?: GrabOcclusion;
}

const UP = new Vector3(0, 1, 0);
const OPEN_HINT = '左スティック 移動  /  右スティック 旋回  /  X メニュー';

export class CoastXR {
  readonly rig = new Group();
  readonly camera = new PerspectiveCamera();
  readonly session: ImmersiveSession;
  private readonly pose = new PerspectiveCamera();
  private readonly poseMatrix = new Matrix4();
  private readonly localPosition = new Vector3();
  private readonly rotation = new Euler(0, 0, 0, 'YXZ');
  private readonly horizontal = new Vector3();
  private readonly headOffset = new Vector3();
  private readonly navigationView = { yaw: 0, headOffset: this.headOffset };
  private readonly bodyOrigin = new Vector3();
  private readonly input = new ImmersiveControls();
  private readonly worldGrab = new WorldXRGrab(this.rig);
  private menu?: ImmersiveMenu;
  private binding?: Binding;
  private active: XRSession | null = null;
  private reference: XRReferenceSpace | null = null;
  private anchorPending = true;
  private tracked = false;
  private previouslyTracked = false;
  private eyeHeight = 0;
  private seatOffset = 0;
  private hintsUntil = 0;

  constructor(private readonly xr: WebXRManager) {
    this.rig.name = 'vr-exploration-rig';
    this.rig.add(this.camera);
    this.session = new ImmersiveSession(xr);
    this.session.observe((_, session) => this.bindSession(session));
    void this.session.checkSupport();
  }

  get hasTracking(): boolean { return this.tracked; }

  get menuOpen(): boolean { return this.menu?.open ?? false; }

  get isGrabbingWorldObject(): boolean { return this.worldGrab.isGrabbing; }

  bind(binding: Binding): void {
    this.binding = binding;
    this.worldGrab.bind(binding.grabTargets, binding.grabOccluded);
    binding.scene.add(this.rig);
    if (this.menu) binding.scene.add(...this.menu.elements);
    this.camera.copy(binding.camera, false);
    binding.controls.setDesktopInputEnabled(!this.active);
    this.relocate();
  }

  relocate(): void {
    this.worldGrab.release();
    this.anchorPending = true;
    this.tracked = false;
    this.previouslyTracked = false;
    this.input.pauseMovement();
    this.closeMenu();
  }

  openMenu(title: string, items: readonly ImmersiveMenuItem[]): void {
    if (!this.tracked || !this.binding) return;
    this.worldGrab.release();
    if (!this.menu) {
      this.menu = new ImmersiveMenu();
      this.binding.scene.add(...this.menu.elements);
    }
    if (!this.menu.open) this.binding.onMenuOpen();
    this.input.pauseMovement();
    this.menu.show(this.pose, title, items);
  }

  closeMenu(): void {
    this.menu?.close();
    this.input.pauseMovement();
  }

  releaseUnavailableWorldGrab(): void {
    this.worldGrab.releaseUnavailable();
  }

  update(frame: XRFrame | undefined, dt: number): PerspectiveCamera {
    const binding = this.binding!;
    if (!this.active) return binding.camera;
    const reference = this.xr.getReferenceSpace();
    if (reference !== this.reference) {
      this.worldGrab.release();
      this.reference?.removeEventListener('reset', this.onReferenceReset);
      this.reference = reference;
      this.reference?.addEventListener('reset', this.onReferenceReset);
    }
    const tracking = frame?.session === this.active && reference && frame.getViewerPose(reference);
    if (!tracking || !frame || !reference) {
      this.clearInput();
      return this.previouslyTracked ? this.pose : binding.camera;
    }

    this.poseMatrix.fromArray(tracking.transform.matrix);
    this.localPosition.setFromMatrixPosition(this.poseMatrix);
    if (this.anchorPending) this.anchor(binding);
    this.updateViewer();
    this.tracked = this.previouslyTracked = true;
    if (this.active.visibilityState !== 'visible') {
      this.clearInput();
      return this.pose;
    }

    const input = this.input.sample(frame, reference, this.menuOpen);
    if (binding.blocking()) this.input.pauseMovement();
    else if (input.menu) {
      if (this.menuOpen) this.closeMenu();
      else binding.openMenu();
    } else if (this.menuOpen) this.menu?.handle(input.menuStep, false);
    else {
      if (input.snap) this.snap(input.snap);
      this.rotation.setFromQuaternion(this.pose.quaternion, 'YXZ');
      this.navigationView.yaw = this.rotation.y;
      this.headOffset.subVectors(this.pose.position, binding.camera.position);
      binding.controls.updateXR(dt, input, this.navigationView);
      this.syncRig(binding);
      this.updateViewer();
    }

    const canGrab = !this.menuOpen && !binding.blocking();
    const grabHint = canGrab ? this.worldGrab.update(frame, reference) : this.worldGrab.release();
    if (!this.menuOpen) {
      const interaction = canGrab && !grabHint && binding.interaction(this.pose);
      const hint = binding.status() || grabHint || (interaction ? `右トリガー  ${interaction}` : '')
        || (performance.now() < this.hintsUntil ? OPEN_HINT : '');
      if (hint && !this.menu) {
        this.menu = new ImmersiveMenu();
        binding.scene.add(...this.menu.elements);
      }
      this.menu?.showHint(this.pose, hint);
    }
    return this.pose;
  }

  dispose(): void {
    this.bindSession(null);
    this.session.dispose();
    this.menu?.dispose();
    this.rig.removeFromParent();
  }

  private bindSession(session: XRSession | null): void {
    if (session === this.active) return;
    this.active?.removeEventListener('select', this.onSelect);
    this.active?.removeEventListener('visibilitychange', this.onVisibility);
    this.active?.removeEventListener('squeezestart', this.onSqueezeStart);
    this.active?.removeEventListener('squeezeend', this.onSqueezeEnd);
    this.active?.removeEventListener('inputsourceschange', this.onSourcesChange);
    this.worldGrab.reset();
    this.reference?.removeEventListener('reset', this.onReferenceReset);
    this.reference = null;
    if (this.active && this.previouslyTracked) {
      this.rotation.setFromQuaternion(this.pose.quaternion, 'YXZ');
      this.binding?.controls.alignDesktopView(this.rotation.y, this.rotation.x);
    }
    this.active = session;
    this.active?.addEventListener('select', this.onSelect);
    this.active?.addEventListener('visibilitychange', this.onVisibility);
    this.active?.addEventListener('squeezestart', this.onSqueezeStart);
    this.active?.addEventListener('squeezeend', this.onSqueezeEnd);
    this.active?.addEventListener('inputsourceschange', this.onSourcesChange);
    this.binding?.controls.setDesktopInputEnabled(!session);
    this.relocate();
    this.input.reset();
    this.hintsUntil = session ? performance.now() + 7200 : 0;
  }

  private readonly onSelect = ({ inputSource, frame }: XRInputSourceEvent): void => {
    const { active, binding, reference } = this;
    if (!active || !reference || !binding || !this.tracked || binding.blocking() || active.visibilityState !== 'visible'
      || frame.session !== active || inputSource.hand || inputSource.handedness !== 'right' || inputSource.targetRayMode !== 'tracked-pointer'
      || inputSource.gamepad?.mapping !== 'xr-standard' || !frame.getPose(inputSource.targetRaySpace, reference)) return;
    if (this.menu?.open) this.menu.handle(0, true);
    else binding.interact(this.pose);
  };

  private referenceForGrab(): XRReferenceSpace | null {
    if (!this.tracked || this.menuOpen || !this.binding || this.binding.blocking()
      || this.active?.visibilityState !== 'visible' || this.xr.getReferenceSpace() !== this.reference) return null;
    return this.reference;
  }

  private readonly onSqueezeStart = (event: XRInputSourceEvent): void => {
    if (event.frame.session === this.active) this.worldGrab.start(event, this.referenceForGrab());
  };

  private readonly onSqueezeEnd = (event: XRInputSourceEvent): void => {
    if (event.frame.session === this.active) this.worldGrab.end(event, this.referenceForGrab());
  };

  private readonly onSourcesChange = ({ removed }: XRInputSourcesChangeEvent): void => {
    this.worldGrab.removeSources(removed);
  };

  private readonly onVisibility = (): void => {
    if (this.active?.visibilityState !== 'visible') this.clearInput();
  };

  private readonly onReferenceReset = (): void => {
    // Recenter the next tracked pose at the same virtual location and heading.
    if (this.previouslyTracked) {
      this.rotation.setFromQuaternion(this.pose.quaternion, 'YXZ');
      this.binding?.controls.alignDesktopView(this.rotation.y, this.rotation.x);
    }
    this.relocate();
    this.input.reset();
  };

  private clearInput(): void {
    this.worldGrab.release();
    this.tracked = false;
    this.input.reset();
    this.menu?.showHint(this.pose, '');
  }

  private anchor({ camera, controls }: Binding): void {
    this.anchorPending = false;
    this.rotation.setFromRotationMatrix(this.poseMatrix, 'YXZ');
    this.rig.rotation.set(0, camera.rotation.y - this.rotation.y, 0);
    this.horizontal.set(this.localPosition.x, 0, this.localPosition.z).applyQuaternion(this.rig.quaternion);
    this.rig.position.copy(camera.position).sub(this.horizontal);
    this.bodyOrigin.copy(camera.position);
    this.eyeHeight = controls.eyeHeight;
    this.seatOffset = controls.currentMovement === 'crouch' ? this.eyeHeight - this.localPosition.y : 0;
    this.syncRig({ camera, controls });
  }

  private syncRig({ camera, controls }: Pick<Binding, 'camera' | 'controls'>): void {
    const { position } = camera;
    this.rig.position.x += position.x - this.bodyOrigin.x;
    this.rig.position.z += position.z - this.bodyOrigin.z;
    if (this.eyeHeight !== controls.eyeHeight) {
      this.eyeHeight = controls.eyeHeight;
      this.seatOffset = 0;
    }
    this.rig.position.y = position.y - this.eyeHeight + this.seatOffset;
    this.bodyOrigin.copy(position);
  }

  private snap(angle: number): void {
    // Rotate about the tracked head so a physical offset from the origin causes no sideways step.
    this.horizontal.copy(this.rig.position).sub(this.pose.position).applyAxisAngle(UP, angle);
    this.rig.position.copy(this.pose.position).add(this.horizontal);
    this.rig.rotation.y += angle;
    this.updateViewer();
  }

  private updateViewer(): void {
    this.rig.updateMatrixWorld();
    this.pose.matrix.multiplyMatrices(this.rig.matrixWorld, this.poseMatrix);
    this.pose.matrix.decompose(this.pose.position, this.pose.quaternion, this.pose.scale);
  }
}
