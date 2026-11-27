/** Shared, dry performance inputs for physical, sample and hybrid renderers. */
export interface KotoNoteOptions {
  readonly frequency: number;
  readonly velocity: number;
  readonly pluckPosition?: number;
  readonly pressSemitones?: number;
  /** Seconds after this note's onset, rather than the beginning of the piece. */
  readonly dampAt?: number;
  readonly duration?: number;
  readonly seed?: number;
}

export type KotoNoteRenderer = (note: KotoNoteOptions, sampleRate: number) => Float32Array;
export type KotoPluck = readonly [seconds: number, string: number, force: number, pressSemitones?: 1 | 2];

export const LAKE_KOTO_DURATION = 39;
export const LAKE_KOTO_SAMPLE_RATE = 48_000;
export const LAKE_KOTO_FINAL_DAMP_SECONDS = 37.82;

// D-based hirajōshi. One/five are separate strings at D4, not adjacent octaves.
const STRING_PITCHES = [62, 55, 57, 58, 62, 63, 67, 69, 70, 74, 75, 79, 81] as const;
const STRING_NAMES = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '斗', '為', '巾'] as const;
const PITCH_NAMES = ['D4', 'G3', 'A3', 'B♭3', 'D4', 'E♭4', 'G4', 'A4', 'B♭4', 'D5', 'E♭5', 'G5', 'A5'] as const;
export const LAKE_KOTO_TUNING = Object.freeze(STRING_PITCHES.map((midi, index) => Object.freeze({
  string: index + 1, name: STRING_NAMES[index], pitch: PITCH_NAMES[index], midi,
  frequency: 440 * 2 ** ((midi - 69) / 12),
})));

const SCORE: readonly KotoPluck[] = [
  [0.09, 5, 0.70], [0.85, 7, 0.70], [1.32, 8, 0.61], [2.21, 9, 0.65, 1],
  [3.76, 7, 0.53], [4.03, 4, 0.39], [4.83, 5, 0.60],
  [6.91, 2, 0.65], [7.46, 6, 0.47], [7.92, 7, 0.56], [8.45, 8, 0.70],
  [9.37, 10, 0.64], [9.78, 9, 0.49], [10.18, 7, 0.58], [11.16, 5, 0.56, 1],
  [13.28, 10, 0.66], [13.63, 11, 0.47], [14.31, 12, 0.58], [15.26, 10, 0.61],
  [16.29, 8, 0.68, 2], [17.64, 7, 0.50], [17.73, 5, 0.43],
  [19.15, 5, 0.45], [19.23, 6, 0.42], [19.31, 7, 0.49], [19.41, 8, 0.52],
  [19.52, 9, 0.60], [19.66, 10, 0.62], [20.81, 13, 0.56], [21.47, 12, 0.50],
  [22.26, 11, 0.46], [23.18, 10, 0.61], [23.21, 3, 0.38],
  [25.14, 2, 0.65], [25.78, 5, 0.56], [26.36, 7, 0.60], [26.88, 8, 0.50],
  [27.63, 9, 0.60, 1], [28.77, 7, 0.56], [29.85, 6, 0.47], [30.41, 3, 0.42],
  [32.37, 4, 0.47], [32.83, 7, 0.56], [33.40, 6, 0.52], [34.24, 5, 0.64],
  [34.30, 1, 0.34], [35.28, 2, 0.46], [36.03, 5, 0.59],
];

// Release the left hand between after-press gestures by stopping that string.
// Values are phrase decisions for this piece, not measurements of a performer.
const PRESSED_NOTE_HOLD_SECONDS: Readonly<Record<number, number>> = {
  2.21: 1.30, 11.16: 1.08, 16.29: 1.12, 27.63: 0.92,
};
export const LAKE_KOTO_EVENTS = Object.freeze(SCORE.map(([seconds, string, force, pressSemitones]) =>
  Object.freeze({
    seconds, string, force, pressSemitones,
    // Softer answers are played a little farther from the fixed right bridge.
    // These three touches are authored choices, not random timing humanization.
    pluckPosition: force >= 0.60 ? 0.105 : force < 0.50 ? 0.140 : 0.125,
    dampAt: pressSemitones ? PRESSED_NOTE_HOLD_SECONDS[seconds]
      : LAKE_KOTO_FINAL_DAMP_SECONDS + 0.008 * (string - 1) - seconds,
  })));

export interface KotoStudyCase {
  readonly id: string;
  readonly label: string;
  readonly kind: 'note' | 'sequence' | 'score';
  readonly onsetSeconds: number;
  readonly durationSeconds: number;
  readonly string?: number;
  readonly force?: number;
  readonly pressSemitones?: number;
  readonly dampAt?: number;
  readonly expectedHz?: number;
  readonly notes?: readonly KotoPluck[];
}

