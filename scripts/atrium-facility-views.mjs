import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

export const facilityViewport = { width: 2944, height: 1648 };
export const facilityComparisonViews = [
  ['sofa-center', 'lounge', Math.PI, [-2.7, 1.20, -29.7], .035],
  ['sofa-left', 'lounge', Math.PI + .65, [-2.7, 1.20, -29.7], .035],
  ['sofa-right', 'lounge', Math.PI - .65, [-2.7, 1.20, -29.7], .035],
  ['reference', 'concourse', .038, [0, 1.65, 0], .122],
  ['upper-facing-front', 'upper-gallery', Math.PI, [-9.22, 10.8, -44.1], -.20],
];

// Observe the rendered camera and draw calls, without accessing application internals.
export function installFacilityProbe({ freezeTime = false } = {}) {
  const probe = { view: null, projection: null, draws: null, frame: 0 };
  window.atriumFacilityProbe = probe;
  localStorage.setItem('lumen-pilgrimage:fov', '42');
  const requestFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => requestFrame(time => {
    probe.activeDraws = { calls: 0, triangles: 0, onScreenCalls: 0, onScreenTriangles: 0 };
    callback(freezeTime ? 1000 : time);
    if (probe.activeDraws.calls) {
      probe.draws = { ...probe.activeDraws };
      probe.frame++;
    }
  });
  const gl = WebGL2RenderingContext.prototype;
  const locate = gl.getUniformLocation;
  const matrixWrite = gl.uniformMatrix4fv;
  const bindFramebuffer = gl.bindFramebuffer;
  const viewMatrices = new WeakSet();
  const projections = new WeakSet();
  let onScreen = true;
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const draw = gl[name];
    gl[name] = function (...args) {
      const count = name.startsWith('drawElements') ? args[1] : args[2];
      const instances = name === 'drawElementsInstanced' ? args[4]
        : name === 'drawArraysInstanced' ? args[3] : 1;
      const triangles = args[0] === this.TRIANGLES ? count / 3 * instances
        : args[0] === this.TRIANGLE_STRIP ? Math.max(0, count - 2) * instances : 0;
      const metrics = probe.activeDraws;
      if (metrics) {
        metrics.calls++; metrics.triangles += triangles;
        if (onScreen) { metrics.onScreenCalls++; metrics.onScreenTriangles += triangles; }
      }
      return draw.apply(this, args);
    };
  }
  gl.getUniformLocation = function (program, name) {
    const location = locate.call(this, program, name);
    if (location && name === 'viewMatrix') viewMatrices.add(location);
    if (location && name === 'projectionMatrix') projections.add(location);
    return location;
  };
  gl.bindFramebuffer = function (target, framebuffer) {
    if (target !== this.READ_FRAMEBUFFER) onScreen = framebuffer === null;
    return bindFramebuffer.call(this, target, framebuffer);
  };
  gl.uniformMatrix4fv = function (location, transpose, matrix, ...rest) {
    if (onScreen && projections.has(location)) probe.projection = {
      verticalFovDeg: 2 * Math.atan(1 / matrix[5]) * 180 / Math.PI,
      aspect: matrix[5] / matrix[0],
    };
    if (onScreen && viewMatrices.has(location)) probe.view = {
      position: [0, 1, 2].map(i => -(matrix[i * 4] * matrix[12]
        + matrix[i * 4 + 1] * matrix[13] + matrix[i * 4 + 2] * matrix[14])),
      direction: [-matrix[2], -matrix[6], -matrix[10]],
    };
    return matrixWrite.call(this, location, transpose, matrix, ...rest);
  };
}

export async function waitForFacility(page) {
  await page.getByRole('heading', { name: '商業アトリウム', exact: true }).waitFor();
  await page.waitForFunction(() => Boolean(window.atriumFacilityProbe?.view));
}

