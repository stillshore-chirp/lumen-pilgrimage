import * as THREE from 'three';
import { applianceTime, createApplianceCycle } from './residenceApplianceCycle';
import type { FurnitureModel } from './residenceFurnitureModel';
import type { ResidenceMaterials } from './residenceMaterials';
import { RESIDENCE_ROOMS, type ResidenceControlLocation, type ResidenceRect } from './residencePlan';

type Point = Readonly<{ x: number; y: number; z: number }>;
export type ApplianceMount = readonly [east: number, north: number, heading?: number];
type ApplianceAnchor = readonly [x: number, y: number, z: number];
type ApplianceControl = { id: string; label: string } & (
  | { kind: 'toggle'; get: () => boolean; set: (value: boolean) => void }
  | { kind: 'button'; invoke: () => void; disabled?: () => boolean }
  | { kind: 'select'; options: readonly { value: string; label: string }[];
    get: () => string; set: (value: string) => void; disabled?: () => boolean }
  | { kind: 'output'; read: () => string }
);

type ApplianceSection = { id: string; title: string; category: 'appliances'; location: ResidenceControlLocation; controls: readonly ApplianceControl[] };
export type ResidenceApplianceAudioSource = {
  id: string;
  position: Point;
  kind: 'water' | 'washer' | 'microwave';
  level: () => number;
  completionCount?: () => number;
};

type Fixture = { id: string; title: string; room: string; mount: ApplianceMount; approach: ApplianceAnchor };
const washerModes = [
  { value: 'wash', label: '洗浄', seconds: 40, level: .47, speed: 3.3 },
  { value: 'rinse', label: 'すすぎ', seconds: 30, level: .41, speed: 2.3 },
  { value: 'spin', label: '脱水', seconds: 22, level: .69, speed: 19 },
  { value: 'dry', label: '乾燥', seconds: 60, level: .33, speed: 1.7 },
] as const;
const washerDuration = { min: 10, max: 60 * 60 };
const washerAdjustments = [[-60, '−1分'], [-10, '−10秒'], [10, '+10秒'], [60, '+1分']] as const;
const maxMicrowaveSeconds = 30 * 60;
const interactionReach = .86;

export class ResidenceAppliances {
  readonly group = new THREE.Group();
  private readonly panels: ApplianceSection[] = [];
  private readonly sources: ResidenceApplianceAudioSource[] = [];
  private readonly nearbyFixtures: { section: ApplianceSection; position: Point; rooms: readonly ResidenceRect[] }[] = [];
  private readonly updates: ((dt: number) => void)[] = [];
  private readonly resources = new Set<{ dispose(): void }>();
  private readonly water = this.own(new THREE.MeshStandardMaterial({
    name: 'Flowing water', color: 0xa9d5da, roughness: .14, metalness: .18,
    opacity: .68, transparent: true, depthWrite: false,
  }));
  private readonly waterGlint = this.own(new THREE.MeshBasicMaterial({
    color: 0xd4f2f3, opacity: .48, transparent: true, depthWrite: false,
  }));

  private readonly now: () => number;

  constructor(now: () => number = () => performance.now() / 1000) {
    this.now = now;
    this.group.name = 'Working residence appliances';
  }

  get sections(): readonly ApplianceSection[] { return this.panels; }
  get audioSources(): readonly ResidenceApplianceAudioSource[] { return this.sources; }

  nearby(position: Point): { distance: number; label: string; sectionId: string } | null {
    let nearest = null;
    for (const fixture of this.nearbyFixtures) {
      const distance = Math.hypot(position.x - fixture.position.x, position.z - fixture.position.z);
      if (distance > interactionReach || (nearest && distance >= nearest.distance)) continue;
      if (!fixture.rooms.some(([west, south, east, north]) => position.x >= west && position.x <= east
        && -position.z >= south && -position.z <= north)) continue;
      nearest = { distance, label: `${fixture.section.title}を操作`, sectionId: fixture.section.id };
    }
    return nearest;
  }

