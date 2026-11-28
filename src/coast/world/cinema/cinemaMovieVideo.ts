const MAX_METADATA_BYTES = 64 * 1024 * 1024;
const MAX_FRAME_QUEUE = 8;
const PREFETCH_FRAMES = 4;
const MAX_DECODE_QUEUE = 4;
const MICROSECONDS_PER_SECOND = 1_000_000;

/** A user-facing failure raised while opening or decoding a local screening. */
export class CinemaMovieVideoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CinemaMovieVideoError';
  }
}

export interface CinemaMovieVideo {
  readonly canvas: HTMLCanvasElement;
  readonly duration: number;
  readonly frameVersion: number;
  present(timeSeconds: number): boolean;
  seek(timeSeconds: number): Promise<void>;
  dispose(): void;
}

interface Box {
  readonly start: number;
  readonly end: number;
  readonly headerSize: number;
  readonly contentStart: number;
  readonly type: string;
}

interface Edit {
  readonly duration: number;
  readonly mediaTime: number;
  readonly rate: number;
}

interface Sample {
  readonly index: number;
  readonly offset: number;
  readonly size: number;
  readonly decodeTime: number;
  readonly durationTicks: number;
  readonly key: boolean;
  readonly presentationTime: number;
  readonly outputTimestamp: number;
  readonly outputDuration: number;
}

interface ParsedVideo {
  readonly width: number;
  readonly height: number;
  readonly codec: string;
  readonly description: Uint8Array;
  readonly timescale: number;
  readonly duration: number;
  readonly samples: readonly Sample[];
  readonly presentationOrder: readonly number[];
  readonly sampleByTimestamp: ReadonlyMap<number, number>;
  readonly config: VideoDecoderConfig;
}

interface FrameEntry {
  readonly index: number;
  readonly frame: VideoFrame;
}

function unsupported(message: string): never {
  throw new CinemaMovieVideoError(message);
}

function assertSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) unsupported(`MP4の${field}が安全に扱える範囲を超えています。`);
  return value;
}

function readUint32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.byteLength) unsupported('MP4のメタデータが途中で終わっています。');
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset);
}

function readInt32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.byteLength) unsupported('MP4のメタデータが途中で終わっています。');
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(offset);
}

function readUint16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.byteLength) unsupported('MP4のメタデータが途中で終わっています。');
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset);
}

function readInt16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.byteLength) unsupported('MP4のメタデータが途中で終わっています。');
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt16(offset);
}

function readUint64(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 8 > data.byteLength) unsupported('MP4のメタデータが途中で終わっています。');
  const value = Number(new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset));
  return assertSafeInteger(value, 'ボックス長');
}

function readAscii(data: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > data.byteLength) unsupported('MP4のメタデータが途中で終わっています。');
  return String.fromCharCode(...data.subarray(offset, offset + length));
}

function parseBoxes(data: Uint8Array, start = 0, end = data.byteLength): Box[] {
  const boxes: Box[] = [];
  let cursor = start;
  while (cursor < end) {
    if (cursor + 8 > end) unsupported('MP4のボックスヘッダーが途中で終わっています。');
    const size32 = readUint32(data, cursor);
    const type = readAscii(data, cursor + 4, 4);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      size = readUint64(data, cursor + 8);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - cursor;
    }
    if (size < headerSize || cursor + size > end) {
      unsupported(`MP4の${type}ボックスの長さが不正です。`);
    }
    boxes.push({
      start: cursor,
      end: cursor + size,
      headerSize,
      contentStart: cursor + headerSize,
      type,
    });
    cursor += size;
  }
  return boxes;
}

function findBox(data: Uint8Array, parent: Box, type: string): Box | undefined {
  return parseBoxes(data, parent.contentStart, parent.end).find(box => box.type === type);
}

function requireBox(data: Uint8Array, parent: Box, type: string): Box {
  const box = findBox(data, parent, type);
  if (!box) unsupported(`MP4に必要な${type}ボックスがありません。`);
  return box;
}

function fullBoxVersion(data: Uint8Array, box: Box): number {
  return data[box.contentStart];
}

async function readFileRange(file: File, offset: number, length: number): Promise<Uint8Array> {
  assertSafeInteger(offset, 'サンプルオフセット');
  assertSafeInteger(length, 'サンプルサイズ');
  const result = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  if (result.byteLength !== length) unsupported('MP4サンプルを読み込めませんでした。');
  return result;
}

