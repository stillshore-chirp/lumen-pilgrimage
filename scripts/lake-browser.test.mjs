import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { Quaternion, Vector3 } from 'three';
import { preview } from 'vite';
import { installSimulatedXR } from './simulated-xr.mjs';
import { LAKE_SPAWN, LAKE_VIEW_FOV, LAKE_VIEW_VERTICAL_OFFSET } from '../src/coast/world/lake/lakeLayout.ts';

const screenshots = process.env.LAKE_SCREENSHOTS;
const viewport = { width: 1440, height: 808 };
const timeout = 110_000;
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

function observeView() {
  const probe = { camera: null };
  window.lakeProbe = probe;
  const cameraUniforms = new WeakSet();
  const gl = WebGL2RenderingContext.prototype;
  const findUniform = gl.getUniformLocation;
  const setPosition = gl.uniform3f;
  gl.getUniformLocation = function (program, name) {
    const location = findUniform.call(this, program, name);
    if (location && name === 'cameraPosition') cameraUniforms.add(location);
    return location;
  };
  gl.uniform3f = function (location, x, y, z) {
    if (cameraUniforms.has(location)) probe.camera = { x, y, z };
    return setPosition.call(this, location, x, y, z);
  };
}

function observeAndon() {
  const gl = WebGL2RenderingContext.prototype;
  const locate = gl.getUniformLocation;
  const setMatrix = gl.uniformMatrix4fv;
  const setVector = gl.uniform3f;
  const setFloat = gl.uniform1f;
  const useProgram = gl.useProgram;
  const draw = gl.drawElements;
  const bindFramebuffer = gl.bindFramebuffer;
  const programs = new WeakMap();
  const uniforms = new WeakMap();
  let current;
  let view;
  let onScreen = true;
  window.andonDraw = null;
  window.floatingMonitorDraw = null;
  const toWorld = ([x, y, z]) => [0, 4, 8].map(i =>
    view[i] * (x - view[12]) + view[i + 1] * (y - view[13]) + view[i + 2] * (z - view[14]));

  gl.getUniformLocation = function (program, name) {
    const location = locate.call(this, program, name);
    if (!location) return location;
    if (!programs.has(program)) programs.set(program, {});
    const info = programs.get(program);
    if (name === 'emissiveMap') info.emissiveMap = true;
    if (name === 'modelViewMatrix' || name === 'viewMatrix' || /^pointLights\[\d+\]\.(position|distance)$/.test(name)) {
      uniforms.set(location, { info, name });
    }
    return location;
  };
  gl.uniformMatrix4fv = function (location, transpose, matrix, ...rest) {
    const uniform = uniforms.get(location);
    // The sky submits the current pass's view matrix before the paper draws.
    // Three.js reuses the upload buffer across different matrix uniforms.
    if (uniform?.name === 'viewMatrix' && onScreen) view = matrix.slice();
    if (uniform?.name === 'modelViewMatrix') {
      const position = [matrix[12], matrix[13], matrix[14]];
      if (uniform.info.emissiveMap) uniform.info.paperPosition = position;
      // The disconnected monitor is a unit quad scaled to 2.7 m by 2.7 × 9/16 m.
      const isMonitorSize = Math.abs(Math.hypot(matrix[0], matrix[1], matrix[2]) - 2.7) < 0.001
        && Math.abs(Math.hypot(matrix[4], matrix[5], matrix[6]) - 2.7 * 9 / 16) < 0.001;
      uniform.info.monitorPosition = isMonitorSize ? position : undefined;
    }
    return setMatrix.call(this, location, transpose, matrix, ...rest);
  };
  gl.uniform3f = function (location, x, y, z) {
    const uniform = uniforms.get(location);
    if (uniform) uniform.info[uniform.name] = [x, y, z];
    return setVector.call(this, location, x, y, z);
  };
  gl.uniform1f = function (location, value) {
    const uniform = uniforms.get(location);
    if (uniform && Math.abs(value - 2.35) < 0.001) {
      uniform.info.andonPosition = uniform.name.replace('.distance', '.position');
    }
    return setFloat.call(this, location, value);
  };
  gl.useProgram = function (program) {
    current = programs.get(program);
    return useProgram.call(this, program);
  };
  gl.bindFramebuffer = function (target, framebuffer) {
    if (target !== this.READ_FRAMEBUFFER) onScreen = framebuffer === null;
    return bindFramebuffer.call(this, target, framebuffer);
  };
  gl.drawElements = function (mode, count, ...rest) {
    if (onScreen && view && current) {
      if (count === 6 && current.monitorPosition) window.floatingMonitorDraw = toWorld(current.monitorPosition);
      // Each paper panel uses a 6-by-8 grid. The andon's point light has a 2.35 m cutoff.
      if (count === 6 * 8 * 6 && current.paperPosition) {
        const position = current[current.andonPosition];
        window.andonDraw = {
          paper: toWorld(current.paperPosition),
          light: position && toWorld(position),
        };
      }
    }
    return draw.call(this, mode, count, ...rest);
  };
}

