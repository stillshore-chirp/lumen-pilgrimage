import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { RESIDENCE_ROOMS } from '../src/coast/world/residence/residencePlan.ts';

const screenshots = process.env.RESIDENCE_SCREENSHOTS;
const viewport = screenshots ? { width: 1280, height: 800 } : { width: 960, height: 600 };
const timeout = 90_000;
const residenceHeading = '都心の70階住戸';
let server;
let browser;
let origin;

before(async () => {
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    channel: process.env.COAST_CHROME_CHANNEL || 'chromium',
    args: ['--enable-unsafe-swiftshader'],
  });
  if (screenshots) await mkdir(screenshots, { recursive: true });
});

after(async () => {
  try {
    await browser?.close();
  } finally {
    await server?.close();
  }
});

function observeResidence() {
  const probe = { camera: null, contexts: 0, analyser: null, trafficFilters: new Set(), roomSends: [], loopStarts: 0 };
  window.residenceProbe = probe;
  const gl = WebGL2RenderingContext.prototype;
  const cameraUniforms = new WeakSet();
  const getUniformLocation = gl.getUniformLocation;
  const uniform3f = gl.uniform3f;
  gl.getUniformLocation = function (program, name) {
    const location = getUniformLocation.call(this, program, name);
    if (location && name === 'cameraPosition') cameraUniforms.add(location);
    return location;
  };
  gl.uniform3f = function (location, x, y, z) {
    if (cameraUniforms.has(location)) probe.camera = { x, y, z };
    return uniform3f.call(this, location, x, y, z);
  };

  const NativeAudioContext = window.AudioContext;
  const connect = AudioNode.prototype.connect;
  window.AudioContext = class extends NativeAudioContext {
    constructor(...args) {
      super(...args);
      probe.contexts++;
      probe.analyser = this.createAnalyser();
    }
  };
  AudioNode.prototype.connect = function (destination, ...args) {
    if (destination === this.context.destination && probe.analyser?.context === this.context) {
      connect.call(this, probe.analyser);
    }
    if (this instanceof AudioBufferSourceNode && this.loop && destination instanceof BiquadFilterNode) {
      probe.trafficFilters.add(destination);
    }
    if (this instanceof GainNode && destination instanceof ConvolverNode) probe.roomSends.push(this);
    return connect.call(this, destination, ...args);
  };
  probe.audioPeak = () => {
    const signal = new Float32Array(probe.analyser.fftSize);
    probe.analyser.getFloatTimeDomainData(signal);
    return Math.max(...signal.map(Math.abs));
  };
  probe.lowpassCutoffs = () => [...probe.trafficFilters].filter(filter => filter.type === 'lowpass')
    .map(filter => filter.frequency.value);
}

async function createPage(t) {
  const page = await browser.newPage({ viewport });
  t.after(() => page.close());
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(observeResidence);
  return { page, errors };
}

async function openResidence(t, place = '') {
  const { page, errors } = await createPage(t);
  const address = new URL('/?world=residence', origin);
  if (place) address.searchParams.set('place', place);
  await page.goto(address.href, { waitUntil: 'commit' });
  await page.getByRole('heading', { name: residenceHeading, exact: true }).waitFor();
  await page.waitForFunction(() => document.hasFocus() && window.residenceProbe.camera);
  return { page, errors };
}

function button(page, name) {
  return page.getByRole('button', { name, exact: true });
}

function residenceDialog(page, name) {
  return page.getByRole('dialog', { name, exact: true });
}

async function selectResidenceDevice(page, category, name) {
  const directory = residenceDialog(page, '住戸の遠隔操作');
  await button(directory, category).click();
  await button(directory, name).click();
  return residenceDialog(page, name);
}

async function openResidenceDevice(page, category, name) {
  await button(page, 'メニュー').click();
  await button(residenceDialog(page, 'メニュー'), '住戸の遠隔操作').click();
  return selectResidenceDevice(page, category, name);
}

async function travel(page, label, world, place, time) {
  await button(page, 'ファストトラベル').click();
  const dialog = page.getByRole('dialog', { name: 'ファストトラベル' });
  await dialog.getByRole('button', { name: label }).click();
  await page.waitForURL(address => address.searchParams.get('world') === world
    && address.searchParams.get('place') === place && address.searchParams.get('time') === time,
  { waitUntil: 'commit' });
  await dialog.waitFor({ state: 'hidden' });
}

async function hold(page, key, whileHeld) {
  await page.keyboard.down(key);
  try {
    await whileHeld();
  } finally {
    await page.keyboard.up(key);
  }
}

function camera(page) {
  return page.evaluate(() => window.residenceProbe.camera);
}

async function moreMovementFrames(page) {
  await page.evaluate(async () => {
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    let previous = await nextFrame();
    let elapsed = 0;
    // The scene caps per-frame integration on slow renderers.
    while (elapsed < 420) {
      const now = await nextFrame();
      elapsed += Math.min(now - previous, 50);
      previous = now;
    }
  });
}

async function capture(page, name, style) {
  if (screenshots) await page.screenshot({ path: join(screenshots, `${name}.png`), style });
}

async function exposeResidenceScene(page) {
  await page.route('**/assets/CoastApp-*.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const prepare = 'this.world.prepareRender?.(';
    assert.ok(source.includes(prepare), 'The residence test hook requires exploration render preparation');
    const hook = 'window.residenceProbe.scene=this.world.scene,'
      + 'window.residenceProbe.relocate??=(pose=>this.controls.relocate(pose)),';
    await route.fulfill({ response, body: source.replace(prepare, hook + prepare) });
  });
}

async function brightness(canvas, area = [0, 0, 1, 1]) {
  return canvas.evaluate((source, [x, y, width, height]) => new Promise(resolve => requestAnimationFrame(() => {
    const sample = document.createElement('canvas');
    sample.width = 32;
    sample.height = 20;
    const context = sample.getContext('2d');
    context.drawImage(source, x * source.width, y * source.height, width * source.width,
      height * source.height, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    const colors = new Set();
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      total += (r + g + b) / 3;
      colors.add((r << 16) | (g << 8) | b);
    }
    resolve({ mean: total / (pixels.length / 4), colors: colors.size });
  })), area);
}

