import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { installSimulatedXR } from './simulated-xr.mjs';
import {
  aimFacilityView, installFacilityProbe, settleFacilityFrames, waitForFacility, walkFacilityTo,
} from './atrium-facility-views.mjs';

const viewport = { width: 960, height: 600 };
const screenshotDirectory = process.env.ATRIUM_SCREENSHOTS;
let server;
let browser;
let origin;
before(async () => {
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    channel: process.env.COAST_CHROME_CHANNEL || 'chromium', args: ['--enable-unsafe-swiftshader'],
  });
  if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
});
after(async () => { try { await browser?.close(); } finally { await server?.close(); } });

async function newPage(t, xr = false) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.type()); });
  await page.addInitScript(installFacilityProbe, { freezeTime: false });
  await page.addInitScript(installShadowProbe);
  if (xr) await page.addInitScript(installSimulatedXR);
  await page.goto(`${origin}/?world=atrium&place=concourse&time=night`, { waitUntil: 'commit' });
  await waitForFacility(page);
  return { page, errors };
}

function button(page, name) { return page.getByRole('button', { name, exact: true }); }

// G2 is the only depth-texture target at 512/1024 square. Observe real GL work,
// including its order relative to the existing non-square floor-reflection target.
function installShadowProbe() {
  const probe = { shadows: [], reflections: [], deleted: [], serial: 0 };
  window.atriumShadowProbe = probe;
  const gl = WebGL2RenderingContext.prototype;
  const textures = new WeakMap();
  const framebuffers = new WeakMap();
  const bindings = new Map();
  let textureUnit = 0;
  let activeFramebuffer = null;
  let pass = null;
  let nextId = 0;
  const isShadow = target => target?.depth && target.width === target.height
    && [512, 1024].includes(target.width);
  const activeTexture = gl.activeTexture;
  gl.activeTexture = function (unit) {
    textureUnit = unit;
    return activeTexture.call(this, unit);
  };
  const bindTexture = gl.bindTexture;
  gl.bindTexture = function (target, texture) {
    bindings.set(`${textureUnit}:${target}`, texture);
    return bindTexture.call(this, target, texture);
  };
  for (const name of ['texImage2D', 'texStorage2D']) {
    const allocate = gl[name];
    gl[name] = function (...args) {
      const [target, level, , width, height] = args;
      if ((name === 'texStorage2D' || level === 0) && Number.isFinite(width) && Number.isFinite(height)) {
        const texture = bindings.get(`${textureUnit}:${target}`);
        if (texture) textures.set(texture, { width, height });
      }
      return allocate.apply(this, args);
    };
  }
  const bindFramebuffer = gl.bindFramebuffer;
  gl.bindFramebuffer = function (target, framebuffer) {
    if (target !== this.READ_FRAMEBUFFER) {
      activeFramebuffer = framebuffer;
      pass = null;
      if (framebuffer && !framebuffers.has(framebuffer)) framebuffers.set(framebuffer, { id: ++nextId });
    }
    return bindFramebuffer.call(this, target, framebuffer);
  };
  const attach = gl.framebufferTexture2D;
  gl.framebufferTexture2D = function (target, attachment, textureTarget, texture, level) {
    const framebuffer = framebuffers.get(activeFramebuffer);
    const dimensions = textures.get(texture);
    if (framebuffer && dimensions) {
      Object.assign(framebuffer, dimensions);
      if (attachment === this.DEPTH_ATTACHMENT || attachment === this.DEPTH_STENCIL_ATTACHMENT) framebuffer.depth = true;
    }
    return attach.call(this, target, attachment, textureTarget, texture, level);
  };
  const deleteFramebuffer = gl.deleteFramebuffer;
  gl.deleteFramebuffer = function (framebuffer) {
    const target = framebuffers.get(framebuffer);
    if (isShadow(target)) probe.deleted.push(target.id);
    return deleteFramebuffer.call(this, framebuffer);
  };
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const draw = gl[name];
    gl[name] = function (...args) {
      probe.serial++;
      const target = framebuffers.get(activeFramebuffer);
      if (target && !pass) {
        const shadow = isShadow(target);
        const reflection = !shadow && target.width >= 320 && target.width <= 1040
          && target.width / target.height > 1.4 && target.width / target.height < 1.9;
        if (shadow || reflection) {
          pass = { id: target.id, width: target.width, height: target.height, serial: probe.serial, draws: 0, triangles: 0 };
          (shadow ? probe.shadows : probe.reflections).push(pass);
        }
      }
      if (pass) {
        const count = name.startsWith('drawElements') ? args[1] : args[2];
        const instances = name === 'drawElementsInstanced' ? args[4]
          : name === 'drawArraysInstanced' ? args[3] : 1;
        const triangles = args[0] === this.TRIANGLES ? count / 3
          : args[0] === this.TRIANGLE_STRIP ? Math.max(0, count - 2) : 0;
        pass.draws++;
        pass.triangles += triangles * instances;
      }
      return draw.apply(this, args);
    };
  }
}

