import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CINEMA_SCREENING_SAMPLE_RATE = 48_000;
const durationSeconds = 16;
export const CINEMA_SCREENING_DURATION_SAMPLES = durationSeconds * CINEMA_SCREENING_SAMPLE_RATE;
export const CINEMA_SCREENING_CHANNELS = [
  'L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Bsl', 'Bsr', 'Ltf', 'Rtf', 'Ltr', 'Rtr',
];

export function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true }).status === 0;
}

function writePcm24Wave(path, channels, samples, frequency, amplitude) {
  const blockAlign = channels * 3;
  const dataBytes = samples * blockAlign;
  const wave = Buffer.alloc(44 + dataBytes);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(36 + dataBytes, 4);
  wave.write('WAVE', 8);
  wave.write('fmt ', 12);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(channels, 22);
  wave.writeUInt32LE(CINEMA_SCREENING_SAMPLE_RATE, 24);
  wave.writeUInt32LE(CINEMA_SCREENING_SAMPLE_RATE * blockAlign, 28);
  wave.writeUInt16LE(blockAlign, 32);
  wave.writeUInt16LE(24, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(dataBytes, 40);

  for (let frame = 0; frame < samples; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const channelFrequency = frequency + channel * 37;
      const envelope = 0.82 + 0.18 * Math.sin((2 * Math.PI * frame) / CINEMA_SCREENING_SAMPLE_RATE);
      const value = Math.round(amplitude * envelope
        * Math.sin((2 * Math.PI * channelFrequency * frame) / CINEMA_SCREENING_SAMPLE_RATE) * 8_388_607);
      wave.writeIntLE(value, 44 + frame * blockAlign + channel * 3, 3);
    }
  }
  return writeFile(path, wave);
}

export async function createCinemaScreeningFixture(directory) {
  await mkdir(directory, { recursive: true });
  const programPath = join(directory, 'screening-program.json');
  const videoPath = join(directory, 'screening-picture.mp4');
  const bedPath = join(directory, 'screening-bed.wav');
  const objectPath = join(directory, 'screening-object.wav');
  const invalidProgramPath = join(directory, 'invalid-screening-program.json');

  const video = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=24:duration=${durationSeconds}`,
    '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', videoPath,
  ], { stdio: 'ignore', windowsHide: true });
  if (video.status !== 0) throw new Error('ffmpeg could not create the cinema screening video fixture.');

  await Promise.all([
    writePcm24Wave(bedPath, CINEMA_SCREENING_CHANNELS.length,
      CINEMA_SCREENING_DURATION_SAMPLES, 173, 0.018),
    writePcm24Wave(objectPath, 1, CINEMA_SCREENING_DURATION_SAMPLES, 997, 0.12),
  ]);

  const program = {
    version: 1,
    durationSamples: CINEMA_SCREENING_DURATION_SAMPLES,
    video: { file: 'screening-picture.mp4', startSample: 0 },
    bed: {
      file: 'screening-bed.wav',
      startSample: 0,
      channels: CINEMA_SCREENING_CHANNELS,
      lfeGainDb: 0,
    },
    objects: [{
      file: 'screening-object.wav',
      startSample: 0,
      keys: [
        { sample: 0, position: [0, 4.4, 0], gainDb: 0 },
        { sample: CINEMA_SCREENING_DURATION_SAMPLES / 2, position: [2.5, 5.2, -1.5], gainDb: -2 },
      ],
    }],
  };
  await Promise.all([
    writeFile(programPath, `${JSON.stringify(program, null, 2)}\n`),
    writeFile(invalidProgramPath, '{"version":1,"durationSamples":0}\n'),
  ]);

  return {
    programPath,
    videoPath,
    bedPath,
    objectPath,
    invalidProgramPath,
    files: [programPath, videoPath, bedPath, objectPath],
  };
}
