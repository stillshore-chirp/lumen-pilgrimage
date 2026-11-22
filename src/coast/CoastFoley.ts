import { EYE_HEIGHT, type CoastMovement } from './CoastControls';
import { coastBedrock, coastRandom, coastTrailDistance, groundHeight, groundSlope, type CoastPoint } from './terrain';

type Contact = 'sand' | 'gravel' | 'leaves' | 'wade' | 'stroke' | 'bubbles' | 'splash';
type ContactVoice = { panner: PannerNode; gain: GainNode; source?: AudioBufferSourceNode; next: number };

const CONTACTS: Record<Contact, {
  duration: number; body: number; grit: number; color: number; decay: number; gain: number;
}> = {
  sand: { duration: 0.23, body: 0.55, grit: 0.38, color: 890, decay: 27, gain: 0.68 },
  gravel: { duration: 0.26, body: 0.35, grit: 0.91, color: 3_200, decay: 27, gain: 0.56 },
  leaves: { duration: 0.34, body: 0.26, grit: 0.78, color: 1_700, decay: 13, gain: 0.62 },
  wade: { duration: 0.31, body: 0.62, grit: 0.72, color: 2_300, decay: 13, gain: 0.44 },
  stroke: { duration: 0.36, body: 0.70, grit: 0.48, color: 1_480, decay: 12, gain: 0.36 },
  bubbles: { duration: 0.39, body: 0.34, grit: 0.29, color: 610, decay: 9, gain: 0.31 },
  splash: { duration: 0.61, body: 0.72, grit: 0.97, color: 3_750, decay: 10, gain: 0.44 },
};

function contactBuffer(context: AudioContext, contact: Contact, seed: number): AudioBuffer {
  const { duration, body, grit, color, decay } = CONTACTS[contact];
  const wet = contact === 'wade' || contact === 'stroke' || contact === 'bubbles' || contact === 'splash';
  const random = coastRandom(seed);
  const rate = 24_000;
  const buffer = context.createBuffer(1, Math.ceil(duration * rate), rate);
  const data = buffer.getChannelData(0);
  let low = 0;
  let filtered = 0;
  const coefficient = 1 - Math.exp(-2 * Math.PI * color / rate);
  const grains = Array.from({ length: wet ? 6 : 9 }, (_, index) => ({
    start: index * duration * 0.073 + random() * duration * 0.12,
    pitch: wet ? 185 + random() * 730 : 860 + random() * 3000,
    strength: 0.3 + random() * 0.7,
  }));
  for (let frame = 0; frame < data.length; frame += 1) {
    const t = frame / rate;
    const noise = random() * 2 - 1;
    low += (noise - low) * 0.032;
    filtered += (noise - filtered) * coefficient;
    const impact = Math.exp(-t * (wet ? 23 : 50)) * (low + Math.sin(t * 2 * Math.PI * (wet ? 86 : 61)) * 0.16);
    let droplets = 0;
    for (const grain of grains) {
      const age = t - grain.start;
      if (age < 0 || age > 0.08) continue;
      const attack = Math.min(1, age * 520);
      const tone = wet ? Math.sin(2 * Math.PI * age * (grain.pitch + age * 2900)) : noise;
      droplets += tone * attack * grain.strength * Math.exp(-age * (wet ? 81 : 126));
    }
    const texture = filtered * Math.exp(-t * decay) * 0.52 + droplets * (wet ? 0.12 : 0.11);
    const envelope = Math.min(1, t * (wet ? 78 : 390), (duration - t) * 75);
    data[frame] = (body * impact + grit * texture) * envelope;
  }
  return buffer;
}

/** Short contacts follow actual displacement and stay at their world position through each hit. */
export class CoastFoley {
  private readonly buffers = new Map<Contact, AudioBuffer>();
  private readonly voices: ContactVoice[] = [];
  private readonly send: GainNode;
  private previous: (CoastPoint & { movement: CoastMovement; elapsed: number }) | undefined;
  private traveled = 0;
  private side = 1;

