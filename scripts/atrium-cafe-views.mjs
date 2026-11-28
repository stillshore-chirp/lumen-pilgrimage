import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { installFacilityProbe, settleFacilityFrames } from './atrium-facility-views.mjs';

const output = process.env.ATRIUM_OUTPUT ? resolve(process.env.ATRIUM_OUTPUT)
  : await mkdtemp(join(tmpdir(), 'lumen-atrium-cafe-'));
await mkdir(output, { recursive: true });
let server;
let browser;
let page;
let context;
const frames = [];
const route = [];
const pageErrors = [];
const httpFailures = [];
const pointerInputs = [];
const frameTimings = [];
let stage = 'setup';
try {
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.COAST_CHROME_CHANNEL || 'chromium', headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    recordVideo: { dir: join(output, 'video'), size: { width: 1280, height: 800 } } });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.name));
  page.on('response', response => {
    if (response.status() >= 400) httpFailures.push({ status: response.status(), path: new URL(response.url()).pathname });
  });
  await page.addInitScript(installFacilityProbe);
  await page.addInitScript(() => {
    window.cafeRouteSamples = [];
    window.cafeMouseInputs = [];
    window.cafeKeyInputs = [];
    document.addEventListener('mousemove', event => {
      if (document.pointerLockElement) window.cafeMouseInputs.push({ trusted: event.isTrusted,
        movement: [event.movementX, event.movementY], timeMs: performance.now() });
    }, true);
    for (const type of ['keydown', 'keyup']) document.addEventListener(type, event => {
      if (event.code === 'KeyW') window.cafeKeyInputs.push({ type, trusted: event.isTrusted, timeMs: performance.now() });
    }, true);
    setInterval(() => {
      const view = window.atriumFacilityProbe?.view;
      if (view && window.cafeRouteSamples.length < 6000) window.cafeRouteSamples.push({
        timeMs: performance.now(), position: [...view.position], direction: [...view.direction],
      });
    }, 100);
  });
  const startup = Date.now();
  const remaining = () => Math.max(1, 135000 - (Date.now() - startup));
  stage = 'navigation-commit';
  await page.goto(`${origin}/?world=atrium&place=stair-foot&time=day`, { waitUntil: 'commit', timeout: 20000 });
  stage = 'dom-heading-attached';
  await page.locator('h1').waitFor({ state: 'attached', timeout: remaining() });
  stage = 'accessible-heading-visible';
  await page.getByRole('heading', { name: '商業アトリウム', exact: true }).waitFor({ state: 'visible', timeout: remaining() });
  stage = 'rendered-camera-probe';
  await page.waitForFunction(() => Boolean(window.atriumFacilityProbe?.view), null, { timeout: remaining() });
  await page.bringToFront();
  let pointer = { x: 0, y: 0 };
  const lock = async () => {
    if (await page.evaluate(() => Boolean(document.pointerLockElement))) return;
    const box = await page.getByRole('button', { name: 'マウス操作を開始', exact: true }).boundingBox();
    assert.ok(box, 'the ordinary pointer-lock button is visible');
    pointer = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.click(pointer.x, pointer.y);
    await page.waitForFunction(() => Boolean(document.pointerLockElement), null, { timeout: 5000 });
  };
  const unlock = async () => {
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => !document.pointerLockElement, null, { timeout: 5000 });
  };
  const aim = async (yaw, pitch = 0) => {
    stage = 'trusted-pointer-aim';
    await lock();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const view = await page.evaluate(() => window.atriumFacilityProbe.view);
        const [x, y, z] = view.direction;
        const yawDelta = Math.atan2(Math.sin(yaw - Math.atan2(-x, -z)), Math.cos(yaw - Math.atan2(-x, -z)));
        const pitchDelta = pitch - Math.atan2(y, Math.hypot(x, z));
        if (Math.abs(yawDelta) < .004 && Math.abs(pitchDelta) < .004) return;
        const move = { x: -yawDelta / .0022, y: -pitchDelta / .0022 };
        pointer = { x: pointer.x + move.x, y: pointer.y + move.y };
        await page.mouse.move(pointer.x, pointer.y, { steps: Math.max(1, Math.ceil(Math.max(Math.abs(move.x), Math.abs(move.y)) / 200)) });
        await settleFacilityFrames(page);
        pointerInputs.push({ requestedYaw: yaw, requestedPitch: pitch, attempt, mouseDelta: move });
      }
      const [x, y, z] = await page.evaluate(() => window.atriumFacilityProbe.view.direction);
      const yawError = Math.atan2(Math.sin(yaw - Math.atan2(-x, -z)), Math.cos(yaw - Math.atan2(-x, -z)));
      const pitchError = pitch - Math.atan2(y, Math.hypot(x, z));
      assert.ok(Math.abs(yawError) < .012 && Math.abs(pitchError) < .012,
        'trusted mouse movement reaches the requested view on all direction axes');
    } finally { await unlock(); }
  };
  const capture = async (name, yaw, pitch = 0) => {
    await aim(yaw, pitch);
    stage = `capture-${name}`;
    await settleFacilityFrames(page);
    await page.screenshot({ path: join(output, `${name}.png`), style: '.coast-ui { visibility:hidden!important; }' });
    frames.push({ name, ...(await page.evaluate(() => {
      const { view, projection, draws } = window.atriumFacilityProbe;
      const canvas = document.querySelector('canvas.coast-view');
      const gl = canvas.getContext('webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return { view, projection, draws, raster: [canvas.width, canvas.height], dpr: devicePixelRatio,
        renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    })) });
  };
  const sampleTiming = async name => {
    stage = `stationary-frame-timing-${name}`;
    const intervals = await page.evaluate(() => new Promise(resolveFrames => {
      const rows = []; let previous;
      const started = performance.now();
      const sample = now => {
        if (previous !== undefined) rows.push(now - previous);
        previous = now;
        if (now - started >= 2500) resolveFrames(rows);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    const sorted = [...intervals].sort((a, b) => a - b);
    frameTimings.push({ name, method: 'stationary live-scene animation-frame intervals; no screenshot during sample; not a GPU timer or HMD measurement',
      frames: sorted.length, meanMs: intervals.reduce((sum, n) => sum + n, 0) / intervals.length,
      p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1), intervals });
  };
  const walk = async (x, z) => {
    const before = await page.evaluate(() => [...window.atriumFacilityProbe.view.position]);
    const entry = { requested: [x, z], before, status: 'pending', input: 'trusted pointer-lock mouse aim + keyboard W' };
    route.push(entry);
    stage = `walk-${route.length}-aim`;
    await aim(Math.atan2(before[0] - x, before[2] - z));
    await lock();
    stage = `walk-${route.length}-forward`;
    await page.keyboard.down('w');
    try {
      await page.waitForFunction(({ x, z }) => {
        const p = window.atriumFacilityProbe.view.position;
        return Math.hypot(p[0] - x, p[2] - z) < .17;
      }, { x, z }, { timeout: 30000 });
    } finally { await page.keyboard.up('w'); await unlock(); }
    const after = await page.evaluate(() => [...window.atriumFacilityProbe.view.position]);
    Object.assign(entry, { after, status: 'reached' });
    await writeFile(join(output, 'cafe-walkthrough-checkpoint.json'), JSON.stringify({ stage, route, frames }, null, 2));
  };
  await walk(10.9, -31.7);
  await walk(10.9, -37.6);
  await capture('01-frontage', -Math.PI / 2, .03);
  await walk(12.95, -37.6);
  await capture('02-entry', -Math.PI / 2, .03);
  await sampleTiming('entry-forward');
  await walk(12.95, -39.85);
  await walk(16.0, -39.85);
  await walk(16.0, -38.15);
  await capture('03-order', Math.PI, -.05);
  await walk(16.0, -39.85);
  await walk(22.4, -39.85);
  for (const [label, yaw] of [['forward', -Math.PI / 2], ['right', 0], ['back', Math.PI / 2], ['left', Math.PI]]) {
    await capture(`04-middle-${label}`, yaw, .02);
    if (label === 'back') await sampleTiming('middle-turnback');
  }
  await walk(29.1, -39.85);
  for (const [label, yaw, pitch] of [['forward', -Math.PI / 2, 0], ['right', 0, 0], ['back', Math.PI / 2, 0],
    ['left', Math.PI, 0], ['up', Math.PI / 2, .85], ['down', Math.PI / 2, -.85]]) {
    await capture(`05-rear-${label}`, yaw, pitch);
    if (label === 'back') await sampleTiming('rear-turnback');
  }
  const standingY = await page.evaluate(() => window.atriumFacilityProbe.view.position[1]);
  await lock();
  await page.keyboard.press('c');
  await page.waitForFunction(y => window.atriumFacilityProbe.view.position[1] < y - .3, standingY);
  await unlock();
  await capture('06-rear-crouched', Math.PI / 2, -.12);
  await lock();
  await page.keyboard.press('c');
  await page.waitForFunction(y => Math.abs(window.atriumFacilityProbe.view.position[1] - y) < .03, standingY);
  await unlock();
  await page.getByRole('button', { name: '一括消灯', exact: true }).click();
  await capture('07-rear-lights-off', Math.PI / 2, .02);
  await page.getByRole('button', { name: '一括点灯', exact: true }).click();
  await page.getByRole('button', { name: '夜', exact: true }).click();
  await capture('07b-rear-night', Math.PI / 2, .02);
  await capture('07c-rear-night-end', -Math.PI / 2, .02);
  await page.getByRole('button', { name: '昼', exact: true }).click();
  await walk(24.2, -39.85);
  await walk(24.2, -37.9);
  await capture('08-left-seating', Math.PI, -.08);
  await walk(24.2, -39.85);
  await walk(12.95, -39.85);
  await walk(12.95, -37.6);
  await walk(10.9, -37.6);
  await capture('09-return-outside', -Math.PI / 2, .02);
  await walk(9.5, -37.6);
  await capture('09b-frontage-head', -Math.PI / 2, .75);
  const supplemental = [{ input: 'existing fast travel UI', destination: 'upper-gallery',
    timeMs: await page.evaluate(() => performance.now()) }];
  await page.getByRole('button', { name: 'ファストトラベル', exact: true }).click();
  await page.getByRole('button', { name: '上階の回廊', exact: false }).click();
  await walk(-9.5, -36);
  await capture('10-upper-envelope', -Math.PI / 2, -.25);
  const samples = await page.evaluate(() => window.cafeRouteSamples);
  const mouseEvents = await page.evaluate(() => window.cafeMouseInputs);
  const keyEvents = await page.evaluate(() => window.cafeKeyInputs);
  assert.ok(mouseEvents.length > 0 && mouseEvents.every(event => event.trusted), 'look input uses browser-trusted mouse events');
  assert.ok(keyEvents.length > 0 && keyEvents.every(event => event.trusted), 'walking uses browser-trusted keyboard events');
  assert.deepEqual(pageErrors, []);
  await writeFile(join(output, 'cafe-walkthrough.json'), JSON.stringify({
    snapshot: 'working-tree model; pair with the build source/dist manifest', viewport: [1280, 800], quality: 'product default',
    browser: await browser.version(), time: 'day', input: 'trusted keyboard and pointer-lock mouse; actual browser exitPointerLock API releases lock',
    route, supplemental, samples, frames, pageErrors, httpFailures, pointerInputs, mouseEvents, keyEvents, frameTimings,
    unperformed: ['independent output quality verdict at capture time', 'physical HMD', 'human audio judgement'],
  }, null, 2));
  console.log(`cafe walkthrough: ${route.length} normal walking legs, ${frames.length} views, ${samples.length} position samples, no page errors`);
} catch (error) {
  const samples = page ? await page.evaluate(() => window.cafeRouteSamples ?? []).catch(() => []) : [];
  if (page) await page.screenshot({ path: join(output, 'partial-failure.png') }).catch(() => {});
  await writeFile(join(output, 'cafe-walkthrough-partial.json'), JSON.stringify({
    result: 'incomplete; inspect last position and failed-frame artifact', stage, errorName: error?.name ?? 'Unknown',
    route, samples, frames, pageErrors, httpFailures, pointerInputs, frameTimings,
  }, null, 2));
  console.error('cafe walkthrough incomplete; partial evidence preserved');
  process.exitCode = 1;
} finally {
  try { await page?.close(); await context?.close(); await browser?.close(); } finally { await server?.close(); }
}