test('the residence accepts startup walking and preserves its views across time, quality and travel', { timeout }, async t => {
  const { page, errors } = await openResidence(t);
  const canvas = page.locator('canvas.coast-view');
  assert.equal(await button(page, '夜').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement === document.body
    && document.pointerLockElement === null && window.residenceProbe.contexts === 0), true);

  const spawn = await camera(page);
  assert.ok(Math.hypot(spawn.x - 21.89, spawn.z + 1.12) < 0.22);
  await hold(page, 'd', () => page.waitForFunction(() => {
    const { x, y, z } = window.residenceProbe.camera;
    return x < 18.3 && Math.abs(z + 1.12) < 0.22 && Math.abs(y - 1.65) < 0.12;
  }));

  for (const key of ['w', 'a', 's']) {
    const start = await camera(page);
    await hold(page, key, () => page.waitForFunction(({ x, z }) => {
      const current = window.residenceProbe.camera;
      return Math.hypot(current.x - x, current.z - z) > 0.15;
    }, start, { timeout: 5000 }));
  }

  await travel(page, 'リビング南窓', 'residence', 'living-window', 'night');
  await page.waitForFunction(() => {
    const { x, z } = window.residenceProbe.camera;
    return Math.hypot(x - 21.89, z + 1.12) < 0.22;
  });
  await hold(page, 'w', async () => {
    await page.waitForFunction(() => window.residenceProbe.camera.z > -0.47);
    await moreMovementFrames(page);
  });
  const standing = await camera(page);
  assert.ok(standing.z < -0.35 && Math.abs(standing.y - 1.65) < 0.12,
    `South facade should stop walking at floor height: ${JSON.stringify(standing)}`);
  const night = await brightness(canvas);
  assert.ok(night.colors > 40, `Night canvas had ${night.colors} sampled colors`);
  await capture(page, 'residence-south-window-night');

  await button(page, '昼').click();
  await page.waitForURL(address => address.searchParams.get('time') === 'day');
  assert.equal(await button(page, '昼').getAttribute('aria-pressed'), 'true');
  const day = await brightness(canvas);
  assert.ok(day.colors > 40 && day.mean > night.mean + 10,
    `Day frame should be brighter at the same window (day=${day.mean}, night=${night.mean})`);
  await capture(page, 'residence-south-window-day');

  await button(page, '高品質').click();
  const renderedWidth = width => canvas.evaluate((element, expected) => element.width === expected, width);
  assert.equal(await renderedWidth(viewport.width), true);
  assert.equal(await button(page, '高品質').getAttribute('aria-pressed'), 'true');
  assert.ok((await brightness(canvas)).colors > 40);
  assert.deepEqual(await camera(page), standing);
  await capture(page, 'residence-south-window-day-high');
  await button(page, '軽量').click();
  assert.equal(await renderedWidth(Math.floor(viewport.width * 0.8)), true);

  const monitor = button(page, '仮想モニター');
  assert.equal(await monitor.getAttribute('aria-expanded'), 'false');
  await monitor.click();
  await button(page, 'モニターを表示').waitFor();
  await monitor.click();

  await travel(page, '中央展望デッキ', 'overlook', 'main-deck', 'day');
  await page.getByRole('heading', { name: '丘陵展望台', exact: true }).waitFor();
  assert.equal(await button(page, '昼').getAttribute('aria-pressed'), 'true');
  await travel(page, '住戸の玄関', 'residence', 'foyer', 'day');
  await page.getByRole('heading', { name: residenceHeading, exact: true }).waitFor();
  await page.waitForFunction(() => {
    const pose = window.residenceProbe.camera;
    return pose && Math.hypot(pose.x - 11.8, pose.z + 14.17) < 0.22;
  });
  assert.equal(await button(page, '昼').getAttribute('aria-pressed'), 'true');
  await capture(page, 'residence-foyer-day');
  await hold(page, 'Shift', () => hold(page, 'w', () => page.waitForFunction(() => {
    const { x, y, z } = window.residenceProbe.camera;
    return z > -6.3 && Math.abs(x - 11.8) < 0.22 && Math.abs(y - 1.65) < 0.12;
  })));

  await travel(page, '入り江の浜', 'coast', 'inlet', 'day');
  await page.getByRole('heading', { name: '自然景観探索', exact: true }).waitFor();
  await button(page, '夜').click();
  await travel(page, 'リビング南窓', 'residence', 'living-window', 'night');
  await page.getByRole('heading', { name: residenceHeading, exact: true }).waitFor();
  assert.equal(await button(page, '夜').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
});

test('tea room and study are accessible in the travel panel and have flush walking paths', { timeout }, async t => {
  const { page, errors } = await openResidence(t, 'foyer');
  const landscape = '.coast-ui { visibility: hidden; }';
  await travel(page, '茶室04', 'residence', 'tea-room', 'night');
  await page.waitForFunction(() => {
    const { x, y, z } = window.residenceProbe.camera;
    return Math.hypot(x - 6.57, z + 3.92) < .19 && Math.abs(y - 1.65) < .10;
  });
  await capture(page, 'residence-tea-room-night', landscape);
  await hold(page, 'w', () => page.waitForFunction(() => {
    const { x, y, z } = window.residenceProbe.camera;
    return z > -3.08 && x < 6.1 && Math.abs(y - 1.65) < .10;
  }));

  await button(page, '昼').click();
  await travel(page, '書斎05', 'residence', 'study', 'day');
  await page.waitForFunction(() => {
    const { x, y, z } = window.residenceProbe.camera;
    return Math.hypot(x - 8.97, z + 3.91) < .19 && Math.abs(y - 1.65) < .10;
  });
  await capture(page, 'residence-study-day', landscape);
  await hold(page, 'w', () => page.waitForFunction(() => {
    const { x, y, z } = window.residenceProbe.camera;
    return z > -2.99 && x > 9.19 && Math.abs(y - 1.65) < .10;
  }));
  assert.deepEqual(errors, []);
});

