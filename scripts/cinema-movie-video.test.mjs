import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const exec = promisify(execFile);
const chromeChannel = process.env.COAST_CHROME_CHANNEL || (process.env.CINEMA_MOVIE_VIDEO_BROWSER ? 'chrome' : 'chromium');

test('CinemaMovieVideo decodes a local H.264 MP4 with seek and a bounded presentation queue', {
  timeout: 90_000,
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cinema-movie-video-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = join(directory, 'fixture.mp4');
  try {
    await exec('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=96x54:rate=5',
      '-t', '2.0', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fixture,
    ]);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    t.skip('ffmpeg unavailable; the H.264 fixture is generated per run.');
    return;
  }
  const bytes = await readFile(fixture);
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, watch: null },
  });
  let browser;
  t.after(async () => {
    try { await browser?.close(); }
    finally { await server.close(); }
  });
  await server.listen();
  browser = await chromium.launch({ channel: chromeChannel });
  const page = await browser.newPage();
  const address = server.httpServer.address();
  await page.goto(`http://127.0.0.1:${address.port}/@vite/client`);
  const result = await page.evaluate(async encoded => {
    const { openCinemaMovieVideo } = await import('/src/coast/world/cinema/cinemaMovieVideo.ts');
    const file = new File([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], 'fixture.mp4', { type: 'video/mp4' });
    const movie = await openCinemaMovieVideo(file);
    const initialVersion = movie.frameVersion;
    const initial = movie.present(0);
    const repeated = movie.present(0.001);
    const beforeSeek = movie.frameVersion;
    const sequential = [];
    for (let i = 0; i < 10; i += 1) {
      const target = Math.min(movie.duration, i * 0.18);
      let ready = movie.present(target);
      for (let attempt = 0; !ready && attempt < 60; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
        ready = movie.present(target);
      }
      sequential.push({ ready, version: movie.frameVersion });
    }
    await movie.seek(movie.duration * 0.75);
    const seekPrepared = movie.present(movie.duration * 0.75);
    const seekVersion = movie.frameVersion;
    await movie.seek(movie.duration);
    const endPrepared = movie.present(movie.duration + 10);
    const endRepeated = movie.present(movie.duration + 10);
    const result = {
      duration: movie.duration,
      size: [movie.canvas.width, movie.canvas.height],
      initialVersion,
      initial,
      repeated,
      beforeSeek,
      sequential,
      seekPrepared,
      seekVersion,
      endPrepared,
      endRepeated,
      finalVersion: movie.frameVersion,
    };
    movie.dispose();
    return result;
  }, Buffer.from(bytes).toString('base64'));
  assert.ok(result.duration > 1.9 && result.duration < 2.1, result);
  assert.deepEqual(result.size, [96, 54]);
  assert.equal(result.initial, true);
  assert.equal(result.repeated, true);
  assert.equal(result.initialVersion, 0);
  assert.equal(result.beforeSeek, 1);
  assert.ok(result.sequential.every(item => item.ready), result);
  assert.ok(result.sequential.at(-1).version > result.beforeSeek, result);
  assert.equal(result.seekPrepared, true);
  assert.ok(result.seekVersion > result.beforeSeek, result);
  assert.equal(result.endPrepared, true);
  assert.equal(result.endRepeated, true);
  assert.equal(result.finalVersion, result.seekVersion + 1);
});
