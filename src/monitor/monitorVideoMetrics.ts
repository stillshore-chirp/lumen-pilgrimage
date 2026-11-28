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
): Promise<MonitorVideoMeasurement> {
  abort.throwIfAborted();
  const source = video?.srcObject;
  let backgrounded = typeof document !== 'undefined' && document.visibilityState !== 'visible';
  const visibilityChanged = () => { backgrounded ||= document.visibilityState !== 'visible'; };
  const before = await read();
  if (!before) throw new Error('Monitor video is unavailable');
  abort.throwIfAborted();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityChanged);
  let callback: number | undefined;
  let first: number | undefined;
  let last: number | undefined;
  const presentationStarted = performance.now();
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
    return result;
  } finally {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityChanged);
    if (callback !== undefined) video?.cancelVideoFrameCallback(callback);
  }
}

export function describeMonitorVideo(measured: MonitorVideoMeasurement): string {
  const number = (value: number | undefined) => value === undefined ? '未取得' : `${value.toFixed(1)}fps`;
  const sender = measured.captureFps !== undefined || measured.sentFps !== undefined;
  const stages = sender
    ? `取得 ${number(measured.captureFps)}・送信 ${number(measured.sentFps)}（エンコード ${number(measured.encodedFps)}）`
    : `受信 ${number(measured.receivedFps)}・デコード ${number(measured.decodedFps)}・映像フレーム更新 ${number(measured.presentedFps)}`;
  const limitation = measured.qualityLimitation === 'cpu' ? ' 送信側の処理負荷による制限があります。'
    : measured.qualityLimitation === 'bandwidth' ? ' 通信帯域による制限があります。' : '';
  return `${stages}。${limitation} 60fpsは目標値です。取得元・通信・処理負荷・表示環境により変わります。`;
}