export const KOTO_STUDY_CASES: readonly KotoStudyCase[] = Object.freeze([
  ...([[2, 'low', '低音'], [7, 'mid', '中音'], [13, 'high', '高音']] as const)
    .flatMap(([string, name, label]) =>
      ([[0.3, 'soft', '弱'], [0.6, 'normal', '中'], [0.9, 'hard', '強']] as const)
        .map(([force, touch, text]) => Object.freeze({
          id: `${name}-${touch}`, label: `${label}・${text}`, kind: 'note' as const,
          string, force, expectedHz: LAKE_KOTO_TUNING[string - 1].frequency,
          onsetSeconds: 0, durationSeconds: 6,
        }))),
  { id: 'press-one', label: '半音の後押し', kind: 'note', string: 9, force: 0.6,
    pressSemitones: 1, expectedHz: LAKE_KOTO_TUNING[8].frequency,
    onsetSeconds: 0, durationSeconds: 6 },
  { id: 'press-two', label: '全音の後押し', kind: 'note', string: 8, force: 0.6,
    pressSemitones: 2, expectedHz: LAKE_KOTO_TUNING[7].frequency,
    onsetSeconds: 0, durationSeconds: 6 },
  { id: 'damped', label: '発音0.65秒後の消音', kind: 'note', string: 7, force: 0.6,
    dampAt: 0.65, expectedHz: LAKE_KOTO_TUNING[6].frequency,
    onsetSeconds: 0, durationSeconds: 6 },
  { id: 'overlap', label: '同弦の再撥弦と多弦の重なり', kind: 'sequence',
    onsetSeconds: 0, durationSeconds: 8,
    notes: [[0, 7, 0.6], [0.16, 7, 0.5], [0.23, 9, 0.55], [0.31, 12, 0.45]] },
  { id: 'chord', label: '五・十の同時合わせ爪', kind: 'sequence',
    onsetSeconds: 0, durationSeconds: 8, notes: [[0, 5, 0.6], [0, 10, 0.6]] },
  { id: 'melody', label: '独自曲の冒頭四音', kind: 'sequence', onsetSeconds: 0, durationSeconds: 9,
    notes: [[0, 5, 0.7], [0.76, 7, 0.7], [1.23, 8, 0.61], [2.12, 9, 0.65, 1]] },
  { id: 'score-39', label: '39秒の独自曲', kind: 'score', onsetSeconds: 0.09, durationSeconds: 39 },
]);

function validateSampleRate(sampleRate: number): void {
  if (!Number.isInteger(sampleRate) || sampleRate < LAKE_KOTO_SAMPLE_RATE || sampleRate > 192_000) {
    throw new RangeError('Koto performance sample rate must be an integer between 48000 and 192000 Hz.');
  }
}

function addNote(samples: Float32Array, voice: Float32Array, seconds: number, sampleRate: number): void {
  const first = Math.round(seconds * sampleRate);
  const length = Math.min(voice.length, samples.length - first);
  for (let index = 0; index < length; index += 1) samples[first + index] += voice[index];
}

/** No per-note or per-clip normalization: preserve the renderer's dynamic ratios. */
export function renderKotoPerformance(renderer: KotoNoteRenderer, sampleRate = LAKE_KOTO_SAMPLE_RATE): Float32Array<ArrayBuffer> {
  validateSampleRate(sampleRate);
  const samples = new Float32Array(Math.round(LAKE_KOTO_DURATION * sampleRate));
  for (const [index, event] of LAKE_KOTO_EVENTS.entries()) {
    // The final hand closes the ringing strings in order, then leaves a breath
    // before the next cycle. This is a performed stop, not a wrap-time crossfade.
    const voice = renderer({
      frequency: LAKE_KOTO_TUNING[event.string - 1].frequency,
      velocity: event.force, pluckPosition: event.pluckPosition,
      pressSemitones: event.pressSemitones, dampAt: event.dampAt,
      duration: Math.min(8, LAKE_KOTO_DURATION - event.seconds), seed: 197 + index * 3923,
    }, sampleRate);
    addNote(samples, voice, event.seconds, sampleRate);
  }
  return samples;
}

export function renderKotoStudyCase(caseId: string, renderer: KotoNoteRenderer,
  sampleRate = LAKE_KOTO_SAMPLE_RATE): Float32Array<ArrayBuffer> {
  validateSampleRate(sampleRate);
  const item = KOTO_STUDY_CASES.find(candidate => candidate.id === caseId);
  if (!item) throw new RangeError(`Unknown koto study case: ${caseId}`);
  if (item.kind === 'score') return renderKotoPerformance(renderer, sampleRate);
  const samples = new Float32Array(Math.round(item.durationSeconds * sampleRate));
  let notes = item.notes;
  if (!notes) {
    if (item.string === undefined || item.force === undefined
      || (item.pressSemitones !== undefined && item.pressSemitones !== 1 && item.pressSemitones !== 2)) {
      throw new Error('Koto study note is missing a valid string, force or press.');
    }
    notes = [[item.onsetSeconds, item.string, item.force, item.pressSemitones]];
  }
  for (const [index, [seconds, string, force, pressSemitones]] of notes.entries()) {
    const voice = renderer({
      frequency: LAKE_KOTO_TUNING[string - 1].frequency,
      velocity: force, pressSemitones, dampAt: item.dampAt,
      duration: Math.min(6, item.durationSeconds - seconds), seed: 197 + index * 3923,
    }, sampleRate);
    addNote(samples, voice, seconds, sampleRate);
  }
  return samples;
}