async function readMovieBox(file: File): Promise<Uint8Array> {
  let offset = 0;
  while (offset + 8 <= file.size) {
    const header = await readFileRange(file, offset, Math.min(16, file.size - offset));
    const size32 = readUint32(header, 0);
    const type = readAscii(header, 4, 4);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (header.byteLength < 16) unsupported(`MP4の${type}ボックスの長さを読み込めません。`);
      size = readUint64(header, 8);
      headerSize = 16;
    } else if (size32 === 0) {
      size = file.size - offset;
    }
    if (size < headerSize || offset + size > file.size) unsupported(`MP4の${type}ボックスの長さが不正です。`);
    if (type === 'moov') {
      if (size > MAX_METADATA_BYTES) unsupported('MP4のメタデータが大きすぎます。');
      return readFileRange(file, offset, size);
    }
    offset += size;
  }
  unsupported('MP4にmoovボックスがありません。断片化された入力はこの初期実装では扱えません。');
}

function parseMovieTimescale(data: Uint8Array, mvhd: Box): { timescale: number; duration: number } {
  const version = fullBoxVersion(data, mvhd);
  if (version === 0) {
    return { timescale: readUint32(data, mvhd.contentStart + 12), duration: readUint32(data, mvhd.contentStart + 16) };
  }
  if (version === 1) {
    return { timescale: readUint32(data, mvhd.contentStart + 20), duration: readUint64(data, mvhd.contentStart + 24) };
  }
  unsupported('MP4のmvhdバージョンに対応していません。');
}

function parseTrackTimescale(data: Uint8Array, mdhd: Box): { timescale: number; duration: number } {
  const version = fullBoxVersion(data, mdhd);
  if (version === 0) {
    return { timescale: readUint32(data, mdhd.contentStart + 12), duration: readUint32(data, mdhd.contentStart + 16) };
  }
  if (version === 1) {
    return { timescale: readUint32(data, mdhd.contentStart + 20), duration: readUint64(data, mdhd.contentStart + 24) };
  }
  unsupported('MP4のmdhdバージョンに対応していません。');
}

function parseEdits(data: Uint8Array, edts: Box): Edit[] {
  const elst = requireBox(data, edts, 'elst');
  const version = fullBoxVersion(data, elst);
  const count = readUint32(data, elst.contentStart + 4);
  let cursor = elst.contentStart + 8;
  const edits: Edit[] = [];
  for (let i = 0; i < count; i += 1) {
    const duration = version === 1 ? readUint64(data, cursor) : readUint32(data, cursor);
    const mediaTimeOffset = version === 1 ? 8 : 4;
    const mediaTime = version === 1 ? Number(new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(cursor + mediaTimeOffset))
      : readInt32(data, cursor + mediaTimeOffset);
    const rateCursor = cursor + mediaTimeOffset + (version === 1 ? 8 : 4);
    const rate = readInt16(data, rateCursor) + readInt16(data, rateCursor + 2) / 65536;
    if (!Number.isFinite(rate) || Math.abs(rate - 1) > 0.0001) unsupported('MP4の可変速度編集リストは扱えません。');
    edits.push({ duration, mediaTime, rate });
    cursor = rateCursor + 4;
  }
  return edits;
}

function parseSampleDescription(data: Uint8Array, stsd: Box): {
  width: number;
  height: number;
  codec: string;
  description: Uint8Array;
} {
  const count = readUint32(data, stsd.contentStart + 4);
  if (count < 1) unsupported('MP4の映像サンプル記述が空です。');
  const entry = parseBoxes(data, stsd.contentStart + 8, stsd.end)[0];
  if (!entry || !['avc1', 'avc3'].includes(entry.type)) {
    unsupported('H.264（avc1/avc3）以外の映像コーデックには対応していません。');
  }
  const width = readUint16(data, entry.contentStart + 24);
  const height = readUint16(data, entry.contentStart + 26);
  if (!width || !height) unsupported('H.264映像の寸法が不正です。');
  const childStart = entry.contentStart + 78;
  const avcC = parseBoxes(data, childStart, entry.end).find(box => box.type === 'avcC');
  if (!avcC || avcC.end - avcC.contentStart < 4) unsupported('H.264のavcC設定がありません。');
  const description = data.slice(avcC.contentStart, avcC.end);
  const codec = `${entry.type}.${[description[1], description[2], description[3]]
    .map(value => value.toString(16).padStart(2, '0')).join('')}`;
  return { width, height, codec, description };
}