test('room switches draw, reverse and reopen the same woven curtain panels', { timeout }, async t => {
  const { page, errors } = await createPage(t);
  await page.addInitScript(() => {
    window.curtainPanels = room => {
      const panels = [];
      window.residenceProbe.scene?.getObjectByName(`Residence curtains ${room}`)?.traverse(mesh => {
        if (mesh.name !== 'Residence curtain panel') return;
        const { widthSegments } = mesh.geometry.parameters;
        const position = mesh.geometry.attributes.position;
        let fabric = 0;
        for (let col = 1; col <= widthSegments; col++) {
          fabric += Math.hypot(position.getX(col) - position.getX(col - 1),
            position.getZ(col) - position.getZ(col - 1));
        }
        panels.push({ span: Math.abs(position.getX(widthSegments) - position.getX(0)), fabric });
      });
      return panels;
    };
  });
  await exposeResidenceScene(page);
  await page.goto(`${origin}/?world=residence`, { waitUntil: 'commit' });
  await page.getByRole('heading', { name: residenceHeading, exact: true }).waitFor();
  await page.waitForFunction(() => window.curtainPanels('LD').length === 6);
  const start = await page.evaluate(() => window.curtainPanels('LD'));
  const close = button(page, 'リビングのカーテンを閉める');
  const open = button(page, 'リビングのカーテンを開ける');
  await close.waitFor({ state: 'hidden' });
  await hold(page, 'd', () => page.waitForFunction(() => window.residenceProbe.camera.x < 18.06));
  await close.waitFor();

  async function waitForExpansion(range) {
    await page.waitForFunction(({ range: [low, high], start }) => window.curtainPanels('LD')
      .every(({ span }, i) => span >= start[i].span * low && span <= start[i].span * high), { range, start });
  }

  await page.keyboard.press('e');
  await open.waitFor();
  await waitForExpansion([2.2, 5]);
  await page.keyboard.press('e');
  await close.waitFor();
  await waitForExpansion([.99, 1.01]);

  // Walk clear of the switch and change the time while the same cloth is still moving.
  await page.keyboard.press('e');
  await hold(page, 'd', () => page.waitForFunction(() => window.residenceProbe.camera.x < 17.28));
  await open.waitFor({ state: 'hidden' });
  await button(page, '昼').click();
  await waitForExpansion([6.60, 6.64]);
  const closed = await page.evaluate(() => window.curtainPanels('LD'));
  for (const [i, panel] of closed.entries()) {
    assert.ok(Math.abs(panel.fabric / start[i].fabric - 1) < .025,
      `Panel ${i} changed its unrolled width from ${start[i].fabric} to ${panel.fabric}`);
  }

  async function relocate(x, z, yaw) {
    await page.evaluate(({ x, z, yaw }) => window.residenceProbe.relocate({ x, z, yaw, pitch: -.10 }), { x, z, yaw });
    await page.waitForFunction(({ x, z }) => {
      const pose = window.residenceProbe.camera;
      return pose && Math.hypot(pose.x - x, pose.z - z) < .015;
    }, { x, z });
  }

  const landscape = '.coast-ui { visibility: hidden; }';
  await relocate(20.34, -2.93, -2.36);
  await capture(page, 'residence-curtains-closed-day', landscape);
  await relocate(17.91, -1.23, Math.PI);
  await open.click();
  await waitForExpansion([.99, 1.01]);
  await capture(page, 'residence-curtain-switch-day', landscape);
  await relocate(20.34, -2.93, -2.36);
  await capture(page, 'residence-curtains-open-day', landscape);
  await button(page, '夜').click();
  await capture(page, 'residence-curtains-open-night', landscape);

  await relocate(7.06, -5.48, Math.PI);
  const roomLabel = id => RESIDENCE_ROOMS.find(room => room.id === id).label;
  await button(page, roomLabel('04') + 'のカーテンを閉める').waitFor({ state: 'hidden' });
  for (const [id, x, z, yaw] of [
    ['02', 18.57, -9.53, 0],
    ['03', 3.24, -4.45, 0],
    ['04', 6.76, -4.33, -Math.PI / 2],
    ['05', 9.22, -4.35, 0],
  ]) {
    await relocate(x, z, yaw);
    const label = roomLabel(id);
    const curtain = button(page, `${label}のカーテンを閉める`);
    const reopen = button(page, `${label}のカーテンを開ける`);
    const initial = await page.evaluate(room => window.curtainPanels(room).map(panel => panel.span), id);
    await curtain.click();
    await reopen.waitFor();
    await page.waitForFunction(({ id, initial }) => window.curtainPanels(id)
      .every((panel, i) => panel.span > initial[i] * 2.5), { id, initial });
    await reopen.click();
  }

  await relocate(17.91, -1.23, Math.PI);
  await close.waitFor();
  await waitForExpansion([.99, 1.01]);
  assert.deepEqual(errors, []);
});