async function shadowSnapshot(page) {
  return page.evaluate(() => ({ ...window.atriumShadowProbe,
    reflections: window.atriumShadowProbe.reflections.slice(-8) }));
}

async function settleStaticShadow(page) {
  for (let frame = 0; frame < 3; frame++) await settleFacilityFrames(page);
}

async function waitForShadow(page, size, previousCount = 0) {
  await page.waitForFunction(({ size, previousCount }) => {
    const shadows = window.atriumShadowProbe.shadows;
    return shadows.length > previousCount && shadows.at(-1).width === size && shadows.at(-1).draws > 0;
  }, { size, previousCount });
  await settleStaticShadow(page);
  return shadowSnapshot(page);
}

function shadowPrecedesReflection(snapshot, pass, message) {
  assert.ok(snapshot.reflections.some(reflection => reflection.serial > pass.serial), message);
}

async function verifyShadowLifecycle(page, t) {
  const initial = await waitForShadow(page, 512);
  assert.equal(initial.shadows.length, 1, 'initial static G2 map renders once');
  shadowPrecedesReflection(initial, initial.shadows[0], 'the initial floor capture renders after G2 shadow work');
  await settleStaticShadow(page);
  assert.equal((await shadowSnapshot(page)).shadows.length, 1, 'stationary ordinary frames reuse the map');

  await button(page, '高品質').click();
  const high = await waitForShadow(page, 1024, initial.shadows.length);
  assert.equal(high.shadows.length, initial.shadows.length + 1, 'quality change regenerates one map');
  assert.notEqual(high.shadows.at(-1).id, initial.shadows[0].id, 'quality change allocates a new render target');
  assert.ok(high.deleted.includes(initial.shadows[0].id), 'the previous shadow framebuffer is disposed');
  shadowPrecedesReflection(high, high.shadows.at(-1), 'the new high-quality map precedes the refreshed floor image');

  await button(page, '一括消灯').click();
  await button(page, '軽量').click();
  await settleStaticShadow(page);
  const off = await shadowSnapshot(page);
  assert.equal(off.shadows.length, high.shadows.length, 'quality changes while off defer shadow rendering');
  assert.ok(off.deleted.includes(high.shadows.at(-1).id), 'off-state quality change frees the old target');
  await button(page, '一括点灯').click();
  const relit = await waitForShadow(page, 512, off.shadows.length);
  assert.equal(relit.shadows.length, off.shadows.length + 1, 'off-state dirty work renders once on relight');
  shadowPrecedesReflection(relit, relit.shadows.at(-1), 'relight updates the map before the next floor image');
  t.diagnostic(`G2 GL passes: initial 512, quality 1024, off deferred, relight 512; ${relit.shadows.length} total`);
  const costs = [
    { stage: 'initial', ...initial.shadows[0] },
    { stage: 'high-quality', ...high.shadows.at(-1) },
    { stage: 'relight', ...relit.shadows.at(-1) },
  ];
  for (const cost of costs) t.diagnostic(
    `G2 ${cost.stage} ${cost.width}x${cost.height}: draws=${cost.draws}, submitted triangles=${cost.triangles}`);
  if (screenshotDirectory) await writeFile(join(screenshotDirectory, 'atrium-g2-shadow-costs.json'), JSON.stringify({
    viewport, time: 'night',
    counting: 'Submitted WebGL TRIANGLES=count/3 or TRIANGLE_STRIP=max(0,count-2), multiplied by instance count; not GPU time or unique geometry.',
    passes: costs,
  }, null, 2) + '\n');
}

async function capture(page, name) {
  return page.screenshot({
    path: screenshotDirectory ? join(screenshotDirectory, `${name}.png`) : undefined,
    style: '.coast-ui { visibility: hidden !important; }',
  });
}

async function surfaceLuminance(page, name, corners) {
  const { view, projection } = await page.evaluate(() => window.atriumFacilityProbe);
  const camera = new PerspectiveCamera(projection.verticalFovDeg, viewport.width / viewport.height, .1, 500);
  camera.position.fromArray(view.position);
  camera.lookAt(new Vector3(...view.position).add(new Vector3(...view.direction)));
  camera.updateMatrixWorld(true);
  const points = corners.map(point => new Vector3(...point).project(camera));
  const xs = points.map(point => (point.x + 1) / 2 * viewport.width);
  const ys = points.map(point => (1 - point.y) / 2 * viewport.height);
  const clip = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys) };
  assert.ok(clip.width > 3 && clip.height > 3 && clip.x >= 0 && clip.y >= 0
    && clip.x + clip.width <= viewport.width && clip.y + clip.height <= viewport.height,
  `${name}: the actual receiving surface is inside the rendered view`);
  const screenshot = await capture(page, name);
  return page.evaluate(async ({ encoded, clip }) => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const sample = document.createElement('canvas');
    sample.width = sample.height = 32;
    const context = sample.getContext('2d');
    context.drawImage(image, clip.x, clip.y, clip.width, clip.height, 0, 0, 32, 32);
    image.close();
    const { data } = context.getImageData(0, 0, 32, 32);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
    return sum / (data.length / 4);
  }, { encoded: screenshot.toString('base64'), clip });
}

