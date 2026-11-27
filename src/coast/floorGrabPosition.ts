import { Vector3, type Object3D } from 'three';
import type { DesktopGrabTarget } from './DesktopGrab';

export function setGrabWorldPosition(object: Object3D, position: Vector3): void {
  if (object.parent) object.parent.worldToLocal(position);
  object.position.copy(position);
}

export class FloorGrabPosition {
  private readonly floor = new Vector3();
  private readonly releasePosition = new Vector3();

  begin(target: DesktopGrabTarget): void {
    target.object.getWorldPosition(this.floor);
    this.floor.y = target.floorHeight?.(this.floor.x, this.floor.z) ?? this.floor.y;
  }

  carry(target: DesktopGrabTarget, position: Vector3, clearance = 0): void {
    const floorY = target.floorHeight?.(position.x, position.z);
    // Keep the last valid floor position while carrying above furniture or outside the floor bounds.
    if (floorY !== undefined) {
      this.floor.set(position.x, floorY, position.z);
      position.y = Math.max(position.y, floorY + clearance);
    }
    target.constrainCarry?.(position);
    setGrabWorldPosition(target.object, position);
  }

  release(target: DesktopGrabTarget): void {
    setGrabWorldPosition(target.object, this.releasePosition.copy(this.floor));
  }
}
