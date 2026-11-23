import type { MonitorOutput, MonitorSharedAudio } from './monitorSession';

interface CaptureAudioConstraints extends MediaTrackConstraints {
  suppressLocalAudioPlayback: boolean;
}

interface CaptureAudioSettings extends MediaTrackSettings {
  suppressLocalAudioPlayback?: boolean;
}

interface CaptureOptions extends DisplayMediaStreamOptions {
  selfBrowserSurface: 'exclude';
  surfaceSwitching: 'exclude';
  systemAudio: 'include';
  windowAudio: 'window';
}

type DisplayMediaDevices = Pick<MediaDevices, 'getDisplayMedia' | 'getSupportedConstraints'>;

interface AudioSelection {
  audio: MonitorSharedAudio;
  explanation: string;
  requiresReselection?: true;
}

const outputLabels: Record<MonitorOutput, string> = {
  pc: 'PC側のみ',
  viewer: 'VR側のみ',
  both: '両方',
};

export function captureErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'AbortError':
        return '画面共有がキャンセルされたか、許可されませんでした。';
      case 'NotFoundError':
        return '共有できる画面が見つかりませんでした。';
      case 'NotReadableError':
        return '画面を取得できませんでした。OSの画面収録権限と共有対象を確認してください。';
      case 'InvalidStateError':
        return 'このタブを開いた状態で、もう一度「画面共有を開始」を押してください。';
    }
  }
  return '画面共有を開始できませんでした。ブラウザとOSの設定を確認してください。';
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    if (track.readyState === 'live') track.stop();
  }
}

export class MonitorCapture {
  private readonly devices: DisplayMediaDevices | undefined;
  private generation = 0;
  private stream: MediaStream | null = null;

  constructor(devices: DisplayMediaDevices | undefined) {
    this.devices = devices;
  }

  get supported() {
    return typeof this.devices?.getDisplayMedia === 'function';
  }

  get active() {
    return this.stream !== null;
  }

  get hasAudio() {
    return this.stream?.getAudioTracks().some(track => track.readyState === 'live') ?? false;
  }

  get sharesFullDisplay() {
    return this.stream?.getVideoTracks()[0]?.getSettings().displaySurface === 'monitor';
  }

  private get supportsSuppressingTabPlayback() {
    const supported = this.devices?.getSupportedConstraints?.() as
      (MediaTrackSupportedConstraints & { suppressLocalAudioPlayback?: boolean }) | undefined;
    return supported?.displaySurface === true && supported.suppressLocalAudioPlayback === true;
  }

  async open(output: MonitorOutput): Promise<MediaStream | null> {
    this.stop();
    const generation = this.generation;
    if (!this.devices || !this.supported) {
      throw new DOMException('', 'NotSupportedError');
    }
    const audioConstraints: CaptureAudioConstraints = {
      suppressLocalAudioPlayback: output === 'viewer',
    };
    const options: CaptureOptions = {
      video: true,
      audio: this.supportsSuppressingTabPlayback ? audioConstraints : true,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      systemAudio: 'include',
      windowAudio: 'window',
    };
    const stream = await this.devices.getDisplayMedia(options);
    if (generation !== this.generation) {
      stopTracks(stream);
      return null;
    }
    if (!stream.getVideoTracks().some(track => track.readyState === 'live')) {
      stopTracks(stream);
      throw new DOMException('', 'NotReadableError');
    }
    this.stream = stream;
    return stream;
  }

  selectAudio(output: MonitorOutput, current?: MonitorOutput): AudioSelection {
    const track = this.stream?.getAudioTracks().find(audio => audio.readyState === 'live');
    if (!track) {
      return {
        audio: { available: false, output: 'pc' },
        explanation: '映像のみ共有中です。音声も送るには、共有ダイアログで音声を共有できる対象を選び、音声共有をオンにしてください。',
      };
    }
    const browserTab = this.stream?.getVideoTracks().find(video => video.readyState === 'live')
      ?.getSettings().displaySurface === 'browser';
    const suppressed = browserTab && (track.getSettings() as CaptureAudioSettings).suppressLocalAudioPlayback === true;
    if (output === 'viewer' && !suppressed) {
      if (current && browserTab && this.supportsSuppressingTabPlayback) {
        return {
          audio: { available: true, output: current },
          explanation: `現在の出力先は「${outputLabels[current]}」です。「VR側のみ」に切り替えるには、音声付きのタブを選び直してください。`,
          requiresReselection: true,
        };
      }
      return {
        audio: { available: true, output: 'both' },
        explanation: browserTab && this.supportsSuppressingTabPlayback
          ? 'PC側の再生停止を確認できないため「両方」で共有しています。'
          : '「VR側のみ」は対応ブラウザで音声付きのタブを共有するときに使えます。現在は「両方」で共有しています。',
      };
    }
    if (suppressed && output !== 'viewer') {
      return {
        audio: output === 'pc'
          ? { available: true, output: 'pc', pcPlaybackSuppressed: true }
          : { available: true, output: 'viewer' },
        explanation: output === 'pc'
          ? '視聴側への音声送信を停止しました。PC側の再生を戻すには、共有対象を選び直してください。'
          : '現在の出力先は「VR側のみ」です。「両方」に切り替えるには、音声付きの共有対象を選び直してください。',
        requiresReselection: true,
      };
    }
    return {
      audio: { available: true, output },
      explanation: output === 'viewer' ? '共有タブのPC側再生を停止する設定をブラウザで確認しました。' : '',
    };
  }

  stop() {
    this.generation += 1;
    if (this.stream) stopTracks(this.stream);
    this.stream = null;
  }
}
