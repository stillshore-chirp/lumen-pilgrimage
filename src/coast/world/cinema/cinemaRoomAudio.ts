import { cinemaScreenCrossings, cinemaSourceBandLoss } from './cinemaPropagation';
import { cinemaPropagationImpulse } from './cinemaPropagationFilter';
import { decodeCinemaHrir, type CinemaConvolutionPath } from './cinemaConvolution';
import { createCinemaKernelBankPreparer } from './cinemaKernelBanks';
import { Quaternion, Vector3, type Camera } from 'three';
import { CINEMA_SAMPLE_RATE, type CinemaPoint, type CinemaProgram } from './cinemaProgram';
import { findCinemaEarlyPaths, type CinemaEarlyPath } from './cinemaReflectionsGeometry';
import { CINEMA_RENDER_SPEAKERS } from './cinemaSpeakers';
import { createCinemaRoutingPacket } from './cinemaRoutingPacket';
import { CINEMA_ROOM_PROCESSOR_SOURCE } from './cinemaRoomProcessor';

const SOUND_SPEED_METRES_PER_SECOND = 343;
const REFERENCE_LISTENER = new Vector3(0, 5, 35.85);
const REFERENCE_DISTANCE = 38.02;
const PROCESSOR_COMMON_DELAY_SAMPLES = 128;
const SPATIAL_STRIDE = 7;
// Evaluated against the exact shared shelf transfer over all material pairs.
const PROPAGATION_FIR_TAPS = 256;
const PATH_UPDATE_SECONDS = 0.05;
const GEOMETRY_POSITION_EPSILON_SQUARED = 0.0001;
const HRTF_BINARY_PATH = `${import.meta.env?.BASE_URL ?? '/'}cinema-audio/cinema-hrtf-kemar-48k-144tap-symmetric.i16le.bin`;
const HRTF_BINARY_BYTES = 60 * 144 * 2 * 2;
const HRTF_ELEVATIONS = [-20, 0, 20, 60, 80] as const;

const cinemaProcessorModules = new WeakMap<AudioContext, Promise<void>>();

export interface CinemaRoomAudioStatus {
  readonly sample: number;
  readonly contextTime: number;
  readonly playing: boolean;
  readonly underruns: number;
  readonly error?: string;
}

export interface CinemaRoomAudio {
  update(camera: Camera): void;
  seek(sample: number): void;
  enqueue(startSample: number, channels: Float32Array[]): void;
  setPlaying(active: boolean): void;
  status(): CinemaRoomAudioStatus;
  centerDelaySamples(): number;
  dispose(): void;
}

interface SpeakerSpatialSnapshot {
  readonly values: Float32Array;
  readonly centerDelaySamples: number;
  readonly reflections: readonly CinemaReflectionPacket[];
  readonly filters: readonly Float32Array[];
}

interface SpeakerGeometry {
  readonly baseDelaySamples: Float32Array;
  readonly distanceGain: Float32Array;
  readonly centerDelaySamples: number;
  readonly reflections: readonly (CinemaEarlyPath & { readonly filter: Float32Array })[];
  readonly filters: readonly Float32Array[];
}

interface CinemaReflectionPacket {
  readonly speaker: number;
  readonly delaySamples: number;
  readonly gain: number;
  readonly highGain: number;
  readonly leftGain: number;
  readonly rightGain: number;
  readonly direction: number;
  readonly filter: Float32Array;
}

function speakerKindCode(kind: (typeof CINEMA_RENDER_SPEAKERS)[number]['kind']): number {
  if (kind === 'screenSub') return 1;
  if (kind === 'surroundSub') return 2;
  return 0;
}

function propagationFilter(speaker: (typeof CINEMA_RENDER_SPEAKERS)[number], launch: CinemaPoint,
  distance: number, screenCrossings: number, reflectionBands?: readonly number[]): Float32Array {
  const loss = cinemaSourceBandLoss({ position: speaker.position, aim: speaker.aim,
    subwoofer: speaker.kind === 'screenSub' || speaker.kind === 'surroundSub' }, launch, distance);
  if (reflectionBands) {
    // The low-band reflection amplitude is already in path.gain; retain it exactly once.
    for (let band = 0; band < loss.length; band += 1) loss[band] += 20 * Math.log10(reflectionBands[band] / reflectionBands[0]);
  }
  return cinemaPropagationImpulse({ bandDb: loss, screenCrossings }, PROPAGATION_FIR_TAPS);
}