function parseTimeEntries(data: Uint8Array, stts: Box, sampleCount: number): {
  decodeTimes: number[];
  durations: number[];
} {
  const count = readUint32(data, stts.contentStart + 4);
  const decodeTimes = new Array<number>(sampleCount);
  const durations = new Array<number>(sampleCount);
  let cursor = stts.contentStart + 8;
  let sample = 0;
  let time = 0;
  for (let i = 0; i < count; i += 1) {
    const run = readUint32(data, cursor);
    const delta = readUint32(data, cursor + 4);
    cursor += 8;
    for (let j = 0; j < run; j += 1) {
      if (sample >= sampleCount) unsupported('MP4のsttsサンプル数が一致しません。');
      decodeTimes[sample] = time;
      durations[sample] = delta;
      time += delta;
      sample += 1;
    }
  }
  if (sample !== sampleCount) unsupported('MP4のsttsサンプル数が一致しません。');
  return { decodeTimes, durations };
}

function parseCompositionOffsets(data: Uint8Array, ctts: Box | undefined, sampleCount: number): number[] {
  const offsets = new Array<number>(sampleCount).fill(0);
  if (!ctts) return offsets;
  const version = fullBoxVersion(data, ctts);
  const count = readUint32(data, ctts.contentStart + 4);
  let cursor = ctts.contentStart + 8;
  let sample = 0;
  for (let i = 0; i < count; i += 1) {
    const run = readUint32(data, cursor);
    const offset = version === 1 ? readInt32(data, cursor + 4) : readUint32(data, cursor + 4);
    cursor += 8;
    for (let j = 0; j < run; j += 1) {
      if (sample >= sampleCount) unsupported('MP4のcttsサンプル数が一致しません。');
      offsets[sample] = offset;
      sample += 1;
    }
  }
  if (sample !== sampleCount) unsupported('MP4のcttsサンプル数が一致しません。');
  return offsets;
}

function parseSampleSizes(data: Uint8Array, stsz: Box): number[] {
  const constant = readUint32(data, stsz.contentStart + 4);
  const count = readUint32(data, stsz.contentStart + 8);
  const sizes = new Array<number>(count);
  if (constant) return sizes.fill(constant);
  let cursor = stsz.contentStart + 12;
  for (let i = 0; i < count; i += 1) {
    sizes[i] = readUint32(data, cursor);
    cursor += 4;
  }
  return sizes;
}

function parseChunkOffsets(data: Uint8Array, stco: Box | undefined, co64: Box | undefined): number[] {
  const box = co64 ?? stco;
  if (!box) unsupported('MP4のチャンクオフセット表がありません。');
  const count = readUint32(data, box.contentStart + 4);
  const result = new Array<number>(count);
  let cursor = box.contentStart + 8;
  for (let i = 0; i < count; i += 1) {
    result[i] = box === co64 ? readUint64(data, cursor) : readUint32(data, cursor);
    cursor += box === co64 ? 8 : 4;
  }
  return result;
}

function parseChunkMap(data: Uint8Array, stsc: Box, chunkCount: number): number[] {
  const count = readUint32(data, stsc.contentStart + 4);
  const entries: { firstChunk: number; samplesPerChunk: number; description: number }[] = [];
  let cursor = stsc.contentStart + 8;
  for (let i = 0; i < count; i += 1) {
    entries.push({
      firstChunk: readUint32(data, cursor),
      samplesPerChunk: readUint32(data, cursor + 4),
      description: readUint32(data, cursor + 8),
    });
    cursor += 12;
  }
  if (!entries.length || entries[0].firstChunk !== 1) unsupported('MP4のstscチャンク表が不正です。');
  const samplesPerChunk = new Array<number>(chunkCount);
  let entryIndex = 0;
  for (let chunk = 1; chunk <= chunkCount; chunk += 1) {
    while (entryIndex + 1 < entries.length && entries[entryIndex + 1].firstChunk <= chunk) entryIndex += 1;
    const entry = entries[entryIndex];
    if (entry.description !== 1) unsupported('複数の映像サンプル記述には対応していません。');
    samplesPerChunk[chunk - 1] = entry.samplesPerChunk;
  }
  return samplesPerChunk;
}