export async function settleFacilityFrames(page) {
  await page.evaluate(() => new Promise(resolveFrame =>
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
}

export async function aimFacilityView(page, yaw, pitch = 0) {
  await page.getByRole('button', { name: 'マウス操作を開始', exact: true }).click();
  await page.waitForFunction(() => document.pointerLockElement?.classList.contains('coast-view'));
  try {
    await page.evaluate(({ yaw, pitch }) => {
      const [x, y, z] = window.atriumFacilityProbe.view.direction;
      const yawDelta = yaw - Math.atan2(-x, -z);
      const pitchDelta = pitch - Math.atan2(y, Math.hypot(x, z));
      document.pointerLockElement.dispatchEvent(new MouseEvent('mousemove', {
        movementX: -yawDelta / .0022, movementY: -pitchDelta / .0022,
      }));
    }, { yaw, pitch });
    await settleFacilityFrames(page);
  } finally {
    await page.evaluate(() => document.exitPointerLock());
  }
  const view = await page.evaluate(() => window.atriumFacilityProbe.view);
  assert.ok(Math.abs(view.direction[0] + Math.sin(yaw) * Math.cos(pitch)) < .003
    && Math.abs(view.direction[1] - Math.sin(pitch)) < .003
    && Math.abs(view.direction[2] + Math.cos(yaw) * Math.cos(pitch)) < .003,
  'the rendered direction matches the requested ordinary mouse input');
}

export async function walkFacilityTo(page, x, z) {
  const start = await page.evaluate(() => window.atriumFacilityProbe.view.position);
  if (Math.hypot(x - start[0], z - start[2]) < .15) return;
  await aimFacilityView(page, Math.atan2(start[0] - x, start[2] - z));
  await page.getByRole('button', { name: 'マウス操作を開始', exact: true }).click();
  await page.waitForFunction(() => document.pointerLockElement?.classList.contains('coast-view'));
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(({ x, z }) => {
      const position = window.atriumFacilityProbe.view.position;
      return Math.hypot(position[0] - x, position[2] - z) < .16;
    }, { x, z }, { timeout: 180_000 });
  } finally {
    await page.keyboard.up('w');
    await page.evaluate(() => document.exitPointerLock());
  }
  await settleFacilityFrames(page);
  const end = await page.evaluate(() => window.atriumFacilityProbe.view.position);
  assert.ok(Math.hypot(end[0] - x, end[2] - z) < .30, 'the audit view was reached by walking');
}

async function captureViews() {
  const destination = process.env.ATRIUM_OUTPUT;
  assert.ok(destination, 'ATRIUM_OUTPUT must name the output directory');
  const mode = process.env.ATRIUM_CAPTURE_MODE || 'comparison';
  assert.ok(['comparison', 'audit'].includes(mode), 'ATRIUM_CAPTURE_MODE must be comparison or audit');
  const time = process.env.ATRIUM_TIME || 'day';
  const quality = process.env.ATRIUM_QUALITY || 'high';
  const lighting = process.env.ATRIUM_LIGHTING || 'default';
  assert.ok(['day', 'night'].includes(time));
  assert.ok(['high', 'default'].includes(quality));
  assert.ok(['default', 'on', 'off'].includes(lighting));
  const out = resolve(destination);
  await mkdir(out, { recursive: true });
  const server = process.env.ATRIUM_ORIGIN ? null
    : await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  const origin = process.env.ATRIUM_ORIGIN || `http://127.0.0.1:${server.httpServer.address().port}`;
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'capture origin must be local');
  let browser;
  const rows = [];
  const errors = [];
  const started = Date.now();
  try {
    browser = await chromium.launch({
      channel: process.env.COAST_CHROME_CHANNEL || 'chromium', args: ['--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: facilityViewport, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.name));
    await page.addInitScript(installFacilityProbe, { freezeTime: mode === 'comparison' });
    const open = async place => {
      await page.goto(`${origin}/?world=atrium&time=${time}&place=${place}`, { waitUntil: 'networkidle' });
      await waitForFacility(page);
      if (quality === 'high') await page.getByRole('button', { name: '高品質', exact: true }).click();
      if (lighting !== 'default') await page.getByRole('button', {
        name: lighting === 'on' ? '一括点灯' : '一括消灯', exact: true,
      }).click();
      await settleFacilityFrames(page);
    };
    const capture = async (name, route) => {
      const image = `atrium-${name}.png`;
      await page.screenshot({ path: join(out, image), style: '.coast-ui { visibility: hidden !important; }' });
      const result = await page.evaluate(() => {
        const { view, projection, draws } = window.atriumFacilityProbe;
        const canvas = document.querySelector('canvas.coast-view');
        return { ...view, projection, draws, raster: {
          width: canvas.width, height: canvas.height, dpr: devicePixelRatio,
        } };
      });
      assert.equal(result.raster.dpr, 1);
      assert.ok(Math.abs(result.projection.verticalFovDeg - 42) < .01);
      assert.ok(result.draws?.calls > 0);
      if (quality === 'high') assert.deepEqual([result.raster.width, result.raster.height],
        [facilityViewport.width, facilityViewport.height]);
      rows.push({ image, ...result, route });
    };
    if (mode === 'comparison') {
      for (const [name, place, yaw, position, pitch] of facilityComparisonViews) {
        await open(place);
        const actual = await page.evaluate(() => window.atriumFacilityProbe.view.position);
        assert.ok(actual.every((value, i) => Math.abs(value - position[i]) < .05), `${name}: source camera position`);
        await aimFacilityView(page, yaw, pitch);
        await capture(name, { start: place, operation: 'mouse look', frozenAnimationTimeMs: 1000 });
      }
    } else {
      await open('concourse');
      await walkFacilityTo(page, -2.7, 2.2);
      await page.keyboard.press('c');
      await settleFacilityFrames(page);
      await aimFacilityView(page, Math.PI, .02);
      await capture('garden-near-low', {
        start: 'concourse', waypoints: [[-2.7, 2.2]], posture: 'crouched', eyeHeight: 1.15,
      });
      await page.keyboard.press('c');
      await walkFacilityTo(page, 2.7, 2.2);
      await aimFacilityView(page, Math.PI, -.03);
      await capture('garden-near-standing', { start: 'garden-near-low', waypoints: [[2.7, 2.2]], posture: 'standing' });
      for (const side of [-1, 1]) {
        await walkFacilityTo(page, side * 10.9, -4);
        await aimFacilityView(page, -side * Math.PI / 2 + side * .25, -.07);
        await capture(side < 0 ? 'west-shop-oblique' : 'east-shop-oblique', {
          operation: 'normal walking and mouse look', waypoint: [side * 10.9, -4],
        });
      }
      await open('upper-gallery');
      await walkFacilityTo(page, -9.22, 1.35);
      await aimFacilityView(page, Math.PI, -.18);
      await capture('upper-front-end', { start: 'upper-gallery', waypoints: [[-9.22, 1.35]] });
      await aimFacilityView(page, 0, -.18);
      await capture('upper-front-turnback', { operation: 'mouse turnback at the same supported end' });
    }
    assert.deepEqual(errors, []);
    await writeFile(join(out, 'atrium-views.json'), JSON.stringify({
      viewport: facilityViewport, time, quality, lighting, mode,
      elapsed: mode === 'comparison' ? 0 : (Date.now() - started) / 1000,
      input: 'normal keyboard/pointer-lock mouse; no application teleport or scene mutation',
      frames: rows,
    }, null, 2) + '\n');
    console.log(`Saved ${rows.length} atrium ${mode} views and atrium-views.json`);
  } finally {
    try { await browser?.close(); } finally { await server?.close(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await captureViews();