test('static G2 shadow follows quality and lighting while new receiving walls darken behind glass',
  { timeout: 180_000 }, async t => {
    const { page, errors } = await newPage(t);
    await verifyShadowLifecycle(page, t);
    const samples = [
      { name: 'garden', position: [0, 0], yaw: Math.PI, corners: [
        [-3.65, 1.80, 13.27], [-2.80, 2.35, 13.27],
      ] },
      { name: 'west-shop', position: [-10.9, -4], yaw: Math.PI / 2, corners: [
        [-16.4, 2.55, -4.8], [-16.4, 2.95, -4.2],
      ] },
      { name: 'east-shop', position: [10.9, -4], yaw: -Math.PI / 2, corners: [
        [16.8, 2.55, -5.0], [16.8, 2.95, -4.4],
      ] },
    ];
    for (const sample of samples) {
      await walkFacilityTo(page, ...sample.position);
      await aimFacilityView(page, sample.yaw, .08);
      await button(page, '一括点灯').click();
      await settleFacilityFrames(page);
      const lit = await surfaceLuminance(page, `facility-${sample.name}-on`, sample.corners);
      await button(page, '一括消灯').click();
      await settleFacilityFrames(page);
      const dark = await surfaceLuminance(page, `facility-${sample.name}-off`, sample.corners);
      assert.ok(lit - dark > 3, `${sample.name}: receiving wall luminance ${dark.toFixed(2)} → ${lit.toFixed(2)}`);
      t.diagnostic(`${sample.name} receiving surface: off ${dark.toFixed(2)}, on ${lit.toFixed(2)}`);
    }
    assert.deepEqual(errors, []);
  });

test('ordinary walking and simulated XR stop in front of the closed garden glass at the same boundary',
  { timeout: 120_000 }, async t => {
    const { page, errors } = await newPage(t, true);
    const initialShadow = await waitForShadow(page, 512);
    await walkFacilityTo(page, -2.7, 2.2);
    await aimFacilityView(page, Math.PI, 0);
    await button(page, 'マウス操作を開始').click();
    await page.waitForFunction(() => Boolean(document.pointerLockElement));
    await page.keyboard.down('w');
    try {
      await page.waitForFunction(() => window.atriumFacilityProbe.view.position[2] > 2.63);
      await page.keyboard.press('Space');
      await settleFacilityFrames(page);
    } finally {
      await page.keyboard.up('w');
      await page.evaluate(() => document.exitPointerLock());
    }
    const desktop = await page.evaluate(() => window.atriumFacilityProbe.view.position);
    assert.ok(desktop[2] <= 2.66, 'walking and jumping cannot enter the garden or pass its visible glass');
    await page.waitForFunction(() => Math.abs(window.atriumFacilityProbe.view.position[1] - 1.65) < .03);
    assert.equal((await shadowSnapshot(page)).shadows.length, initialShadow.shadows.length,
      'ordinary movement and floor reflections reuse the same static shadow map');
    await capture(page, 'facility-garden-desktop-boundary');
    await page.evaluate(() => { window.xrFixture.head.yaw = Math.PI; });
    await button(page, 'VRを開始').click();
    await page.waitForFunction(() => window.xrFixture.eyePoses[0] && window.xrFixture.eyePoses[320]);
    await page.evaluate(() => window.xrFixture.mutate({ side: 'left', axes: [0, -1], frames: 20 }));
    await page.evaluate(() => window.xrFixture.mutate({ side: 'left', axes: [0, 0] }));
    const xr = await page.evaluate(() => ({ left: window.xrFixture.eyePoses[0],
      right: window.xrFixture.eyePoses[320], draws: window.xrFixture.xrDraws }));
    for (const eye of [xr.left, xr.right]) {
      assert.ok(eye.z > 2.60 && eye.z <= 2.67, 'each eye remains on the public side of the fixed glass');
      assert.ok(Math.abs(eye.y - 1.65) < .03, 'XR remains on the ground support at the closed edge');
    }
    assert.ok(Math.abs(Math.hypot(xr.left.x - xr.right.x, xr.left.z - xr.right.z) - .064) < .002);
    assert.ok(xr.draws > 0, 'both simulated views render at the close transparent boundary');
    const xrShadow = await shadowSnapshot(page);
    assert.equal(xrShadow.shadows.length, initialShadow.shadows.length,
      'XR left and right eyes reuse the desktop shadow map without new shadow draws');
    await capture(page, 'facility-garden-simulated-xr-boundary');
    await button(page, 'VRを終了').click();
    await page.waitForFunction(() => window.xrFixture.ends === 1);
    await settleStaticShadow(page);
    assert.equal((await shadowSnapshot(page)).shadows.length, initialShadow.shadows.length,
      'the returning desktop floor capture also reuses the same map');
    assert.deepEqual(errors, []);
  });