function observeOutput() {
  const probe = { context: null, analyser: null };
  window.lakeAudioProbe = probe;
  const NativeContext = window.AudioContext;
  const connect = AudioNode.prototype.connect;
  window.AudioContext = class extends NativeContext {
    constructor(...args) {
      super(...args);
      probe.context = this;
      probe.analyser = this.createAnalyser();
    }
  };
  AudioNode.prototype.connect = function (destination, ...args) {
    if (destination === probe.context?.destination) connect.call(this, probe.analyser);
    return connect.call(this, destination, ...args);
  };
  probe.peak = () => {
    if (!probe.analyser) return 0;
    const data = new Float32Array(probe.analyser.fftSize);
    probe.analyser.getFloatTimeDomainData(data);
    return Math.max(...data.map(Math.abs));
  };
}

async function newPage(t) {
  const page = await browser.newPage({ viewport });
  t.after(() => page.close());
  page.setDefaultTimeout(25_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(observeView);
  return { page, errors };
}

function action(page, name) {
  return page.getByRole('button', { name, exact: true });
}

async function goToLake(page, options = '') {
  await page.goto(`${origin}/?world=lake${options}`, { waitUntil: 'commit' });
  await page.getByRole('heading', { name: '湖畔の広間', exact: true }).waitFor();
  await page.waitForFunction(() => Boolean(window.lakeProbe.camera));
}

async function capture(page, name) {
  return page.screenshot({
    path: screenshots ? join(screenshots, `${name}.png`) : undefined,
    style: '.coast-ui { visibility: hidden !important; }',
  });
}

async function sampleBrightness(page, buffer, region) {
  return page.evaluate(async ({ image, region: [x, y, width, height] }) => {
    const bytes = Uint8Array.from(atob(image), letter => letter.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const crop = document.createElement('canvas');
    crop.width = 64;
    crop.height = 24;
    const ctx = crop.getContext('2d');
    ctx.drawImage(bitmap, bitmap.width * x, bitmap.height * y, bitmap.width * width,
      bitmap.height * height, 0, 0, crop.width, crop.height);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, crop.width, crop.height);
    const pixelCount = data.length / 4;
    let sum = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      sum += data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
    }
    return sum / pixelCount;
  }, { image: buffer.toString('base64'), region });
}

async function withPointerLock(page, inspect) {
  await action(page, 'マウス操作を開始').click();
  await page.waitForFunction(() => document.pointerLockElement?.classList.contains('coast-view'));
  try {
    await inspect();
  } finally {
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => document.pointerLockElement === null
      && !document.querySelector('#app')?.classList.contains('coast-locked'));
  }
}

async function walk(page, key, condition, holdAfterArrival = false) {
  await withPointerLock(page, async () => {
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(condition);
      if (holdAfterArrival) {
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1_000)));
      }
    } finally {
      await page.keyboard.up(key);
    }
  });
}

