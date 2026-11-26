import { Quaternion, Raycaster, Vector2, Vector3, type Object3D, type PerspectiveCamera } from 'three';

export interface DesktopGrabTarget {
  readonly label: string;
  readonly object: Object3D;
  readonly reach: number;
  available(): boolean;
  hitDistance(ray: Raycaster): number | undefined;
  // Return a world-space floor height where the object can rest.
  floorHeight?(x: number, z: number): number | undefined;
  // Keep a floor object's carried world-space pose clear of its surroundings.
  constrainCarry?(position: Vector3): void;
}

export class DesktopGrab {
  private readonly center = new Vector2();
  private readonly ray = new Raycaster();
  private readonly position = new Vector3();
  private readonly right = new Vector3();
  private readonly floorPosition = new Vector3();
  private readonly cameraOffset = new Vector3();
  private readonly cameraRotationOffset = new Quaternion();
  private readonly rotation = new Quaternion();
  private readonly parentRotation = new Quaternion();
  private held?: DesktopGrabTarget;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly targets: readonly DesktopGrabTarget[] = [],
    private readonly isOccluded?: (ray: Raycaster, target: Object3D, distance: number) => boolean,
  ) {}

  toggle(extraTarget?: DesktopGrabTarget): boolean {
    if (this.held) {
      this.release();
      return true;
    }
    const target = this.pick(extraTarget);
    if (!target) return false;
    this.held = target;
    target.object.getWorldPosition(this.position);
    if (target.floorHeight) {
      this.floorPosition.copy(this.position);
      this.floorPosition.y = target.floorHeight(this.position.x, this.position.z) ?? this.position.y;
      this.update();
    } else {
      this.camera.worldToLocal(this.cameraOffset.copy(this.position));
      this.camera.getWorldQuaternion(this.cameraRotationOffset).invert();
      this.cameraRotationOffset.multiply(target.object.getWorldQuaternion(this.rotation));
    }
    return true;
  }

  label(extraTarget?: DesktopGrabTarget): string | null {
    if (this.held?.available()) return `F ${this.held.label}を置く`;
    const target = this.pick(extraTarget);
    return target ? `F ${target.label}を掴む` : null;
  }

  update(): void {
    const target = this.held;
    if (!target) return;
    if (!target.available()) {
      this.release();
      return;
    }
    if (target.floorHeight) {
      this.aim();
      this.ray.ray.at(1.05, this.position);
      this.right.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
      const sideOffset = Math.min(0.25, 0.25 / this.camera.projectionMatrix.elements[0]);
      this.position.addScaledVector(this.right, sideOffset);
      this.position.y -= 0.35;
      const floorY = target.floorHeight(this.position.x, this.position.z);
      if (floorY !== undefined) {
        this.floorPosition.set(this.position.x, floorY, this.position.z);
        this.position.y = Math.max(this.position.y, floorY + 0.18);
      }
      target.constrainCarry?.(this.position);
    } else {
      this.camera.localToWorld(this.position.copy(this.cameraOffset));
      this.camera.getWorldQuaternion(this.rotation).multiply(this.cameraRotationOffset);
      const parent = target.object.parent;
      if (parent) this.rotation.premultiply(parent.getWorldQuaternion(this.parentRotation).invert());
      target.object.quaternion.copy(this.rotation);
    }
    this.setWorldPosition(target.object, this.position);
  }

  release(target?: DesktopGrabTarget): void {
    if (!this.held || (target && target !== this.held)) return;
    if (this.held.floorHeight) this.setWorldPosition(this.held.object, this.position.copy(this.floorPosition));
    this.held = undefined;
  }

  private setWorldPosition(object: Object3D, position: Vector3): void {
    if (object.parent) object.parent.worldToLocal(position);
    object.position.copy(position);
  }

  private aim(): void {
    this.camera.updateWorldMatrix(true, false);
    this.ray.setFromCamera(this.center, this.camera);
  }

  private pick(extraTarget?: DesktopGrabTarget): DesktopGrabTarget | undefined {
    if (this.targets.length === 0 && !extraTarget) return;
    this.aim();
    let picked: DesktopGrabTarget | undefined;
    let bestDistance = Infinity;
    const consider = (target: DesktopGrabTarget) => {
      if (!target.available()) return;
      const distance = target.hitDistance(this.ray);
      if (distance !== undefined && distance > 0 && distance <= target.reach && distance < bestDistance) {
        bestDistance = distance;
        picked = target;
      }
    };
    for (const target of this.targets) consider(target);
    if (extraTarget) consider(extraTarget);
    return picked && !this.isOccluded?.(this.ray, picked.object, bestDistance) ? picked : undefined;
  }
}