function createSpeakerGeometry(position: Vector3): SpeakerGeometry {
  const source = new Vector3();
  const baseDelaySamples = new Float32Array(CINEMA_RENDER_SPEAKERS.length);
  const distanceGain = new Float32Array(CINEMA_RENDER_SPEAKERS.length);
  const filters: Float32Array[] = [];
  const listener: CinemaPoint = [position.x, position.y, position.z];
  let centerIndex = -1;
  let centerX = Infinity;
  for (let i = 0; i < CINEMA_RENDER_SPEAKERS.length; i += 1) {
    const speaker = CINEMA_RENDER_SPEAKERS[i];
    if (speaker.kind === 'screen' && Math.abs(speaker.position[0]) < centerX) {
      centerX = Math.abs(speaker.position[0]);
      centerIndex = i;
    }
    source.set(speaker.position[0], speaker.position[1], speaker.position[2]);
    const distance = Math.max(1, source.distanceTo(position));
    distanceGain[i] = Math.min(2, REFERENCE_DISTANCE / distance);
    filters.push(propagationFilter(speaker, listener, distance, cinemaScreenCrossings([speaker.position, listener])));
    baseDelaySamples[i] = Math.max(0,
      speaker.delaySamples + distance * CINEMA_SAMPLE_RATE / SOUND_SPEED_METRES_PER_SECOND);
  }
  const center = centerIndex >= 0 ? CINEMA_RENDER_SPEAKERS[centerIndex] : null;
  const centerDistance = center
    ? Math.max(1, source.set(center.position[0], center.position[1], center.position[2]).distanceTo(position))
    : REFERENCE_DISTANCE;
  const centerDelaySamples = center
    ? Math.max(0, center.delaySamples + centerDistance * CINEMA_SAMPLE_RATE / SOUND_SPEED_METRES_PER_SECOND)
      + PROCESSOR_COMMON_DELAY_SAMPLES
    : REFERENCE_DISTANCE * CINEMA_SAMPLE_RATE / SOUND_SPEED_METRES_PER_SECOND + PROCESSOR_COMMON_DELAY_SAMPLES;
  return {
    baseDelaySamples,
    distanceGain,
    centerDelaySamples,
    filters,
    reflections: findCinemaEarlyPaths(listener).map(path => ({ ...path,
      filter: propagationFilter(CINEMA_RENDER_SPEAKERS[path.speaker], path.launchPoint, path.pathLength,
        path.screenCrossings, path.bandGain) })),
  };
}

function hrtfDirectionIndex(direction: Vector3, right: Vector3, forward: Vector3, up: Vector3): number {
  const azimuth = (Math.atan2(direction.dot(right), direction.dot(forward)) * 180 / Math.PI + 360) % 360;
  const azimuthIndex = Math.round(azimuth / 30) % 12;
  const elevation = Math.asin(Math.max(-1, Math.min(1, direction.dot(up)))) * 180 / Math.PI;
  let elevationIndex = 0;
  let distance = Infinity;
  for (let index = 0; index < HRTF_ELEVATIONS.length; index += 1) {
    const candidateDistance = Math.abs(elevation - HRTF_ELEVATIONS[index]);
    if (candidateDistance < distance) {
      distance = candidateDistance;
      elevationIndex = index;
    }
  }
  return elevationIndex * 12 + azimuthIndex;
}

/** Direction-bin selection used by the measured KEMAR table. */
export function cinemaHrtfDirectionIndexForPose(
  source: CinemaPoint,
  listener: CinemaPoint,
  forward: CinemaPoint,
  up: CinemaPoint,
): number {
  const sourceVector = new Vector3(source[0], source[1], source[2])
    .sub(new Vector3(listener[0], listener[1], listener[2])).normalize();
  const forwardVector = new Vector3(forward[0], forward[1], forward[2]).normalize();
  const upVector = new Vector3(up[0], up[1], up[2]).normalize();
  const rightVector = new Vector3().crossVectors(forwardVector, upVector).normalize();
  return hrtfDirectionIndex(sourceVector, rightVector, forwardVector, upVector);
}