  constructor(private readonly context: AudioContext, output: AudioNode, reflections: AudioNode) {
    this.send = context.createGain();
    this.send.gain.value = 0.35;
    this.send.connect(reflections);
    for (let index = 0; index < 3; index += 1) {
      const panner = context.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 0.75;
      panner.rolloffFactor = 0.65;
      const gain = context.createGain();
      gain.connect(panner).connect(output);
      gain.connect(this.send);
      this.voices.push({ gain, panner, next: 0 });
    }
  }

  update(position: CoastPoint, surface: number, movement: CoastMovement, elapsed: number, now: number): void {
    const previous = this.previous;
    this.previous = { ...position, movement, elapsed };
    if (!previous || movement === 'flight') return;
    const dx = position.x - previous.x;
    const dz = position.z - previous.z;
    const dy = position.y - previous.y;
    const horizontal = Math.hypot(dx, dz);
    const elapsedDelta = elapsed - previous.elapsed;
    if (horizontal > 3.4 || Math.abs(dy) > 2.8 || elapsedDelta <= 0 || elapsedDelta > 0.32) {
      this.traveled = 0;
      return;
    }
    if (movement !== previous.movement) {
      this.traveled = 0;
      if (movement === 'dive') this.play('bubbles', position.x, position.y + 0.24, position.z, now);
      else if (movement === 'swim' || (movement === 'wade' && previous.movement === 'flight')) {
        this.play('splash', position.x, surface + 0.17, position.z, now);
      }
    }

    const swimming = movement === 'swim' || movement === 'dive';
    const floor = groundHeight(position.x, position.z);
    if (!swimming && Math.abs(position.y - EYE_HEIGHT - floor) > 0.16) {
      this.traveled = 0;
      return;
    }
    const distance = movement === 'dive' ? Math.hypot(horizontal, dy * 0.6) : horizontal;
    if (distance < 0.016) return;
    this.traveled += distance;
    const strideSeconds = movement === 'walk' ? 0.31 : movement === 'wade' ? 0.41 : 0.57;
    const stride = Math.max(swimming ? 1.18 : 0.82, distance / elapsedDelta * strideSeconds);
    if (this.traveled < stride) return;
    this.traveled %= stride;

    let contact: Contact;
    if (movement === 'dive') contact = 'bubbles';
    else if (movement === 'swim') contact = 'stroke';
    else if (movement === 'wade') contact = 'wade';
    else if (coastBedrock(position.x, position.z) > 0.45 || groundSlope(position.x, position.z, 0.7) > 0.58) {
      contact = 'gravel';
    } else if (position.z > 143 && floor > 9) contact = 'leaves';
    else contact = coastTrailDistance(position.x, position.z) < 1.7 ? 'gravel' : 'sand';

    this.side *= -1;
    const lateral = horizontal > 0.018 ? this.side * (swimming ? 0.4 : 0.19) / horizontal : 0;
    const y = movement === 'dive' ? position.y - 0.42 : swimming || movement === 'wade' ? surface + 0.16 : floor + 0.1;
    this.play(contact, position.x - dz * lateral, y, position.z + dx * lateral, now);
  }

  dispose(): void {
    for (const voice of this.voices) {
      if (voice.source) {
        voice.source.onended = null;
        voice.source.stop();
        voice.source.disconnect();
      }
      voice.panner.disconnect();
      voice.gain.disconnect();
    }
    this.send.disconnect();
    this.buffers.clear();
  }

  private play(contact: Contact, x: number, y: number, z: number, now: number): void {
    const voice = this.voices.find(candidate => !candidate.source && candidate.next <= now);
    if (!voice) return;
    let buffer = this.buffers.get(contact);
    if (!buffer) {
      buffer = contactBuffer(this.context, contact, 91 + this.buffers.size * 79);
      this.buffers.set(contact, buffer);
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.89 + Math.random() * 0.25;
    voice.panner.positionX.setValueAtTime(x, now);
    voice.panner.positionY.setValueAtTime(y, now);
    voice.panner.positionZ.setValueAtTime(z, now);
    voice.gain.gain.setValueAtTime(CONTACTS[contact].gain * (0.82 + Math.random() * 0.18), now);
    source.connect(voice.gain);
    voice.source = source;
    voice.next = now + buffer.duration / source.playbackRate.value + 0.04;
    source.onended = () => {
      source.disconnect();
      voice.source = undefined;
    };
    source.start(now);
  }
}
