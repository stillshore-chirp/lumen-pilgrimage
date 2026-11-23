import { coastRandom, type CoastPoint } from '../../terrain';
import type { ResidenceApplianceAudioSource } from './residenceAppliances';

type Point = Readonly<CoastPoint>;
type ApplianceKind = ResidenceApplianceAudioSource['kind'];
type SoundPath = (listener: Point, source: Point) => {
  gain: number; cutoff: number; arrival: Point; diffuseGain: number;
};

const sampleRate = 24000;
const loopLevels: Record<ApplianceKind, number> = { water: .30, washer: .21, microwave: .16 };
const quietGain = .0008;
const tau = 2 * Math.PI;

function operatingLoop(context: BaseAudioContext, kind: ApplianceKind): AudioBuffer {
  const count = 4 * sampleRate;
  const blend = .18 * sampleRate;
  const buffer = context.createBuffer(1, count, sampleRate);
  const channel = buffer.getChannelData(0);
  const start = new Float32Array(blend);
  const random = coastRandom({ water: 15739, washer: 5349, microwave: 5813 }[kind]);
  let slow = 0;
  let fast = 0;
  let nextDrop = 0;
  let drop = 0;
  let dropPhase = 0;
  let dropPitch = 0;
  for (let i = 0; i < count + blend; i++) {
    const seconds = i / sampleRate;
    const noise = 2 * random() - 1;
    slow += (noise - slow) * .067;
    fast += (noise - fast) * .53;
    let value: number;
    if (kind === 'water') {
      if (seconds >= nextDrop) {
        nextDrop = seconds + .019 + random() * .052;
        drop = .28 + random() * .61;
        dropPitch = 920 + random() * 2300;
        dropPhase = 0;
      }
      dropPhase += dropPitch * tau / sampleRate;
      dropPitch *= .99942;
      value = (fast - slow) * (.40 + .084 * Math.sin(tau * seconds * 2.37))
        + drop * (.14 * Math.sin(dropPhase) + .38 * (fast - slow));
      drop *= .9965;
    } else if (kind === 'washer') {
      const turn = tau * seconds * 1.23;
      const motor = .19 * Math.sin(tau * seconds * 59 + .55 * Math.sin(turn));
      const belt = .10 * Math.sin(tau * seconds * 118 + .27 * Math.cos(turn * .5));
      value = (motor + belt) * (.66 + .25 * Math.sin(turn)) + slow * (.18 + .09 * Math.cos(turn));
    } else {
      const blades = Math.sin(tau * seconds * 177 + .41 * Math.sin(tau * seconds * 1.13));
      value = .15 * Math.sin(tau * seconds * 60) + .092 * blades + .22 * slow + .062 * (fast - slow);
    }
    if (i < blend) start[i] = value;
    if (i < count) channel[i] = value;
    else {
      const index = i - count;
      const fade = .5 - .5 * Math.cos(Math.PI * index / (blend - 1));
      channel[index] = value * (1 - fade) + start[index] * fade;
    }
  }
  return buffer;
}

function completionTone(context: BaseAudioContext, kind: ApplianceKind): AudioBuffer {
  const buffer = context.createBuffer(1, Math.round(sampleRate * .47), sampleRate);
  const channel = buffer.getChannelData(0);
  const notes = kind === 'microwave' ? [784, 988] : [523, 659];
  for (const [index, frequency] of notes.entries()) {
    const start = sampleRate * .18 * index;
    for (let i = 0; i < .24 * sampleRate; i++) {
      const time = i / sampleRate;
      const envelope = Math.min(time / .012, 1) * Math.exp(-time * 16) * Math.min(1, (.24 - time) / .025);
      const phase = tau * time * frequency;
      channel[start + i] += .066 * envelope * (Math.sin(phase) + .12 * Math.sin(phase * 2));
    }
  }
  return buffer;
}

function createVoice(context: BaseAudioContext, dry: AudioNode, wet: AudioNode) {
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = -.75;
  const operating = context.createGain();
  operating.gain.value = 0;
  operating.connect(filter);
  const direct = context.createGain();
  const diffuse = context.createGain();
  direct.gain.value = 0;
  diffuse.gain.value = 0;
  const panner = context.createPanner();
  panner.panningModel = 'HRTF';
  panner.rolloffFactor = 0;
  filter.connect(direct).connect(panner).connect(dry);
  filter.connect(diffuse).connect(wet);
  return { filter, direct, diffuse, panner, operating, loop: undefined as AudioBufferSourceNode | undefined,
    tones: new Set<AudioBufferSourceNode>(), idleSince: undefined as number | undefined };
}