async function turn(page, movementX, movementY = 0) {
  await page.evaluate(([x, y]) => {
    document.pointerLockElement.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y }));
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, [movementX, movementY]);
}

async function captureHallViews(page) {
  await withPointerLock(page, async () => {
    const eighthTurn = 357;
    for (const name of ['right-oblique', 'right', 'rear-right', 'rear', 'rear-left', 'left', 'left-oblique']) {
      await turn(page, eighthTurn);
      await capture(page, `lake-hall-${name}`);
    }
    await turn(page, eighthTurn, -335);
    await capture(page, 'lake-hall-ceiling');
    await turn(page, 0, 690);
    await capture(page, 'lake-hall-floor');
    await turn(page, 0, -355);
  });
}

async function travel(page, world, name) {
  await action(page, 'ファストトラベル').click();
  const dialog = page.getByRole('dialog', { name: 'ファストトラベル' });
  await dialog.getByRole('region', { name: world, exact: true })
    .getByRole('button', { name: new RegExp(name) }).click();
  await dialog.waitFor({ state: 'hidden' });
}

function assertLightFollowsPaper({ paper, light }) {
  assert.ok(Math.hypot(...light.map((value, i) => value - paper[i])) < 0.14,
    'the rendered paper and point light remain together');
}

function controllerAim(origin, destination) {
  const direction = new Vector3(...destination).sub(new Vector3(...origin)).normalize();
  const { x, y, z, w } = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), direction);
  return { x, y, z, w };
}

test('lake hall starts at its photo comparison view and switches the sky to night', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  await goToLake(page);
  const position = await page.evaluate(() => window.lakeProbe.camera);
  assert.ok(Math.hypot(position.x, position.y - 1.65, position.z - 7) < 0.04);
  assert.equal(await page.locator('#coast-fov').inputValue(), '52');
  await page.waitForLoadState('networkidle');
  const skyRegion = [0.30, 0.195, 0.40, 0.085];
  const day = await sampleBrightness(page, await capture(page, 'lake-hall-day'), skyRegion);
  if (screenshots) {
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 8_000)));
    await capture(page, 'lake-hall-day-later');
    await action(page, '高品質').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await capture(page, 'lake-hall-day-high');
    await action(page, '軽量').click();
    await captureHallViews(page);
  }
  await action(page, '夜').click();
  await page.waitForURL(url => url.searchParams.get('time') === 'night');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const night = await sampleBrightness(page, await capture(page, 'lake-hall-night'), skyRegion);
  assert.ok(day > 70 && night < day * 0.70, `sky light changed from ${day.toFixed(1)} to ${night.toFixed(1)}`);
  await action(page, '高品質').click();
  assert.equal(await action(page, '高品質').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (screenshots) await capture(page, 'lake-hall-night-high');
  assert.deepEqual(errors, []);
});

test('the night andon illuminates its paper and nearby tatami and follows the world light control', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  await goToLake(page, '&time=night');
  await page.waitForLoadState('networkidle');
  const lit = await capture(page, 'lake-andon-lit');
  await action(page, '一括消灯').click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const dark = await capture(page, 'lake-andon-unlit');
  const shade = [0.678, 0.828, 0.014, 0.029];
  const tatami = [0.667, 0.888, 0.040, 0.021];
  const litShade = await sampleBrightness(page, lit, shade);
  const darkShade = await sampleBrightness(page, dark, shade);
  const litFloor = await sampleBrightness(page, lit, tatami);
  const darkFloor = await sampleBrightness(page, dark, tatami);
  assert.ok(litShade > darkShade + 20, `andon paper luminance: ${darkShade} → ${litShade}`);
  assert.ok(litFloor > darkFloor + 5, `nearby floor luminance: ${darkFloor} → ${litFloor}`);
  assert.match(page.url(), /time=night/);
  assert.deepEqual(errors, []);
});

