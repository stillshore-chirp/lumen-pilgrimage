import { cinemaBandShelves } from './cinemaPropagation';
import { Quaternion, Vector3, type Camera } from 'three';
import {
  CINEMA_BANDS, CINEMA_REFLECTION_LIMIT, CINEMA_SCREEN_BANDS, CINEMA_WOVEN_FABRIC,
  cinemaDecibels, cinemaReflections, cinemaReflectionTaper, cinemaSeatDrr, cinemaSeatTrim, cinemaSpeakerLoss,
  createCinemaTail, type CinemaQuality, type CinemaReflection, type CinemaSpeaker,
} from './cinemaAcoustics';
import { CINEMA_ROWS } from './cinemaLayout';
import { createCinemaSharedRouting } from './cinemaSharedRouting';

const PATH_UPDATE_SECONDS = 0.05;
const CROSSFADE_SECONDS = 0.15;
const EARLY_SHARE = 0.60;
const SPECTRAL_GLIDE = 0.035;
// Match the coherent shared programme to the native HRTF reference by reducing
// the lightweight dry/early branch. The shared late IR is not part of this trim.
const LIGHT_QUALITY_LEVEL = cinemaDecibels(-3.5);

function qualityLevel(quality: CinemaQuality): number {
  return quality === 'light' ? LIGHT_QUALITY_LEVEL : 1;
}

interface Feed {
  speaker: CinemaSpeaker;
  id: string;
  routingGain: number;
  roomScale: number;
  signal: AudioNode;
  tail: GainNode | null;
}

interface SceneVoice {
  gain: GainNode;
  pan: PannerNode;
  dispose(): void;
}

interface DryVoice extends SceneVoice {
  feed: Feed;
  spectrum: BiquadFilterNode[];
}

interface ReflectionVoice extends SceneVoice {
  delay: DelayNode;
  spectrum: BiquadFilterNode[];
  releaseAt: number;
}

interface ReflectionCandidate {
  feed: Feed;
  path: CinemaReflection;
  id: string;
  strength: number;
}

interface ListeningGraph {
  quality: CinemaQuality;
  gain: GainNode;
  alignment?: DelayNode;
  dry: DryVoice[];
  reflections: Map<string, ReflectionVoice>;
  releaseAt: number;
}

function filterChain(context: BaseAudioContext, bands: readonly number[]): BiquadFilterNode[] {
  const filters: BiquadFilterNode[] = [];
  try {
    for (const { frequency } of cinemaBandShelves(bands, bands.map(() => 0))) {
      const filter = context.createBiquadFilter();
      filters.push(filter);
      filter.type = 'highshelf';
      filter.frequency.value = frequency;
    }
    return filters;
  } catch {
    filters.forEach(filter => filter.disconnect());
    throw new Error('Cinema spectrum unavailable');
  }
}

function appendFilters(input: AudioNode, filters: BiquadFilterNode[]): AudioNode {
  const edges: { source: AudioNode; target: AudioNode }[] = [];
  let source = input;
  try {
    for (const filter of filters) {
      source.connect(filter);
      edges.push({ source, target: filter });
      source = filter;
    }
    return source;
  } catch {
    for (let index = edges.length - 1; index >= 0; index--) edges[index].source.disconnect(edges[index].target);
    throw new Error('Cinema spectrum connection unavailable');
  }
}

function spectralLoss(filters: BiquadFilterNode[], db: readonly number[], time: number, snap: boolean): void {
  filters.forEach((filter, i) => adjust(filter.gain, db[i + 1] - db[i], time, SPECTRAL_GLIDE, snap));
}

function adjust(parameter: AudioParam, value: number, time: number, glide: number, snap = false): void {
  parameter.cancelScheduledValues(time);
  if (snap) parameter.setValueAtTime(value, time);
  else parameter.setTargetAtTime(value, time, glide);
}

function positionPan(panner: PannerNode, point: Vector3, time: number, snap = true): void {
  adjust(panner.positionX, point.x, time, SPECTRAL_GLIDE, snap);
  adjust(panner.positionY, point.y, time, SPECTRAL_GLIDE, snap);
  adjust(panner.positionZ, point.z, time, SPECTRAL_GLIDE, snap);
}

function audioVoice(context: BaseAudioContext, input: AudioNode, output: AudioNode, quality: CinemaQuality): SceneVoice {
  const gain = context.createGain();
  let pan: PannerNode | undefined;
  let connected = false;
  try {
    const panner = context.createPanner();
    pan = panner;
    panner.panningModel = quality === 'high' ? 'HRTF' : 'equalpower';
    panner.rolloffFactor = 0;
    gain.gain.value = 0;
    input.connect(gain);
    connected = true;
    gain.connect(panner).connect(output);
    return { gain, pan: panner, dispose: () => { input.disconnect(gain); gain.disconnect(); panner.disconnect(); } };
  } catch {
    if (connected) input.disconnect(gain);
    gain.disconnect();
    pan?.disconnect();
    throw new Error('Cinema spatial voice unavailable');
  }
}

