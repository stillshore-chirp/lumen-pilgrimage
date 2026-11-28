import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3, type Camera } from 'three';
import type { WorldMonitorOutput } from '../../../monitor/monitorAudio';
import { atriumLocalTailMix, atriumSoundPath, type AtriumPoint } from './atriumAcoustics';
import { createAtriumRoomTail } from './atriumAudioSamples';
import { ATRIUM_BOUNDS, ATRIUM_LEVELS } from './atriumLayout';
import {
  ATRIUM_CAFE_PLAN, ATRIUM_CAFE_SPEAKERS, atriumCafeLocalPoint, atriumCafeWorldPoint, inAtriumCafe,
} from './atriumCafePlan';

type OutputId = WorldMonitorOutput['id'];
type Speaker = Readonly<{ id: string; position: readonly number[]; aim: readonly number[] }>;
type Arrival = Readonly<{ point: AtriumPoint; delay: number; gain: number; cutoff: number }>;
const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);

export const ATRIUM_MONITOR_SPEAKERS: readonly Speaker[] = ATRIUM_LEVELS.flatMap((level, floor) =>
  [-16, -32, -48].flatMap((z, row) => ([-1, 1] as const).map(side => ({
    id: `atrium-${floor + 1}-${row + 1}-${side < 0 ? 'L' : 'R'}`,
    position: [side * (ATRIUM_BOUNDS.maxX - .32), level - .67, z],
    aim: [-side * .8, -.6, 0],
  }))));

export function createAtriumMonitorSpeakers(parent: Group): void {
  const cabinet = new BoxGeometry(.30, .28, .21);
  const grille = new BoxGeometry(.255, .225, .012);
  const casing = new MeshStandardMaterial({ color: 0xd8d4c8, roughness: .76 });
  const cloth = new MeshStandardMaterial({ color: 0x3c4140, roughness: .95 });
  for (const speaker of ATRIUM_MONITOR_SPEAKERS) {
    const group = new Group();
    group.name = speaker.id;
    group.position.set(speaker.position[0], speaker.position[1], speaker.position[2]);
    group.lookAt(group.position.clone().add(new Vector3(...speaker.aim)));
    group.add(new Mesh(cabinet, casing));
    const front = new Mesh(grille, cloth);
    front.position.z = .111;
    group.add(front);
    // A rear standoff contacts the gallery wall; no unsupported floating boxes.
    const mount = new Mesh(new BoxGeometry(.12, .12, .34), casing);
    mount.position.z = -.24;
    group.add(mount);
    parent.add(group);
  }
}

function point(values: readonly number[]): AtriumPoint {
  return { x: values[0], y: values[1], z: values[2] };
}

