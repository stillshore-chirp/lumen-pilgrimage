export const MONITOR_TARGET_FRAME_RATE = 60;

const counterNames = ['frames', 'framesEncoded', 'framesSent', 'framesReceived', 'framesDecoded', 'framesDropped'] as const;
type CounterName = typeof counterNames[number];
type Counter = { id: string; timestamp: number; type: string } & Partial<Record<CounterName, number>>;
export type MonitorVideoSnapshot = {
  counters: Counter[];
  width?: number;
  height?: number;
  qualityLimitation?: 'none' | 'cpu' | 'bandwidth' | 'other';
};
export type MonitorSurfaceFrames = { renderedFrames: number; videoFrames: number; uploadFrames: number; timestamp: number; surface: 'floating' | 'television' };
export type MonitorVideoMeasurement = {
  durationMs: number;
  captureFps?: number;
  encodedFps?: number;
  sentFps?: number;
  receivedFps?: number;
  decodedFps?: number;
  droppedFps?: number;
  presentedFps?: number;
  presentationFrames?: number;
  presentationDurationMs?: number;
  renderedFps?: number;
  suppliedFps?: number;
  uploadFps?: number;
  playbackPresentedFps?: number;
  playbackDroppedFps?: number;
  playbackQualityScope?: 'visible-dom' | 'unavailable-hidden-dom';
  surface?: MonitorSurfaceFrames['surface'];
  width?: number;
  height?: number;
  qualityLimitation?: MonitorVideoSnapshot['qualityLimitation'];
};

type VideoStat = RTCStats & Partial<Record<CounterName, number>> & {
  kind?: string;
  frameWidth?: number;
  frameHeight?: number;
  width?: number;
  height?: number;
  qualityLimitationReason?: string;
};

/** Keep frame counters only; SDP, ICE addresses and track labels never leave getStats. */
export function monitorVideoSnapshot(report: RTCStatsReport): MonitorVideoSnapshot {
  const snapshot: MonitorVideoSnapshot = { counters: [] };
  report.forEach((value: VideoStat) => {
    if (value.kind !== 'video' || !['media-source', 'outbound-rtp', 'inbound-rtp'].includes(value.type)) return;
    const counter: Counter = { id: value.id, type: value.type, timestamp: value.timestamp };
    for (const name of counterNames) {
      const count = value[name];
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0) counter[name] = count;
    }
    snapshot.counters.push(counter);
    snapshot.width = value.frameWidth ?? value.width ?? snapshot.width;
    snapshot.height = value.frameHeight ?? value.height ?? snapshot.height;
    const reason = value.qualityLimitationReason;
    if (reason === 'none' || reason === 'cpu' || reason === 'bandwidth' || reason === 'other') snapshot.qualityLimitation = reason;
  });
  return snapshot;
}

export function monitorVideoRates(before: MonitorVideoSnapshot, after: MonitorVideoSnapshot): MonitorVideoMeasurement {
  const result: MonitorVideoMeasurement = { durationMs: 0, width: after.width, height: after.height, qualityLimitation: after.qualityLimitation };
  const fields = [
    ['media-source', 'frames', 'captureFps'], ['outbound-rtp', 'framesEncoded', 'encodedFps'],
    ['outbound-rtp', 'framesSent', 'sentFps'], ['inbound-rtp', 'framesReceived', 'receivedFps'],
    ['inbound-rtp', 'framesDecoded', 'decodedFps'], ['inbound-rtp', 'framesDropped', 'droppedFps'],
  ] as const;
  for (const [type, counter, field] of fields) {
    let total: number | undefined;
    for (const end of after.counters.filter(row => row.type === type)) {
      const start = before.counters.find(row => row.id === end.id && row.type === type);
      const elapsed = start ? end.timestamp - start.timestamp : 0;
      const first = start?.[counter];
      const last = end[counter];
      if (elapsed <= 0 || first === undefined || last === undefined || last < first) continue;
      total = (total ?? 0) + (last - first) * 1000 / elapsed;
      result.durationMs = Math.max(result.durationMs, elapsed);
    }
    if (total !== undefined) result[field] = total;
  }
  return result;
}