  update(dt: number): void {
    const step = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, .05) : 0;
    for (const update of this.updates) update(step);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
  }

  addWater(fixture: Fixture, outlet: ApplianceAnchor, floor: number, spray = false): void {
    const frame = this.mount(fixture);
    const [x, y, z] = outlet;
    const flow = new THREE.Group();
    flow.position.set(x, y, z);
    flow.visible = false;
    frame.add(flow);
    const length = y - floor;
    if (!spray) {
      const stream = this.mesh(flow, new THREE.CylinderGeometry(.006, .004, length, 9), this.water,
        [0, -length / 2, 0]);
      this.updates.push(dt => {
        if (flow.visible) stream.rotation.y += dt * 1.7;
      });
    }

    const drops = this.own(new THREE.InstancedMesh(this.own(new THREE.SphereGeometry(1, 6, 4)),
      this.waterGlint, spray ? 60 : 12));
    drops.frustumCulled = false;
    drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    flow.add(drops);
    const rippleMaterial = this.own(this.waterGlint.clone());
    const ripple = this.mesh(flow, new THREE.RingGeometry(.85, 1, 24), rippleMaterial, [0, -length + .004, 0]);
    ripple.rotation.x = -Math.PI / 2;
    const drop = new THREE.Object3D();
    let elapsed = 0;
    const update = (dt: number) => {
      elapsed += dt;
      for (let i = 0; i < drops.count; i++) {
        const angle = i * 2.399963;
        const elapsedFraction = (elapsed * (spray ? 1.35 : 5.3) + i * i * .754878) % 1;
        const descent = elapsedFraction * (.35 + .65 * elapsedFraction);
        const radius = (spray ? .045 + descent * .092 : .006) * ((i % 8) + 1) / 8;
        drop.position.set(Math.cos(angle) * radius, -descent * length, Math.sin(angle) * radius);
        drop.scale.set(spray ? .0024 : .0018, spray ? .017 + descent * .022 : .009 + descent * .006, .002);
        drop.updateMatrix();
        drops.setMatrixAt(i, drop.matrix);
      }
      drops.instanceMatrix.needsUpdate = true;
      const pulse = (elapsed * 3.5) % 1;
      ripple.scale.setScalar((spray ? .085 : .011) + pulse * (spray ? .085 : .037));
      rippleMaterial.opacity = .48 * (1 - pulse);
    };
    this.updates.push(dt => { if (flow.visible) update(dt); });
    this.register(fixture, frame, [
      { kind: 'toggle', id: 'flow', label: spray ? 'シャワー' : '水栓', get: () => flow.visible, set(visible) {
        flow.visible = visible;
        if (visible) update(0);
      } },
    ], { kind: 'water', at: outlet, level: () => flow.visible ? (spray ? .74 : .54) : 0 });
  }

  addWasher(fixture: Fixture, materials: ResidenceMaterials): void {
    const frame = this.mount(fixture);
    const drum = new THREE.Group();
    drum.position.set(0, .378, .314);
    frame.add(drum);
    const steel = this.own(new THREE.MeshStandardMaterial({ color: 0x536168, metalness: .46, roughness: .34 }));
    const backing = this.mesh(drum, new THREE.CircleGeometry(.163, 40), steel, [0, 0, 0]);
    backing.name = 'Perforated drum back';
    this.mesh(drum, new THREE.TorusGeometry(.146, .009, 9, 40), materials.brushedSteel, [0, 0, .003]);
    const pores = this.own(new THREE.InstancedMesh(this.own(new THREE.CircleGeometry(.0032, 6)),
      materials.darkMetal, 46));
    const pore = new THREE.Object3D();
    for (let i = 0; i < pores.count; i++) {
      const radius = .134 * Math.sqrt((i + 1) / pores.count);
      const angle = i * 2.399963;
      pore.position.set(radius * Math.cos(angle), radius * Math.sin(angle), .004);
      pore.updateMatrix();
      pores.setMatrixAt(i, pore.matrix);
    }
    drum.add(pores);
    const cloths = [materials.fabric, materials.bedding, materials.linenShade];
    for (const [i, cloth] of cloths.entries()) {
      const fabric = this.mesh(drum, new THREE.SphereGeometry(1, 15, 9), cloth,
        [(.063 * i) - .065, -.067 + i * .012, .012]);
      fabric.scale.set(.070, .040 - .004 * i, .014);
      fabric.rotation.z = .42 * (i - 1);
    }
    const water = this.own(new THREE.MeshBasicMaterial({ color: 0x4d9bab, transparent: true, opacity: .38,
      depthWrite: false }));
    const waterline = new THREE.Shape();
    waterline.absarc(0, 0, .159, Math.PI * 1.11, Math.PI * 1.89, false);
    waterline.closePath();
    const washWater = this.mesh(frame, new THREE.ShapeGeometry(waterline, 28), water, [0, .378, .343]);
    const washFoam = new THREE.Group();
    washFoam.position.set(0, .33, .346);
    frame.add(washFoam);
    const bubble = this.own(new THREE.SphereGeometry(1, 8, 5));
    for (let i = 0; i < 12; i++) {
      const foam = new THREE.Mesh(bubble, this.waterGlint);
      foam.position.set(-.126 + .022 * i, Math.sin(i * 1.9) * .006, 0);
      foam.scale.setScalar(.005 + .002 * (i % 3));
      washFoam.add(foam);
    }
    const glass = this.own(new THREE.MeshStandardMaterial({ color: 0x97aeb0, transparent: true, opacity: .16,
      metalness: .21, roughness: .15, depthWrite: false }));
    this.mesh(frame, new THREE.CircleGeometry(.165, 40), glass, [0, .378, .354]);
    const display = this.display(frame, [-.130, .721, .309], .152, .031);
    const cycle = createApplianceCycle(this.now);
    let mode: typeof washerModes[number] = washerModes[0];
    let configuredSeconds: number = mode.seconds;
    let phase = 0;
    const selectedSeconds = () => cycle.remaining > 0 ? cycle.remaining : configuredSeconds;
    const sync = (dt: number) => {
      cycle.advance();
      const running = cycle.running;
      const wet = mode.value === 'wash' || mode.value === 'rinse';
      washWater.visible = running && wet;
      washFoam.visible = running && mode.value === 'wash';
      water.color.setHex(mode.value === 'rinse' ? 0x83c4d5 : 0x4c94a1);
      steel.emissive.setHex(running && mode.value === 'dry' ? 0x4e2c18 : 0x000000);
      if (running) {
        phase += dt;
        const direction = wet ? Math.tanh(4 * Math.cos(phase * 1.31)) : 1;
        drum.rotation.z += direction * mode.speed * dt;
        washFoam.rotation.z = Math.sin(phase * 4.6) * .074;
        washWater.rotation.z = washFoam.rotation.z;
      }
      const state = running ? `${mode.label} ${applianceTime(cycle.remaining)}`
        : cycle.finished ? '完了' : cycle.remaining > 0 ? `停止 ${applianceTime(cycle.remaining)}`
          : `${mode.label} ${applianceTime(configuredSeconds)}`;
      display(state, running || cycle.finished);
    };
    const setDuration = (seconds: number) => {
      if (cycle.running) return;
      if (cycle.remaining > 0) cycle.set(seconds);
      else {
        configuredSeconds = seconds;
        cycle.set(0);
      }
      sync(0);
    };
    sync(0);
    this.updates.push(sync);
    this.register(fixture, frame, [
      { kind: 'toggle', id: 'power', label: '運転', get: () => cycle.running, set(value) {
        if (value) {
          if (!cycle.running && cycle.remaining === 0) {
            cycle.set(configuredSeconds);
            phase = 0;
          }
          cycle.start();
        } else cycle.stop();
        sync(0);
      } },
      { kind: 'select', id: 'mode', label: '運転モード', options: washerModes,
        get: () => mode.value, disabled: () => cycle.running, set(value) {
          const selected = washerModes.find(candidate => candidate.value === value);
          if (!selected || selected === mode || cycle.running) return;
          mode = selected;
          configuredSeconds = mode.seconds;
          cycle.set(0);
          sync(0);
        } },
      ...washerAdjustments.map(([step, label]) => {
        const disabled = () => cycle.running || (step < 0 ? selectedSeconds() <= washerDuration.min
          : selectedSeconds() >= washerDuration.max);
        return { kind: 'button' as const, id: `time-${step}`, label, disabled,
          invoke() {
            if (disabled()) return;
            setDuration(THREE.MathUtils.clamp(selectedSeconds() + step, washerDuration.min, washerDuration.max));
          } };
      }),
      { kind: 'button', id: 'reset-time', label: '標準時間に戻す', disabled: () => cycle.running,
        invoke: () => setDuration(mode.seconds) },
      { kind: 'output', id: 'status', label: '状態', read: () => cycle.running
        ? `${mode.label}中・残り ${applianceTime(cycle.remaining)}`
        : cycle.finished ? '完了' : cycle.remaining > 0 ? `停止中・残り ${applianceTime(cycle.remaining)}`
          : `待機中・設定 ${applianceTime(configuredSeconds)}` },
    ], { kind: 'washer', at: [0, .40, .28], level: () => cycle.running ? mode.level : 0,
      completionCount: () => cycle.completions });
  }

  addMicrowave(fixture: Fixture, model: FurnitureModel, m: ResidenceMaterials): void {
    const bottom = .892;
    const unit = model.at(...fixture.mount);
    const body = model.tone(m.metal, 0x7c7870);
    const handle = model.tone(m.brushedSteel, 0xbeb7a6);
    const cavity = this.own(new THREE.MeshStandardMaterial({ color: 0x77746b, roughness: .37,
      emissive: 0xb06124, emissiveIntensity: 0 }));
    const quartz = this.own(new THREE.MeshStandardMaterial({ color: 0xaf8860, roughness: .42,
      emissive: 0xf89839, emissiveIntensity: 0 }));
    unit.box(body, 0, bottom + .143, -.164, .526, .287, .028, .008);
    unit.box(body, 0, bottom + .272, .013, .526, .031, .364, .009);
    unit.box(body, 0, bottom + .015, .013, .526, .029, .364, .008);
    unit.box(body, -.249, bottom + .14, .013, .028, .269, .363, .008);
    unit.box(body, .178, bottom + .14, .013, .168, .268, .363, .011);
    unit.box(cavity, -.069, bottom + .147, -.145, .33, .218, .009, .006);
    unit.box(cavity, -.224, bottom + .147, .009, .012, .218, .310, .004);
    unit.box(cavity, .095, bottom + .147, .009, .012, .218, .310, .004);
    unit.box(cavity, -.067, bottom + .251, .009, .319, .022, .309, .004);
    unit.box(cavity, -.067, bottom + .032, .009, .319, .018, .309, .004);
    unit.box(quartz, .084, bottom + .175, -.042, .008, .052, .081, .004);
    for (const z of [-.103, -.064, -.025, .014, .053]) {
      unit.box(m.darkMetal, .259, bottom + .213, z, .012, .006, .021, .001);
    }
    for (const y of [.044, .251]) unit.box(m.darkMetal, -.066, bottom + y, .201, .388, .040, .022, .007);
    for (const x of [-.243, .110]) unit.box(m.darkMetal, x, bottom + .147, .201, .036, .240, .022, .007);
    unit.box(handle, .112, bottom + .147, .221, .016, .135, .018, .007);
    unit.box(m.darkMetal, .190, bottom + .143, .194, .127, .252, .013, .006);
    unit.box(m.darkMetal, .190, bottom + .216, .201, .102, .039, .008, .004);
    for (const x of [.162, .217]) {
      unit.box(body, x, bottom + .153, .203, .042, .025, .009, .005);
      unit.box(body, x, bottom + .116, .203, .042, .025, .009, .005);
    }
    unit.box(handle, .191, bottom + .061, .204, .098, .034, .011, .005);
    const frame = this.mount(fixture);
    const glass = this.own(new THREE.MeshStandardMaterial({ color: 0x282b2a, metalness: .26, roughness: .22,
      opacity: .63, transparent: true, depthWrite: false }));
    this.mesh(frame, new THREE.PlaneGeometry(.327, .170), glass, [-.066, bottom + .146, .206]);
    const plate = new THREE.Group();
    plate.position.set(-.066, bottom + .047, .005);
    frame.add(plate);
    this.mesh(plate, new THREE.CylinderGeometry(.119, .116, .011, 32), m.brushedSteel, [0, 0, 0]);
    this.mesh(plate, new THREE.LatheGeometry([
      [0, 0], [.034, 0], [.038, .004], [.049, .020], [.057, .032], [.055, .034],
      [.050, .031], [.044, .021], [.033, .008], [0, .008],
    ].map(([radius, height]) => new THREE.Vector2(radius, height)), 28), m.ceramic, [.026, .006, -.008]);
    const display = this.display(frame, [.190, bottom + .216, .206], .095, .033);
    const cycle = createApplianceCycle(this.now);
    const cannotAdd = (seconds: number) => cycle.running || cycle.remaining + seconds > maxMicrowaveSeconds;
    let paused = false;
    const sync = (dt: number) => {
      cycle.advance();
      cavity.emissiveIntensity = cycle.running ? .52 : 0;
      quartz.emissiveIntensity = cycle.running ? 1.65 : 0;
      glass.opacity = cycle.running ? .30 : .63;
      if (cycle.running) plate.rotation.y += .64 * dt;
      display(cycle.finished ? 'END' : applianceTime(cycle.remaining), cycle.running || cycle.finished);
    };
    sync(0);
    this.updates.push(sync);
    this.register(fixture, frame, [
      ...[10, 60].map(seconds => ({ kind: 'button' as const, id: `add-${seconds}`,
        label: seconds === 10 ? '+10秒' : '+1分', disabled: () => cannotAdd(seconds), invoke() {
          if (!cannotAdd(seconds)) cycle.set(cycle.remaining + seconds);
          sync(0);
        } })),
      { kind: 'button', id: 'start', label: '加熱開始・再開', disabled: () => cycle.running || cycle.remaining <= 0,
        invoke() { cycle.start(); sync(0); } },
      { kind: 'button', id: 'stop', label: '停止', disabled: () => !cycle.running,
        invoke() {
          if (!cycle.running) return;
          cycle.stop();
          paused = cycle.remaining > 0;
          sync(0);
        } },
      { kind: 'button', id: 'reset', label: '時間をリセット', disabled: () => cycle.running,
        invoke() { cycle.set(0); paused = false; sync(0); } },
      { kind: 'output', id: 'time', label: '残り時間', read: () => applianceTime(cycle.remaining) },
      { kind: 'output', id: 'status', label: '状態', read: () => cycle.running ? '加熱中'
        : cycle.finished ? '加熱完了' : paused ? '停止中' : cycle.remaining > 0 ? '時間設定済み' : '待機中' },
    ], { kind: 'microwave', at: [0, bottom + .15, .18], level: () => cycle.running ? .45 : 0,
      completionCount: () => cycle.completions });
  }

  private register(fixture: Fixture, frame: THREE.Group, controls: readonly ApplianceControl[],
    { at, ...sound }: Omit<ResidenceApplianceAudioSource, 'id' | 'position'> & { at: ApplianceAnchor }): void {
    const position = frame.localToWorld(new THREE.Vector3(...at));
    const section = { id: fixture.id, title: fixture.title, category: 'appliances' as const, controls,
      location: { roomId: fixture.room, markers: [[position.x, -position.z, position.x, -position.z] as const] } };
    this.panels.push(section);
    const room = RESIDENCE_ROOMS.find(room => room.id === fixture.room)!;
    this.nearbyFixtures.push({ section, position: frame.localToWorld(new THREE.Vector3(...fixture.approach)),
      rooms: room.rectangles });
    this.sources.push({ ...sound, id: fixture.id, position: frame.localToWorld(new THREE.Vector3(...at)) });
  }

  private mount(fixture: Fixture): THREE.Group {
    const [east, north, heading = 0] = fixture.mount;
    const frame = new THREE.Group();
    frame.name = fixture.id;
    frame.position.set(east, 0, -north);
    frame.rotation.y = heading;
    this.group.add(frame);
    return frame;
  }

  private own<T extends { dispose(): void }>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }

  private mesh(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, at: ApplianceAnchor) {
    const mesh = new THREE.Mesh(this.own(geometry), material);
    mesh.position.set(...at);
    group.add(mesh);
    return mesh;
  }

  private display(group: THREE.Group, at: ApplianceAnchor, width: number, height: number) {
    const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
    const paint = canvas?.getContext('2d');
    if (!canvas || !paint) return () => {};
    canvas.width = 256;
    canvas.height = Math.round(256 * height / width);
    const texture = this.own(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    const face = this.own(new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    this.mesh(group, new THREE.PlaneGeometry(width, height), face, at);
    let previous = '';
    let lit = false;
    return (text: string, active: boolean) => {
      if (text === previous && lit === active) return;
      previous = text;
      lit = active;
      paint.fillStyle = '#161c1d';
      paint.fillRect(0, 0, canvas.width, canvas.height);
      paint.fillStyle = active ? '#d2e9dd' : '#91a6a1';
      paint.font = `600 ${Math.floor(canvas.height * .62)}px ui-monospace, monospace`;
      paint.textAlign = 'center';
      paint.textBaseline = 'middle';
      paint.fillText(text, 128, canvas.height * .53, 234);
      texture.needsUpdate = true;
    };
  }
}