test('tea room shoji and curtain independently control the window through local and menu actions', { timeout }, async t => {
  const { page, errors } = await createPage(t);
  await page.addInitScript(() => {
    const gl = WebGL2RenderingContext.prototype;
    const getLocation = gl.getUniformLocation;
    const setFloat = gl.uniform1f;
    const shojiUniforms = new WeakSet();
    gl.getUniformLocation = function (program, name) {
      const location = getLocation.call(this, program, name);
      if (location && name === 'residenceTeaShojiTransmission') shojiUniforms.add(location);
      return location;
    };
    gl.uniform1f = function (location, value) {
      if (shojiUniforms.has(location)) window.shojiDiffuseTransmission = value;
      return setFloat.call(this, location, value);
    };
  });
  await exposeResidenceScene(page);
  await page.goto(`${origin}/?world=residence&place=tea-room&time=day`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.residenceProbe.relocate);

  const curtainGroup = page.locator('[data-residence-section="curtains-04"]');
  const shoji = curtainGroup.getByRole('button', { name: '障子', exact: true });
  const curtain = curtainGroup.getByRole('button', { name: 'カーテン', exact: true });
  const close = button(page, '茶室の障子を閉める');
  const reopen = button(page, '茶室の障子を開ける');
  const landscape = '.coast-ui { visibility: hidden; }';
  const waitForShoji = (x, gain) => page.waitForFunction(({ x, gain }) => {
    const leaf = window.residenceProbe.scene.getObjectByName('Tea room shoji sliding west');
    return leaf && Math.abs(leaf.position.x - x) < .005
      && Math.abs(window.shojiDiffuseTransmission - gain) < .003;
  }, { x, gain });
  const paperLight = () => page.evaluate(() => {
    const leaf = window.residenceProbe.scene.getObjectByName('Tea room shoji sliding west');
    let light = 0;
    leaf.traverse(node => {
      if (node.material?.name === 'Tea room shoji paper') light = node.material.emissiveIntensity;
    });
    return light;
  });
  const view = { x: 5.48, z: -2.43, yaw: Math.PI, pitch: -.055 };
  const near = { ...view, z: -1.56 };
  await page.evaluate(view => window.residenceProbe.relocate(view), view);
  await waitForShoji(4.505, .561);
  await capture(page, 'residence-tea-shoji-open-day', landscape);
  await page.evaluate(near => window.residenceProbe.relocate(near), near);
  await close.waitFor();
  await page.keyboard.press('e');
  await reopen.waitFor();
  await waitForShoji(5.135, .389);
  await page.evaluate(view => window.residenceProbe.relocate(view), view);
  await capture(page, 'residence-tea-shoji-closed-day', landscape);
  const openCurtainLight = await paperLight();
  assert.ok(openCurtainLight > .25);

  await openResidenceDevice(page, 'カーテン', '茶室04');
  await curtainGroup.getByRole('button', { name: '障子', exact: true, pressed: false }).waitFor();
  assert.equal(await curtain.getAttribute('aria-pressed'), 'true');
  await curtain.click();
  await page.keyboard.press('Escape');
  await waitForShoji(5.135, .389);
  await page.waitForFunction(() => {
    let light = 0;
    window.residenceProbe.scene.getObjectByName('Tea room shoji sliding west').traverse(node => {
      if (node.material?.name === 'Tea room shoji paper') light = node.material.emissiveIntensity;
    });
    return light > 0 && light < .12;
  });
  await capture(page, 'residence-tea-shoji-curtain-closed-day', landscape);
  await openResidenceDevice(page, 'カーテン', '茶室04');
  await shoji.click();
  assert.equal(await curtain.getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Escape');
  await waitForShoji(4.505, .561);
  await capture(page, 'residence-tea-curtain-only-closed-day', landscape);
  await button(page, '高品質').click();
  await button(page, '夜').click();
  assert.ok((await paperLight()) < .018);
  assert.deepEqual(errors, []);
});

test('tea room fusuma moves, stops passage when closed, and leaves the window curtain independent', { timeout }, async t => {
  const { page, errors } = await createPage(t);
  await page.addInitScript(() => {
    const gl = WebGL2RenderingContext.prototype;
    const locations = new WeakMap();
    const getLocation = gl.getUniformLocation;
    const setArray = gl.uniform1fv;
    window.teaLight = {};
    gl.getUniformLocation = function (program, name) {
      const location = getLocation.call(this, program, name);
      if (location && name.startsWith('residenceWindowTransmission')) locations.set(location, 'window');
      return location;
    };
    gl.uniform1fv = function (location, values, ...rest) {
      if (locations.get(location) === 'window') window.teaLight.window = Math.min(...values);
      return setArray.call(this, location, values, ...rest);
    };
  });
  await exposeResidenceScene(page);
  await page.goto(`${origin}/?world=residence&place=tea-room&time=day`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.residenceProbe.relocate);
  const doorOpen = button(page, '茶室の襖を開ける');
  const doorClose = button(page, '茶室の襖を閉める');
  const closedAt = 5.996;
  const openAt = 5.008;
  const waitForFusuma = x => page.waitForFunction(x => {
    const door = window.residenceProbe.scene.getObjectByName('Tea room fusuma');
    return door && Math.abs(door.position.x - x) < .005;
  }, x);
  const waitForCurtainLight = open => page.waitForFunction(open => {
    const light = window.teaLight.window;
    return open ? light > .99 : light < .45;
  }, open);

  await page.evaluate(() => window.residenceProbe.relocate({ x: 6.49, z: -5.7, yaw: Math.PI, pitch: 0 }));
  await doorClose.waitFor();
  await waitForFusuma(openAt);
  await waitForCurtainLight(true);
  await page.keyboard.press('e');
  await doorOpen.waitFor();
  await waitForFusuma(closedAt);
  await waitForCurtainLight(true);
  await hold(page, 'w', async () => {
    await moreMovementFrames(page);
    assert.ok((await camera(page)).z < -5, 'The closed fusuma must stop passage');
  });
  await hold(page, 's', () => page.waitForFunction(() => window.residenceProbe.camera.z < -5.58));
  await doorOpen.click();
  await waitForFusuma(openAt);
  await hold(page, 'w', () => page.waitForFunction(() => window.residenceProbe.camera.z > -4.64));

  await page.evaluate(() => window.residenceProbe.relocate({ x: 6.76, z: -4.33, yaw: -Math.PI / 2, pitch: 0 }));
  await button(page, '茶室04のカーテンを閉める').click();
  await button(page, '茶室04のカーテンを開ける').waitFor();
  await waitForFusuma(openAt);
  await waitForCurtainLight(false);
  await page.evaluate(() => window.residenceProbe.relocate({ x: 6.28, z: -4.00, yaw: 0, pitch: 0 }));
  await capture(page, 'residence-tea-fusuma-open', '.coast-ui { visibility: hidden; }');
  await doorClose.click();
  await waitForFusuma(closedAt);
  await waitForCurtainLight(false);
  await capture(page, 'residence-tea-fusuma-closed', '.coast-ui { visibility: hidden; }');
  assert.deepEqual(errors, []);
});

test('the residence menu opens individual controls and keeps remote and wall controls in sync', { timeout }, async t => {
  const { page, errors } = await openResidence(t);
  const trigger = button(page, 'メニュー');
  const menu = residenceDialog(page, 'メニュー');
  const remote = button(menu, '住戸の遠隔操作');
  const directory = residenceDialog(page, '住戸の遠隔操作');
  const livingChoice = button(directory, 'リビング・ダイニング');
  const livingLights = residenceDialog(page, 'リビング・ダイニング');
  const west = button(livingLights, 'ペンダント灯（西）');
  const east = button(livingLights, 'ペンダント灯（東）');
  const atStart = await camera(page);
  await trigger.press('Enter');
  await menu.waitFor();
  await hold(page, 'd', () => moreMovementFrames(page));
  assert.deepEqual(await camera(page), atStart, 'A modal must suspend scene movement');
  await page.keyboard.press('Tab');
  assert.ok(await button(menu, '閉じる').evaluate(node => node === document.activeElement));
  await page.keyboard.press('Tab');
  assert.ok(await remote.evaluate(node => node === document.activeElement));
  await page.keyboard.press('Enter');
  assert.equal(await directory.locator('[data-residence-section]').count(), 0);
  await capture(page, 'residence-remote-directory');
  await livingChoice.press('Enter');
  assert.equal(await livingLights.locator('[data-residence-section]').count(), 1);
  assert.equal(await west.getAttribute('aria-pressed'), 'true');
  assert.equal(await east.getAttribute('aria-pressed'), 'true');
  await west.click();
  assert.equal(await west.getAttribute('aria-pressed'), 'false');
  assert.equal(await east.getAttribute('aria-pressed'), 'true');
  await button(livingLights, '一括消灯').click();
  assert.equal(await east.getAttribute('aria-pressed'), 'false');
  await button(livingLights, '一括点灯').click();
  assert.equal(await west.getAttribute('aria-pressed'), 'true');
  await west.click();
  await capture(page, 'residence-remote-lighting');
  await button(livingLights, '設備一覧へ戻る').press('Enter');
  assert.ok(await livingChoice.evaluate(node => node === document.activeElement));
  await button(directory, 'メニューへ戻る').press('Enter');
  assert.ok(await remote.evaluate(node => node === document.activeElement));
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  assert.ok(await trigger.evaluate(node => node === document.activeElement));
  await button(page, '昼').click();
  await button(page, '高品質').click();
  await openResidenceDevice(page, '照明', 'リビング・ダイニング');
  assert.equal(await west.getAttribute('aria-pressed'), 'false');
  assert.equal(await east.getAttribute('aria-pressed'), 'true');

  await button(livingLights, '設備一覧へ戻る').click();
  const curtains = await selectResidenceDevice(page, 'カーテン', 'リビング');
  const drape = button(curtains, 'カーテン');
  await drape.click();
  assert.equal(await drape.getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Escape');
  await button(page, '軽量').click();
  await hold(page, 'd', () => page.waitForFunction(() => window.residenceProbe.camera.x < 18.06));
  await button(page, 'リビングのカーテンを開ける').click();

  await page.setViewportSize({ width: 375, height: 710 });
  await trigger.click();
  assert.ok(await menu.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await remote.click();
  assert.ok(await directory.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await selectResidenceDevice(page, 'カーテン', 'リビング');
  assert.ok(await curtains.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  assert.equal(await drape.getAttribute('aria-pressed'), 'true');
  await capture(page, 'residence-remote-curtains-mobile');
  await button(curtains, '設備一覧へ戻る').click();
  await selectResidenceDevice(page, '照明', 'リビング・ダイニング');
  assert.ok(await livingLights.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await capture(page, 'residence-remote-lighting-mobile');
  assert.deepEqual(errors, []);
});

test('an open gallery doorway softly lights the living floor with its own fixtures off', { timeout }, async t => {
  const { page, errors } = await createPage(t);
  await exposeResidenceScene(page);
  await page.goto(`${origin}/?world=residence&time=night`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.residenceProbe.relocate);

  const canvas = page.locator('canvas').first();
  const view = { x: 11.94, z: -4.85, yaw: 0, pitch: -.46 };
  const reachDoor = { ...view, z: -5.70 };
  const area = [.38, .80, .25, .16];
  async function move(pose) {
    await page.evaluate(pose => window.residenceProbe.relocate(pose), pose);
    await page.waitForFunction(({ x, z }) => {
      const at = window.residenceProbe.camera;
      return at && Math.hypot(at.x - x, at.z - z) < .015;
    }, pose);
  }
  const leafAt = x => page.waitForFunction(x => {
    const door = window.residenceProbe.scene.getObjectByName('Gallery pocket door');
    return door && Math.abs(door.position.x - x) < .005;
  }, x);

  const living = await openResidenceDevice(page, '照明', 'リビング・ダイニング');
  await button(living, '一括消灯').click();
  await button(living, '設備一覧へ戻る').click();
  const kitchen = await selectResidenceDevice(page, '照明', 'キッチン');
  await button(kitchen, '一括消灯').click();
  await page.keyboard.press('Escape');

  await move(view);
  await leafAt(12.814);
  const lit = await brightness(canvas, area);
  await capture(page, 'residence-spill-gallery-open', '.coast-ui { visibility: hidden; }');
  await move(reachDoor);
  await button(page, 'リビングの引戸を閉める').click();
  await leafAt(11.056);
  await move(view);
  const shaded = await brightness(canvas, area);
  await capture(page, 'residence-spill-gallery-closed', '.coast-ui { visibility: hidden; }');
  assert.ok(lit.mean > shaded.mean + .8, JSON.stringify({ lit, shaded }));
  assert.deepEqual(errors, []);
});

test('theater mode sets RGB illumination and restores the normal living-room light settings', { timeout }, async t => {
  const { page, errors } = await createPage(t);
  await page.addInitScript(() => {
    const gl = WebGL2RenderingContext.prototype;
    const getLocation = gl.getUniformLocation;
    const setFloat = gl.uniform1f;
    const setColor = gl.uniform3f;
    const stateUniforms = new WeakSet();
    const tintUniforms = new WeakSet();
    window.theaterLight = {};
    gl.getUniformLocation = function (program, name) {
      const location = getLocation.call(this, program, name);
      if (location && name === 'residenceTheaterEnabled') stateUniforms.add(location);
      if (location && name === 'residenceTheaterTint') tintUniforms.add(location);
      return location;
    };
    gl.uniform1f = function (location, value) {
      if (stateUniforms.has(location)) window.theaterLight.on = value === 1;
      return setFloat.call(this, location, value);
    };
    gl.uniform3f = function (location, red, green, blue) {
      if (tintUniforms.has(location)) window.theaterLight.tint = [red, green, blue];
      return setColor.call(this, location, red, green, blue);
    };
  });
  await page.goto(`${origin}/?world=residence&place=living-theater&time=night`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.theaterLight.on === false);
  const living = await openResidenceDevice(page, '照明', 'リビング・ダイニング');
  const toggle = living.getByRole('button', { name: 'シアター照明', exact: true });
  const tint = living.getByLabel('シアター照明の色', { exact: true });
  const west = living.getByRole('button', { name: 'ペンダント灯（西）', exact: true });
  const east = living.getByRole('button', { name: 'ペンダント灯（東）', exact: true });
  const allOff = living.getByRole('button', { name: '一括消灯', exact: true });
  const landscape = '.coast-ui { visibility: hidden; }';

  await west.click();
  assert.equal(await west.getAttribute('aria-pressed'), 'false');
  assert.equal(await east.getAttribute('aria-pressed'), 'true');
  await toggle.focus();
  await toggle.press('Space');
  assert.equal(await west.isDisabled(), true);
  assert.equal(await east.isDisabled(), true);
  assert.equal(await east.getAttribute('aria-pressed'), 'false');
  assert.equal(await tint.inputValue(), '#ffb875');
  await button(living, '設備一覧へ戻る').click();
  const kitchen = await selectResidenceDevice(page, '照明', 'キッチン');
  const kitchenLight = kitchen.getByRole('button', { pressed: true }).first();
  await kitchenLight.waitFor();
  assert.equal(await kitchenLight.isEnabled(), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.theaterLight.on && window.theaterLight.tint[0] > window.theaterLight.tint[2]);
  await button(page, '高品質').click();
  await capture(page, 'residence-theater-rgb-warm', landscape);

  await openResidenceDevice(page, '照明', 'リビング・ダイニング');
  await tint.fill('#70bdff');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.theaterLight.on && window.theaterLight.tint[2] > window.theaterLight.tint[0]);
  await capture(page, 'residence-theater-rgb-blue', landscape);
  await button(page, '軽量').click();
  await button(page, '昼').click();
  await page.waitForFunction(() => window.theaterLight.on);
  await button(page, '夜').click();
  await openResidenceDevice(page, '照明', 'リビング・ダイニング');
  assert.equal(await tint.inputValue(), '#70bdff');
  await toggle.click();
  assert.equal(await west.isEnabled(), true);
  assert.equal(await west.getAttribute('aria-pressed'), 'false');
  assert.equal(await east.getAttribute('aria-pressed'), 'true');
  await toggle.click();
  await allOff.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await east.getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.theaterLight.on === false);
  await capture(page, 'residence-theater-rgb-off', landscape);
  assert.deepEqual(errors, []);
});

test('closing the fusuma reduces street treble and adjoining-room reverb at a fixed hallway viewpoint', { timeout }, async t => {
  const { page, errors } = await createPage(t);
  await exposeResidenceScene(page);
  await page.goto(`${origin}/?world=residence&place=tea-room&time=night`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.residenceProbe.relocate);
  await page.evaluate(() => window.residenceProbe.relocate({ x: 6.49, z: -5.62, yaw: Math.PI, pitch: 0 }));
  const close = button(page, '茶室の襖を閉める');
  await close.waitFor();
  await button(page, '環境音を開始').click();
  await button(page, '環境音を再開').waitFor();
  await page.waitForFunction(() => {
    const probe = window.residenceProbe;
    return probe.roomSends[5]?.gain.value > .015 && probe.lowpassCutoffs().length >= 3
      && probe.lowpassCutoffs().every(value => value < 900);
  });
  const measure = () => page.evaluate(() => ({
    cutoffs: window.residenceProbe.lowpassCutoffs(),
    teaReverb: window.residenceProbe.roomSends[5].gain.value,
  }));
  const opened = await measure();
  await close.click();
  await page.waitForFunction(() => window.residenceProbe.roomSends[5].gain.value < .003);
  await page.waitForFunction(opened => window.residenceProbe.lowpassCutoffs()
    .some((value, i) => value < opened[i] - 18), opened.cutoffs);
  const closed = await measure();
  t.diagnostic(`Fusuma acoustic parameters ${JSON.stringify({ opened, closed })}`);
  await button(page, '茶室の襖を開ける').click();
  await page.waitForFunction(() => window.residenceProbe.roomSends[5].gain.value > .015);
  assert.deepEqual(errors, []);
});

test('the primary bedroom slider gates balcony access and the glass rail stops walking', { timeout }, async t => {
  const { page, errors } = await openResidence(t, 'primary-bedroom');
  const open = button(page, 'バルコニーの引戸を開ける');
  const close = button(page, 'バルコニーの引戸を閉める');
  const bedroom = await camera(page);
  assert.ok(Math.hypot(bedroom.x - 20.07, bedroom.z + 13.575) < 0.22,
    `Unexpected primary bedroom spawn ${JSON.stringify(bedroom)}`);
  await open.waitFor();
  await capture(page, 'residence-bedroom-night');
  await hold(page, 'a', () => page.waitForFunction(() => window.residenceProbe.camera.z < -14.84));
  await button(page, '主寝室のカーテンを閉める').click();
  await button(page, '主寝室のカーテンを開ける').waitFor();
  await page.evaluate(() => document.activeElement.blur());
  await hold(page, 'd', () => page.waitForFunction(() => window.residenceProbe.camera.z > -13.67));
  await open.waitFor();

  await button(page, '環境音を開始').click();
  await button(page, '環境音を再開').waitFor();
  await page.waitForFunction(() => {
    const peak = window.residenceProbe.audioPeak();
    return peak > 0.0001 && peak < 0.98;
  });

  async function walkEastTo(x) {
    await page.waitForFunction(limit => window.residenceProbe.camera.x > limit, x);
  }

  await hold(page, 'w', async () => {
    await walkEastTo(20.19);
    await moreMovementFrames(page);
  });
  const sill = await camera(page);
  assert.ok(sill.x < 20.7, `Walked through the closed slider at E=${sill.x}`);
  const closedCutoffs = await page.evaluate(() => window.residenceProbe.lowpassCutoffs());
  assert.ok(closedCutoffs.length >= 3 && closedCutoffs.every(cutoff => cutoff < 520),
    `Closed glass should attenuate the high frequencies: ${closedCutoffs}`);

  await page.keyboard.press('e');
  await open.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.residenceProbe.lowpassCutoffs()
    .filter(cutoff => cutoff > 1000).length >= 3);
  await hold(page, 'w', () => walkEastTo(20.61));
  await close.waitFor({ state: 'hidden' });
  await page.keyboard.press('e');
  await hold(page, 'w', () => walkEastTo(21.9));
  await close.waitFor({ state: 'hidden' });
  const balcony = await camera(page);
  assert.ok(Math.abs(balcony.y - bedroom.y) < 0.12, 'The balcony threshold should be flush');
  await capture(page, 'residence-balcony-night');

  await hold(page, 'w', async () => {
    await walkEastTo(22.35);
    await moreMovementFrames(page);
  });
  const rail = await camera(page);
  assert.ok(rail.x < 22.8 && Math.abs(rail.y - balcony.y) < 0.1,
    `The rail should stop walking at floor height: ${JSON.stringify(rail)}`);

  await hold(page, 's', () => page.waitForFunction(() => window.residenceProbe.camera.x < 20.12));
  await close.click();
  await open.waitFor();
  await page.waitForFunction(() => window.residenceProbe.lowpassCutoffs().every(cutoff => cutoff < 520));
  assert.equal(await page.evaluate(() => window.residenceProbe.contexts), 1);
  assert.deepEqual(errors, []);
});

test('captures the designed seated and balcony sightlines', { timeout, skip: !screenshots }, async t => {
  const { page, errors } = await createPage(t);
  const landscape = '.coast-ui { visibility: hidden; }';
  // The central sofa cushion is near E20/N1.30 and finishes at 0.50 m above the floor.
  let eye = { x: 20, y: 1.15, z: -1.30, yaw: 179.83, pitch: -17 };
  await page.route('**/assets/CoastApp-*.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const prepare = 'this.world.prepareRender?.(';
    assert.ok(source.includes(prepare), 'The capture hook requires the exploration render preparation');
    // Draw the built scene from fixed review points on this screenshot page only.
    const { x, y, z, yaw, pitch } = eye;
    const pose = `this.camera.position.set(${x},${y},${z}),`
      + `this.camera.rotation.set(${pitch}*Math.PI/180,${yaw}*Math.PI/180,0),`;
    await route.fulfill({ response, body: source.replace(prepare, pose + prepare) });
  });

  async function loadView(place) {
    await page.goto(`${origin}/?world=residence&place=${place}`, { waitUntil: 'commit' });
    await page.waitForFunction(({ x, y, z }) => {
      const pose = window.residenceProbe.camera;
      return pose && Math.hypot(pose.x - x, pose.y - y, pose.z - z) < 0.001;
    }, eye);
  }

  async function captureDayNight(name, place = 'living-window') {
    await loadView(place);
    await button(page, '高品質').click();
    await capture(page, `${name}-night`, landscape);
    await button(page, '昼').click();
    await capture(page, `${name}-day`, landscape);
  }

  await captureDayNight('residence-south-window-seated');

  eye = { ...eye, pitch: -24 };
  await captureDayNight('residence-south-window-seated-down');

  eye = { x: 17.25, y: 1.65, z: -3.55, yaw: -141, pitch: -6 };
  await captureDayNight('residence-living-room');

  eye = { x: 21.94, y: 1.63, z: -12.94, yaw: -96, pitch: -38 };
  await captureDayNight('residence-balcony-street', 'primary-bedroom');

  eye = { x: 21.94, y: 1.63, z: -12.94, yaw: -72, pitch: -38 };
  await captureDayNight('residence-balcony-northeast', 'primary-bedroom');

  eye = { x: 21.89, y: 1.65, z: -0.42, yaw: 151, pitch: -26 };
  await captureDayNight('residence-southwest-window');
  assert.deepEqual(errors, []);
});

test('nearby appliances open individual controls and start localized audio', { timeout }, async t => {
  const { page, errors } = await createPage(t);
  await exposeResidenceScene(page);
  await page.addInitScript(() => {
    const start = AudioBufferSourceNode.prototype.start;
    const connect = AudioBufferSourceNode.prototype.connect;
    const chimes = new WeakSet();
    window.residenceProbe.completionStarts = 0;
    AudioBufferSourceNode.prototype.connect = function (target, ...args) {
      // Chimes are short one-shots sent straight to the appliance's spatial low-pass filter.
      if (!this.loop && this.buffer?.duration < 1 && target instanceof BiquadFilterNode) chimes.add(this);
      return connect.call(this, target, ...args);
    };
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.loop) window.residenceProbe.loopStarts++;
      if (chimes.has(this)) window.residenceProbe.completionStarts++;
      return start.apply(this, args);
    };
  });
  await page.goto(`${origin}/?world=residence&place=living-theater&time=night`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.residenceProbe.relocate);
  await page.evaluate(() => window.residenceProbe.relocate({ x: 13.48, z: -8.99, yaw: 0, pitch: 0 }));
  await button(page, '電子レンジを操作').waitFor();
  await button(page, '環境音を開始').click();
  await button(page, '環境音を再開').waitFor();
  const initialLoops = await page.evaluate(() => window.residenceProbe.loopStarts);
  const atStart = await camera(page);
  await page.keyboard.press('e');
  const microwave = residenceDialog(page, '電子レンジ');
  await microwave.waitFor();
  assert.equal(await microwave.locator('[data-residence-section]').count(), 1);
  assert.equal(await button(microwave, '設備一覧へ戻る').count(), 0);
  assert.equal(await microwave.getByRole('combobox').count(), 0);
  await page.keyboard.press('t');
  assert.equal(await residenceDialog(page, 'ファストトラベル').count(), 0);
  await hold(page, 'd', () => moreMovementFrames(page));
  assert.deepEqual(await camera(page), atStart);
  await capture(page, 'residence-local-microwave');
  const addSeconds = microwave.getByRole('button', { name: '+10秒', exact: true });
  const addMinute = microwave.getByRole('button', { name: '+1分', exact: true });
  const heat = microwave.getByRole('button', { name: '加熱開始・再開', exact: true });
  const stopHeat = microwave.getByRole('button', { name: '停止', exact: true });
  await addSeconds.click();
  await microwave.getByText('00:10', { exact: true }).waitFor();
  await addMinute.click();
  await microwave.getByText('01:10', { exact: true }).waitFor();
  await microwave.getByRole('button', { name: '時間をリセット' }).click();
  await addSeconds.click();
  await heat.click();
  await microwave.getByText('加熱中', { exact: true }).waitFor();
  await page.waitForFunction(initial => window.residenceProbe.loopStarts > initial, initialLoops);
  await microwave.getByText(/^00:0[7-9]$/).waitFor();
  await stopHeat.click();
  await microwave.getByText('停止中', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.residenceProbe.completionStarts), 0);

  await button(microwave, '閉じる').click();
  await page.waitForFunction(() => document.activeElement?.matches('.coast-view'));
  await hold(page, 'd', () => page.waitForFunction(x => Math.abs(window.residenceProbe.camera.x - x) > .08, atStart.x));

  const kitchen = await openResidenceDevice(page, '家電・水栓', 'キッチンの水栓');
  const tap = button(kitchen, '水栓');
  await tap.click();
  assert.equal(await tap.getAttribute('aria-pressed'), 'true');
  await button(kitchen, '設備一覧へ戻る').click();
  await selectResidenceDevice(page, '家電・水栓', '電子レンジ');
  await microwave.getByText('停止中', { exact: true }).waitFor();
  await heat.click();
  await microwave.getByText('加熱完了', { exact: true }).waitFor();
  await page.waitForFunction(() => window.residenceProbe.completionStarts === 1);
  await button(microwave, '設備一覧へ戻る').click();
  await selectResidenceDevice(page, '家電・水栓', 'キッチンの水栓');
  assert.equal(await tap.getAttribute('aria-pressed'), 'true');
  await tap.click();
  assert.equal(await tap.getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.residenceProbe.relocate({ x: 7.44, z: -8.55, yaw: Math.PI / 2, pitch: -.12 }));

  await button(page, '洗濯機（入口側）を操作').click();
  const washer = residenceDialog(page, '洗濯機（入口側）');
  assert.equal(await button(washer, '設備一覧へ戻る').count(), 0);
  assert.equal(await button(washer, '加熱開始・再開').count(), 0);
  const mode = washer.getByRole('combobox', { name: '運転モード' });
  assert.deepEqual(await mode.locator('option').allTextContents(), ['洗浄', 'すすぎ', '脱水', '乾燥']);
  for (const selected of ['wash', 'rinse', 'dry', 'spin']) {
    await mode.selectOption(selected);
    assert.equal(await mode.inputValue(), selected);
  }
  const power = washer.getByRole('button', { name: '運転', exact: true });
  const loopsBeforeWasher = await page.evaluate(() => window.residenceProbe.loopStarts);
  await power.click();
  await washer.getByText(/脱水中/).waitFor();
  assert.ok(await mode.isDisabled());
  await page.waitForFunction(initial => window.residenceProbe.loopStarts > initial, loopsBeforeWasher);
  await power.click();
  await washer.getByText(/停止中/).waitFor();
  assert.ok(await mode.isEnabled());
  assert.equal(await page.evaluate(() => window.residenceProbe.completionStarts), 1);
  await page.keyboard.press('Escape');
  await washer.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
});