export async function measureMonitorVideo(
  read: () => Promise<MonitorVideoSnapshot | null>,
  abort: AbortSignal,
  video?: HTMLVideoElement,
  durationMs = 3_000,
  surface?: () => MonitorSurfaceFrames | null,
): Promise<MonitorVideoMeasurement> {
  abort.throwIfAborted();
  const source = video?.srcObject;
  let backgrounded = typeof document !== 'undefined' && document.visibilityState !== 'visible';
  const visibilityChanged = () => { backgrounded ||= document.visibilityState !== 'visible'; };
  const before = await read();
  if (!before) throw new Error('Monitor video is unavailable');
  abort.throwIfAborted();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityChanged);
  const surfaceBefore = surface?.();
  let callback: number | undefined;
  let first: number | undefined;
  let last: number | undefined;
  const presentationStarted = performance.now();
  const qualityBefore = video?.getVideoPlaybackQuality?.();
  const observe: VideoFrameRequestCallback = (_now, metadata) => {
    last = metadata.presentedFrames;
    first ??= last;
    callback = video!.requestVideoFrameCallback(observe);
  };
  if (video && typeof video.requestVideoFrameCallback === 'function') callback = video.requestVideoFrameCallback(observe);
  try {
    await new Promise<void>((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(abort.reason); };
      const timer = setTimeout(() => { abort.removeEventListener('abort', stop); resolve(); }, durationMs);
      abort.addEventListener('abort', stop, { once: true });
    });
    abort.throwIfAborted();
    const presentationDurationMs = performance.now() - presentationStarted;
    const surfaceAfter = surface?.();
    const qualityAfter = video?.getVideoPlaybackQuality?.();
    const after = await read();
    abort.throwIfAborted();
    if (!after || video && video.srcObject !== source) throw new Error('Monitor video changed during measurement');
    if (backgrounded) throw new Error('Monitor measurement requires a visible page');
    const result = monitorVideoRates(before, after);
    if (video && typeof video.requestVideoFrameCallback === 'function' && presentationDurationMs > 0) {
      // Count the entire observation window, including freezes after the last callback.
      // The first callback contributes one frame. Delayed initial callbacks can undercount composition.
      result.presentationFrames = first !== undefined && last !== undefined ? Math.max(0, last - first + 1) : 0;
      result.presentationDurationMs = presentationDurationMs;
      result.presentedFps = result.presentationFrames * 1000 / presentationDurationMs;
    }
    if (qualityBefore && qualityAfter && presentationDurationMs > 0 && !video?.hidden) {
      result.playbackQualityScope = 'visible-dom';
      const displayedBefore = qualityBefore.totalVideoFrames - qualityBefore.droppedVideoFrames;
      const displayedAfter = qualityAfter.totalVideoFrames - qualityAfter.droppedVideoFrames;
      if (displayedAfter >= displayedBefore) result.playbackPresentedFps = (displayedAfter - displayedBefore) * 1000 / presentationDurationMs;
      if (qualityAfter.droppedVideoFrames >= qualityBefore.droppedVideoFrames) result.playbackDroppedFps = (qualityAfter.droppedVideoFrames - qualityBefore.droppedVideoFrames) * 1000 / presentationDurationMs;
    }
    if (video?.hidden) result.playbackQualityScope = 'unavailable-hidden-dom';
    if (surfaceBefore && surfaceAfter && surfaceBefore.surface === surfaceAfter.surface && surfaceAfter.timestamp > surfaceBefore.timestamp) {
      result.surface = surfaceAfter.surface;
      const seconds = (surfaceAfter.timestamp - surfaceBefore.timestamp) / 1000;
      if (surfaceAfter.renderedFrames >= surfaceBefore.renderedFrames) result.renderedFps = (surfaceAfter.renderedFrames - surfaceBefore.renderedFrames) / seconds;
      if (surfaceAfter.uploadFrames >= surfaceBefore.uploadFrames) result.uploadFps = (surfaceAfter.uploadFrames - surfaceBefore.uploadFrames) / seconds;
      if (surfaceAfter.videoFrames >= surfaceBefore.videoFrames) result.suppliedFps = (surfaceAfter.videoFrames - surfaceBefore.videoFrames) / seconds;
    }
    return result;
  } finally {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityChanged);
    if (callback !== undefined) video?.cancelVideoFrameCallback(callback);
  }
}

export function describeMonitorVideo(measured: MonitorVideoMeasurement, role: 'sender' | 'viewer'): string {
  const number = (value: number | undefined) => value === undefined ? '未取得' : `${value.toFixed(1)}fps`;
  const sender = role === 'sender';
  const stages = sender
    ? `取得 ${number(measured.captureFps)}・送信 ${number(measured.sentFps)}（エンコード ${number(measured.encodedFps)}）`
    : `受信 ${number(measured.receivedFps)}・デコード ${number(measured.decodedFps)}・映像フレーム更新 ${number(measured.presentedFps)}`;
  const label = measured.surface === 'floating' ? '浮遊面' : measured.surface === 'television' ? 'テレビ面' : '対象面';
  const surface = !sender ? ` 景観描画 ${number(measured.renderedFps)}・景観への映像供給 ${number(measured.suppliedFps)}（${label}）。` : '';
  const limitation = measured.qualityLimitation === 'cpu' ? ' 送信側の処理負荷による制限があります。'
    : measured.qualityLimitation === 'bandwidth' ? ' 通信帯域による制限があります。' : '';
  return `${stages}。${surface}${limitation} 60fpsは目標値です。取得元・通信・処理負荷・表示環境により変わります。`;
}