function createReflectionPackets(
  paths: readonly (CinemaEarlyPath & { readonly filter: Float32Array })[],
  position: Vector3,
  forward: Vector3,
  up: Vector3,
): readonly CinemaReflectionPacket[] {
  const right = new Vector3().crossVectors(forward, up).normalize();
  const direction = new Vector3();
  return paths.map(path => {
    direction.set(path.point[0], path.point[1], path.point[2]).sub(position).normalize();
    const side = Math.max(-1, Math.min(1, direction.dot(right)));
    const angle = (side + 1) * Math.PI * 0.25;
    return {
      speaker: path.speaker,
      filter: path.filter,
      delaySamples: path.delaySamples,
      gain: path.gain,
      highGain: path.highGain,
      leftGain: Math.cos(angle),
      rightGain: Math.sin(angle),
      direction: hrtfDirectionIndex(direction, right, forward, up),
    };
  });
}

function createSpatialSnapshot(
  position: Vector3,
  forward: Vector3,
  up: Vector3,
  geometry: SpeakerGeometry,
): SpeakerSpatialSnapshot {
  const right = new Vector3().crossVectors(forward, up).normalize();
  const source = new Vector3();
  const direction = new Vector3();
  const values = new Float32Array(CINEMA_RENDER_SPEAKERS.length * SPATIAL_STRIDE);
  for (let i = 0; i < CINEMA_RENDER_SPEAKERS.length; i += 1) {
    const speaker = CINEMA_RENDER_SPEAKERS[i];
    source.set(speaker.position[0], speaker.position[1], speaker.position[2]);
    direction.copy(source).sub(position).normalize();
    const side = Math.max(-1, Math.min(1, direction.dot(right)));
    const elevation = Math.abs(direction.dot(up));
    const angle = (side + 1) * Math.PI * 0.25;
    const headShadow = Math.min(0.22, Math.abs(side) * 0.18);
    const elevationGain = 0.92 + elevation * 0.08;
    // createCinemaRouting applies the per-speaker calibration gain to each
    // input. Keep it out of the listener transform so calibration is applied
    // exactly once.
    let leftGain = Math.cos(angle) * geometry.distanceGain[i] * elevationGain;
    let rightGain = Math.sin(angle) * geometry.distanceGain[i] * elevationGain;
    if (side > 0) leftGain *= 1 - headShadow;
    else rightGain *= 1 - headShadow;
    const interauralSamples = side * CINEMA_SAMPLE_RATE * 0.0006;
    const baseDelay = geometry.baseDelaySamples[i];
    const base = i * SPATIAL_STRIDE;
    values[base] = baseDelay + Math.max(0, interauralSamples);
    values[base + 1] = baseDelay + Math.max(0, -interauralSamples);
    values[base + 2] = leftGain;
    values[base + 3] = rightGain;
    values[base + 4] = (leftGain + rightGain) * 0.022;
    values[base + 5] = geometry.distanceGain[i];
    values[base + 6] = hrtfDirectionIndex(direction, right, forward, up);
  }
  return {
    values,
    filters: geometry.filters,
    centerDelaySamples: geometry.centerDelaySamples,
    reflections: createReflectionPackets(geometry.reflections, position, forward, up),
  };
}

async function loadCinemaHrtf(): Promise<ArrayBuffer | undefined> {
  if (typeof fetch !== 'function') return undefined;
  try {
    const response = await fetch(HRTF_BINARY_PATH, { cache: 'force-cache' });
    if (!response.ok) return undefined;
    const buffer = await response.arrayBuffer();
    return buffer.byteLength === HRTF_BINARY_BYTES ? buffer : undefined;
  } catch {
    return undefined;
  }
}

function ensureCinemaProcessorModule(context: AudioContext): Promise<void> {
  const existing = cinemaProcessorModules.get(context);
  if (existing) return existing;
  const moduleUrl = URL.createObjectURL(new Blob([CINEMA_ROOM_PROCESSOR_SOURCE], {
    type: 'application/javascript',
  }));
  const loading = context.audioWorklet.addModule(moduleUrl).finally(() => {
    URL.revokeObjectURL(moduleUrl);
  });
  cinemaProcessorModules.set(context, loading);
  // Handle the rejection on a side branch so a failed load can be retried
  // without creating an unhandled-rejection promise of our own.
  void loading.then(undefined, () => {
    if (cinemaProcessorModules.get(context) === loading) cinemaProcessorModules.delete(context);
  });
  return loading;
}

function transferBuffers(channels: readonly Float32Array[], routing: ArrayBuffer): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  for (const channel of channels) {
    if (channel.buffer instanceof ArrayBuffer && !buffers.includes(channel.buffer)) buffers.push(channel.buffer);
  }
  if (!buffers.includes(routing)) buffers.push(routing);
  return buffers;
}