test('F carries the aimed night andon and leaves its paper and light at the new floor position', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  await page.addInitScript(observeAndon);
  await goToLake(page, '&time=night');
  await page.waitForFunction(() => window.andonDraw?.light);
  const original = await page.evaluate(() => window.andonDraw);
  const hint = page.locator('.coast-grab-hint[role="status"]');
  const pickup = hint.filter({ hasText: /^F 行灯を掴む$/ });
  const release = hint.filter({ hasText: /^F 行灯を置く$/ });
  await withPointerLock(page, async () => {
    await page.keyboard.down('w');
    await page.waitForFunction(() => window.lakeProbe.camera.z < 1.75);
    await page.keyboard.up('w');
    await page.keyboard.down('d');
    await page.waitForFunction(() => window.lakeProbe.camera.x > 2.05);
    await page.keyboard.up('d');

    const eye = await page.evaluate(() => window.lakeProbe.camera);
    const dx = original.light[0] - eye.x;
    const dz = original.light[2] - eye.z;
    const yaw = -Math.atan2(dx, -dz);
    const pitch = Math.atan2(original.paper[1] - eye.y, Math.hypot(dx, dz));
    const centerPitch = Math.atan(-2 * LAKE_VIEW_VERTICAL_OFFSET * Math.tan(LAKE_VIEW_FOV * Math.PI / 360));
    await turn(page, -yaw / 0.0022, -pitch / 0.0022);
    assert.equal(await hint.isVisible(), false, 'aiming with the unshifted lens misses the paper');
    await turn(page, 0, centerPitch / 0.0022);
    await pickup.waitFor();
  });

  // F and the movement keys also work on the canvas after leaving mouse-look mode.
  await page.locator('canvas.coast-view').focus();
  await pickup.waitFor();
  await page.keyboard.down('f');
  await release.waitFor();
  await page.waitForFunction(previous => window.andonDraw.paper[1] > previous + 0.3, original.paper[1]);
  await page.keyboard.down('f');
  await page.keyboard.down('d');
  const startX = await page.evaluate(() => window.lakeProbe.camera.x);
  await page.waitForFunction(x => window.lakeProbe.camera.x > x + 0.9, startX);
  await page.keyboard.up('d');
  assert.equal(await release.isVisible(), true, 'a repeat keydown does not put down the andon');
  await page.keyboard.up('f');
  const carried = await page.evaluate(() => window.andonDraw);
  assert.ok(carried.light[0] > original.light[0] + 0.65);
  assertLightFollowsPaper(carried);
  if (screenshots) await capture(page, 'lake-andon-carried');

  await page.keyboard.press('f');
  await release.waitFor({ state: 'hidden' });
  await page.waitForFunction(y => Math.abs(window.andonDraw.paper[1] - y) < 0.015, original.paper[1]);
  const placed = await page.evaluate(() => window.andonDraw);
  assert.ok(placed.light[0] > original.light[0] + 0.65, 'the andon is placed on the floor at its transported location');
  assertLightFollowsPaper(placed);
  if (screenshots) await capture(page, 'lake-andon-placed');
  const releaseX = await page.evaluate(() => window.lakeProbe.camera.x);
  await page.keyboard.down('d');
  await page.waitForFunction(x => window.lakeProbe.camera.x > x + 0.5, releaseX);
  await page.keyboard.up('d');
  await page.evaluate(() => { window.andonDraw = null; });
  await page.waitForFunction(() => window.andonDraw?.light);
  const afterWalk = await page.evaluate(() => window.andonDraw.light);
  assert.ok(Math.hypot(...afterWalk.map((value, i) => value - placed.light[i])) < 0.015);

  await action(page, '昼').click();
  await page.evaluate(() => {
    window.andonDraw = null;
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await page.evaluate(() => window.andonDraw), null, 'the paper and light are absent during the day');
  await action(page, '夜').click();
  await page.waitForFunction(() => window.andonDraw?.light);
  const restored = await page.evaluate(() => window.andonDraw);
  assert.ok(Math.hypot(...restored.light.map((value, i) => value - placed.light[i])) < 0.015);
  assertLightFollowsPaper(restored);
  assert.deepEqual(errors, []);
});

