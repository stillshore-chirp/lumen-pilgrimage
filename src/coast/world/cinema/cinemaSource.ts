import {
  CINEMA_CHANNELS,
  CINEMA_SAMPLE_RATE,
  type CinemaChannel,
  type CinemaObjectKey,
  type CinemaScreeningAsset,
} from './cinemaProgram';

const RIFF_SIZE_SENTINEL = 0xffff_ffff;
const PCM_FORMAT = 0x0001;
const EXTENSIBLE_FORMAT = 0xfffe;
const PCM_SUBFORMAT = [
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
  0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
] as const;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_WAVE_CHUNKS = 100_000;
const MAX_DS64_BYTES = 16 * 1024 * 1024;
const MAX_READ_BYTES = 256 * 1024 * 1024;
const MAX_OBJECTS = 32;
const MAX_OBJECT_KEYS = 100_000;

type RecordValue = Record<string, unknown>;

interface Ds64Info {
  readonly riffSize: number;
  readonly dataSize: number;
  readonly table: ReadonlyMap<string, number>;
}

interface WaveInfo {
  readonly file: File;
  readonly dataOffset: number;
  readonly dataSize: number;
  readonly frameCount: number;
  readonly channelCount: number;
  readonly blockAlign: number;
  readonly channels: readonly CinemaChannel[] | null;
}

interface ParsedObject {
  readonly file: File;
  readonly startSample: number;
  readonly keys: readonly CinemaObjectKey[];
}

const MASK_CHANNELS = new Map<number, readonly CinemaChannel[]>([
  [0x00000004, ['C']],
  [0x00000003, ['L', 'R']],
  // KSAUDIO_SPEAKER_5POINT1. BL/BR carry the surround pair in this layout.
  [0x0000003f, ['L', 'R', 'C', 'LFE', 'Ls', 'Rs']],
  // KSAUDIO_SPEAKER_7POINT1_SURROUND, in mask-bit order.
  [0x0000063f, ['L', 'R', 'C', 'LFE', 'Bsl', 'Bsr', 'Ls', 'Rs']],
  // KSAUDIO_SPEAKER_7POINT1 (wide), in mask-bit order.
  [0x000000ff, ['L', 'R', 'C', 'LFE', 'Bsl', 'Bsr', 'LC', 'RC']],
  // 7.1.4 variants built from the known lower-channel masks.
  [0x0002d63f, ['L', 'R', 'C', 'LFE', 'Bsl', 'Bsr', 'Ls', 'Rs', 'Ltf', 'Rtf', 'Ltr', 'Rtr']],
  [0x0002d0ff, ['L', 'R', 'C', 'LFE', 'Bsl', 'Bsr', 'LC', 'RC', 'Ltf', 'Rtf', 'Ltr', 'Rtr']],
  [0x0002d6ff, ['L', 'R', 'C', 'LFE', 'Bsl', 'Bsr', 'LC', 'RC', 'Ls', 'Rs', 'Ltf', 'Rtf', 'Ltr', 'Rtr']],
]);

const SUPPORTED_BED_LAYOUTS = new Set([
  ['C'],
  ['L', 'R'],
  ['L', 'LC', 'C', 'RC', 'R'],
  ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'],
  ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Bsl', 'Bsr'],
  ['L', 'R', 'C', 'LFE', 'Bsl', 'Bsr', 'Ls', 'Rs'],
  ['L', 'R', 'C', 'LFE', 'Bsl', 'Bsr', 'LC', 'RC'],
  ['L', 'R', 'C', 'LFE', 'Bsl', 'Bsr', 'LC', 'RC', 'Ls', 'Rs'],
  ['L', 'R', 'C', 'LFE', 'Bsl', 'Bsr', 'Ls', 'Rs', 'Ltf', 'Rtf', 'Ltr', 'Rtr'],
  ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Bsl', 'Bsr', 'Ltf', 'Rtf', 'Ltr', 'Rtr'],
  ['L', 'R', 'C', 'LFE', 'Bsl', 'Bsr', 'LC', 'RC', 'Ltf', 'Rtf', 'Ltr', 'Rtr'],
  ['L', 'R', 'C', 'LFE', 'Bsl', 'Bsr', 'LC', 'RC', 'Ls', 'Rs', 'Ltf', 'Rtf', 'Ltr', 'Rtr'],
  ['L', 'LC', 'C', 'RC', 'R', 'LFE', 'Ls', 'Rs'],
  ['L', 'LC', 'C', 'RC', 'R', 'LFE', 'Bsl', 'Bsr', 'Ls', 'Rs'],
  ['L', 'LC', 'C', 'RC', 'R', 'LFE', 'Ls', 'Rs', 'Bsl', 'Bsr', 'Ltf', 'Rtf', 'Ltr', 'Rtr'],
  ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Bsl', 'Bsr', 'LC', 'RC', 'Ltf', 'Rtf', 'Ltr', 'Rtr'],
].map(channels => channels.join('\u0000')));