function parseSyncSamples(data: Uint8Array, stss: Box | undefined, sampleCount: number): Set<number> {
  if (!stss) return new Set(Array.from({ length: sampleCount }, (_, index) => index));
  const count = readUint32(data, stss.contentStart + 4);
  const sync = new Set<number>();
  let cursor = stss.contentStart + 8;
  for (let i = 0; i < count; i += 1) sync.add(readUint32(data, cursor + i * 4) - 1);
  return sync;
}

function mapPresentationTimes(
  samples: Array<{ decodeTime: number; durationTicks: number }>,
  edits: readonly Edit[],
  movieTimescale: number,
  trackTimescale: number,
  trackDuration: number,
): { times: number[]; duration: number } {
  const times = new Array<number>(samples.length).fill(Number.NaN);
  if (!edits.length) {
    const origin = samples.reduce((minimum, sample) => Math.min(minimum, sample.decodeTime), Infinity);
    for (let index = 0; index < samples.length; index += 1) {
      times[index] = (samples[index].decodeTime - origin) / trackTimescale;
    }
    const duration = samples.reduce((maximum, sample) => Math.max(maximum,
      (sample.decodeTime - origin + sample.durationTicks) / trackTimescale), trackDuration / trackTimescale);
    return { times, duration };
  }
  let movieCursor = 0;
  for (const edit of edits) {
    if (edit.mediaTime >= 0) {
      const mediaStart = edit.mediaTime;
      const mediaEnd = mediaStart + edit.duration * trackTimescale / movieTimescale;
      const presentationStart = movieCursor / movieTimescale;
      for (let index = 0; index < samples.length; index += 1) {
        const mediaTime = samples[index].decodeTime;
        if (mediaTime >= mediaStart && mediaTime < mediaEnd && Number.isNaN(times[index])) {
          times[index] = presentationStart + (mediaTime - mediaStart) / trackTimescale;
        }
      }
    }
    movieCursor += edit.duration;
  }
  return { times, duration: movieCursor / movieTimescale };
}

function buildSamples(
  data: Uint8Array,
  stbl: Box,
  movieTimescale: number,
  trackTimescale: number,
  trackDuration: number,
  edits: readonly Edit[],
): { samples: Sample[]; presentationOrder: number[]; duration: number } {
  const stsz = requireBox(data, stbl, 'stsz');
  const sizes = parseSampleSizes(data, stsz);
  if (!sizes.length) unsupported('MP4の映像サンプルが空です。');
  const stts = requireBox(data, stbl, 'stts');
  const { decodeTimes, durations } = parseTimeEntries(data, stts, sizes.length);
  const compositionOffsets = parseCompositionOffsets(data, findBox(data, stbl, 'ctts'), sizes.length);
  const chunkOffsets = parseChunkOffsets(data, findBox(data, stbl, 'stco'), findBox(data, stbl, 'co64'));
  const samplesPerChunk = parseChunkMap(data, requireBox(data, stbl, 'stsc'), chunkOffsets.length);
  const keySamples = parseSyncSamples(data, findBox(data, stbl, 'stss'), sizes.length);
  const offsets = new Array<number>(sizes.length);
  let sampleIndex = 0;
  for (let chunk = 0; chunk < chunkOffsets.length; chunk += 1) {
    let sampleOffset = chunkOffsets[chunk];
    const count = samplesPerChunk[chunk];
    for (let item = 0; item < count && sampleIndex < sizes.length; item += 1) {
      offsets[sampleIndex] = sampleOffset;
      sampleOffset += sizes[sampleIndex];
      sampleIndex += 1;
    }
  }
  if (sampleIndex !== sizes.length) unsupported('MP4のチャンク表とサンプル数が一致しません。');
  const mapped = mapPresentationTimes(
    sizes.map((_, index) => ({ decodeTime: decodeTimes[index] + compositionOffsets[index], durationTicks: durations[index] })),
    edits, movieTimescale, trackTimescale, trackDuration,
  );
  const samples = sizes.map((size, index) => {
    const presentationTime = mapped.times[index];
    return {
      index,
      offset: offsets[index],
      size,
      decodeTime: decodeTimes[index],
      durationTicks: durations[index],
      key: keySamples.has(index),
      presentationTime,
      outputTimestamp: Number.isNaN(presentationTime) ? -1 : Math.round(presentationTime * MICROSECONDS_PER_SECOND),
      outputDuration: Math.max(1, Math.round(durations[index] / trackTimescale * MICROSECONDS_PER_SECOND)),
    };
  });
  const presentationOrder = samples.filter(sample => Number.isFinite(sample.presentationTime))
    .sort((a, b) => a.presentationTime - b.presentationTime || a.index - b.index)
    .map(sample => sample.index);
  if (!presentationOrder.length) unsupported('MP4の編集リストから表示できる映像区間を得られません。');
  return { samples, presentationOrder, duration: mapped.duration };
}