function peakStage(context: BaseAudioContext): WaveShaperNode {
  const node = context.createWaveShaper();
  const curve = new Float32Array(2049);
  const ceiling = cinemaDecibels(-1);
  const knee = 0.74;
  for (let i = 0; i < curve.length; i += 1) {
    const sample = 2 * i / (curve.length - 1) - 1;
    const magnitude = Math.abs(sample);
    const unit = Math.max(0, (magnitude - knee) / (1 - knee));
    const compressed = knee + (ceiling - knee) * (2 * unit - unit ** 2);
    curve[i] = Math.sign(sample) * (magnitude <= knee ? magnitude : compressed);
  }
  node.curve = curve;
  return node;
}

function pickReflections(feeds: Feed[], position: Vector3, limit: number): ReflectionCandidate[] {
  const candidates = feeds.flatMap(feed => cinemaReflections(feed.speaker, position).flatMap(path => {
    const strength = path.amplitude[2] * cinemaReflectionTaper(path.delay);
    return strength > 0.0001 ? [{ feed, path, strength, id: `${feed.id}:${path.surface}` }] : [];
  }));
  return candidates.sort((a, b) => b.strength * b.feed.routingGain - a.strength * a.feed.routingGain).slice(0, limit);
}

/** The monitor owns the context, input, output and the user gesture used to start playback. */
export function createCinemaPlayback(context: BaseAudioContext, input: AudioNode, output: AudioNode, channelCount: number) {
  const routing = createCinemaSharedRouting(context, input, channelCount);
  const owned: AudioNode[] = [];
  try {
    return createListeningPlayback(context, output, routing, owned);
  } catch {
    routing.dispose();
    owned.forEach(node => node.disconnect());
    throw new Error('Cinema shared playback unavailable');
  }
}

