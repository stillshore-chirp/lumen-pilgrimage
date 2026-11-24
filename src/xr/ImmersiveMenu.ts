import {
  CanvasTexture, Euler, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type PerspectiveCamera,
} from 'three';

export interface ImmersiveMenuItem {
  readonly label: string | (() => string);
  readonly invoke?: () => void;
  readonly enabled?: () => boolean;
}

const VISIBLE_ROWS = 6;
const PANEL_WIDTH = 960;
const PANEL_HEIGHT = 680;

function makePanel(name: string, width: number, height: number, meters: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(meters, meters * height / width), new MeshBasicMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  mesh.name = name;
  mesh.renderOrder = 9000;
  mesh.visible = false;
  return {
    mesh, context, texture,
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
      texture.dispose();
    },
  };
}

function background(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.clearRect(0, 0, width, height);
  context.beginPath();
  context.roundRect(2, 2, width - 4, height - 4, 28);
  context.fillStyle = '#102728';
  context.fill();
  context.strokeStyle = '#83aba5';
  context.lineWidth = 3;
  context.stroke();
}

export class ImmersiveMenu {
  private readonly panel = makePanel('vr-exploration-menu', PANEL_WIDTH, PANEL_HEIGHT, 1.48);
  private readonly notice = makePanel('vr-exploration-status', PANEL_WIDTH, 104, 1.43);
  private readonly rotation = new Euler(0, 0, 0, 'YXZ');
  private readonly offset = new Vector3();
  private items: readonly ImmersiveMenuItem[] = [];
  private title = '';
  private selected = 0;
  private rowsKey = '';
  private hint = '';

  get elements() { return [this.panel.mesh, this.notice.mesh] as const; }
  get open(): boolean { return this.panel.mesh.visible; }

  show(viewer: PerspectiveCamera, title: string, items: readonly ImmersiveMenuItem[]): void {
    if (!this.open) {
      this.rotation.setFromQuaternion(viewer.quaternion, 'YXZ');
      this.rotation.z = 0;
      this.panel.mesh.rotation.copy(this.rotation);
      this.offset.set(0, -.04, -1.5).applyEuler(this.rotation);
      this.panel.mesh.position.copy(viewer.position).add(this.offset);
      this.notice.mesh.visible = false;
    }
    this.title = title;
    this.items = items;
    this.selected = Math.max(0, items.findIndex(item => item.invoke && item.enabled?.() !== false));
    this.panel.mesh.visible = true;
    this.rowsKey = '';
    this.draw();
  }

  close(): void {
    this.panel.mesh.visible = false;
    this.notice.mesh.visible = false;
    this.items = [];
  }

  handle(step: number, confirm: boolean): void {
    if (!this.open) return;
    if (step !== 0) this.selected = Math.max(0, Math.min(this.items.length - 1, this.selected + step));
    if (confirm) {
      const current = this.items[this.selected];
      if (current?.enabled?.() !== false) current?.invoke?.();
    }
    if (this.open) this.draw();
  }

  showHint(viewer: PerspectiveCamera, hint: string): void {
    this.notice.mesh.visible = Boolean(hint && !this.open);
    if (!this.notice.mesh.visible) return;
    this.rotation.setFromQuaternion(viewer.quaternion, 'YXZ');
    this.rotation.z = 0;
    this.notice.mesh.rotation.copy(this.rotation);
    this.offset.set(0, -.58, -1.5).applyEuler(this.rotation);
    this.notice.mesh.position.copy(viewer.position).add(this.offset);
    if (hint === this.hint) return;
    this.hint = hint;
    const { context, texture } = this.notice;
    background(context, PANEL_WIDTH, 104);
    context.textBaseline = 'middle';
    context.font = '600 42px sans-serif';
    context.fillStyle = '#f6fbf7';
    context.fillText(hint, 30, 53, PANEL_WIDTH - 60);
    texture.needsUpdate = true;
  }

  dispose(): void {
    this.close();
    this.panel.dispose();
    this.notice.dispose();
  }

  private draw(): void {
    const start = Math.max(0, Math.min(this.selected - VISIBLE_ROWS + 1, this.items.length - VISIBLE_ROWS));
    const rows = this.items.slice(start, start + VISIBLE_ROWS).map((item, index) => ({
      text: typeof item.label === 'string' ? item.label : item.label(),
      selected: start + index === this.selected,
      enabled: item.enabled?.() !== false,
    }));
    const key = JSON.stringify([start, rows]);
    if (key === this.rowsKey) return;
    this.rowsKey = key;
    const { context, texture } = this.panel;
    background(context, PANEL_WIDTH, PANEL_HEIGHT);
    context.textBaseline = 'middle';
    context.fillStyle = '#f6fbf7';
    context.font = '650 46px sans-serif';
    context.fillText(this.title, 34, 58, 790);
    context.fillStyle = '#bce2d5';
    context.font = '500 28px sans-serif';
    context.textAlign = 'right';
    context.fillText(`${this.selected + 1} / ${this.items.length}`, 923, 58);
    context.textAlign = 'left';
    for (const [index, row] of rows.entries()) {
      const y = 104 + index * 81;
      context.fillStyle = row.selected ? '#c8eddf' : '#1e3d3d';
      context.beginPath();
      context.roundRect(28, y, 904, 68, 13);
      context.fill();
      context.fillStyle = row.selected ? '#102728' : '#f6fbf7';
      context.font = '600 38px sans-serif';
      context.fillText(`${row.selected ? '›  ' : ''}${row.text}${row.enabled ? '' : '（操作不可）'}`, 52, y + 34, 852);
    }
    context.fillStyle = '#bce2d5';
    context.font = '500 31px sans-serif';
    context.fillText('右スティック ↑↓ 選択  /  右トリガー 決定  /  X 閉じる', 34, 637, 892);
    texture.needsUpdate = true;
  }
}