test('a failed lake scene load has a world-specific message and a recovery link', { timeout }, async t => {
  const { page } = await newPage(t);
  await page.route('**/assets/LakeWorld-*.js', route => route.abort());
  await page.goto(`${origin}/?world=lake`);
  await page.getByText('湖畔の広間を読み込めませんでした。ページを再読み込みしてください。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: '入り江と山道へ' }).getAttribute('href'), '?world=coast');
});

test('the indoor window bays and back wall bound walking, with time retained across worlds',
  { timeout }, async t => {
    const { page, errors } = await newPage(t);
    await goToLake(page);
    await walk(page, 'w', () => window.lakeProbe.camera.z < -1.1);
    assert.ok(Math.abs((await page.evaluate(() => window.lakeProbe.camera)).y - 1.65) < 0.04);
    for (const side of [
      { label: '西の窓辺', id: 'west-window', x: -18.7, key: 'a', wall: () => window.lakeProbe.camera.x < -21.2 },
      { label: '東の窓辺', id: 'east-window', x: 18.7, key: 'd', wall: () => window.lakeProbe.camera.x > 21.2 },
    ]) {
      await travel(page, '湖畔の広間', '広間の中央');
      await walk(page, side.key, side.wall, true);
      assert.ok(Math.abs(await page.evaluate(() => window.lakeProbe.camera.x)) <= 21.401);
      await travel(page, '湖畔の広間', side.label);
      await page.waitForURL(url => url.searchParams.get('place') === side.id);
      await page.waitForFunction(x => {
        const p = window.lakeProbe.camera;
        return Math.hypot(p.x - x, p.y - 1.65, p.z + 5.1) < 0.05;
      }, side.x);
      if (screenshots) await capture(page, `lake-${side.id}-day`);
      await walk(page, 'w', () => window.lakeProbe.camera.z < -5.83, true);
      assert.ok((await page.evaluate(() => window.lakeProbe.camera.z)) >= -6.001);
      if (screenshots) {
        await withPointerLock(page, async () => {
          await turn(page, 1428, -186);
          await capture(page, `lake-${side.id}-looking-back`);
          await turn(page, -1428, 186);
        });
      }
      await walk(page, 's', () => window.lakeProbe.camera.z > -3.9);
      const inside = await page.evaluate(() => window.lakeProbe.camera);
      assert.ok(Math.abs(inside.y - 1.65) < 0.04);
    }

    await travel(page, '湖畔の広間', '広間の中央');
    await walk(page, 's', () => window.lakeProbe.camera.z > 15.92, true);
    assert.ok((await page.evaluate(() => window.lakeProbe.camera.z)) <= 16.201);
    if (screenshots) {
      await capture(page, 'lake-hall-from-rear');
      await withPointerLock(page, async () => {
        await turn(page, 1071);
        await capture(page, 'lake-hall-rear-corner');
        await turn(page, -1071);
      });
    }

    await action(page, '夜').click();
    await travel(page, '丘陵展望台', '中央展望デッキ');
    await page.getByRole('heading', { name: '丘陵展望台', exact: true }).waitFor();
    assert.match(page.url(), /time=night/);
    await travel(page, '湖畔の広間', '広間の中央');
    await page.getByRole('heading', { name: '湖畔の広間', exact: true }).waitFor();
    assert.match(page.url(), /time=night/);
    assert.deepEqual(errors, []);
  });

test('a simulated XR viewer crosses the table footprint at standing height', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  await page.addInitScript(installSimulatedXR);
  await goToLake(page);
  await action(page, 'VRを開始').click();
  await page.waitForFunction(() => window.xrFixture.eyePoses[0] && window.xrFixture.eyePoses[320]);
  await page.evaluate(() => window.xrFixture.mutate({ side: 'left', axes: [0, -1] }));
  try {
    await page.waitForFunction(() => {
      const { eyePoses } = window.xrFixture;
      return (eyePoses[0].z + eyePoses[320].z) / 2 < -1.1;
    });
  } finally {
    await page.evaluate(() => window.xrFixture.mutate({ side: 'left', axes: [0, 0] }));
  }
  const height = await page.evaluate(() => {
    const { eyePoses } = window.xrFixture;
    return (eyePoses[0].y + eyePoses[320].y) / 2;
  });
  assert.ok(Math.abs(height - 1.65) < 0.05);
  await action(page, 'VRを終了').click();
  await page.waitForFunction(() => window.xrFixture.ends === 1);
  assert.deepEqual(errors, []);
});