function createListeningPlayback(context: BaseAudioContext, output: AudioNode,
  routing: ReturnType<typeof createCinemaSharedRouting>, owned: AudioNode[]) {
  const peak = peakStage(context);
  const hrtfAlignment = Math.round(0.00585 * context.sampleRate) / context.sampleRate;
  const diffuseAlignment = context.createDelay(0.02);
  diffuseAlignment.delayTime.value = hrtfAlignment;
  const feeds: Feed[] = [];
  owned.push(peak, diffuseAlignment);
  const active = new Map<CinemaQuality, ListeningGraph>();
  const position = new Vector3(0.39, CINEMA_ROWS[8].y + 1.15, CINEMA_ROWS[8].z);
  const previous = new Vector3();
  const rotation = new Quaternion();
  const forward = new Vector3();
  const up = new Vector3();
  let quality: CinemaQuality = 'light';
  let nextPathUpdate = 0;
  let disposed = false;
  let hasPose = false;
  let crossfade = { from: 0, to: 0, start: 0 };

  peak.connect(output);
  diffuseAlignment.connect(peak);
  routing.feeds.forEach(({ speaker: equipment, signal: source, coefficients, roomScale }, channel) => {
    const isSub = equipment.kind === 'screenSub' || equipment.kind === 'surroundSub';
    const speaker: CinemaSpeaker = {
      id: isSub ? 'LFE' : equipment.kind === 'screen' ? 'C' : equipment.position[0] < 0 ? 'SL' : 'SR',
      position: new Vector3(...equipment.position), aim: new Vector3(...equipment.aim),
      screen: equipment.kind === 'screen',
    };
    let signal: AudioNode = source;
    let tail: GainNode | null = null;
    if (speaker.screen) {
      const filters = filterChain(context, CINEMA_SCREEN_BANDS);
      spectralLoss(filters, CINEMA_WOVEN_FABRIC, context.currentTime, true);
      signal = appendFilters(source, filters);
      owned.push(...filters);
    }
    if (roomScale > 0) {
      const convolution = context.createConvolver();
      convolution.normalize = false;
      // Each source has its own stereo IR. Inverted L/R still excite the room.
      convolution.buffer = createCinemaTail(context, 20_281 + 1_171 * channel);
      tail = context.createGain();
      tail.gain.value = 0;
      signal.connect(tail).connect(convolution).connect(diffuseAlignment);
      owned.push(convolution, tail);
    }
    feeds.push({ speaker, id: equipment.id, roomScale,
      routingGain: coefficients.reduce((sum, value) => sum + Math.abs(value), 0), signal, tail });
  });

  function newGraph(mode: CinemaQuality, audible: boolean): ListeningGraph {
    const gain = context.createGain();
    gain.gain.value = Number(audible) * qualityLevel(mode);
    const graph: ListeningGraph = { quality: mode, gain, dry: [], reflections: new Map(), releaseAt: Infinity };
    // HRTF convolution has a small renderer delay. Align the lightweight
    // branch for crossfades while keeping synchronized media inside its budget.
    try {
      graph.alignment = mode === 'light' ? context.createDelay(0.02) : undefined;
      if (graph.alignment) {
        graph.alignment.delayTime.value = hrtfAlignment;
        gain.connect(graph.alignment).connect(peak);
      } else gain.connect(peak);
      for (const feed of feeds) {
        const spectrum = filterChain(context, CINEMA_BANDS);
        let connected = false;
        let voice: SceneVoice | undefined;
        try {
          const ending = appendFilters(feed.signal, spectrum);
          connected = true;
          voice = audioVoice(context, ending, gain, mode);
          positionPan(voice.pan, feed.speaker.position, context.currentTime);
          const completed = voice;
          graph.dry.push({ ...completed, feed, spectrum, dispose: () => {
            completed.dispose();
            feed.signal.disconnect(spectrum[0]);
            spectrum.forEach(filter => filter.disconnect());
          } });
        } catch {
          voice?.dispose();
          if (connected) feed.signal.disconnect(spectrum[0]);
          spectrum.forEach(filter => filter.disconnect());
          throw new Error('Cinema direct graph unavailable');
        }
      }
      active.set(mode, graph);
      return graph;
    } catch {
      destroyGraph(graph);
      throw new Error('Cinema listening graph unavailable');
    }
  }

  function makeReflection(graph: ListeningGraph, candidate: ReflectionCandidate): ReflectionVoice {
    const delay = context.createDelay(0.1);
    let spectrum: BiquadFilterNode[] = [];
    let voice: SceneVoice | undefined;
    let connected = false;
    try {
      spectrum = filterChain(context, CINEMA_BANDS);
      const end = appendFilters(delay, spectrum);
      voice = audioVoice(context, end, graph.gain, graph.quality);
      candidate.feed.signal.connect(delay);
      connected = true;
      const completed = voice;
      return { ...completed, delay, spectrum, releaseAt: Infinity, dispose: () => {
        completed.dispose();
        candidate.feed.signal.disconnect(delay);
        delay.disconnect();
        spectrum.forEach(filter => filter.disconnect());
      } };
    } catch {
      if (connected) candidate.feed.signal.disconnect(delay);
      voice?.dispose();
      delay.disconnect();
      spectrum.forEach(filter => filter.disconnect());
      throw new Error('Cinema reflected graph unavailable');
    }
  }

  function destroyGraph(graph: ListeningGraph): void {
    graph.dry.forEach(voice => voice.dispose());
    graph.reflections.forEach(voice => voice.dispose());
    graph.gain.disconnect();
    graph.alignment?.disconnect();
    active.delete(graph.quality);
  }

  function readPosition(camera: Camera): void {
    camera.getWorldPosition(position);
    camera.getWorldQuaternion(rotation);
    forward.set(0, 0, -1).applyQuaternion(rotation);
    up.set(0, 1, 0).applyQuaternion(rotation);
    const listener = context.listener;
    listener.positionX.value = position.x;
    listener.positionY.value = position.y;
    listener.positionZ.value = position.z;
    listener.forwardX.value = forward.x;
    listener.forwardY.value = forward.y;
    listener.forwardZ.value = forward.z;
    listener.upX.value = up.x;
    listener.upY.value = up.y;
    listener.upZ.value = up.z;
  }

  function updateGeometry(now: number, snap: boolean, movedSeat: boolean): void {
    const dryGain = cinemaDecibels(cinemaSeatTrim(position));
    const reflectionGain = dryGain / cinemaDecibels(cinemaSeatDrr(position));
    const selected = pickReflections(feeds, position, CINEMA_REFLECTION_LIMIT[quality]);
    for (const feed of feeds) {
      const hasEarly = selected.some(candidate => candidate.feed === feed);
      if (feed.tail) adjust(feed.tail.gain, feed.roomScale * reflectionGain * Math.sqrt(hasEarly ? 1 - EARLY_SHARE : 1),
        now, SPECTRAL_GLIDE, snap);
    }
    for (const graph of active.values()) {
      for (const voice of graph.dry) {
        const speaker = voice.feed.speaker;
        const distance = Math.max(1, speaker.position.distanceTo(position));
        const db = cinemaSpeakerLoss(speaker, position, distance);
        spectralLoss(voice.spectrum, db, now, snap);
        const speechTrim = (db[2] + db[3] + db[4]) / 3;
        // Retain the shared front programme's seat-coverage calibration. Local
        // diffusion/bass cabinets use their own distance and broadband aim loss.
        const distanceGain = speaker.screen ? 1 : Math.min(1.6, 22 / distance);
        adjust(voice.gain.gain, dryGain * distanceGain
          * cinemaDecibels(db[0] - (speaker.screen ? speechTrim : 0)), now, SPECTRAL_GLIDE, snap);
      }
      const limit = CINEMA_REFLECTION_LIMIT[graph.quality];
      const candidates = graph.quality === quality ? selected : pickReflections(feeds, position, limit);
      for (const [id, voice] of graph.reflections) {
        if (voice.releaseAt <= now) {
          voice.dispose();
          graph.reflections.delete(id);
        } else if (!candidates.some(candidate => candidate.id === id) && voice.releaseAt === Infinity) {
          adjust(voice.gain.gain, 0, now, CROSSFADE_SECONDS / 5);
          voice.releaseAt = now + CROSSFADE_SECONDS;
        }
      }
      for (const candidate of candidates) {
        let voice = graph.reflections.get(candidate.id);
        const isNew = !voice;
        if (!voice) {
          if (graph.reflections.size >= limit) continue;
          voice = makeReflection(graph, candidate);
          graph.reflections.set(candidate.id, voice);
        }
        voice.releaseAt = Infinity;
        const { path } = candidate;
        // A seat jump must not glide the delay through tens of milliseconds and bend the soundtrack.
        if (movedSeat && !isNew) {
          adjust(voice.gain.gain, 0, now, 0.005);
          voice.delay.delayTime.setValueAtTime(path.delay, now + 0.03);
        } else adjust(voice.delay.delayTime, path.delay, now, SPECTRAL_GLIDE, snap || isNew);
        positionPan(voice.pan, path.point, now, snap || isNew || movedSeat);
        const db = path.amplitude.map(value => 20 * Math.log10(value));
        spectralLoss(voice.spectrum, db, now, snap || isNew);
        const earlyEnergy = candidates.reduce((sum, item) => sum + (item.feed === candidate.feed ? item.strength ** 2 : 0), 0);
        const relative = path.amplitude[0] * cinemaReflectionTaper(path.delay);
        const amplitude = reflectionGain * relative * Math.sqrt(EARLY_SHARE / earlyEnergy);
        const gainAt = movedSeat && !isNew ? now + 0.035 : now;
        adjust(voice.gain.gain, amplitude, gainAt, CROSSFADE_SECONDS / 5, snap);
      }
    }
  }

  return {
    setQuality(mode: CinemaQuality): void {
      if (disposed || mode === quality) return;
      const now = context.currentTime;
      const incoming = active.get(mode);
      if (hasPose) {
        const next = incoming ?? newGraph(mode, false);
        next.releaseAt = Infinity;
        const outgoing = active.get(quality);
        if (outgoing) outgoing.releaseAt = now + CROSSFADE_SECONDS;
        // Resume an interrupted crossfade at the current angle. Equal-power
        // weights limit dips while the two panners use different filters.
        const fraction = Math.min(1, (now - crossfade.start) / CROSSFADE_SECONDS);
        const from = crossfade.from + (crossfade.to - crossfade.from) * fraction;
        const to = Number(mode === 'high');
        crossfade = { from, to, start: now };
        for (const graph of active.values()) {
          const wave = graph.quality === 'high' ? Math.sin : Math.cos;
          const curve = Float32Array.from({ length: 33 }, (_, i) =>
            qualityLevel(graph.quality) * wave(Math.PI * 0.5 * (from + (to - from) * i / 32)));
          graph.gain.gain.cancelScheduledValues(0);
          graph.gain.gain.setValueCurveAtTime(curve, now, CROSSFADE_SECONDS);
        }
      }
      quality = mode;
      nextPathUpdate = now;
    },
    update(camera: Camera): void {
      if (disposed) return;
      const now = context.currentTime;
      readPosition(camera);
      if (now < nextPathUpdate) return;
      const first = !hasPose;
      if (first) {
        newGraph(quality, true);
        const mode = Number(quality === 'high');
        crossfade = { from: mode, to: mode, start: now };
      }
      for (const graph of active.values()) if (graph.releaseAt <= now) destroyGraph(graph);
      const movedSeat = !first && previous.distanceToSquared(position) > 9;
      updateGeometry(now, first, movedSeat);
      hasPose = true;
      previous.copy(position);
      nextPathUpdate = now + PATH_UPDATE_SECONDS;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Listening children own edges from routing feeds. Retire them before
      // disconnecting their common parent nodes.
      active.forEach(destroyGraph);
      routing.dispose();
      owned.forEach(node => node.disconnect());
    },
  };
}