function fail(message: string): never {
  throw new Error(`Cinema screening input: ${message}`);
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): RecordValue {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function requireSafeInteger(value: unknown, label: string, minimum?: number): number {
  if (!Number.isSafeInteger(value) || (minimum !== undefined && (value as number) < minimum)) {
    fail(`${label} must be a safe integer${minimum === undefined ? '' : ` >= ${minimum}`}`);
  }
  return value as number;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function safeAdd(a: number, b: number, label: string): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) fail(`${label} is outside the safe sample range`);
  return result;
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function equalChannels(a: readonly CinemaChannel[], b: readonly CinemaChannel[]): boolean {
  return a.length === b.length && a.every((channel, index) => channel === b[index]);
}

function isCinemaChannel(value: unknown): value is CinemaChannel {
  return typeof value === 'string' && (CINEMA_CHANNELS as readonly string[]).includes(value);
}

function parseBedChannels(value: unknown): readonly CinemaChannel[] {
  if (!Array.isArray(value) || value.length === 0) fail('bed.channels must be an array');
  const channels = value.map((channel, index) => {
    if (!isCinemaChannel(channel)) fail(`bed.channels[${index}] is not a known channel`);
    return channel;
  });
  if (!SUPPORTED_BED_LAYOUTS.has(channels.join('\u0000'))) {
    fail('bed.channels が対応チャンネル構成ではありません');
  }
  return channels;
}

function parsePoint(value: unknown, label: string): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) fail(`${label} must contain exactly three coordinates`);
  return [
    requireFiniteNumber(value[0], `${label}[0]`),
    requireFiniteNumber(value[1], `${label}[1]`),
    requireFiniteNumber(value[2], `${label}[2]`),
  ];
}

function parseObject(value: unknown, index: number, durationSamples: number, filesByName: ReadonlyMap<string, File>): ParsedObject {
  const object = requireRecord(value, `objects[${index}]`);
  const fileName = requireString(object.file, `objects[${index}].file`);
  const file = filesByName.get(fileName);
  if (!file) fail(`指定された objects[${index}].file を選択してください: ${JSON.stringify(fileName)}`);
  const startSample = requireSafeInteger(object.startSample, `objects[${index}].startSample`);
  if (!Array.isArray(object.keys) || object.keys.length === 0 || object.keys.length > MAX_OBJECT_KEYS) {
    fail(`objects[${index}].keys must contain between 1 and ${MAX_OBJECT_KEYS} entries`);
  }
  let previousSample = -1;
  const keys = object.keys.map((value, keyIndex): CinemaObjectKey => {
    const key = requireRecord(value, `objects[${index}].keys[${keyIndex}]`);
    const sample = requireSafeInteger(key.sample, `objects[${index}].keys[${keyIndex}].sample`, 0);
    if (sample > durationSamples) fail(`objects[${index}].keys[${keyIndex}].sample is outside durationSamples`);
    if (sample <= previousSample) fail(`objects[${index}].keys must be in strictly ascending sample order`);
    previousSample = sample;
    return {
      sample,
      position: parsePoint(key.position, `objects[${index}].keys[${keyIndex}].position`),
      gainDb: requireFiniteNumber(key.gainDb, `objects[${index}].keys[${keyIndex}].gainDb`),
    };
  });
  return { file, startSample, keys };
}

async function readBytes(file: File, start: number, end: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > file.size) {
    fail(`range ${start}..${end} is outside ${JSON.stringify(file.name)}`);
  }
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