test('Quest Touch Plus grips, carries and sets the night andon down in simulated XR', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  await page.addInitScript(installSimulatedXR);
  await page.addInitScript(observeAndon);
  await goToLake(page, '&time=night');
  await page.waitForFunction(() => window.andonDraw?.light);
  const original = await page.evaluate(() => window.andonDraw);
  const [x, floorLightY, z] = original.light;
  const change = value => page.evaluate(input => window.xrFixture.mutate(input), value);
  const read = () => page.evaluate(() => {
    const { eyePoses } = window.xrFixture;
    return { andon: window.andonDraw, eyeX: (eyePoses[0].x + eyePoses[320].x) / 2 };
  });
  const gripPose = ([worldX, y, worldZ], walkedX = 0) => ({
    position: { x: worldX - walkedX, y, z: worldZ - LAKE_SPAWN.z },
  });
  const aimPose = (origin, destination, walkedX = 0) => ({
    ...gripPose(origin, walkedX), orientation: controllerAim(origin, destination),
  });
  const assertLightAt = (snapshot, expected, message) => {
    assertLightFollowsPaper(snapshot.andon);
    const distance = Math.hypot(...snapshot.andon.light.map((value, i) => value - expected[i]));
    assert.ok(distance < 0.035, `${message} (distance ${distance.toFixed(3)} m)`);
  };
  const toggleMenu = async () => {
    await change({ side: 'left', button: 4, pressed: true });
    await change({ side: 'left', button: 4, pressed: false });
  };

  await action(page, 'VRを開始').click();
  await page.waitForFunction(() => window.xrFixture.eyePoses[0] && window.xrFixture.eyePoses[320]);
  const head = { x, z: z + 1.57 - LAKE_SPAWN.z, pitch: Math.atan2(original.paper[1] - 1.65, 1.57) };
  await change({ head });
  const reach = [x + 0.21, 0.84, z + 0.72];
  await change({ side: 'right', gripSpace: gripPose([x + 0.12, 0.88, z + 0.60]),
    targetRaySpace: aimPose(reach, [x + 0.4, 1, z]), squeeze: true });
  assertLightAt(await read(), original.light, 'head aim alone cannot grab the andon');
  await change({ side: 'right', squeeze: false });

  await change({ head: { x: x - 0.42 }, side: 'right', targetRaySpace: aimPose(reach, original.light) });
  await page.waitForFunction(() => window.xrFixture.hint?.includes('行灯を掴む'));
  await change({ select: true });
  await change({});
  assertLightAt(await read(), original.light, 'the index trigger leaves the andon on the floor');
  await toggleMenu();
  await page.waitForFunction(() => window.xrFixture.menuTitle === 'ファストトラベル');
  await change({ side: 'right', squeeze: true });
  assertLightAt(await read(), original.light, 'the open menu blocks a grip');
  await change({ side: 'right', squeeze: false });
  await toggleMenu();

  await change({ side: 'right', squeeze: true });
  await page.waitForFunction(() => window.xrFixture.hint?.includes('行灯を置く'));
  const grip = [x + 0.40, 1.10, z + 0.50];
  const gripSpace = gripPose(grip);
  gripSpace.orientation = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  await change({ side: 'right', gripSpace });
  const carried = await read();
  // The light is 20.5 cm above the base and the handle is about 47 cm above it.
  const heldLight = [grip[0], grip[1] - 0.47 + floorLightY, grip[2]];
  assertLightAt(carried, heldLight, 'the upright andon follows the grip pose');
  const otherGrip = [grip[0] - 0.27, 1.02, grip[2] + 0.18];
  await change({ side: 'left', gripSpace: gripPose(otherGrip),
    targetRaySpace: aimPose(otherGrip, heldLight), squeeze: true });
  assertLightAt(await read(), heldLight, 'the second hand does not take over the held andon');
  await change({ side: 'left', squeeze: false });
  assertLightAt(await read(), heldLight, 'releasing the other hand leaves the original grip holding the andon');
  await change({ head: { x: x - 0.28 } });
  const beforeWalk = await read();
  assertLightAt(beforeWalk, heldLight, 'moving the head does not move the held andon');

  await change({ side: 'left', axes: [1, 0], frames: 0 });
  try {
    await page.waitForFunction(eyeX => window.xrFixture.eyePoses[0].x > eyeX + 0.42, beforeWalk.eyeX);
  } finally {
    await change({ side: 'left', axes: [0, 0] });
  }
  const afterWalk = await read();
  const walkedX = afterWalk.eyeX - beforeWalk.eyeX;
  assertLightAt(afterWalk, [heldLight[0] + walkedX, heldLight[1], heldLight[2]], 'the held light moves with the walking rig');
  await change({ side: 'right', squeeze: false });
  const floor = [afterWalk.andon.light[0], floorLightY, afterWalk.andon.light[2]];
  assertLightAt(await read(), floor, 'releasing the grip leaves the andon on the floor below the hand');
  await change({ side: 'right', gripSpace: gripPose([x + 0.64, 0.88, z + 0.75], walkedX) });
  assertLightAt(await read(), floor, 'the placed andon remains fixed when the right hand moves away');

  const leftReach = [floor[0] - 0.14, 0.86, floor[2] + 0.62];
  await change({ side: 'left', gripSpace: gripPose(leftReach, walkedX),
    targetRaySpace: aimPose(leftReach, floor, walkedX), squeeze: true });
  assertLightAt(await read(), [leftReach[0], leftReach[1] - 0.47 + floorLightY, leftReach[2]],
    'the left grip can pick up the placed andon');
  await change({ side: 'left', gripSpace: { tracked: false } });
  const dropped = [leftReach[0], floorLightY, leftReach[2]];
  assertLightAt(await read(), dropped, 'losing grip tracking sets the andon down');
  await change({ side: 'left', gripSpace: { ...gripPose(leftReach, walkedX), tracked: true } });
  assertLightAt(await read(), dropped, 'regaining tracking does not re-grab with the grip still pressed');
  await change({ side: 'left', squeeze: false });

  await action(page, '昼').click();
  await page.waitForURL(url => url.searchParams.get('time') === 'day');
  await page.evaluate(() => { window.andonDraw = null; });
  await change({ side: 'left', targetRaySpace: aimPose(leftReach, dropped, walkedX), squeeze: true });
  assert.equal(await page.evaluate(() => window.andonDraw), null, 'a daytime grip cannot bring the andon into view');
  await change({ side: 'left', squeeze: false });
  await action(page, '夜').click();
  await page.waitForFunction(() => window.andonDraw?.light);
  assertLightAt(await read(), dropped, 'the andon returns at the same floor position at night');

  await action(page, 'VRを終了').click();
  await page.waitForFunction(() => window.xrFixture.ends === 1);
  assert.deepEqual(errors, []);
});