async function parseVideo(file: File): Promise<ParsedVideo> {
  if (!file.size) unsupported('空の上映ファイルです。');
  const movieBytes = await readMovieBox(file);
  const movie = parseBoxes(movieBytes).find(box => box.type === 'moov');
  if (!movie) unsupported('MP4のmoovボックスを解釈できません。');
  const movieHeader = requireBox(movieBytes, movie, 'mvhd');
  const movieTime = parseMovieTimescale(movieBytes, movieHeader);
  if (!movieTime.timescale) unsupported('MP4のmovie timescaleが不正です。');
  const tracks = parseBoxes(movieBytes, movie.contentStart, movie.end).filter(box => box.type === 'trak');
  for (const track of tracks) {
    const mdia = findBox(movieBytes, track, 'mdia');
    if (!mdia) continue;
    const handler = findBox(movieBytes, mdia, 'hdlr');
    if (!handler || readAscii(movieBytes, handler.contentStart + 8, 4) !== 'vide') continue;
    const mdhd = requireBox(movieBytes, mdia, 'mdhd');
    const trackTime = parseTrackTimescale(movieBytes, mdhd);
    if (!trackTime.timescale) unsupported('MP4のvideo timescaleが不正です。');
    const minf = requireBox(movieBytes, mdia, 'minf');
    const stbl = requireBox(movieBytes, minf, 'stbl');
    const description = parseSampleDescription(movieBytes, requireBox(movieBytes, stbl, 'stsd'));
    const edits = findBox(movieBytes, track, 'edts') ? parseEdits(movieBytes, findBox(movieBytes, track, 'edts')!) : [];
    const trackSamples = buildSamples(movieBytes, stbl, movieTime.timescale, trackTime.timescale, trackTime.duration, edits);
    const config: VideoDecoderConfig = {
      codec: description.codec,
      codedWidth: description.width,
      codedHeight: description.height,
      description: description.description,
      hardwareAcceleration: 'prefer-hardware',
      optimizeForLatency: true,
    };
    if (typeof VideoDecoder === 'undefined') unsupported('このブラウザーはWebCodecs VideoDecoderに対応していません。Chromeの対応環境で開いてください。');
    let support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) {
      config.hardwareAcceleration = 'no-preference';
      support = await VideoDecoder.isConfigSupported(config);
    }
    if (!support.supported) unsupported(`このブラウザーはH.264映像形式（${description.codec}）をデコードできません。`);
    const sampleByTimestamp = new Map<number, number>();
    for (const index of trackSamples.presentationOrder) sampleByTimestamp.set(trackSamples.samples[index].outputTimestamp, index);
    return {
      ...description,
      timescale: trackTime.timescale,
      duration: edits.length ? trackSamples.duration : Math.max(trackSamples.duration, movieTime.duration / movieTime.timescale),
      samples: trackSamples.samples,
      presentationOrder: trackSamples.presentationOrder,
      sampleByTimestamp,
      config,
    };
  }
  unsupported('MP4にH.264映像トラックがありません。');
}