function readUint64(view: DataView, offset: number, label: string): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${label} exceeds the safe byte range`);
  return Number(value);
}

function parseDs64Body(bytes: Uint8Array, label: string): Ds64Info {
  if (bytes.byteLength < 28) fail(`${label} が途中で切れています (ds64)`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = readUint64(view, 0, `${label}.riffSize`);
  const dataSize = readUint64(view, 8, `${label}.dataSize`);
  readUint64(view, 16, `${label}.sampleCount`);
  const tableLength = view.getUint32(24, true);
  const tableBytes = tableLength * 12;
  if (!Number.isSafeInteger(tableBytes) || 28 + tableBytes > bytes.byteLength) fail(`${label} のテーブルが途中で切れています (ds64)`);
  const table = new Map<string, number>();
  for (let index = 0; index < tableLength; index += 1) {
    const entryOffset = 28 + index * 12;
    const chunkId = ascii(bytes.subarray(entryOffset, entryOffset + 4));
    const chunkSize = readUint64(view, entryOffset + 4, `${label}.${chunkId}`);
    if (table.has(chunkId)) fail(`${label} に同じチャンクの記録があります (ds64)`);
    table.set(chunkId, chunkSize);
  }
  return { riffSize, dataSize, table };
}

async function parseDs64(file: File, offset: number, size: number): Promise<Ds64Info> {
  if (size < 28 || size > MAX_DS64_BYTES) fail(`ds64 のサイズを確認してください: ${JSON.stringify(file.name)}`);
  const bytes = await readBytes(file, offset, safeAdd(offset, size, 'ds64 end'));
  return parseDs64Body(bytes, `${file.name}:ds64`);
}

function resolveChunkSize(size32: number, id: string, ds64: Ds64Info | undefined): number {
  if (size32 !== RIFF_SIZE_SENTINEL) return size32;
  if (!ds64) fail(`64-bitサイズのチャンクに ds64 がありません: ${JSON.stringify(id)}`);
  if (id === 'data') return ds64.dataSize;
  const size = ds64.table.get(id);
  if (size === undefined) fail(`ds64 にチャンクサイズの記録がありません: ${JSON.stringify(id)}`);
  return size;
}

function parseWaveFormat(bytes: Uint8Array, fileName: string): {
  readonly channels: number;
  readonly sampleRate: number;
  readonly avgBytesPerSec: number;
  readonly bitsPerSample: number;
  readonly blockAlign: number;
  readonly extensibleMask?: number;
} {
  if (bytes.byteLength < 16) fail(`WAVEのfmtチャンクが途中で切れています: ${JSON.stringify(fileName)}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = view.getUint16(0, true);
  const channels = view.getUint16(2, true);
  const sampleRate = view.getUint32(4, true);
  const avgBytesPerSec = view.getUint32(8, true);
  const blockAlign = view.getUint16(12, true);
  const bitsPerSample = view.getUint16(14, true);
  if (channels < 1 || channels > CINEMA_CHANNELS.length) fail(`fmt in ${JSON.stringify(fileName)} has an unsupported channel count`);
  if (tag === PCM_FORMAT) {
    return { channels, sampleRate, avgBytesPerSec, bitsPerSample, blockAlign };
  }
  if (tag !== EXTENSIBLE_FORMAT || bytes.byteLength < 40) fail(`対応するWAVE形式ではありません（48 kHz・24-bit PCM）: ${JSON.stringify(fileName)}`);
  const cbSize = view.getUint16(16, true);
  if (cbSize < 22 || bytes.byteLength < 18 + cbSize) fail(`WAVEのfmt拡張サイズを確認してください: ${JSON.stringify(fileName)}`);
  const validBits = view.getUint16(18, true);
  const mask = view.getUint32(20, true);
  for (let index = 0; index < PCM_SUBFORMAT.length; index += 1) {
    if (bytes[24 + index] !== PCM_SUBFORMAT[index]) fail(`対応するWAVE形式ではありません（整数PCM）: ${JSON.stringify(fileName)}`);
  }
  if (validBits !== 24) fail(`WAVEは24-bit PCMにしてください: ${JSON.stringify(fileName)}`);
  if (avgBytesPerSec !== sampleRate * blockAlign) fail(`WAVEのバイトレートを確認してください: ${JSON.stringify(fileName)}`);
  return { channels, sampleRate, avgBytesPerSec, bitsPerSample, blockAlign, extensibleMask: mask };
}

