import { Quaternion, Vector3, type Camera } from 'three';
import {
  CINEMA_BANDS, CINEMA_REFLECTION_LIMIT, CINEMA_SCREEN_BANDS, CINEMA_SPEAKERS, CINEMA_WOVEN_FABRIC,
  cinemaDecibels, cinemaReflections, cinemaReflectionTaper, cinemaSeatDrr, cinemaSeatTrim, cinemaSpeakerLoss,
  createCinemaTail, type CinemaQuality, type CinemaReflection, type CinemaSpeaker,
} from './cinemaAcoustics';
import { CINEMA_ROWS } from './cinemaLayout';

const PATH_UPDATE_SECONDS = 0.05;
const CROSSFADE_SECONDS = 0.15;
const EARLY_SHARE = 0.60;
const SPECTRAL_GLIDE = 0.035;

interface Feed {
  speaker: CinemaSpeaker;
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
  return bands.slice(1).map((frequency, index) => {
    const filter = context.createBiquadFilter();
    filter.type = 'highshelf';
    filter.frequency.value = Math.sqrt(frequency * bands[index]);
    return filter;
  });
}

function appendFilters(input: AudioNode, filters: BiquadFilterNode[]): AudioNode {
  return filters.reduce<AudioNode>((source, filter) => source.connect(filter), input);
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
  const pan = context.createPanner();
  pan.panningModel = quality === 'high' ? 'HRTF' : 'equalpower';
  pan.rolloffFactor = 0;
  gain.gain.value = 0;
  input.connect(gain).connect(pan).connect(output);
  return { gain, pan, dispose: () => { input.disconnect(gain); gain.disconnect(); pan.disconnect(); } };
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
    return strength > 0.0001 ? [{ feed, path, strength, id: `${feed.speaker.id}:${path.surface}` }] : [];
  }));
  return candidates.sort((a, b) => b.strength - a.strength).slice(0, limit);
}

/** The monitor owns the context, input, output and the user gesture used to start playback. */
export function createCinemaPlayback(context: BaseAudioContext, input: AudioNode, output: AudioNode, channelCount: number) {
  const speakers = channelCount === 1 ? [CINEMA_SPEAKERS[2]] : channelCount === 6
    ? CINEMA_SPEAKERS : CINEMA_SPEAKERS.slice(0, 2);
  const layout = context.createGain();
  layout.channelCount = speakers.length;
  layout.channelCountMode = 'explicit';
  layout.channelInterpretation = channelCount === 6 ? 'discrete' : 'speakers';
  const splitter = context.createChannelSplitter(speakers.length);
  const peak = peakStage(context);
  const hrtfAlignment = Math.round(0.00585 * context.sampleRate) / context.sampleRate;
  const diffuseAlignment = context.createDelay(0.02);
  diffuseAlignment.delayTime.value = hrtfAlignment;
  const feeds: Feed[] = [];
  const owned: AudioNode[] = [layout, splitter, peak, diffuseAlignment];
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

  input.connect(layout).connect(splitter);
  peak.connect(output);
  diffuseAlignment.connect(peak);
  speakers.forEach((speaker, channel) => {
    const source = context.createGain();
    splitter.connect(source, channel);
    owned.push(source);
    let signal: AudioNode = source;
    let tail: GainNode | null = null;
    if (speaker.screen) {
      const filters = filterChain(context, CINEMA_SCREEN_BANDS);
      spectralLoss(filters, CINEMA_WOVEN_FABRIC, context.currentTime, true);
      signal = appendFilters(source, filters);
      owned.push(...filters);
    }
    if (speaker.id === 'LFE') {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 120;
      filter.Q.value = Math.SQRT1_2;
      signal.connect(filter);
      signal = filter;
      owned.push(filter);
    } else {
      const convolution = context.createConvolver();
      convolution.normalize = false;
      // Each source has its own stereo IR. Inverted L/R still excite the room.
      convolution.buffer = createCinemaTail(context, 20_281 + 1_171 * channel);
      tail = context.createGain();
      tail.gain.value = 0;
      signal.connect(tail).connect(convolution).connect(diffuseAlignment);
      owned.push(convolution, tail);
    }
    feeds.push({ speaker, signal, tail });
  });

  function newGraph(mode: CinemaQuality, audible: boolean): ListeningGraph {
    const gain = context.createGain();
    gain.gain.value = Number(audible);
    // HRTF convolution has a small renderer delay. Align the lightweight
    // branch for crossfades while keeping synchronized media inside its budget.
    const alignment = mode === 'light' ? context.createDelay(0.02) : undefined;
    if (alignment) {
      alignment.delayTime.value = hrtfAlignment;
      gain.connect(alignment).connect(peak);
    } else gain.connect(peak);
    const dry = feeds.map(feed => {
      const spectrum = filterChain(context, CINEMA_BANDS);
      const ending = appendFilters(feed.signal, spectrum);
      const voice = audioVoice(context, ending, gain, mode);
      positionPan(voice.pan, feed.speaker.position, context.currentTime);
      return {
        ...voice, feed, spectrum,
        dispose: () => {
          voice.dispose();
          feed.signal.disconnect(spectrum[0]);
          spectrum.forEach(filter => filter.disconnect());
        },
      };
    });
    const graph: ListeningGraph = { quality: mode, gain, alignment, dry, reflections: new Map(), releaseAt: Infinity };
    active.set(mode, graph);
    return graph;
  }

  function makeReflection(graph: ListeningGraph, candidate: ReflectionCandidate): ReflectionVoice {
    const delay = context.createDelay(0.1);
    const spectrum = filterChain(context, CINEMA_BANDS);
    const end = appendFilters(delay, spectrum);
    const voice = audioVoice(context, end, graph.gain, graph.quality);
    candidate.feed.signal.connect(delay);
    return {
      ...voice, delay, spectrum, releaseAt: Infinity,
      dispose: () => {
        voice.dispose();
        candidate.feed.signal.disconnect(delay);
        delay.disconnect();
        spectrum.forEach(filter => filter.disconnect());
      },
    };
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
      if (feed.tail) adjust(feed.tail.gain, reflectionGain * Math.sqrt(hasEarly ? 1 - EARLY_SHARE : 1),
        now, SPECTRAL_GLIDE, snap);
    }
    for (const graph of active.values()) {
      for (const voice of graph.dry) {
        const speaker = voice.feed.speaker;
        const db = cinemaSpeakerLoss(speaker, position, speaker.position.distanceTo(position));
        spectralLoss(voice.spectrum, db, now, snap);
        const speechTrim = (db[2] + db[3] + db[4]) / 3;
        adjust(voice.gain.gain, dryGain * cinemaDecibels(db[0] - speechTrim), now, SPECTRAL_GLIDE, snap);
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
          const curve = Float32Array.from({ length: 33 }, (_, i) => wave(Math.PI * 0.5 * (from + (to - from) * i / 32)));
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
      input.disconnect(layout);
      active.forEach(destroyGraph);
      owned.forEach(node => node.disconnect());
    },
  };
}
