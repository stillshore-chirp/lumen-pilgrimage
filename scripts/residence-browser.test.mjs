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
  const probe = { camera: null, contexts: 0, analyser: null, trafficFilters: new Set() };
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

async function brightness(canvas) {
  return canvas.evaluate(source => new Promise(resolve => requestAnimationFrame(() => {
    const sample = document.createElement('canvas');
    sample.width = 32;
    sample.height = 20;
    const context = sample.getContext('2d');
    context.drawImage(source, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    const colors = new Set();
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      total += (r + g + b) / 3;
      colors.add((r << 16) | (g << 8) | b);
    }
    resolve({ mean: total / (pixels.length / 4), colors: colors.size });
  })));
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
  await page.route('**/assets/CoastApp-*.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const prepare = 'this.world.prepareRender?.(';
    assert.ok(source.includes(prepare), 'The curtain review hook requires exploration render preparation');
    const hook = 'window.residenceProbe.scene=this.world.scene,'
      + 'window.residenceProbe.relocate??=(pose=>this.controls.relocate(pose)),';
    await route.fulfill({ response, body: source.replace(prepare, hook + prepare) });
  });
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
  // The central sofa cushion is near E20/N1 and finishes at 0.50 m above the floor.
  let eye = { x: 20, y: 1.15, z: -1, yaw: 179.83, pitch: -17 };
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