test('a disconnected floating monitor in front of the andon takes the simulated Quest grip', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  await page.addInitScript(installSimulatedXR);
  await page.addInitScript(observeAndon);
  await goToLake(page, '&time=night');
  await page.waitForFunction(() => window.andonDraw?.light);
  await walk(page, 'w', () => window.lakeProbe.camera.z < 4.34);
  await walk(page, 'd', () => window.lakeProbe.camera.x > 2.07);
  const camera = await page.evaluate(() => window.lakeProbe.camera);
  const panel = action(page, '仮想モニター');
  await panel.click();
  await action(page, 'モニターを表示').click();
  await panel.click();
  await action(page, 'VRを開始').click();
  await page.waitForFunction(() => window.xrFixture.eyePoses[0] && window.xrFixture.eyePoses[320]);
  const change = value => page.evaluate(input => window.xrFixture.mutate(input), value);
  await change({ head: { z: -2.22, pitch: -0.55 } });
  const read = () => page.evaluate(() => ({ monitor: window.floatingMonitorDraw, light: window.andonDraw?.light }));
  await page.waitForFunction(() => window.floatingMonitorDraw && window.andonDraw?.light);
  const start = await read();
  const [x, y, z] = start.light;
  assert.ok(start.monitor[2] > z + 0.5, 'the monitor is rendered in front of the andon');
  const target = [x - camera.x, y, z - camera.z];
  const origin = [x - camera.x, 1.30, start.monitor[2] + 0.30 - camera.z];
  const [handX, handY, handZ] = origin;
  const aim = { position: { x: handX, y: handY, z: handZ }, orientation: controllerAim(origin, target) };
  const travelX = 0.72;
  await change({ side: 'right', gripSpace: { position: aim.position }, targetRaySpace: aim, squeeze: true });
  await change({ side: 'right', gripSpace: { position: { x: handX + travelX } } });
  const dragged = await read();
  const distance = (from, to) => Math.hypot(...from.map((value, i) => value - to[i]));
  const movedMonitor = [start.monitor[0] + travelX, start.monitor[1], start.monitor[2]];
  assert.ok(distance(dragged.monitor, movedMonitor) < 0.035, 'the rendered monitor follows the squeezing hand');
  assert.ok(distance(dragged.light, start.light) < 0.035, 'the lamp behind the monitor stays on the floor');
  await change({ side: 'right', squeeze: false });
  await action(page, 'VRを終了').click();
  await page.waitForFunction(() => window.xrFixture.ends === 1);
  assert.deepEqual(errors, []);
});

