import { coastRandom, smoothstep } from '../../terrain';

const SAMPLE_RATE = 24_000;
const WATER_SECONDS = 31;
const OVERLAP_SECONDS = 0.36;

/** Small, irregular laps against the boardwalk edge with receding surface detail. */
export function createLakeWater(context: BaseAudioContext, seed: number): AudioBuffer {
  const random = coastRandom(seed);
  const buffer = context.createBuffer(1, WATER_SECONDS * SAMPLE_RATE, SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  const overlap = Math.round(OVERLAP_SECONDS * SAMPLE_RATE);
  const coefficient = (hz: number) => 1 - Math.exp(-2 * Math.PI * hz / SAMPLE_RATE);
  const bassBand = coefficient(90);
  const bodyBand = coefficient(480);
  const edgeBand = coefficient(2200);
  const trickleBand = coefficient(4700);
  let bass = 0, body = 0, edge = 0, trickle = 0;
  let pulseStart = 0, pulseLength = 0.9, pulseGain = 0.55;
  let nextPulse = 1.8;

  for (let i = 0; i < data.length + overlap; i += 1) {
    const time = i / SAMPLE_RATE;
    const input = random() * 2 - 1;
    bass += (input - bass) * bassBand;
    body += (input - body) * bodyBand;
    edge += (input - edge) * edgeBand;
    trickle += (input - trickle) * trickleBand;
    if (time >= nextPulse) {
      pulseStart = nextPulse;
      pulseLength = 0.46 + 0.89 * random();
      pulseGain = 0.36 + 0.72 * random();
      nextPulse += pulseLength + 0.34 + 2.80 * random();
    }
    const phase = (time - pulseStart) / pulseLength;
    const rise = smoothstep(0, 0.26, phase);
    const pocket = rise * (1 - smoothstep(0.28, 1, phase)) * pulseGain;
    const droplets = rise * (1 - smoothstep(0.14, 0.69, phase)) * pulseGain;
    const sample = (body - bass) * (0.075 + 0.42 * pocket)
      + (edge - body) * (0.028 + 0.28 * droplets) + (trickle - edge) * 0.10 * droplets;
    if (i < data.length) {
      data[i] = sample;
    } else {
      const j = i - data.length;
      const angle = (j + 1) / overlap * Math.PI / 2;
      // Crossfade from the continuation of the tail into the already-rendered beginning.
      data[j] = sample * Math.cos(angle) + data[j] * Math.sin(angle);
    }
  }
  return buffer;
}
