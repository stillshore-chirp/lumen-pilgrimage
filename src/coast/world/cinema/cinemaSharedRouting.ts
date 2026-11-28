import { CINEMA_RENDER_SPEAKERS, type CinemaRenderSpeaker } from './cinemaSpeakers';

export interface CinemaSharedFeed {
  readonly speaker: CinemaRenderSpeaker;
  readonly signal: AudioNode;
  readonly coefficients: readonly number[];
  readonly delaySeconds: number;
  readonly roomScale: number;
}

const FRONT_BUDGET = 0.66;
const DIFFUSE_BUDGET = 0.10;
const BASS_BUDGET = 0.05;
// Web Audio low/high-pass Q uses dB; all-pass Q below is linear.
const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);
const STEREO_FRONT = [[.32, 0], [.12, .04], [.02, .02], [.04, .12], [0, .32]] as const;
const MONO_FRONT = [.10, .15, .50, .15, .10] as const;

/** Mono/stereo installation feeds, or the established standard-5.1 input contract. */
export function cinemaSharedFeedPlan(channelCount = 2) {
  const mono = channelCount === 1;
  const surround = channelCount === 6;
  const diffuseCount = CINEMA_RENDER_SPEAKERS.filter(speaker =>
    speaker.kind === 'side' || speaker.kind === 'rear' || speaker.kind === 'top').length;
  const bassCount = CINEMA_RENDER_SPEAKERS.filter(speaker =>
    speaker.kind === 'screenSub' || speaker.kind === 'surroundSub').length;
  const sideCounts = [-1, 1].map(side => CINEMA_RENDER_SPEAKERS.filter(speaker =>
    (speaker.kind === 'side' || speaker.kind === 'rear') && Math.sign(speaker.position[0]) === side).length);
  const topCounts = [-1, 1].map(side => CINEMA_RENDER_SPEAKERS.filter(speaker =>
    speaker.kind === 'top' && Math.sign(speaker.position[0]) === side).length);
  let front = 0;
  return CINEMA_RENDER_SPEAKERS.map((speaker, index) => {
    const bass = speaker.kind === 'screenSub' || speaker.kind === 'surroundSub';
    const diffuse = speaker.kind !== 'screen' && !bass;
    let coefficients: readonly number[];
    if (surround) {
      // Preserve the established Web Audio 5.1 input order. A reported six
      // channels does not imply objects or independent height programme tracks.
      const values = new Array<number>(6).fill(0);
      if (speaker.kind === 'screen') {
        const channel = [0, 0, 2, 1, 1][front];
        values[channel] = [.16, .04, .20, .04, .16][front];
        front += 1;
      } else if (bass) values[3] = .20 / bassCount;
      else {
        const side = speaker.position[0] < 0 ? 0 : 1;
        values[4 + side] = speaker.kind === 'top' ? .02 / topCounts[side] : .08 / sideCounts[side];
      }
      coefficients = values;
    } else if (speaker.kind === 'screen') {
      const weights = mono ? [MONO_FRONT[front] * .5, MONO_FRONT[front] * .5] : STEREO_FRONT[front];
      front += 1;
      coefficients = [weights[0] * FRONT_BUDGET, weights[1] * FRONT_BUDGET];
    } else if (bass) {
      coefficients = [BASS_BUDGET / bassCount * .5, BASS_BUDGET / bassCount * .5];
    } else {
      // The nonzero mid floor also excites the array for mono. The side component
      // retains anti-phase content, with opposite handedness on opposite walls.
      const side = speaker.position[0] < 0 ? 1 : -1;
      const gain = DIFFUSE_BUDGET / diffuseCount / .78;
      coefficients = [(.22 + side * .78) * .5 * gain, (.22 - side * .78) * .5 * gain];
    }
    const processedDiffuse = surround ? speaker.kind === 'top' : diffuse;
    const surroundRoom = surround && (speaker.id === 'side-L-07' || speaker.id === 'side-R-07');
    return { speaker, coefficients, bass, diffuse: processedDiffuse,
      roomScale: speaker.kind === 'screen' ? 1 : surroundRoom ? sideCounts[speaker.position[0] < 0 ? 0 : 1] : 0,
      // This is an electronic diffusion delay relative to the shared video clock,
      // not absolute source-to-listener flight time. Do not add it to file playback.
      // File playback's delaySamples compensates absolute flight time. Applying
      // that compensation alone here would misalign coherent front feeds.
      delaySeconds: processedDiffuse ? .018 + (index * 17 % 47) * .00047 : 0,
      phaseFrequency: 370 + (index * 137 % 1_930),
    };
  });
}

export function createCinemaSharedRouting(context: BaseAudioContext, input: AudioNode, channelCount: number) {
  const owned: AudioNode[] = [];
  const own = <T extends AudioNode>(node: T): T => { owned.push(node); return node; };
  const layout = own(context.createGain());
  // Six channels retain the existing standard-5.1 API contract. Other counts
  // retain the established mono/stereo fallback, never an inferred object bed.
  const inputs = channelCount === 6 ? 6 : 2;
  layout.channelCount = inputs;
  layout.channelCountMode = 'explicit';
  layout.channelInterpretation = inputs === 6 ? 'discrete' : 'speakers';
  const splitter = own(context.createChannelSplitter(inputs));
  const feeds: CinemaSharedFeed[] = [];
  try {
    layout.connect(splitter);
    for (const plan of cinemaSharedFeedPlan(channelCount)) {
      const sum = own(context.createGain());
      sum.channelCount = 1;
      sum.channelCountMode = 'explicit';
      sum.channelInterpretation = 'discrete';
      for (let channel = 0; channel < inputs; channel += 1) {
        const coefficient = plan.coefficients[channel];
        if (!coefficient) continue;
        const gain = own(context.createGain());
        gain.gain.value = coefficient;
        splitter.connect(gain, channel).connect(sum);
      }
      let signal: AudioNode = sum;
      if (plan.diffuse) {
        const highpass = own(context.createBiquadFilter());
        highpass.type = 'highpass';
        highpass.frequency.value = 250;
        highpass.Q.value = BUTTERWORTH_Q_DB;
        const lowpass = own(context.createBiquadFilter());
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 5_000;
        lowpass.Q.value = BUTTERWORTH_Q_DB;
        const phase = own(context.createBiquadFilter());
        phase.type = 'allpass';
        phase.frequency.value = plan.phaseFrequency;
        phase.Q.value = Math.SQRT1_2;
        signal = signal.connect(highpass).connect(lowpass).connect(phase);
      } else if (plan.bass) {
        const lowpass = own(context.createBiquadFilter());
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 120;
        lowpass.Q.value = BUTTERWORTH_Q_DB;
        signal = signal.connect(lowpass);
      }
      if (plan.delaySeconds > 0) {
        const delay = own(context.createDelay(.1));
        delay.delayTime.value = plan.delaySeconds;
        signal = signal.connect(delay);
      }
      feeds.push({ speaker: plan.speaker, signal, coefficients: plan.coefficients,
        delaySeconds: plan.delaySeconds, roomScale: plan.roomScale });
    }
    input.connect(layout);
  } catch {
    owned.forEach(node => node.disconnect());
    throw new Error('Cinema shared routing unavailable');
  }
  let disposed = false;
  return { feeds, dispose() {
    if (disposed) return;
    disposed = true;
    input.disconnect(layout);
    owned.forEach(node => node.disconnect());
  } };
}