test('the gallery pocket door closes, stops walking, and reopens both ways', { timeout }, async t => {
  const { page, errors } = await createPage(t);
  await exposeResidenceScene(page);
  await page.goto(`${origin}/?world=residence&time=day`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.residenceProbe.relocate);
  const open = button(page, 'リビングの引戸を開ける');
  const close = button(page, 'リビングの引戸を閉める');
  const waitForLeaf = x => page.waitForFunction(x => {
    const door = window.residenceProbe.scene.getObjectByName('Gallery pocket door');
    return door && Math.abs(door.position.x - x) < .005;
  }, x);
  const gallery = { x: 11.94, z: -7.68, yaw: Math.PI, pitch: -.04 };
  const living = { x: 11.94, z: -5.68, yaw: 0, pitch: -.04 };
  async function relocate(pose) {
    await page.evaluate(pose => window.residenceProbe.relocate(pose), pose);
    await page.waitForFunction(({ x, z }) => {
      const at = window.residenceProbe.camera;
      return at && Math.hypot(x - at.x, z - at.z) < .015;
    }, pose);
  }
  const landscape = '.coast-ui { visibility: hidden; }';

  await relocate(gallery);
  await close.waitFor();
  await waitForLeaf(12.814);
  await relocate({ ...gallery, z: -8.75, pitch: -.11 });
  await capture(page, 'gallery-door-open', landscape);
  await relocate(gallery);
  await close.waitFor();
  await page.keyboard.press('e');
  await open.waitFor();
  await waitForLeaf(11.056);
  await relocate({ ...gallery, z: -8.75, pitch: -.11 });
  await capture(page, 'gallery-door-closed', landscape);
  await relocate(gallery);
  await hold(page, 'w', async () => {
    await page.waitForFunction(() => window.residenceProbe.camera.z > -7.25);
    await moreMovementFrames(page);
    const pose = await camera(page);
    assert.ok(pose.z < -6.91 && pose.z > -7.13, JSON.stringify(pose));
  });
  await open.click();
  await waitForLeaf(12.814);
  await hold(page, 'w', () => page.waitForFunction(() => window.residenceProbe.camera.z > -6.02));
  await relocate(living);
  await close.click();
  await waitForLeaf(11.056);
  await relocate({ ...living, z: -4.72, pitch: -.11 });
  await capture(page, 'gallery-door-living', landscape);
  await relocate(living);
  await open.click();
  await waitForLeaf(12.814);
  await hold(page, 'w', () => page.waitForFunction(() => window.residenceProbe.camera.z < -7.26));
  assert.deepEqual(errors, []);
});