test('lake ambience reaches the output and follows the simulated XR listener', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  await page.addInitScript(installSimulatedXR);
  await page.addInitScript(observeOutput);
  await goToLake(page, '&place=west-window');
  await action(page, '環境音をオン').click();
  await page.waitForFunction(() => window.lakeAudioProbe.peak() > 0.00005);
  await page.locator('.coast-sound-details > summary').click();
  assert.ok(await page.getByRole('slider', { name: '水音', exact: true }).isVisible());
  assert.ok(await page.getByRole('slider', { name: '鳥の声', exact: true }).isVisible());
  await page.locator('.coast-sound-details > summary').click();
  await action(page, 'VRを開始').click();
  await page.waitForFunction(() => window.xrFixture.xrDraws > 0
    && Boolean(window.xrFixture.eyePoses[0]) && Boolean(window.xrFixture.eyePoses[320]));
  const start = await page.evaluate(() => {
    const left = window.xrFixture.eyePoses[0];
    const right = window.xrFixture.eyePoses[320];
    return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, z: (left.z + right.z) / 2 };
  });
  assert.ok(Math.hypot(start.x + 18.7, start.y - 1.65, start.z + 5.1) < 0.06);
  await page.evaluate(() => window.xrFixture.mutate({ head: { yaw: 0.65 }, frames: 6 }));
  await page.waitForFunction(() => Math.abs(window.lakeAudioProbe.context.listener.forwardX.value) > 0.30);
  const desktopDraws = await page.evaluate(() => window.xrFixture.desktopDraws);
  await action(page, 'VRを終了').click();
  await page.waitForFunction(previous => window.xrFixture.ends === 1
    && window.xrFixture.desktopDraws > previous, desktopDraws);
  assert.equal(await page.evaluate(() => window.xrFixture.strayDraws), 0);
  await action(page, '環境音をオフ').click();
  await page.waitForFunction(() => window.lakeAudioProbe.peak() < 0.00002);
  assert.deepEqual(errors, []);
});