/**
 * Create the PC/Link cinema renderer. PCM planes are transferred to the
 * worklet, so callers must treat buffers passed to enqueue as consumed.
 */
export async function createCinemaRoomAudio(
  context: AudioContext,
  output: AudioNode,
  program: CinemaProgram,
): Promise<CinemaRoomAudio> {
  if (context.sampleRate !== CINEMA_SAMPLE_RATE) {
    throw new RangeError(`Cinema room audio requires a ${CINEMA_SAMPLE_RATE} Hz AudioContext`);
  }
  if (CINEMA_RENDER_SPEAKERS.length !== 57) {
    throw new Error('Cinema room audio requires the 57-speaker render layout');
  }
  if (program.bed.length + program.objects.length <= 0) {
    throw new Error('Cinema room audio requires at least one PCM channel');
  }
  if (!context.audioWorklet) throw new Error('AudioWorklet is unavailable in this browser');
  await ensureCinemaProcessorModule(context);
  const hrtfBuffer = await loadCinemaHrtf();
  const prepareFilters = hrtfBuffer ? createCinemaKernelBankPreparer(decodeCinemaHrir(hrtfBuffer)) : undefined;

  const lfeIndex = program.bed.findIndex(channel => channel === 'LFE');
  const node = new AudioWorkletNode(context, 'cinema-room-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: {
      speakerCount: CINEMA_RENDER_SPEAKERS.length,
      inputCount: program.bed.length + program.objects.length,
      kinds: CINEMA_RENDER_SPEAKERS.map(speaker => speakerKindCode(speaker.kind)),
      lfeIndex,
      lfeGain: 10 ** (program.lfeGainDb / 20),
    },
  });
  node.connect(output);

  const referenceForward = new Vector3(0, 0, -1);
  const referenceUp = new Vector3(0, 1, 0);
  let geometry = createSpeakerGeometry(REFERENCE_LISTENER);
  let spatial = createSpatialSnapshot(REFERENCE_LISTENER, referenceForward, referenceUp, geometry);
  let lastGeometryUpdate = -Infinity;
  const geometryPosition = REFERENCE_LISTENER.clone();
  const posePosition = new Vector3();
  const poseRotation = new Quaternion();
  const poseForward = new Vector3();
  const poseUp = new Vector3();
  let disposed = false;
  let seekGeneration = 0;
  let error: string | undefined;
  let latest: CinemaRoomAudioStatus = {
    sample: 0,
    contextTime: context.currentTime,
    playing: false,
    underruns: 0,
  };

  node.port.onmessage = event => {
    if (disposed) return;
    const message = event.data as {
      readonly type?: string;
      readonly generation?: number;
      readonly sample?: number;
      readonly contextTime?: number;
      readonly playing?: boolean;
      readonly underruns?: number;
      readonly message?: string;
    };
    if (message.type === 'status' && message.generation === seekGeneration && Number.isFinite(message.sample)
      && Number.isFinite(message.contextTime) && Number.isFinite(message.underruns)) {
      latest = {
        sample: Math.trunc(message.sample as number),
        contextTime: message.contextTime as number,
        playing: Boolean(message.playing),
        underruns: Math.max(0, Math.trunc(message.underruns as number)),
        ...(error ? { error } : {}),
      };
    } else if (message.type === 'bank-resync') {
      prepareFilters?.requestFull();
      filterValues = undefined;
    } else if (message.type === 'error') {
      error = typeof message.message === 'string' ? message.message : 'Cinema room processor failed';
      latest = { ...latest, error };
    }
  };
  node.onprocessorerror = () => {
    if (disposed) return;
    error = 'Cinema room processor failed';
    latest = { ...latest, error };
  };
  if (hrtfBuffer) node.port.postMessage({ type: 'hrtf', buffer: hrtfBuffer }, [hrtfBuffer]);

  let filterValues: Float32Array | undefined;
  let filterGeometry: readonly Float32Array[] | undefined;
  let filterReflections: readonly CinemaReflectionPacket[] = [];
  const sendSpatial = (snapshot: SpeakerSpatialSnapshot): void => {
    const changed = filterGeometry !== snapshot.filters || !filterValues || snapshot.values.some((value, index) => value !== filterValues![index])
      || snapshot.reflections.length !== filterReflections.length
      || snapshot.reflections.some((path, index) => {
        const previous = filterReflections[index];
        return !previous || path.speaker !== previous.speaker || path.delaySamples !== previous.delaySamples
          || path.gain !== previous.gain || path.highGain !== previous.highGain || path.direction !== previous.direction || path.filter !== previous.filter;
      });
    if (prepareFilters && changed) {
      const paths: CinemaConvolutionPath[] = [];
      for (let speaker = 0; speaker < CINEMA_RENDER_SPEAKERS.length; speaker += 1) {
        const base = speaker * SPATIAL_STRIDE;
        paths.push({ speaker, delaySamples: Math.min(snapshot.values[base], snapshot.values[base + 1]),
          direction: snapshot.values[base + 6], gain: snapshot.values[base + 5], send: snapshot.values[base + 4], filter: snapshot.filters[speaker] });
      }
      for (const path of snapshot.reflections) {
        const gain = path.gain * (0.12 + 0.18 * path.highGain);
        paths.push({ speaker: path.speaker, delaySamples: path.delaySamples, direction: path.direction,
          gain, send: gain, filter: path.filter });
      }
      const submission = prepareFilters.prepare(paths);
      try {
        node.port.postMessage(submission.message, submission.transfer);
        submission.commit();
      } catch (error) {
        submission.cancel();
        throw error;
      }
      filterValues = snapshot.values.slice();
      filterGeometry = snapshot.filters;
      filterReflections = snapshot.reflections;
    }
    spatial = snapshot;
    node.port.postMessage({ type: 'pose', spatial: snapshot.values,
      reflections: snapshot.reflections.map(({ filter: _filter, ...path }) => path) },
      [snapshot.values.buffer]);
  };
  sendSpatial(spatial);

  return {
    update(camera: Camera): void {
      if (disposed) return;
      const now = context.currentTime;
      camera.getWorldPosition(posePosition);
      camera.getWorldQuaternion(poseRotation);
      poseForward.set(0, 0, -1).applyQuaternion(poseRotation).normalize();
      poseUp.set(0, 1, 0).applyQuaternion(poseRotation).normalize();
      // Listener orientation follows every camera update. The distance and
      // propagation geometry are refreshed at 20 Hz, keeping the control
      // traffic light while preserving fast head turns.
      const moved = posePosition.distanceToSquared(geometryPosition) > GEOMETRY_POSITION_EPSILON_SQUARED;
      if (moved && now - lastGeometryUpdate >= PATH_UPDATE_SECONDS) {
        geometry = createSpeakerGeometry(posePosition);
        geometryPosition.copy(posePosition);
        lastGeometryUpdate = now;
      }
      sendSpatial(createSpatialSnapshot(posePosition, poseForward, poseUp, geometry));
    },
    seek(sample: number): void {
      if (disposed) return;
      const target = Number.isFinite(sample) ? Math.trunc(sample) : 0;
      node.port.postMessage({ type: 'seek', sample: target, generation: ++seekGeneration });
      latest = { ...latest, sample: target, contextTime: context.currentTime, playing: false };
    },
    enqueue(startSample: number, channels: Float32Array[]): void {
      if (disposed) return;
      if (channels.length !== program.bed.length + program.objects.length) {
        throw new RangeError('Cinema PCM channel count does not match the screening program');
      }
      const frames = channels[0]?.length ?? 0;
      if (frames <= 0 || channels.some(channel => channel.length !== frames)) {
        throw new RangeError('Cinema PCM planes must have the same non-zero length');
      }
      const start = Number.isFinite(startSample) ? Math.trunc(startSample) : 0;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(start + frames)) {
        throw new RangeError('Cinema PCM sample range must use safe integers');
      }
      const packedRouting = createCinemaRoutingPacket(program, start, frames);
      node.port.postMessage({ type: 'enqueue', startSample: start, channels, packedRouting },
        transferBuffers(channels, packedRouting));
    },
    setPlaying(active: boolean): void {
      if (disposed) return;
      node.port.postMessage({ type: 'playing', active: Boolean(active) });
      if (!active) latest = { ...latest, playing: false };
    },
    status(): CinemaRoomAudioStatus {
      return error && !latest.error ? { ...latest, error } : latest;
    },
    centerDelaySamples(): number {
      return spatial.centerDelaySamples;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      prepareFilters?.clear();
      filterValues = undefined;
      filterReflections = [];
      node.port.postMessage({ type: 'dispose' });
      node.disconnect();
      node.port.close();
      node.port.onmessage = null;
      node.onprocessorerror = null;
    },
  };
}