class CinemaMovieVideoImpl implements CinemaMovieVideo {
  readonly canvas: HTMLCanvasElement;
  readonly duration: number;
  private readonly context: CanvasRenderingContext2D;
  private readonly file: File;
  private readonly video: ParsedVideo;
  private readonly frames = new Map<number, FrameEntry>();
  private decoder: VideoDecoder | null = null;
  private decoderGeneration = 0;
  private decoderNeedsKeyframe = false;
  private decodeCursor = 0;
  private requestedTarget: number | null = null;
  private pumpQueued = false;
  private operation: Promise<void> = Promise.resolve();
  private lastPresentedIndex = -1;
  private _frameVersion = 0;
  private disposed = false;
  private lastError: CinemaMovieVideoError | null = null;

  constructor(file: File, video: ParsedVideo) {
    this.file = file;
    this.video = video;
    this.duration = video.duration;
    this.canvas = document.createElement('canvas');
    this.canvas.width = video.width;
    this.canvas.height = video.height;
    const context = this.canvas.getContext('2d');
    if (!context) throw new CinemaMovieVideoError('映像表示用の2Dキャンバスを作成できません。');
    this.context = context;
  }

  get frameVersion(): number {
    return this._frameVersion;
  }

  private releaseFrames(): void {
    for (const entry of this.frames.values()) entry.frame.close();
    this.frames.clear();
  }

  private trimFrames(): void {
    while (this.frames.size > MAX_FRAME_QUEUE) {
      const candidate = [...this.frames.values()].find(entry => entry.index !== this.lastPresentedIndex);
      if (!candidate) break;
      candidate.frame.close();
      this.frames.delete(candidate.index);
    }
  }

  private closeDecoder(): void {
    this.decoderGeneration += 1;
    if (this.decoder) {
      this.decoder.close();
      this.decoder = null;
    }
  }

  private findKeySample(index: number): number {
    for (let cursor = index; cursor >= 0; cursor -= 1) if (this.video.samples[cursor].key) return cursor;
    unsupported('対象フレームへ到達できるH.264キーフレームがありません。');
  }

  private createDecoder(startIndex: number): number {
    this.closeDecoder();
    const generation = this.decoderGeneration;
    this.decoder = new VideoDecoder({
      output: frame => {
        if (this.disposed || generation !== this.decoderGeneration) {
          frame.close();
          return;
        }
        const index = this.video.sampleByTimestamp.get(frame.timestamp);
        if (index === undefined) {
          frame.close();
          return;
        }
        const previous = this.frames.get(index);
        previous?.frame.close();
        this.frames.set(index, { index, frame });
        this.trimFrames();
      },
      error: error => {
        if (generation === this.decoderGeneration) {
          this.lastError = new CinemaMovieVideoError(`H.264映像のデコードに失敗しました: ${error.message}`);
        }
      },
    });
    this.decoder.configure(this.video.config);
    this.decoderNeedsKeyframe = false;
    this.decodeCursor = startIndex;
    return generation;
  }