async function parseWave(file: File, expectedChannels: readonly CinemaChannel[] | null): Promise<WaveInfo> {
  if (file.size < 12) fail(`WAVEヘッダーが短すぎます: ${JSON.stringify(file.name)}`);
  const header = await readBytes(file, 0, 12);
  const container = ascii(header.subarray(0, 4));
  if (container !== 'RIFF' && container !== 'RF64' && container !== 'BW64') fail(`WAVEヘッダー形式を確認してください（RIFF/RF64/BW64）: ${JSON.stringify(file.name)}`);
  if (ascii(header.subarray(8, 12)) !== 'WAVE') fail(`WAVEヘッダーを確認してください: ${JSON.stringify(file.name)}`);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const riffSize32 = view.getUint32(4, true);
  let ds64: Ds64Info | undefined;
  let containerEnd: number;
  if (container === 'RIFF') {
    if (riffSize32 === RIFF_SIZE_SENTINEL) fail(`RIFFのサイズ欄を確認してください: ${JSON.stringify(file.name)}`);
    containerEnd = safeAdd(8, riffSize32, 'RIFF end');
  } else {
    const ds64Header = await readBytes(file, 12, 20);
    if (ascii(ds64Header.subarray(0, 4)) !== 'ds64') fail(`${container}の先頭に ds64 がありません: ${JSON.stringify(file.name)}`);
    const ds64Size = new DataView(ds64Header.buffer, ds64Header.byteOffset, ds64Header.byteLength).getUint32(4, true);
    if (ds64Size === RIFF_SIZE_SENTINEL) fail('ds64のサイズ欄を確認してください');
    ds64 = await parseDs64(file, 20, ds64Size);
    containerEnd = safeAdd(8, ds64.riffSize, `${container} end`);
  }
  if (containerEnd < 12 || containerEnd > file.size) fail(`WAVEヘッダーのファイルサイズを確認してください: ${JSON.stringify(file.name)}`);

  let offset = 12;
  let chunkCount = 0;
  let format: ReturnType<typeof parseWaveFormat> | undefined;
  let dataOffset: number | undefined;
  let dataSize: number | undefined;
  while (offset < containerEnd) {
    if (++chunkCount > MAX_WAVE_CHUNKS) fail(`${JSON.stringify(file.name)} contains too many chunks`);
    if (containerEnd - offset < 8) fail(`WAVEチャンクヘッダーが途中で切れています: ${JSON.stringify(file.name)}`);
    const chunkHeader = await readBytes(file, offset, safeAdd(offset, 8, 'chunk header end'));
    const id = ascii(chunkHeader.subarray(0, 4));
    const chunkView = new DataView(chunkHeader.buffer, chunkHeader.byteOffset, chunkHeader.byteLength);
    const size = resolveChunkSize(chunkView.getUint32(4, true), id, ds64);
    const bodyStart = safeAdd(offset, 8, `${id} body start`);
    const bodyEnd = safeAdd(bodyStart, size, `${id} body end`);
    const paddedEnd = safeAdd(bodyEnd, size % 2, `${id} padded end`);
    if (paddedEnd > containerEnd || bodyEnd > file.size) fail(`${JSON.stringify(file.name)} has a chunk outside its boundary`);
    if (id === 'fmt ') {
      if (format) fail(`${JSON.stringify(file.name)} has duplicate fmt chunks`);
      const fmtBytes = await readBytes(file, bodyStart, safeAdd(bodyStart, Math.min(size, 64), 'fmt preview end'));
      format = parseWaveFormat(fmtBytes, file.name);
    } else if (id === 'data') {
      if (dataOffset !== undefined) fail(`${JSON.stringify(file.name)} has duplicate data chunks`);
      dataOffset = bodyStart;
      dataSize = size;
    } else if (id === 'ds64' && !ds64 && size >= 28 && size <= MAX_DS64_BYTES) {
      ds64 = await parseDs64(file, bodyStart, size);
    }
    offset = paddedEnd;
  }
  if (offset !== containerEnd) fail(`${JSON.stringify(file.name)} has an invalid chunk alignment`);
  if (!format || dataOffset === undefined || dataSize === undefined) fail(`WAVEにfmt/dataチャンクがありません: ${JSON.stringify(file.name)}`);
  if (format.sampleRate !== CINEMA_SAMPLE_RATE || format.bitsPerSample !== 24) {
    fail(`48 kHz・24-bit PCMのWAVEを選択してください: ${JSON.stringify(file.name)}`);
  }
  if (!expectedChannels && format.channels !== 1) fail(`objectsの音声はモノPCMにしてください: ${JSON.stringify(file.name)}`);
  if (format.blockAlign !== format.channels * 3 || format.blockAlign <= 0) fail(`${JSON.stringify(file.name)} has an invalid PCM block alignment`);
  if (format.sampleRate * format.blockAlign > 0xffff_ffff || format.avgBytesPerSec !== format.sampleRate * format.blockAlign) {
    fail(`${JSON.stringify(file.name)} has an inconsistent PCM byte rate`);
  }
  if (dataSize % format.blockAlign !== 0 || dataSize === 0) fail(`${JSON.stringify(file.name)} data is not a non-empty whole number of frames`);
  const frameCount = dataSize / format.blockAlign;
  if (!Number.isSafeInteger(frameCount)) fail(`${JSON.stringify(file.name)} has too many PCM frames`);

  let channels: readonly CinemaChannel[] | null = expectedChannels;
  if (expectedChannels && format.channels !== expectedChannels.length) {
    fail(`${JSON.stringify(file.name)} channel count does not match the manifest`);
  }
  if (format.extensibleMask !== undefined) {
    if (expectedChannels) {
      const maskChannels = MASK_CHANNELS.get(format.extensibleMask);
      if (!maskChannels || !equalChannels(maskChannels, expectedChannels)) {
        fail(`対応チャンネルの順序がmanifestと一致しません (channel mask): ${JSON.stringify(file.name)}`);
      }
    } else if (format.extensibleMask !== 0 && format.extensibleMask !== 0x00000004) {
      fail(`${JSON.stringify(file.name)} object PCM has an ambiguous channel mask`);
    }
  }
  if (!expectedChannels) channels = null;
  return {
    file,
    dataOffset,
    dataSize,
    frameCount,
    channelCount: format.channels,
    blockAlign: format.blockAlign,
    channels,
  };
}

