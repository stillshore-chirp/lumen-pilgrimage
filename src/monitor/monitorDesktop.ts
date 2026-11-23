import * as THREE from 'three';
import { MONITOR_MAX_SCALE, MONITOR_MIN_SCALE, type MonitorObject } from './monitorObject';

export type MonitorDragMode = 'move' | 'rotate' | 'scale';

const MAX_DRAG_DISTANCE = 12;
const YAW_AXIS = new THREE.Vector3(0, 1, 0);

type Drag = {
  mode: MonitorDragMode;
  pointerId: number;
  x: number;
  y: number;
  scale: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  hit: THREE.Vector3;
  plane: THREE.Plane;
  right: THREE.Vector3;
};

export class MonitorDesktop {
  private readonly monitor: MonitorObject;
  private drag: Drag | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly displacement = new THREE.Vector3();
  private readonly yaw = new THREE.Quaternion();
  private readonly pitch = new THREE.Quaternion();

  constructor(monitor: MonitorObject) {
    this.monitor = monitor;
  }

  begin(camera: THREE.Camera, ndc: THREE.Vector2, mode: MonitorDragMode, pointerId: number, clientX: number, clientY: number): boolean {
    if (this.drag || !this.validPointer(ndc, clientX, clientY)) return false;

    camera.updateWorldMatrix(true, false);
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.monitor.intersect(this.raycaster)?.point;
    if (!hit) return false;

    const { position, quaternion, scale } = this.monitor.group;
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const cameraRotation = camera.getWorldQuaternion(new THREE.Quaternion());
    this.drag = {
      mode, pointerId, x: clientX, y: clientY, hit,
      position: position.clone(), quaternion: quaternion.clone(), scale: scale.x,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(forward, hit),
      right: new THREE.Vector3(1, 0, 0).applyQuaternion(cameraRotation)
    };
    return true;
  }

  move(camera: THREE.Camera, ndc: THREE.Vector2, pointerId: number, clientX: number, clientY: number): boolean {
    const drag = this.drag;
    if (!drag || drag.pointerId !== pointerId) return false;
    if (!this.monitor.group.visible) {
      this.cancel();
      return false;
    }
    if (!this.validPointer(ndc, clientX, clientY)) return false;

    const { position, quaternion, scale } = this.monitor.group;
    const dx = clientX - drag.x;
    const dy = clientY - drag.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    switch (drag.mode) {
      case 'move':
        camera.updateWorldMatrix(true, false);
        this.raycaster.setFromCamera(ndc, camera);
        if (this.raycaster.ray.intersectPlane(drag.plane, this.displacement)) {
          this.displacement.sub(drag.hit);
          if (Number.isFinite(this.displacement.lengthSq())) {
            position.copy(drag.position).add(this.displacement.clampLength(0, MAX_DRAG_DISTANCE));
          }
        }
        break;
      case 'rotate':
        this.yaw.setFromAxisAngle(YAW_AXIS, THREE.MathUtils.clamp(dx * 0.007, -Math.PI * 2, Math.PI * 2));
        this.pitch.setFromAxisAngle(drag.right, THREE.MathUtils.clamp(dy * 0.007, -Math.PI, Math.PI));
        quaternion.copy(drag.quaternion).premultiply(this.pitch).premultiply(this.yaw);
        break;
      case 'scale': {
        const distance = THREE.MathUtils.clamp((dx - dy) * 0.004, -10, 10);
        scale.setScalar(THREE.MathUtils.clamp(drag.scale * Math.exp(distance), MONITOR_MIN_SCALE, MONITOR_MAX_SCALE));
        break;
      }
    }
    return true;
  }

  end(pointerId: number): void {
    if (this.drag?.pointerId === pointerId) this.cancel();
  }

  cancel(): void {
    this.drag = null;
  }

  private validPointer(ndc: THREE.Vector2, x: number, y: number): boolean {
    return Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && Number.isFinite(x) && Number.isFinite(y);
  }
}