  private async waitForDecodeSlot(decoder: VideoDecoder): Promise<void> {
    while (decoder.decodeQueueSize >= MAX_DECODE_QUEUE) {
      await new Promise<void>(resolve => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          decoder.removeEventListener('dequeue', onDequeue);
          clearTimeout(timeout);
          resolve();
        };
        const onDequeue = () => {
          if (decoder.decodeQueueSize < MAX_DECODE_QUEUE) settle();
        };
        const timeout = window.setTimeout(settle, 20);
        decoder.addEventListener('dequeue', onDequeue);
        onDequeue();
      });
      if (this.lastError) throw this.lastError;
    }
  }

  private async decodeTo(targetIndex: number, reset: boolean): Promise<void> {
    if (this.disposed) return;
    const target = Math.max(0, Math.min(targetIndex, this.video.samples.length - 1));
    if (this.frames.has(target)) return;
    const start = this.findKeySample(target);
    if (reset || !this.decoder || this.decoderNeedsKeyframe || target < this.decodeCursor) {
      if (reset) this.releaseFrames();
      this.lastPresentedIndex = -1;
      this.createDecoder(start);
    }
    const decoder = this.decoder;
    if (!decoder) unsupported('映像デコーダーを初期化できません。');
    const generation = this.decoderGeneration;
    const limit = Math.min(this.video.samples.length - 1, target + MAX_FRAME_QUEUE / 2);
    while (!this.frames.has(target) && this.decodeCursor <= limit) {
      if (this.disposed || generation !== this.decoderGeneration) return;
      await this.waitForDecodeSlot(decoder);
      const sample = this.video.samples[this.decodeCursor];
      const bytes = await readFileRange(this.file, sample.offset, sample.size);
      if (this.disposed || generation !== this.decoderGeneration) return;
      decoder.decode(new EncodedVideoChunk({
        type: sample.key ? 'key' : 'delta',
        timestamp: sample.outputTimestamp,
        duration: sample.outputDuration,
        data: bytes,
      }));
      this.decodeCursor += 1;
    }
    if (!this.frames.has(target)) {
      await decoder.flush();
      this.decoderNeedsKeyframe = true;
    }
    if (this.lastError) throw this.lastError;
    if (!this.frames.has(target)) throw new CinemaMovieVideoError('指定した映像フレームを準備できませんでした。');
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.operation.then(task, task);
    this.operation = next.then(() => undefined, () => undefined);
    return next;
  }

  private requestDecode(targetIndex: number): void {
    this.requestedTarget = Math.max(this.requestedTarget ?? -1, targetIndex);
    if (this.pumpQueued) return;
    this.pumpQueued = true;
    void this.enqueue(async () => {
      try {
        while (this.requestedTarget !== null && !this.disposed) {
          const target = this.requestedTarget;
          this.requestedTarget = null;
          await this.decodeTo(target, false);
        }
      } catch (error) {
        this.lastError = error instanceof CinemaMovieVideoError
          ? error : new CinemaMovieVideoError('映像デコード中に予期しないエラーが発生しました。', { cause: error });
      } finally {
        this.pumpQueued = false;
      }
    });
  }

  private presentationIndex(timeSeconds: number): number {
    const order = this.video.presentationOrder;
    if (timeSeconds <= this.video.samples[order[0]].presentationTime) return order[0];
    let low = 0;
    let high = order.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.video.samples[order[middle]].presentationTime <= timeSeconds) low = middle;
      else high = middle - 1;
    }
    return order[low];
  }

  present(timeSeconds: number): boolean {
    if (this.disposed) return false;
    if (this.lastError) {
      const error = this.lastError;
      this.lastError = null;
      throw error;
    }
    if (!Number.isFinite(timeSeconds)) throw new CinemaMovieVideoError('上映時刻は有限な秒数で指定してください。');
    const time = Math.max(0, Math.min(this.duration, timeSeconds));
    const target = this.presentationIndex(time);
    if (target === this.lastPresentedIndex && this.frames.has(target)) return true;
    const entry = this.frames.get(target);
    if (!entry) {
      this.requestDecode(target);
      return false;
    }
    this.context.drawImage(entry.frame, 0, 0, this.canvas.width, this.canvas.height);
    this.lastPresentedIndex = target;
    this._frameVersion += 1;
    this.requestDecode(Math.min(this.video.samples.length - 1, target + PREFETCH_FRAMES));
    return true;
  }

  async seek(timeSeconds: number): Promise<void> {
    if (this.disposed) throw new CinemaMovieVideoError('破棄済みの上映映像はシークできません。');
    if (!Number.isFinite(timeSeconds)) throw new CinemaMovieVideoError('シーク時刻は有限な秒数で指定してください。');
    const time = Math.max(0, Math.min(this.duration, timeSeconds));
    const target = this.presentationIndex(time);
    this.requestedTarget = null;
    await this.enqueue(async () => {
      if (this.disposed) throw new CinemaMovieVideoError('破棄済みの上映映像です。');
      this.lastError = null;
      await this.decodeTo(target, true);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requestedTarget = null;
    this.closeDecoder();
    this.releaseFrames();
    this.lastPresentedIndex = -1;
  }
}

export async function openCinemaMovieVideo(file: File): Promise<CinemaMovieVideo> {
  if (typeof document === 'undefined') unsupported('ローカル映像はブラウザー環境で開いてください。');
  if (typeof VideoDecoder === 'undefined') unsupported('このブラウザーはWebCodecs VideoDecoderに対応していません。Chromeの対応環境で開いてください。');
  const parsed = await parseVideo(file);
  const result = new CinemaMovieVideoImpl(file, parsed);
  try {
    await result.seek(0);
    return result;
  } catch (error) {
    result.dispose();
    if (error instanceof CinemaMovieVideoError) throw error;
    throw new CinemaMovieVideoError('ローカル映像を初期化できませんでした。', { cause: error });
  }
}