function distance(a: AtriumPoint, b: AtriumPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Stereo reference: atrium faces -Z; the cafe entrance faces into the room along +X. */
export function atriumMonitorChannel(id: OutputId, speaker: Speaker): 0 | 1 {
  if (id === 'cafe') {
    const local = atriumCafeLocalPoint(speaker.position[0], speaker.position[2]);
    return local.u > ATRIUM_CAFE_PLAN.width * .5 ? 0 : 1;
  }
  return speaker.position[0] < 0 ? 0 : 1;
}

const entrance = point(atriumCafeWorldPoint(
  (ATRIUM_CAFE_PLAN.entrance[0] + ATRIUM_CAFE_PLAN.entrance[1]) * .5,
  ATRIUM_CAFE_PLAN.entrance[2], 1.65,
));

function cafePartitionBlocked(source: AtriumPoint, listener: AtriumPoint): boolean {
  const a = atriumCafeLocalPoint(source.x, source.z);
  const b = atriumCafeLocalPoint(listener.x, listener.z);
  const [u, d, width, depth] = ATRIUM_CAFE_PLAN.staffRoom;
  let start = 0;
  let end = 1;
  for (const [from, delta, low, high] of [[a.u, b.u - a.u, u, u + width], [a.d, b.d - a.d, d, d + depth]]) {
    if (Math.abs(delta) < 1e-9) {
      if (from < low || from > high) return false;
    } else {
      const first = (low - from) / delta;
      const last = (high - from) / delta;
      start = Math.max(start, Math.min(first, last));
      end = Math.min(end, Math.max(first, last));
      if (start > end) return false;
    }
  }
  return end > .001 && start < .999;
}

/** Shared architectural opening, not a ray through an opaque shop side wall. */
export function atriumMonitorPath(id: OutputId, speaker: Speaker, listener: AtriumPoint) {
  const source = point(speaker.position);
  const inCafe = inAtriumCafe(listener.x, listener.z) && listener.y < ATRIUM_CAFE_PLAN.ceiling;
  if (id === 'cafe' && inCafe) {
    const directDistance = distance(source, listener);
    const blocked = cafePartitionBlocked(source, listener);
    const gain = (2.2 / (2.2 + directDistance)) ** .74 * (blocked ? .12 : 1);
    const reflections = [0, ATRIUM_CAFE_PLAN.ceiling].map((wall, index): Arrival => {
      const image = { ...source, y: 2 * wall - source.y };
      const reflectedDistance = distance(image, listener);
      return { point: image, delay: Math.max(0, (reflectedDistance - directDistance) / 343),
        gain: blocked ? 0 : gain * directDistance / Math.max(1, reflectedDistance) * (index === 0 ? .20 : .29), cutoff: 4_800 };
    });
    return { point: source, gain, cutoff: blocked ? 900 : 8_000, lateSend: gain * .24, reflections, sheltered: 1 };
  }
  const throughOpening = id === 'cafe' || inCafe;
  const path = atriumSoundPath(inCafe ? entrance : listener, id === 'cafe' ? entrance : source);
  if (!throughOpening) return { point: source, gain: path.gain, cutoff: path.cutoff,
    lateSend: path.lateSend, reflections: path.reflections, sheltered: atriumLocalTailMix(listener) };
  const interiorDistance = distance(id === 'cafe' ? source : listener, entrance);
  const openingGain = .32 * (2.2 / (2.2 + interiorDistance)) ** .74;
  return { point: entrance, gain: path.gain * openingGain, cutoff: Math.min(1_800, path.cutoff),
    lateSend: path.lateSend * openingGain, reflections: path.reflections.map(reflection => ({
      ...reflection, point: inCafe ? entrance : reflection.point,
      cutoff: Math.min(1_800, reflection.cutoff), gain: reflection.gain * openingGain,
    })), sheltered: Number(inCafe) };
}

function move(panner: PannerNode, location: AtriumPoint, now: number, snap: boolean): void {
  for (const axis of ['X', 'Y', 'Z'] as const) {
    const value = location[axis.toLowerCase() as 'x' | 'y' | 'z'];
    if (snap) panner[`position${axis}`].setValueAtTime(value, now);
    else panner[`position${axis}`].setTargetAtTime(value, now, .025);
  }
}

function createPlayback(context: BaseAudioContext, source: AudioNode, output: AudioNode, id: OutputId) {
  const speakers = id === 'cafe' ? ATRIUM_CAFE_SPEAKERS : ATRIUM_MONITOR_SPEAKERS;
  const owned: AudioNode[] = [];
  const own = <T extends AudioNode>(node: T): T => { owned.push(node); return node; };
  const layout = own(context.createGain());
  layout.channelCount = 2;
  layout.channelCountMode = 'explicit';
  layout.channelInterpretation = 'speakers';
  const splitter = own(context.createChannelSplitter(2));
  const panners: PannerNode[] = [];
  const listener = new Vector3();
  const previous = new Vector3(Infinity, 0, 0);
  let disposed = false;
  let initialized = false;
  let nextUpdate = 0;
  let quality: 'light' | 'high' = 'light';
  const panner = () => {
    const node = own(context.createPanner());
    node.panningModel = quality === 'high' ? 'HRTF' : 'equalpower';
    node.rolloffFactor = 0;
    node.coneInnerAngle = node.coneOuterAngle = 360;
    panners.push(node);
    return node;
  };
  const response = (input: AudioNode, seed: number, room: 'void' | 'sheltered') => {
    const level = own(context.createGain());
    level.gain.value = 0;
    const convolver = own(context.createConvolver());
    convolver.normalize = false;
    convolver.buffer = createAtriumRoomTail(context, seed, room);
    input.connect(level).connect(convolver).connect(output);
    return level;
  };
  try {
    layout.connect(splitter);
    // Independent input responses retain anti-phase stereo in the room tail.
    const rooms = [0, 1].map(channel => {
      const input = own(context.createGain());
      splitter.connect(input, channel);
      return { open: response(input, 38_021 + channel * 1_019, 'void'),
        local: response(input, 18_233 + channel * 1_711, 'sheltered') };
    });
    const voices = speakers.map((speaker, index) => {
      const sum = own(context.createGain());
      sum.channelCount = 1;
      sum.channelCountMode = 'explicit';
      sum.channelInterpretation = 'discrete';
      // Alternate actual L/R feeds, with a small opposite-channel contribution.
      const side = atriumMonitorChannel(id, speaker);
      for (let channel = 0; channel < 2; channel += 1) {
        const gain = own(context.createGain());
        gain.gain.value = (channel === side ? .85 : .15) * .9 / Math.sqrt(speakers.length);
        splitter.connect(gain, channel).connect(sum);
      }
      const highpass = own(context.createBiquadFilter());
      highpass.type = 'highpass';
      highpass.frequency.value = id === 'cafe' ? 72 : 100;
      highpass.Q.value = BUTTERWORTH_Q_DB;
      const phase = own(context.createBiquadFilter());
      phase.type = 'allpass';
      phase.frequency.value = 520 + index * 73;
      phase.Q.value = Math.SQRT1_2;
      const zoneDelay = own(context.createDelay(.02));
      zoneDelay.delayTime.value = .001 + index * .00043;
      sum.connect(highpass).connect(phase).connect(zoneDelay);
      const arrivals = Array.from({ length: 3 }, () => {
        const delay = own(context.createDelay(.2));
        const filter = own(context.createBiquadFilter());
        filter.type = 'lowpass';
        filter.Q.value = BUTTERWORTH_Q_DB;
        const gain = own(context.createGain());
        gain.gain.value = 0;
        const pan = panner();
        zoneDelay.connect(delay).connect(filter).connect(gain).connect(pan).connect(output);
        return { delay, filter, gain, pan };
      });
      return { speaker, arrivals };
    });
    source.connect(layout);
    return {
      setQuality(value: 'light' | 'high') {
        if (disposed || quality === value) return;
        quality = value;
        panners.forEach(node => { node.panningModel = value === 'high' ? 'HRTF' : 'equalpower'; });
        nextUpdate = 0;
      },
      update(camera: Camera) {
        if (disposed) return;
        camera.getWorldPosition(listener);
        const now = context.currentTime;
        if (initialized && now < nextUpdate && previous.distanceToSquared(listener) < .01) return;
        const paths = voices.map(voice => atriumMonitorPath(id, voice.speaker, listener));
        const weighted = paths.reduce((sum, path) => sum + path.gain * .9 / Math.sqrt(speakers.length), 0);
        // Keep a close approach from increasing the coherent aggregate without limit.
        const trim = Math.min(1, .62 / Math.max(.001, weighted));
        let tail = 0;
        voices.forEach((voice, index) => {
          const path = paths[index];
          const sourcePoint = point(voice.speaker.position);
          const target = path.point.x === sourcePoint.x && path.point.z === sourcePoint.z ? listener : path.point;
          const dx = target.x - sourcePoint.x;
          const dy = target.y - sourcePoint.y;
          const dz = target.z - sourcePoint.z;
          const length = Math.hypot(dx, dy, dz);
          const dot = length > .001 ? (voice.speaker.aim[0] * dx + voice.speaker.aim[1] * dy
            + voice.speaker.aim[2] * dz) / length : 1;
          const aim = .28 + .72 * Math.max(0, Math.min(1, dot));
          voice.arrivals.forEach((arrival, arrivalIndex) => {
            const reflection = path.reflections[arrivalIndex - 1];
            const gain = arrivalIndex === 0 ? path.gain * aim
              : reflection?.gain && (quality === 'high' || arrivalIndex === 1) ? reflection.gain * .55 : 0;
            const at = arrivalIndex === 0 ? path.point : reflection?.point ?? path.point;
            const delay = arrivalIndex === 0 ? 0 : reflection?.delay ?? 0;
            move(arrival.pan, at, now, !initialized);
            const adjust = (parameter: AudioParam, value: number) => {
              if (!initialized) parameter.setValueAtTime(value, now);
              else parameter.setTargetAtTime(value, now, .025);
            };
            adjust(arrival.gain.gain, gain * trim);
            adjust(arrival.filter.frequency, arrivalIndex === 0 ? path.cutoff : reflection?.cutoff ?? path.cutoff);
            adjust(arrival.delay.delayTime, Math.min(.19, delay));
          });
          tail += path.lateSend / speakers.length;
        });
        const local = paths.reduce((sum, path) => sum + path.sheltered, 0) / paths.length;
        rooms.forEach(room => {
          const level = Math.min(.16, tail * .55) * trim;
          room.open.gain.setTargetAtTime(level * Math.sqrt(1 - local), now, .04);
          room.local.gain.setTargetAtTime(level * Math.sqrt(local), now, .04);
        });
        initialized = true;
        previous.copy(listener);
        nextUpdate = now + .05;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        source.disconnect(layout);
        owned.forEach(node => node.disconnect());
      },
    };
  } catch {
    owned.forEach(node => node.disconnect());
    throw new Error('World speaker playback unavailable');
  }
}

export function createAtriumMonitorOutputs(): readonly WorldMonitorOutput[] {
  return [
    { id: 'atrium', label: '館内スピーカー', createAudio: (context, source, output) => createPlayback(context, source, output, 'atrium') },
    { id: 'cafe', label: 'カフェのスピーカー', createAudio: (context, source, output) => createPlayback(context, source, output, 'cafe') },
  ];
}