function readPcm24(bytes: Uint8Array, offset: number): number {
  let sample = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  if (sample & 0x800000) sample -= 0x1000000;
  return sample / 0x800000;
}

async function readWaveRange(info: WaveInfo, timelineStart: number, count: number, assetStart: number): Promise<Float32Array[]> {
  const planeCount = info.channelCount;
  const planes = Array.from({ length: planeCount }, () => new Float32Array(count));
  if (count === 0) return planes;
  const timelineEnd = safeAdd(timelineStart, count, 'read range');
  const assetEnd = safeAdd(assetStart, info.frameCount, `${info.file.name} timeline end`);
  const overlapStart = Math.max(timelineStart, assetStart);
  const overlapEnd = Math.min(timelineEnd, assetEnd);
  if (overlapStart >= overlapEnd) return planes;
  const sourceStart = overlapStart - assetStart;
  const frameCount = overlapEnd - overlapStart;
  const byteStart = safeAdd(info.dataOffset, sourceStart * info.blockAlign, `${info.file.name} data start`);
  const byteLength = frameCount * info.blockAlign;
  const bytes = await readBytes(info.file, byteStart, safeAdd(byteStart, byteLength, `${info.file.name} data end`));
  const outputStart = overlapStart - timelineStart;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const inputOffset = frame * info.blockAlign;
    const outputOffset = outputStart + frame;
    for (let channel = 0; channel < planeCount; channel += 1) {
      planes[channel][outputOffset] = readPcm24(bytes, inputOffset + channel * 3);
    }
  }
  return planes;
}