type Voice = ReturnType<typeof createVoice>;

function release(voice: Voice): void {
  if (voice.loop) {
    voice.loop.stop();
    voice.loop.disconnect();
  }
  for (const tone of voice.tones) {
    tone.onended = null;
    tone.stop();
    tone.disconnect();
  }
  voice.tones.clear();
  voice.operating.disconnect();
  voice.filter.disconnect();
  voice.direct.disconnect();
  voice.diffuse.disconnect();
  voice.panner.disconnect();
}

export function createResidenceApplianceAudio(context: BaseAudioContext, dry: AudioNode, wet: AudioNode,
  sources: readonly ResidenceApplianceAudioSource[]) {
  const emitters = sources.map(source => ({ source, completed: source.completionCount?.() ?? 0,
    voice: undefined as Voice | undefined }));
  const loops = new Map<ApplianceKind, AudioBuffer>();
  const chimes = new Map<ApplianceKind, AudioBuffer>();
  const random = coastRandom(4687);

  return {
    update(listener: Point, path: SoundPath): void {
      const time = context.currentTime;
      for (const emitter of emitters) {
        const { source } = emitter;
        const completed = source.completionCount?.() ?? 0;
        const chime = completed !== emitter.completed;
        emitter.completed = completed;
        const level = source.level();
        if (level === 0 && !chime && !emitter.voice) continue;
        const route = path(listener, source.position);
        const audible = Math.max(route.gain, route.diffuseGain) > quietGain;
        if (!emitter.voice && !audible) continue;
        const fresh = !emitter.voice;
        const voice = emitter.voice ??= createVoice(context, dry, wet);
        const { x, y, z } = route.arrival;
        if (fresh) {
          voice.panner.positionX.value = x;
          voice.panner.positionY.value = y;
          voice.panner.positionZ.value = z;
          voice.filter.frequency.value = route.cutoff;
        } else {
          voice.panner.positionX.setTargetAtTime(x, time, .06);
          voice.panner.positionY.setTargetAtTime(y, time, .06);
          voice.panner.positionZ.setTargetAtTime(z, time, .06);
          voice.filter.frequency.setTargetAtTime(route.cutoff, time, .08);
        }
        voice.direct.gain.setTargetAtTime(route.gain, time, .07);
        voice.diffuse.gain.setTargetAtTime(route.diffuseGain * .76, time, .09);
        if (audible && level > 0 && !voice.loop) {
          let buffer = loops.get(source.kind);
          if (!buffer) {
            buffer = operatingLoop(context, source.kind);
            loops.set(source.kind, buffer);
          }
          const loop = context.createBufferSource();
          loop.buffer = buffer;
          loop.loop = true;
          loop.connect(voice.operating);
          loop.start(time, random() * buffer.duration);
          voice.loop = loop;
        }
        if (audible && chime) {
          let buffer = chimes.get(source.kind);
          if (!buffer) {
            buffer = completionTone(context, source.kind);
            chimes.set(source.kind, buffer);
          }
          const tone = context.createBufferSource();
          tone.buffer = buffer;
          tone.connect(voice.filter);
          voice.tones.add(tone);
          tone.onended = () => { tone.disconnect(); voice.tones.delete(tone); };
          tone.start(time + .05);
        }
        voice.operating.gain.setTargetAtTime(audible ? loopLevels[source.kind] * level : 0, time, .066);
        if (voice.loop && source.kind === 'washer' && level > 0) {
          voice.loop.playbackRate.setTargetAtTime(.62 + level * .92, time, .14);
        }
        if (audible && (level > 0 || voice.tones.size > 0)) {
          voice.idleSince = undefined;
        } else {
          voice.idleSince ??= time;
          if (time - voice.idleSince > .35) {
            release(voice);
            emitter.voice = undefined;
          }
        }
      }
    },
    dispose(): void {
      for (const emitter of emitters) {
        if (emitter.voice) release(emitter.voice);
        emitter.voice = undefined;
      }
      loops.clear();
      chimes.clear();
    },
  };
}
