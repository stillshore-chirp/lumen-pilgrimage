import { CanvasTexture, SRGBColorSpace } from 'three';

const WIDTH = 960;
const HEIGHT = 540;
export const CINEMA_PREVIEW_DURATION = 26;
const phases = [
  { at: 0, cue: 'center', caption: '幕の中央' },
  { at: 5, cue: 'left', caption: '幕の左から右へ' },
  { at: 10, cue: 'right', caption: 'スクリーン右' },
  { at: 15, cue: 'overhead', caption: '天井を前から後ろへ' },
  { at: 20, cue: 'rear', caption: '客席の後方' },
] as const;

type PreviewCue = typeof phases[number]['cue'];

export function createCinemaPreview() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const frame = canvas.getContext('2d');
  if (!frame) throw new Error('Cinema preview canvas is unavailable');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  let startedAt: number | null = null;
  let drawnFrame = -1;
  let lastCue = -1;
  let cueAt = 0;
  let frameVersion = 0;

  function renderAt(seconds: number, cue: number): boolean {
    const time = Math.max(0, Math.min(CINEMA_PREVIEW_DURATION - 1 / 24, seconds));
    const nextFrame = Math.floor(time * 24);
    if (nextFrame === drawnFrame) return true;
    drawnFrame = nextFrame;
    const phaseIndex = Math.min(phases.length - 1, Math.floor(time / 5));
    paintFrame(frame!, phaseIndex, time, cue);
    ++frameVersion;
    texture.needsUpdate = true;
    return true;
  }

  return {
    canvas,
    duration: CINEMA_PREVIEW_DURATION,
    texture,
    aspect: WIDTH / HEIGHT,
    get frameVersion() { return frameVersion; },
    get playing() { return startedAt !== null; },
    start(elapsed: number) {
      startedAt = elapsed;
      drawnFrame = lastCue = -1;
      cueAt = 0;
    },
    stop() { startedAt = null; },
    present(time: number) {
      const phase = Math.min(phases.length - 1, Math.max(0, Math.floor(time / 5)));
      return renderAt(time, phases[phase].at + 0.6);
    },
    seek(time: number) {
      drawnFrame = -1;
      this.present(time);
      return Promise.resolve();
    },
    update(elapsed: number, play: (cue: PreviewCue) => void) {
      if (startedAt === null) return;
      const time = elapsed - startedAt;
      if (time >= CINEMA_PREVIEW_DURATION) {
        startedAt = null;
        return;
      }
      const phaseIndex = Math.min(phases.length - 1, Math.floor(time / 5));
      const phase = phases[phaseIndex];
      if (time >= phase.at + .6 && phaseIndex !== lastCue) {
        cueAt = time;
        lastCue = phaseIndex;
        play(phase.cue);
      }
      renderAt(time, cueAt);
    },
    dispose() { texture.dispose(); },
  };
}

function paintFrame(frame: CanvasRenderingContext2D, phase: number, time: number, cueAt: number): void {
  frame.fillStyle = '#060b12';
  frame.fillRect(0, 0, WIDTH, HEIGHT);

  const phaseEnd = phases[phase + 1]?.at ?? CINEMA_PREVIEW_DURATION;
  const reveal = Math.min(1, (time - phases[phase].at) * 1.4, (phaseEnd - time) / .82);
  const pulse = Math.exp(-3.5 * Math.max(0, time - cueAt));
  const x = phase === 1 ? 211 : phase === 2 ? WIDTH - 211 : WIDTH / 2;
  const y = phase === 3 ? 120 : 253;
  const halo = frame.createRadialGradient(x, y, 8, x, y, phase === 1 || phase === 2 ? 390 : 265);
  halo.addColorStop(0, phase === 4 ? '#b79265' : '#e8e9d8');
  halo.addColorStop(.37, phase === 1 || phase === 2 ? '#aeb5a5' : '#365665');
  halo.addColorStop(1, '#0c121e00');
  frame.globalAlpha = reveal * (.76 + pulse * .18);
  frame.fillStyle = halo;
  frame.fillRect(0, 0, WIDTH, HEIGHT);

  frame.globalAlpha = reveal * .34;
  frame.strokeStyle = '#cfeced';
  frame.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const radius = 22 + 25 * i + 11 * Math.sin(time * .85 - i * .45);
    frame.beginPath();
    frame.ellipse(x, y, radius * 1.54, radius, 0.05, 0, Math.PI * 2);
    frame.stroke();
  }

  frame.globalAlpha = 1;
  frame.fillStyle = '#070c15d6';
  frame.fillRect(0, HEIGHT - 95, WIDTH, 95);
  frame.fillStyle = '#f5f1df';
  frame.textAlign = 'center';
  frame.font = '500 28px system-ui, sans-serif';
  frame.fillText(phases[phase].caption, WIDTH / 2, HEIGHT - 44);
}