function parseManifest(value: unknown, filesByName: ReadonlyMap<string, File>, manifestName: string): {
  readonly durationSamples: number;
  readonly video: File;
  readonly videoStartSample: number;
  readonly bed: { readonly file: File; readonly startSample: number; readonly channels: readonly CinemaChannel[]; readonly lfeGainDb: 0 | 10 };
  readonly objects: readonly ParsedObject[];
} {
  const manifest = requireRecord(value, 'manifest');
  if (manifest.version !== 1) fail('manifest.version は 1 にしてください');
  const durationSamples = requireSafeInteger(manifest.durationSamples, 'durationSamples', 1);
  const video = requireRecord(manifest.video, 'video');
  const videoName = requireString(video.file, 'video.file');
  const videoFile = filesByName.get(videoName);
  if (!videoFile) fail(`指定された video.file を選択してください: ${JSON.stringify(videoName)}`);
  if (videoName === manifestName) fail('video.file はJSON manifest以外を指定してください');
  const videoStartSample = requireSafeInteger(video.startSample, 'video.startSample');
  safeAdd(videoStartSample, durationSamples, 'video timeline');
  const bed = requireRecord(manifest.bed, 'bed');
  const bedName = requireString(bed.file, 'bed.file');
  const bedFile = filesByName.get(bedName);
  if (!bedFile) fail(`指定された bed.file を選択してください: ${JSON.stringify(bedName)}`);
  if (bedName === manifestName) fail('bed.file はJSON manifest以外を指定してください');
  const startSample = requireSafeInteger(bed.startSample, 'bed.startSample');
  const channels = parseBedChannels(bed.channels);
  if (bed.lfeGainDb !== 0 && bed.lfeGainDb !== 10) fail('bed.lfeGainDb は 0 または 10 にしてください');
  if (manifest.objects !== undefined && !Array.isArray(manifest.objects)) fail('objects は配列にしてください');
  if (Array.isArray(manifest.objects) && manifest.objects.length > MAX_OBJECTS) fail(`objects は ${MAX_OBJECTS} 件以内にしてください`);
  const objects = (manifest.objects ?? []).map((object, index) => parseObject(object, index, durationSamples, filesByName));
  return {
    durationSamples,
    video: videoFile,
    videoStartSample,
    bed: { file: bedFile, startSample, channels, lfeGainDb: bed.lfeGainDb as 0 | 10 },
    objects,
  };
}

/** Load a version-1 screening manifest and the referenced 48 kHz 24-bit PCM assets. */
export async function openCinemaScreening(files: readonly File[]): Promise<CinemaScreeningAsset> {
  if (!Array.isArray(files) || files.length === 0) fail('上映素材を1つ以上選択してください');
  const filesByName = new Map<string, File>();
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || typeof file.slice !== 'function' || typeof file.size !== 'number') {
      fail('選択した項目をファイルとして読み込めません');
    }
    if (file.name.length === 0) fail('selected files must have names');
    if (filesByName.has(file.name)) fail(`選択したファイル名が重複しています: ${JSON.stringify(file.name)}`);
    filesByName.set(file.name, file);
  }
  const manifestCandidates = files.filter(file => file.name.toLowerCase().endsWith('.json')
    || (file.type ?? '').toLowerCase().split(';', 1)[0] === 'application/json');
  if (manifestCandidates.length !== 1) fail('JSON manifestを1つだけ選択してください');
  const manifestFile = manifestCandidates[0];
  if (manifestFile.size > MAX_MANIFEST_BYTES) fail('JSON manifestが大きすぎます');
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(new TextDecoder().decode(await readBytes(manifestFile, 0, manifestFile.size)));
  } catch {
    fail(`JSON manifestの形式を確認してください: ${JSON.stringify(manifestFile.name)}`);
  }
  const parsed = parseManifest(manifestValue, filesByName, manifestFile.name);
  const bedInfo = await parseWave(parsed.bed.file, parsed.bed.channels);
  const objectInfos = await Promise.all(parsed.objects.map(object => parseWave(object.file, null)));
  safeAdd(parsed.bed.startSample, bedInfo.frameCount, 'bed timeline');
  parsed.objects.forEach((object, index) => safeAdd(object.startSample, objectInfos[index].frameCount, `object ${index} timeline`));
  const planeCount = parsed.bed.channels.length + objectInfos.length;
  const maxReadSamples = Math.floor(MAX_READ_BYTES / (planeCount * Float32Array.BYTES_PER_ELEMENT));
  if (maxReadSamples < 1) fail('screening has too many output planes');
  const program = {
    bed: parsed.bed.channels,
    lfeGainDb: parsed.bed.lfeGainDb,
    objects: parsed.objects.map(object => ({ keys: object.keys })),
  } as const;
  return {
    durationSamples: parsed.durationSamples,
    program,
    video: parsed.video,
    videoStartSample: parsed.videoStartSample,
    async read(startSample: number, count: number): Promise<Float32Array[]> {
      requireSafeInteger(startSample, 'read.startSample');
      requireSafeInteger(count, 'read.count', 0);
      if (count > maxReadSamples) fail(`read.count exceeds the safe output limit of ${maxReadSamples} samples`);
      safeAdd(startSample, count, 'read range');
      const [bedPlanes, ...objectPlanes] = await Promise.all([
        readWaveRange(bedInfo, startSample, count, parsed.bed.startSample),
        ...objectInfos.map((info, index) => readWaveRange(info, startSample, count, parsed.objects[index].startSample)),
      ]);
      return [...bedPlanes, ...objectPlanes.flat()];
    },
  };
}
