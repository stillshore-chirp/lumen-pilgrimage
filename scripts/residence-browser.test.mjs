import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { registry as playwrightRegistry } from 'playwright-core/lib/coreBundle';
import { basename, dirname, join } from 'node:path';
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
let browserServer;
let ownedBrowserProcess;
const ownedLaunchChildren = [];
let origin;
let nativeStartedAt;
let launchEvidence;
const pageEvidence = new WeakMap();
const buildManifest = process.env.RESIDENCE_BUILD_MANIFEST
  ? JSON.parse(await readFile(process.env.RESIDENCE_BUILD_MANIFEST, 'utf8')) : null;
const sha256 = value => createHash('sha256').update(value).digest('hex');
async function withDeadline(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Residence browser operation exceeded its deadline')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
function waitForOwnedExit(child, milliseconds) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const exited = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.off('exit', exited); resolve(false); }, milliseconds);
    child.once('exit', exited);
  });
}


// Wrap declared Playwright API roles, independent of bundled/minified constructor names.
function createApiGuard(bounded) {
  const proxies = new WeakMap();
  const protectedApiObjects = new WeakMap();
  const locatorMethods = new Set(['locator', 'getByRole', 'getByLabel', 'getByText', 'getByPlaceholder', 'getByTestId', 'getByTitle', 'getByAltText']);
  const returns = {
    Browser: { newContext: 'BrowserContext', newPage: 'Page', newBrowserCDPSession: 'CDPSession' },
    BrowserContext: { newPage: 'Page', browser: 'Browser' },
    Page: { context: 'BrowserContext', mainFrame: 'Frame', frame: 'Frame', waitForFunction: 'JSHandle' },
    Frame: { page: 'Page', waitForFunction: 'JSHandle' },
    Locator: { first: 'Locator', last: 'Locator', nth: 'Locator', filter: 'Locator', and: 'Locator', or: 'Locator' },
    Route: { fetch: 'APIResponse', request: 'Request' },
    Response: { request: 'Request', frame: 'Frame' },
    Request: { frame: 'Frame' },
    JSHandle: { asElement: 'ElementHandle', getProperty: 'JSHandle' },
  };
  function protect(value, role) {
    if (!value || typeof value !== 'object' || !role) return value;
    if (proxies.has(value)) return proxies.get(value);
    const proxy = new Proxy(value, { get(target, name) {
      const member = Reflect.get(target, name, target);
      if (typeof member !== 'function') {
        const propertyRole = role === 'Page' ? { keyboard: 'Keyboard', mouse: 'Mouse', touchscreen: 'Touchscreen' }[name] : null;
        return protect(member, propertyRole);
      }
      return (...args) => {
        const resultRole = locatorMethods.has(String(name)) && ['Page', 'Frame', 'Locator'].includes(role)
          ? 'Locator' : returns[role]?.[name];
        const convert = result => name === 'all' && role === 'Locator' && Array.isArray(result)
          ? result.map(item => protect(item, 'Locator')) : protect(result, resultRole);
        const result = member.apply(target, args);
        if (result && typeof result.then === 'function') {
          const isWait = ['waitFor', 'waitForFunction', 'waitForURL', 'waitForLoadState'].includes(String(name));
          const limit = name === 'close' ? 5000 : isWait ? 140000 : name === 'evaluate' ? 15000 : 20000;
          return bounded(`${role}.${String(name)}`, () => result, limit).then(convert);
        }
        return convert(result);
      };
    } });
    proxies.set(value, proxy);
    protectedApiObjects.set(proxy, role);
    return proxy;
  }
  return { protect, protectedApiObjects };
}

const { protect: protectApi, protectedApiObjects } = createApiGuard((label, operation, milliseconds) =>
  withDeadline(Promise.resolve().then(operation), milliseconds));

const spatialCaseNames = new Set([
  'the residence menu opens individual controls and keeps remote and wall controls in sync',
  'the residence remote directory keeps its bounds when changing equipment categories',
  'the residence plan selects real rooms and keeps the individual device location visible',
]);

before(async () => {
  const channel = process.env.COAST_CHROME_CHANNEL || 'chromium';
  const registered = playwrightRegistry.registry.findExecutable(channel);
  assert.ok(registered, 'The requested Playwright Chromium channel must resolve before loading the product');
  const executablePath = await realpath(registered.executablePathOrDie('javascript'));
  const require = createRequire(import.meta.url);
  const browserMetadata = JSON.parse(await readFile(join(dirname(require.resolve('playwright-core/package.json')), 'browsers.json'), 'utf8'));
  const expectedVersion = channel === 'chromium'
    ? browserMetadata.browsers.find(entry => entry.name === 'chromium')?.browserVersion : null;
  const args = ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
  launchEvidence = { requestedChannel: channel, profile: channel === 'chromium' ? 'playwright-bundled' : 'explicit-channel',
    expectedVersion, requestedFlags: args };

  // Capture only children spawned by this owned launch, before launch readiness can stall.
  const spawn = childProcess.spawn;
  childProcess.spawn = function (...parameters) {
    const child = spawn.apply(this, parameters);
    if (child.pid) ownedLaunchChildren.push(child);
    return child;
  };
  syncBuiltinESMExports();
  try {
    browserServer = await withDeadline(chromium.launchServer({ executablePath, headless: true,
      host: '127.0.0.1', args }), 30000);
  } finally {
    childProcess.spawn = spawn;
    syncBuiltinESMExports();
  }
  ownedBrowserProcess = browserServer.process();
  nativeStartedAt = new Date().toISOString();
  const actualPath = await realpath(ownedBrowserProcess.spawnfile);
  Object.assign(launchEvidence, { browserPid: ownedBrowserProcess.pid, executableName: basename(actualPath),
    executableMatches: actualPath === executablePath, executablePathHash: sha256(actualPath),
    allowedFlags: args.filter(argument => ownedBrowserProcess.spawnargs.includes(argument)),
    headless: ownedBrowserProcess.spawnargs.some(argument => argument === '--headless' || argument.startsWith('--headless=')) });
  browser = await withDeadline(chromium.connect(browserServer.wsEndpoint()), 10000);
  launchEvidence.version = browser.version();
  launchEvidence.versionMatches = expectedVersion ? browser.version() === expectedVersion : null;
  assert.ok(launchEvidence.executableMatches && (!expectedVersion || launchEvidence.versionMatches),
    'The actual browser executable or bundled version differs from the selected profile');
  assert.ok(args.every(argument => launchEvidence.allowedFlags.includes(argument)) && launchEvidence.headless,
    'The actual browser flags differ from the selected profile');

  // Validate the browser profile before starting the heavier product page.
  server = await withDeadline(preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } }), 10000);
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  if (screenshots) {
    await mkdir(screenshots, { recursive: true });
    await writeFile(join(screenshots, 'native-owner.json'), JSON.stringify({
      owner: 'residence-browser', pid: process.pid, browserPid: ownedBrowserProcess.pid, origin,
      startedAt: nativeStartedAt, status: 'validated', launch: launchEvidence,
    }, null, 2));
  }
}, { timeout });

after(async () => {
  await withDeadline(browser?.close() ?? Promise.resolve(), 5000).catch(() => {});
  await withDeadline(browserServer?.close() ?? Promise.resolve(), 5000).catch(() => {});
  const children = [...new Set([...ownedLaunchChildren, ownedBrowserProcess].filter(Boolean))];
  const forced = [];
  for (const child of children) {
    if (await waitForOwnedExit(child, 500)) continue;
    child.kill('SIGTERM'); forced.push({ pid: child.pid, signal: 'SIGTERM' });
    if (!await waitForOwnedExit(child, 1000)) {
      child.kill('SIGKILL'); forced.push({ pid: child.pid, signal: 'SIGKILL' });
      await waitForOwnedExit(child, 1000);
    }
  }
  const browserClosed = children.every(child => child.exitCode !== null || child.signalCode !== null);
  let previewClosed = !server;
  if (server) {
    try { await withDeadline(server.close(), 3000); previewClosed = true; }
    catch {
      server.httpServer.closeAllConnections();
      try { await withDeadline(server.close(), 3000); previewClosed = true; } catch { /* recorded below */ }
    }
  }
  if (screenshots && nativeStartedAt) await writeFile(join(screenshots, 'native-owner.json'), JSON.stringify({
    owner: 'residence-browser', pid: process.pid, browserPid: ownedBrowserProcess?.pid, origin, startedAt: nativeStartedAt,
    endedAt: new Date().toISOString(), status: browserClosed && previewClosed ? 'closed' : 'cleanup-incomplete',
    browserClosed, previewClosed, forced, launch: launchEvidence,
  }, null, 2));
  assert.ok(browserClosed && previewClosed, 'The residence browser resources did not finish closing');
}, { timeout: 30_000 });

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
  (function installResidenceAudioGraphObserver() {
    const probe = window.residenceProbe;
    const edges = new WeakMap();
    const connect = AudioNode.prototype.connect;
    const disconnect = AudioNode.prototype.disconnect;
    probe.firstFilters = start => {
      const filters = new Set();
      const visited = new Set();
      const pending = [[start, 0]];
      while (pending.length) {
        const [node, depth] = pending.shift();
        if (visited.has(node) || depth > 8) continue;
        visited.add(node);
        if (node instanceof BiquadFilterNode) {
          filters.add(node);
          continue;
        }
        for (const target of edges.get(node) ?? []) {
          if (target instanceof AudioNode) pending.push([target, depth + 1]);
        }
      }
      return [...filters];
    };
    AudioNode.prototype.connect = function (destination, ...args) {
      const result = connect.call(this, destination, ...args);
      let targets = edges.get(this);
      if (!targets) edges.set(this, targets = new Set());
      targets.add(destination);
      if (this instanceof AudioBufferSourceNode && this.loop) {
        for (const filter of probe.firstFilters(destination)) probe.trafficFilters.add(filter);
      }
      return result;
    };
    AudioNode.prototype.disconnect = function (...args) {
      const result = disconnect.apply(this, args);
      if (args.length === 0) edges.delete(this);
      else if (args[0] instanceof AudioNode) edges.get(this)?.delete(args[0]);
      return result;
    };
  })();
}

function observeResidenceCamera() {
  window.residenceProbe = { camera: null };
  const gl = WebGL2RenderingContext.prototype;
  const locations = new WeakSet();
  const locate = gl.getUniformLocation;
  gl.getUniformLocation = function (program, name) {
    const location = locate.call(this, program, name);
    if (location && name === 'cameraPosition') locations.add(location);
    return location;
  };
  const write = gl.uniform3f;
  gl.uniform3f = function (location, x, y, z) {
    if (locations.has(location)) window.residenceProbe.camera = { x, y, z };
    return write.call(this, location, x, y, z);
  };
}

async function createPage(t) {
  const spatialCase = spatialCaseNames.has(t.name);
  const rawPage = await withDeadline(browser.newPage({ viewport }), 15000);
  const page = spatialCase ? protectApi(rawPage, 'Page') : rawPage;
  if (spatialCase) assert.equal(protectedApiObjects.get(page.locator('html')), 'Locator');
  const evidence = { case: t.name, mode: 'acceptance', spatialCase,
    launch: launchEvidence, errors: [], failedRequests: [], bundles: [], pending: [] };
  pageEvidence.set(page, evidence);
  if (screenshots) {
    page.on('requestfailed', request => evidence.failedRequests.push({
      path: new URL(request.url()).pathname, failure: request.failure()?.errorText,
    }));
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (!path.startsWith('/assets/') || !path.endsWith('.js')) return;
      const pending = response.body().then(body => {
        const expected = buildManifest?.artifacts?.[`dist${path}`];
        evidence.bundles.push({ path, status: response.status(), sha256: sha256(body),
          matchesBuild: expected ? sha256(body) === expected : null,
          instrumented: path.includes('CoastApp-') && evidence.originalBundle !== undefined,
          matchesObservation: evidence.observationBundle?.path === path ? sha256(body) === evidence.observationBundle.sha256 : null });
      }).catch(() => { evidence.bundles.push({ path, status: response.status(), bodyUnavailable: true }); });
      evidence.pending.push(pending);
    });
  }
  t.after(async () => {
    if (screenshots && !page.isClosed()) {
      await Promise.race([Promise.allSettled(evidence.pending), new Promise(resolve => setTimeout(resolve, 1000))]);
      evidence.page = await withDeadline(page.evaluate(() => {
        const canvas = document.querySelector('canvas.coast-view');
        const gl = canvas?.getContext('webgl2');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        return { path: location.pathname, world: new URL(location.href).searchParams.get('world'),
          headings: [...document.querySelectorAll('h1,h2')].map(element => element.textContent),
          statuses: [...document.querySelectorAll('[role="status"], [role="alert"]')].map(element => element.textContent),
          appCanvas: !!canvas, glAvailable: !!gl, rendererSource: canvas ? 'app-canvas' : 'not-reached',
          renderer: gl ? gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) : null,
          sceneReached: !!window.residenceProbe?.scene?.isScene,
          controlHandlesReached: !!window.residenceProbe?.controls?.some(section => section.id === 'kitchen-tap') };
      }), 3000).catch(() => ({ diagnosticUnavailable: 'deadline-or-page-closed' }));
      const { pending, ...record } = evidence;
      const name = t.name.replace(/[^a-zA-Z0-9]+/g, '-');
      await writeFile(join(screenshots, `${name}-diagnostic.json`), JSON.stringify(record, null, 2));
      await withDeadline(page.screenshot({ path: join(screenshots, `${name}-final.png`), timeout: 2000 }), 2500).catch(() => {});
    }
    await withDeadline(page.close(), 5000);
  }, { timeout: 15_000 });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); evidence.errors.push({ kind: 'pageerror', name: error.name, message: error.message }); });
  page.on('console', message => {
    if (message.type() === 'error') { errors.push(message.text()); evidence.errors.push({ kind: 'console', message: message.text() }); }
  });
  await page.addInitScript(spatialCase ? observeResidenceCamera : observeResidence);
  return { page, errors };
}

async function openResidence(t, place = '', inspect = false) {
  const { page, errors } = await createPage(t);
  if (inspect) await exposeResidenceScene(page);
  const address = new URL('/?world=residence', origin);
  if (place) address.searchParams.set('place', place);
  const started = Date.now();
  const remaining = () => Math.max(1, 60000 - (Date.now() - started));
  await withDeadline(page.goto(address.href, { waitUntil: 'commit', timeout: 20000 }), 22000);
  await withDeadline(page.getByRole('heading', { name: residenceHeading, exact: true }).waitFor({ timeout: remaining() }), remaining() + 1000);
  await withDeadline(page.bringToFront(), 5000);
  await withDeadline(page.waitForFunction(() => document.hasFocus() && window.residenceProbe.camera, null,
    { timeout: remaining() }), remaining() + 1000);
  const evidence = pageEvidence.get(page);
  if (evidence?.spatialCase) {
    evidence.setup = await withDeadline(page.evaluate(() => {
      const canvas = document.querySelector('canvas.coast-view');
      const gl = canvas?.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return { camera: window.residenceProbe.camera,
        raster: canvas ? { css: [canvas.clientWidth, canvas.clientHeight], buffer: [canvas.width, canvas.height], dpr: devicePixelRatio } : null,
        renderer: gl ? gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) : null };
    }), 3000);
    assert.ok(evidence.setup.raster && evidence.setup.renderer, 'The spatial UI cases must reach the actual application renderer');
    await page.setViewportSize({ width: 960, height: 600 });
  }
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
  await page.route('**/assets/CoastApp-*.js', async rawRoute => {
    const route = protectApi(rawRoute, 'Route');
    const response = await route.fetch();
    const source = await response.text();
    const path = new URL(route.request().url()).pathname;
    const evidence = pageEvidence.get(page);
    if (evidence) evidence.originalBundle = { path, sha256: sha256(source),
      matchesBuild: buildManifest?.artifacts?.[`dist${path}`] === sha256(source) };
    const prepare = 'this.world.prepareRender?.(';
    assert.ok(source.includes(prepare), 'The residence test hook requires exploration render preparation');
    const hook = 'window.residenceProbe.scene=this.world.scene,'
      + 'window.residenceProbe.controls=this.residenceControls,'
      + (evidence?.spatialCase ? '' : 'window.residenceProbe.relocate??=(pose=>this.controls.relocate(pose)),');
    const body = source.replace(prepare, hook + prepare);
    if (evidence) evidence.observationBundle = { path, sha256: sha256(body),
      modification: 'scene/control reference exposure only' };
    await route.fulfill({ response, body });
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
    const channels = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      channels[0] += r;
      channels[1] += g;
      channels[2] += b;
      colors.add((r << 16) | (g << 8) | b);
    }
    const rgb = channels.map(channel => channel / (pixels.length / 4));
    resolve({ mean: (rgb[0] + rgb[1] + rgb[2]) / 3, colors: colors.size, rgb });
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

test('the night residence preserves oak grain, speaker contours and the unlit screen color', { timeout }, async t => {
  const { page, errors } = await createPage(t);
  await exposeResidenceScene(page);
  await page.goto(`${origin}/?world=residence&place=living-theater&time=night`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.residenceProbe.relocate && window.residenceProbe.scene?.children.length > 0);
  await button(page, '高品質').click();
  const canvas = page.locator('canvas.coast-view');
  const relocate = async (x, z, yaw, pitch) => {
    await page.evaluate(pose => window.residenceProbe.relocate(pose), { x, z, yaw, pitch });
    await page.waitForFunction(({ x, z }) => {
      const pose = window.residenceProbe.camera;
      return pose && Math.hypot(pose.x - x, pose.z - z) < .02;
    }, { x, z });
  };
  await relocate(21.25, -2.37, .41, -.15);
  const floorArea = [385 / 768, 358 / 480, 125 / 768, 38 / 480];
  const oakAtNight = await brightness(canvas, floorArea);
  const [red, green, blue] = oakAtNight.rgb;
  assert.ok(red > green && green > blue && blue >= 29, `Warm oak with distinct blue-channel detail: ${JSON.stringify(oakAtNight)}`);
  assert.ok(oakAtNight.colors > 35, 'the wood retains visible texture');
  await button(page, '昼').click();
  const oakByDay = await brightness(canvas, floorArea);
  assert.ok(oakByDay.mean > oakAtNight.mean + 15, 'day and night keep visibly different floor lighting');
  await button(page, '夜').click();

  await relocate(21.25, -4.21, -.28, -.23);
  const cone = await brightness(canvas, [412 / 768, 177 / 480, 35 / 768, 24 / 480]);
  const casing = await brightness(canvas, [406 / 768, 151 / 480, 41 / 768, 13 / 480]);
  const screen = await brightness(canvas, [80 / 768, 78 / 480, 169 / 768, 144 / 480]);
  const buildings = await brightness(canvas, [552 / 768, 226 / 480, 204 / 768, 152 / 480]);
  assert.ok(cone.mean > casing.mean + 14 && cone.mean < 36,
    `The speaker cone is visible while its enclosure stays dark: ${JSON.stringify({ cone, casing })}`);
  assert.ok(screen.rgb.every((channel, index) => Math.abs(channel - [17, 23, 27][index]) <= 1),
    `The screen keeps its fixed sRGB color: ${JSON.stringify(screen.rgb)}`);
  assert.ok(buildings.mean > 29 && buildings.colors > 40, 'facades and window lights are visible through the east window');
  assert.deepEqual(errors, []);
});

test('C crouches and stands at the living-room window and fast travel restores standing', { timeout }, async t => {
  const { page, errors } = await openResidence(t);
  const mode = page.locator('.coast-mode');
  const spawn = await camera(page);
  assert.ok(Math.abs(spawn.y - 1.65) < 0.001);
  await capture(page, 'residence-south-window-standing');

  await page.keyboard.press('c');
  await page.waitForFunction(() => Math.abs(window.residenceProbe.camera.y - 1.15) < 0.001);
  const crouched = await camera(page);
  assert.deepEqual([crouched.x, crouched.z], [spawn.x, spawn.z]);
  assert.equal(await mode.textContent(), 'しゃがみ');
  await capture(page, 'residence-south-window-crouched');
  await page.keyboard.press('c');
  await page.waitForFunction(() => Math.abs(window.residenceProbe.camera.y - 1.65) < 0.001);
  assert.deepEqual(await camera(page), spawn);
  assert.equal(await mode.textContent(), '歩行');

  await page.keyboard.press('t');
  const dialog = page.getByRole('dialog', { name: 'ファストトラベル' });
  await dialog.waitFor();
  await page.keyboard.press('c');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await camera(page), spawn);
  assert.equal(await mode.textContent(), '歩行');

  await page.keyboard.press('c');
  await page.waitForFunction(() => Math.abs(window.residenceProbe.camera.y - 1.15) < 0.001);
  await hold(page, 'd', () => page.waitForFunction(x => window.residenceProbe.camera.x < x - 0.7, spawn.x));
  assert.ok(Math.abs((await camera(page)).y - 1.15) < 0.001);
  await travel(page, 'リビング南窓', 'residence', 'living-window', 'night');
  await page.waitForFunction(() => Math.abs(window.residenceProbe.camera.y - 1.65) < 0.001);
  assert.deepEqual(await camera(page), spawn);
  assert.equal(await mode.textContent(), '歩行');
  assert.deepEqual(errors, []);
});

test('the residence jumps and flies within the living room ceiling and windows', { timeout }, async t => {
  const { page, errors } = await openResidence(t);
  const mode = page.locator('.coast-mode');
  const flight = button(page, '自由飛行');
  const start = await camera(page);
  assert.equal(await flight.getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Space');
  await page.waitForFunction(y => window.residenceProbe.camera.y > y + .35, start.y);
  await page.waitForFunction(y => Math.abs(window.residenceProbe.camera.y - y) < .01, start.y);

  await page.keyboard.press('f');
  assert.equal(await mode.textContent(), '自由飛行');
  assert.equal(await flight.getAttribute('aria-pressed'), 'true');
  await hold(page, 'Space', () => page.waitForFunction(() => window.residenceProbe.camera.y > 2.74));
  assert.ok((await camera(page)).y < 2.76);

  await hold(page, 'w', async () => {
    await page.waitForFunction(() => window.residenceProbe.camera.z > -.75);
    await moreMovementFrames(page);
  });
  const byWindow = await camera(page);
  assert.ok(byWindow.z < -.35 && byWindow.y < 2.76, JSON.stringify(byWindow));
  await flight.click();
  assert.equal(await flight.getAttribute('aria-pressed'), 'false');
  await page.waitForFunction(y => Math.abs(window.residenceProbe.camera.y - y) < .01, start.y);
  const landed = await camera(page);
  assert.ok(Math.hypot(landed.x - byWindow.x, landed.z - byWindow.z) < .01);
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

test('world lighting changes every room and restores the residence light settings', { timeout }, async t => {
  const { page, errors } = await openResidence(t, 'living-theater');
  const lights = page.getByRole('group', { name: 'ワールド照明' });
  const on = button(lights, '一括点灯');
  const off = button(lights, '一括消灯');
  const automatic = button(lights, '既定');
  const canvas = page.locator('canvas.coast-view');
  const landscape = '.coast-ui { visibility: hidden; }';
  const room = await openResidenceDevice(page, '照明', 'リビング・ダイニング');
  const west = button(room, 'ペンダント灯（西）');
  const east = button(room, 'ペンダント灯（東）');
  const theater = button(room, 'シアター照明');
  await west.click();
  await page.keyboard.press('Escape');
  await on.click();
  const lit = await brightness(canvas, [.20, .18, .60, .67]);
  await capture(page, 'residence-world-light-on', landscape);
  await off.click();
  const dark = await brightness(canvas, [.20, .18, .60, .67]);
  await capture(page, 'residence-world-light-off', landscape);
  assert.ok(lit.mean - dark.mean > 6, `Living room light: ${dark.mean} → ${lit.mean}`);
  t.diagnostic(`Living room light ${dark.mean.toFixed(1)} → ${lit.mean.toFixed(1)}`);
  await openResidenceDevice(page, '照明', 'リビング・ダイニング');
  for (const fixture of [west, east, theater]) assert.equal(await fixture.getAttribute('aria-pressed'), 'false');
  await east.click();
  assert.equal(await east.getAttribute('aria-pressed'), 'true');
  assert.equal(await west.getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Escape');
  await lights.locator('button[aria-pressed="true"]').waitFor({ state: 'hidden' });

  await button(page, '昼').click();
  const study = await openResidenceDevice(page, '照明', '書斎05');
  assert.equal(await button(study, 'デスクライト').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Escape');
  await on.click();
  await openResidenceDevice(page, '照明', '書斎05');
  assert.equal(await button(study, 'デスクライト').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');

  await button(page, '夜').click();
  await automatic.click();
  await openResidenceDevice(page, '照明', 'リビング・ダイニング');
  assert.equal(await west.getAttribute('aria-pressed'), 'false');
  assert.equal(await east.getAttribute('aria-pressed'), 'true');
  assert.equal(await theater.getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 375, height: 710 });
  await off.click();
  assert.equal(await off.getAttribute('aria-pressed'), 'true');
  assert.ok(await lights.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await capture(page, 'residence-world-light-mobile');
  assert.deepEqual(errors, []);
});

test('the residence remote directory keeps its bounds when changing equipment categories', { timeout }, async t => {
  const { page, errors } = await openResidence(t);
  const directory = residenceDialog(page, '住戸の遠隔操作');
  const categoryNames = ['照明', 'カーテン', '家電・水栓'];
  const tab = name => button(directory, name);
  const choices = name => directory.getByRole('region', { name, exact: true });
  const listViewport = name => choices(name).locator('.residence-control-list-viewport:not([inert])');
  await button(page, 'メニュー').click();
  await button(residenceDialog(page, 'メニュー'), '住戸の遠隔操作').click();

  let bounds;
  const shortViewport = { width: 320, height: 300 };
  for (const size of [{ width: 960, height: 600 }, { width: 375, height: 710 }, shortViewport]) {
    await page.setViewportSize(size);
    const categoryBounds = [];
    const listGaps = [];
    for (const [index, name] of categoryNames.entries()) {
      await tab(name).click();
      assert.equal(await tab(name).getAttribute('aria-pressed'), 'true');
      assert.equal(await directory.getByRole('button', { pressed: true }).count(), 1);
      assert.equal(await directory.getByRole('region').count(), 1, 'Only the selected equipment list is exposed');
      const list = choices(name);
      const bottom = element => element.getBoundingClientRect().bottom;
      listGaps.push(await list.evaluate(bottom) - await list.getByRole('button').last().evaluate(bottom));
      categoryBounds.push(await directory.boundingBox());
      if (size !== shortViewport) assert.ok(await listViewport(name).evaluate(element => element.clientHeight > 0),
        'The selected equipment list retains its own usable viewport beside the plan');
      await capture(page, `residence-remote-${size.width}x${size.height}-${index + 1}`);
    }
    [bounds] = categoryBounds;
    assert.ok(bounds);
    for (const box of categoryBounds) assert.deepEqual(box, bounds, `Layout moved at ${size.width}×${size.height}`);
    if (size !== shortViewport) {
      await tab('カーテン').click();
      await directory.locator('[data-residence-plan] [role="button"]').last().focus();
      await page.keyboard.press('Tab');
      assert.ok(await choices('カーテン').getByRole('button').first().evaluate(element => element === document.activeElement));
    }
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= size.width);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= size.height);
    assert.ok(await directory.evaluate(element => element.scrollWidth <= element.clientWidth));
    if (screenshots) t.diagnostic(`${size.width}×${size.height}: ${JSON.stringify(bounds)}`);
  }

  await button(directory, '図を拡大').click();
  const enlargedPlan = residenceDialog(page, '平面図');
  assert.ok(await enlargedPlan.locator('[data-residence-plan]').isVisible());
  await capture(page, 'residence-plan-expanded-320x300');
  await button(enlargedPlan, '前の画面へ戻る').click();
  assert.deepEqual(await directory.boundingBox(), bounds);
  await tab('カーテン').click();
  assert.ok(await listViewport('カーテン').evaluate(element => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop > 0 && element.scrollHeight - element.clientHeight - element.scrollTop <= 1;
  }));
  assert.ok(await directory.evaluate(element => element.scrollTop === 0 && element.scrollHeight === element.clientHeight));
  const shownAtEnd = [choices('カーテン').getByRole('button').last(), ...categoryNames.map(tab), button(directory, '閉じる')];
  for (const control of shownAtEnd) {
    assert.ok(await control.evaluate(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(x + width / 2, y + height / 2));
    }), 'The last device, category buttons and close button must remain visible at the scroll end');
  }
  assert.deepEqual(await directory.boundingBox(), bounds);
  await capture(page, 'residence-remote-320x300-curtains-end');

  await tab('家電・水栓').click();
  const appliances = choices('家電・水栓').getByRole('button');
  const lastAppliance = appliances.last();
  const applianceName = await lastAppliance.textContent();
  assert.ok(await lastAppliance.evaluate(element => {
    const dialog = element.closest('dialog');
    return element.getBoundingClientRect().bottom > dialog.getBoundingClientRect().bottom;
  }), 'The short viewport should require scrolling');
  await appliances.nth(-2).press('Tab');
  assert.ok(await lastAppliance.evaluate(element => element === document.activeElement));
  assert.ok(await listViewport('家電・水栓').evaluate(element => element.scrollTop > 0));
  await page.keyboard.press('Enter');
  const device = residenceDialog(page, applianceName);
  assert.equal(await device.locator('[data-residence-section]').count(), 1);
  await button(device, '設備一覧へ戻る').press('Enter');
  assert.ok(await lastAppliance.evaluate(element => element === document.activeElement));
  assert.deepEqual(await directory.boundingBox(), bounds);

  await tab('カーテン').press('Space');
  await tab('家電・水栓').press('Tab');
  assert.ok(await directory.getByLabel('部屋', { exact: true }).evaluate(element => element === document.activeElement));
  await button(directory, '図を拡大').focus();
  await page.keyboard.press('Tab');
  const firstCurtain = choices('カーテン').getByRole('button').first();
  assert.ok(await firstCurtain.evaluate(element => element === document.activeElement));
  await page.keyboard.press('Escape');
  await directory.waitFor({ state: 'hidden' });
  assert.ok(await button(page, 'メニュー').evaluate(element => element === document.activeElement));
  assert.deepEqual(errors, []);
});

test('the residence plan selects real rooms and keeps the individual device location visible', { timeout }, async t => {
  const { page, errors } = await openResidence(t, '', true);
  await page.waitForFunction(() => window.residenceProbe.scene?.isScene
    && window.residenceProbe.controls.some(section => section.id === 'kitchen-tap'));
  const entryScripts = await page.evaluate(() => [...document.scripts].filter(script => script.src)
    .map(script => new URL(script.src).pathname));
  assert.ok(entryScripts.some(path => /^\/assets\/main-[^/]+\.js$/.test(path)), 'Use the actual built product entry');
  assert.ok(entryScripts.every(path => !path.includes('@vite/client')), 'The acceptance page must use preview, not dev modules');
  await button(page, 'メニュー').click();
  await button(residenceDialog(page, 'メニュー'), '住戸の遠隔操作').click();
  const directory = residenceDialog(page, '住戸の遠隔操作');
  const room = directory.getByLabel('部屋', { exact: true });
  const focusEnds = await directory.evaluate(element => {
    const nodes = [...element.querySelectorAll('button, select, [tabindex="0"]')]
      .filter(node => !node.closest('[inert]') && !node.disabled && node.getClientRects().length);
    nodes[0].dataset.focusEnd = 'first';
    nodes.at(-1).dataset.focusEnd = 'last';
    return nodes.length;
  });
  assert.ok(focusEnds > 2);
  await directory.locator('[data-focus-end="first"]').focus();
  await page.keyboard.press('Shift+Tab');
  assert.ok(await directory.locator('[data-focus-end="last"]').evaluate(element => element === document.activeElement));
  await directory.locator('[data-focus-end="last"]').focus();
  await page.keyboard.press('Tab');
  assert.ok(await directory.locator('[data-focus-end="first"]').evaluate(element => element === document.activeElement));
  await directory.getByRole('heading', { name: '住戸の遠隔操作', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.ok(await directory.locator('[data-focus-end="last"]').evaluate(element => element === document.activeElement));
  const kitchen = directory.locator('[data-residence-plan] [data-residence-room="K"]');
  await kitchen.press('Space');
  assert.equal(await room.inputValue(), 'K');
  assert.equal(await kitchen.getAttribute('aria-current'), 'true');
  assert.equal(await directory.locator('[data-residence-choice]:visible').count(), 1);
  await button(directory, '家電・水栓').click();
  assert.equal(await directory.locator('[data-residence-choice]:visible').count(), 2);
  await button(directory, 'キッチンの水栓').press('Enter');
  const device = residenceDialog(page, 'キッチンの水栓');
  assert.equal(await device.locator('[data-residence-section]').getAttribute('data-residence-room'), 'K');
  const marker = device.locator('.residence-plan-markers circle');
  assert.equal(await marker.count(), 1);
  const point = await marker.evaluate(element => ({ east: Number(element.dataset.planEast), north: Number(element.dataset.planNorth) }));
  assert.ok(point.east >= 12.8 && point.east <= 17.35 && point.north >= 6.65 && point.north <= 9.95);
  const actualWater = await page.evaluate(() => {
    const flow = window.residenceProbe.scene.getObjectByName('kitchen-tap').children[0];
    const at = flow.getWorldPosition(flow.position.clone());
    return { east: at.x, north: -at.z, running: flow.visible };
  });
  assert.ok(Math.abs(point.east - actualWater.east) < 1e-8 && Math.abs(point.north - actualWater.north) < 1e-8,
    'The remote marker must identify the actual rendered water outlet');
  assert.equal(actualWater.running, false);
  const tap = button(device, '水栓');
  await tap.press('Space');
  assert.equal(await tap.getAttribute('aria-pressed'), 'true');
  assert.ok(await page.evaluate(() => window.residenceProbe.scene.getObjectByName('kitchen-tap').children[0].visible));
  assert.match(await device.locator('.residence-plan-caption').textContent(), /キッチン.*水栓/);
  await capture(page, 'residence-spatial-kitchen-tap');
  const setWater = on => page.evaluate(on => window.residenceProbe.controls.find(section => section.id === 'kitchen-tap')
    .controls.find(control => control.id === 'flow').set(on), on);
  await setWater(false);
  await page.waitForFunction(() => document.querySelector('[data-residence-control="flow"]').getAttribute('aria-pressed') === 'false');
  await setWater(true);
  await page.waitForFunction(() => document.querySelector('[data-residence-control="flow"]').getAttribute('aria-pressed') === 'true');
  await tap.press('Space');
  assert.equal(await tap.getAttribute('aria-pressed'), 'false');
  await button(device, '設備一覧へ戻る').click();
  assert.ok(await button(directory, 'キッチンの水栓').evaluate(element => element === document.activeElement));
  await room.selectOption('');
  await button(directory, '照明').click();
  await button(directory, 'リビング・ダイニング').click();
  const lights = residenceDialog(page, 'リビング・ダイニング');
  const west = button(lights, 'ペンダント灯（西）');
  const tabPaths = [];
  const tabToWest = async () => {
    await page.mouse.move(4, 4);
    await lights.getByRole('heading', { name: 'リビング・ダイニング', exact: true }).focus();
    const path = [];
    for (let step = 0; step < 60; step++) {
      await page.keyboard.press('Tab');
      const target = await page.evaluate(() => document.activeElement?.getAttribute('data-residence-control'));
      path.push(target);
      if (target === 'LD-pendant-west') {
        tabPaths.push(path);
        return;
      }
    }
    assert.fail('Real Tab must reach the west fixture within the finite focus path');
  };
  await tabToWest();
  const lit = on => page.waitForFunction(on => {
    let amount;
    window.residenceProbe.scene.traverse(object => {
      if (object.material?.userData?.residenceFixtureId === 'LD-pendant-west') amount = object.material.emissiveIntensity;
    });
    return typeof amount === 'number' && (amount > 0) === on;
  }, on);
  const initialOn = await west.getAttribute('aria-pressed') === 'true';
  await button(lights, '一括点灯').hover();
  assert.ok(await west.evaluate(node => node === document.activeElement),
    'Hovering another control must retain the real keyboard target');
  const hoverPreview = { caption: await lights.locator('.residence-plan-caption').textContent(),
    markerCount: await lights.locator('.residence-plan-markers circle').count() };
  await page.keyboard.press('Space');
  assert.equal(await west.getAttribute('aria-pressed'), String(!initialOn));
  await lit(!initialOn);
  assert.equal(await lights.locator('.residence-plan-markers circle').count(), 1);
  assert.match(await lights.locator('.residence-plan-caption').textContent(), /ペンダント灯（西）/);
  pageEvidence.get(page).mixedInput = { hoverPreview, activatedControl: 'LD-pendant-west', tabPaths };
  await page.evaluate(() => window.residenceProbe.controls.find(section => section.id === 'lighting-LD')
    .controls.find(control => control.id === 'LD-pendant-west').set(true));
  await page.waitForFunction(() => document.querySelector('[data-residence-control="LD-pendant-west"]').getAttribute('aria-pressed') === 'true');
  await lit(true);
  const pendant = lights.locator('.residence-plan-markers circle');
  assert.equal(Number(await pendant.getAttribute('data-plan-east')), 15.36);
  assert.equal(Number(await pendant.getAttribute('data-plan-north')), 4.72);
  await capture(page, 'residence-spatial-pendant');
  await page.setViewportSize({ width: 375, height: 710 });
  await tabToWest();
  assert.ok(await west.evaluate(node => {
    const box = node.getBoundingClientRect();
    return node === document.activeElement && box.x >= 0 && box.y >= 0
      && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
  }), 'Real Tab scrolls the focused mobile control into the visible viewport');
  await capture(page, 'residence-spatial-pendant-mobile');
  await page.setViewportSize({ width: 320, height: 300 });
  await button(lights, '図を拡大').click();
  const expanded = residenceDialog(page, '平面図');
  await capture(page, 'residence-spatial-pendant-expanded');
  await button(expanded, '前の画面へ戻る').click();
  assert.ok(await button(lights, '図を拡大').evaluate(element => element === document.activeElement));
  assert.ok(await lights.evaluate(element => element.scrollWidth <= element.clientWidth));
  await page.keyboard.press('Escape');
  assert.ok(await button(page, 'メニュー').evaluate(element => element === document.activeElement));
  const previousDocument = await page.evaluate(() => {
    window.previousResidencePanel = document.querySelector('#residence-control-dialog').parentElement;
    return { timeOrigin: performance.timeOrigin };
  });
  await button(page, '夜').click();
  await travel(page, '中央展望デッキ', 'overlook', 'main-deck', 'night');
  await page.getByRole('heading', { name: '丘陵展望台', exact: true }).waitFor();
  assert.equal(await page.locator('#residence-control-dialog').count(), 0);
  const replacement = await page.evaluate(previous => ({
    newDocument: performance.timeOrigin !== previous.timeOrigin,
    oldPanelConnected: window.previousResidencePanel?.isConnected ?? null,
  }), previousDocument);
  assert.ok(replacement.newDocument || replacement.oldPanelConnected === false,
    'A full document navigation or in-place replacement must remove the old active residence UI');
  pageEvidence.get(page).worldReplacement = replacement;
  assert.deepEqual(errors, []);
});

test('the open foyer door lights the gallery floor with its own fixtures off', { timeout }, async t => {
  const { page, errors } = await createPage(t);
  await exposeResidenceScene(page);
  await page.goto(`${origin}/?world=residence&time=night`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.residenceProbe.relocate);

  const canvas = page.locator('canvas').first();
  const view = { x: 11.90, z: -10.28, yaw: 0, pitch: -.46 };
  const reachDoor = { ...view, z: -11.22 };
  const area = [.38, .80, .25, .16];
  async function move(pose) {
    await page.evaluate(pose => window.residenceProbe.relocate(pose), pose);
    await page.waitForFunction(({ x, z }) => {
      const at = window.residenceProbe.camera;
      return at && Math.hypot(at.x - x, at.z - z) < .015;
    }, pose);
  }
  const leafAt = x => page.waitForFunction(x => {
    const door = window.residenceProbe.scene.getObjectByName('Foyer pocket door');
    return door && Math.abs(door.position.x - x) < .005;
  }, x);

  const gallery = await openResidenceDevice(page, '照明', '玄関ギャラリー');
  await button(gallery, '一括消灯').click();
  await button(gallery, '設備一覧へ戻る').click();
  const kitchen = await selectResidenceDevice(page, '照明', 'キッチン');
  await button(kitchen, '一括消灯').click();
  await button(kitchen, '設備一覧へ戻る').click();
  const foyer = await selectResidenceDevice(page, '照明', '玄関・前室');
  await button(foyer, '一括点灯').click();
  await page.keyboard.press('Escape');

  await move(view);
  await leafAt(9.298);
  const lit = await brightness(canvas, area);
  await capture(page, 'residence-spill-foyer-open', '.coast-ui { visibility: hidden; }');
  await move(reachDoor);
  await button(page, '玄関前室の引戸を閉める').click();
  await leafAt(11.056);
  await move(view);
  const shaded = await brightness(canvas, area);
  await capture(page, 'residence-spill-foyer-closed', '.coast-ui { visibility: hidden; }');
  assert.ok(lit.mean > shaded.mean + .8, JSON.stringify({ lit, shaded }));
  t.diagnostic(`Foyer spill brightness ${JSON.stringify({ lit: lit.mean, shaded: shaded.mean })}`);
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
  assert.equal(await west.isEnabled(), true);
  assert.equal(await east.isEnabled(), true);
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
  await west.click();
  assert.equal(await west.getAttribute('aria-pressed'), 'true');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
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
  await button(page, '環境音をオン').click();
  await button(page, '環境音をオフ').waitFor();
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

  await button(page, '環境音をオン').click();
  await button(page, '環境音をオフ').waitFor();
  await page.waitForFunction(() => {
    const peak = window.residenceProbe.audioPeak();
    return peak > 0.0001 && peak < 0.98;
  });
  const soundDetails = page.locator('.coast-sound-details > summary');
  await soundDetails.click();
  const traffic = page.locator('#coast-sound-traffic');
  await traffic.fill('0');
  await page.waitForFunction(() => window.residenceProbe.audioPeak() < .000001);
  await traffic.fill('100');
  await page.waitForFunction(() => window.residenceProbe.audioPeak() > .0001);
  assert.equal(await page.evaluate(() => window.residenceProbe.contexts), 1);
  await soundDetails.click();
  await page.evaluate(() => document.activeElement.blur());

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
      const duration = this.buffer?.duration ?? 0;
      const completion = [3.44, .78].some(seconds => Math.abs(duration - seconds) < .01);
      if (!this.loop && completion && window.residenceProbe.firstFilters(target).length > 0) chimes.add(this);
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
  await button(page, '環境音をオン').click();
  await button(page, '環境音をオフ').waitFor();
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
  const addWashSeconds = washer.getByRole('button', { name: '+10秒', exact: true });
  const addWashMinute = washer.getByRole('button', { name: '+1分', exact: true });
  const subtractWashMinute = washer.getByRole('button', { name: '−1分', exact: true });
  const resetWash = washer.getByRole('button', { name: '標準時間に戻す', exact: true });
  await washer.getByText('待機中・設定 00:22', { exact: true }).waitFor();
  await addWashMinute.click();
  await washer.getByText('待機中・設定 01:22', { exact: true }).waitFor();
  await resetWash.click();
  await addWashSeconds.click();
  await washer.getByText('待機中・設定 00:32', { exact: true }).waitFor();
  const loopsBeforeWasher = await page.evaluate(() => window.residenceProbe.loopStarts);
  await power.click();
  await washer.getByText(/脱水中/).waitFor();
  assert.ok(await mode.isDisabled());
  assert.ok(await addWashSeconds.isDisabled());
  assert.ok(await resetWash.isDisabled());
  await page.waitForFunction(initial => window.residenceProbe.loopStarts > initial, loopsBeforeWasher);
  await power.click();
  await washer.getByText(/停止中/).waitFor();
  assert.ok(await mode.isEnabled());
  await addWashMinute.click();
  await washer.getByText(/停止中・残り 01:/).waitFor();
  assert.equal(await page.evaluate(() => window.residenceProbe.completionStarts), 1);
  await resetWash.click();
  await washer.getByText('停止中・残り 00:22', { exact: true }).waitFor();
  await subtractWashMinute.click();
  await washer.getByText('停止中・残り 00:10', { exact: true }).waitFor();
  await capture(page, 'residence-washer-adjustment');
  await button(washer, '閉じる').click();
  const otherWasher = await openResidenceDevice(page, '家電・水栓', '洗濯機（奥側）');
  await otherWasher.getByText('待機中・設定 00:40', { exact: true }).waitFor();
  await button(otherWasher, '設備一覧へ戻る').click();
  await selectResidenceDevice(page, '家電・水栓', '洗濯機（入口側）');
  await power.click();
  await washer.getByText('完了', { exact: true }).waitFor();
  await page.waitForFunction(() => window.residenceProbe.completionStarts === 2);
  await page.keyboard.press('Escape');
  await washer.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
});

test('the foyer pocket door closes locally while the gallery, living room and kitchen remain open', { timeout }, async t => {
  const { page, errors } = await createPage(t);
  await page.addInitScript(() => {
    const dryGains = new WeakMap();
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (this instanceof BiquadFilterNode && destination instanceof GainNode && !dryGains.has(this)) {
        dryGains.set(this, destination.gain);
      }
      return connect.call(this, destination, ...args);
    };
    window.foyerTrafficGains = () => [...window.residenceProbe.trafficFilters]
      .map(filter => dryGains.get(filter)?.value ?? 0);
  });
  await exposeResidenceScene(page);
  await page.goto(`${origin}/?world=residence&time=day`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.residenceProbe.relocate);
  const open = button(page, '玄関前室の引戸を開ける');
  const close = button(page, '玄関前室の引戸を閉める');
  const waitForLeaf = opened => page.waitForFunction(expected => {
    const leaf = window.residenceProbe.scene.getObjectByName('Foyer pocket door');
    return leaf && Math.abs(leaf.position.x - expected) < .005;
  }, opened ? 9.298 : 11.056);
  const foyer = { x: 11.90, z: -12.94, yaw: Math.PI, pitch: -.04 };
  const gallery = { x: 11.90, z: -11.22, yaw: 0, pitch: -.04 };
  async function relocate(pose) {
    await page.evaluate(pose => window.residenceProbe.relocate(pose), pose);
    await page.waitForFunction(({ x, z }) => {
      const at = window.residenceProbe.camera;
      return at && Math.hypot(x - at.x, z - at.z) < .015;
    }, pose);
  }
  const landscape = '.coast-ui { visibility: hidden; }';
  async function walkAcrossLivingBoundary() {
    await relocate({ x: 11.90, z: -7.72, yaw: -Math.PI / 2, pitch: 0 });
    await hold(page, 'w', () => page.waitForFunction(() => window.residenceProbe.camera.x > 13.14));
    for (const x of [11.35, 11.90, 12.45, 13.25, 14.05, 15.5, 16.9]) {
      await relocate({ x, z: -7.12, yaw: Math.PI, pitch: 0 });
      await hold(page, 'w', () => page.waitForFunction(x => {
        const pose = window.residenceProbe.camera;
        return pose.z > -6.27 && Math.abs(pose.x - x) < .045 && Math.abs(pose.y - 1.65) < .04;
      }, x));
    }
  }

  await relocate(foyer);
  await close.waitFor();
  await waitForLeaf(true);
  await relocate({ ...foyer, z: -14.75, pitch: -.11 });
  await capture(page, 'foyer-door-open', landscape);
  await relocate(foyer);
  await button(page, '環境音をオン').click();
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => window.foyerTrafficGains().some(gain => gain > .0002));
  await moreMovementFrames(page);
  const openGains = await page.evaluate(() => window.foyerTrafficGains());
  await relocate({ ...foyer, z: -12.10 });
  await close.waitFor();
  await page.keyboard.press('e');
  await open.waitFor();
  await moreMovementFrames(page);
  const pausedEast = await page.evaluate(() => window.residenceProbe.scene.getObjectByName('Foyer pocket door').position.x);
  assert.ok(pausedEast + 1.688 <= foyer.x - .24, JSON.stringify(pausedEast));
  await relocate(foyer);
  await waitForLeaf(false);
  await page.waitForFunction(opened => window.foyerTrafficGains()
    .some((gain, index) => opened[index] > .0002 && gain < opened[index] * .38), openGains);
  const closedGains = await page.evaluate(() => window.foyerTrafficGains());
  const index = openGains.findIndex((gain, i) => gain > .0002 && closedGains[i] < gain * .38);
  t.diagnostic(`Foyer traffic dry gain ${JSON.stringify({ open: openGains[index], closed: closedGains[index] })}`);
  await relocate({ ...foyer, z: -14.75, pitch: -.11 });
  await capture(page, 'foyer-door-closed', landscape);
  await relocate(foyer);
  await hold(page, 'w', async () => {
    await page.waitForFunction(() => window.residenceProbe.camera.z > -12.69);
    await moreMovementFrames(page);
    const pose = await camera(page);
    assert.ok(pose.z < -12.36 && pose.z > -12.58, JSON.stringify(pose));
  });
  await open.click();
  await waitForLeaf(true);
  await hold(page, 'w', () => page.waitForFunction(() => window.residenceProbe.camera.z > -11.55));
  await relocate(gallery);
  await page.keyboard.press('e');
  await waitForLeaf(false);
  await relocate({ ...gallery, z: -9.50, pitch: -.11 });
  await capture(page, 'foyer-door-gallery-side', landscape);
  await walkAcrossLivingBoundary();
  await relocate(gallery);
  await page.keyboard.press('e');
  await waitForLeaf(true);
  await hold(page, 'w', () => page.waitForFunction(() => window.residenceProbe.camera.z < -12.68));
  await walkAcrossLivingBoundary();
  await relocate({ x: 9.94, z: -5.72, yaw: 0, pitch: 0 });
  await hold(page, 'w', () => page.waitForFunction(() => window.residenceProbe.camera.z < -7.14));
  assert.deepEqual(errors, []);
});

test('nearby lighting controls switch a zone or one lamp without opening the residence menu', { timeout }, async t => {
  const { page, errors } = await createPage(t);
  await exposeResidenceScene(page);
  await page.goto(`${origin}/?world=residence&time=night`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.residenceProbe.relocate);

  const dialog = page.locator('#residence-control-dialog');
  const living = residenceDialog(page, 'リビング・ダイニング');
  const study = residenceDialog(page, '書斎05');
  const tea = residenceDialog(page, '茶室04');
  const table = living.getByRole('button', { name: 'ソファ横のランプ', exact: true });
  const pendant = living.getByRole('button', { name: 'ペンダント灯（東）', exact: true });
  const theater = living.getByRole('button', { name: 'シアター照明', exact: true });
  const nightLight = living.getByRole('button', { name: '常夜灯', exact: true });
  const desk = study.getByRole('button', { name: 'デスクライト', exact: true });
  const lantern = tea.getByRole('button', { name: '行灯', exact: true });
  const canvas = page.locator('canvas.coast-view');
  const landscape = '.coast-ui { visibility: hidden; }';
  const go = pose => page.evaluate(pose => window.residenceProbe.relocate(pose), pose);
  const pressed = (control, on) => control.and(dialog.getByRole('button', { pressed: on })).waitFor();
  const light = (id, on) => page.waitForFunction(({ id, on }) => {
    let amount;
    window.residenceProbe.scene.traverse(object => {
      if (object.material?.userData?.residenceFixtureId === id) amount = object.material.emissiveIntensity;
    });
    return typeof amount === 'number' && (amount > 0) === on;
  }, { id, on });

  await go({ x: 11.65, z: -4.78, yaw: Math.PI / 2, pitch: -.35 });
  await button(page, 'リビング・ダイニングの照明を一括消灯').waitFor();
  await page.keyboard.press('e');
  await button(page, 'リビング・ダイニングの照明を一括点灯').waitFor();
  assert.equal(await dialog.isVisible(), false);
  await light('LD-table', false);
  await light('LD-pendant-east', false);
  await light('K-strip-east', true);
  await button(page, 'リビング・ダイニングの照明を一括点灯').click();
  await light('LD-table', true);
  await light('LD-pendant-east', true);

  await go({ x: 17.97, z: -1.55, yaw: Math.PI, pitch: -.72 });
  await button(page, 'ソファ横のランプを消す').click();
  await light('LD-table', false);
  await light('LD-pendant-east', true);
  await openResidenceDevice(page, '照明', 'リビング・ダイニング');
  await pressed(table, false);
  await pressed(pendant, true);
  await pressed(nightLight, true);

  await pendant.click();
  await theater.click();
  assert.equal(await table.isEnabled(), true);
  assert.equal(await pendant.isEnabled(), true);
  await pressed(pendant, false);
  await page.keyboard.press('Escape');

  await go({ x: 11.65, z: -4.78, yaw: Math.PI / 2, pitch: -.35 });
  await button(page, 'リビング・ダイニングの照明を一括点灯').waitFor();
  await page.keyboard.press('e');
  await light('LD-pendant-east', true);
  assert.equal(await dialog.isVisible(), false);
  await openResidenceDevice(page, '照明', 'リビング・ダイニング');
  await pressed(theater, true);
  await pressed(pendant, true);
  await pressed(nightLight, true);
  await nightLight.click();
  await pressed(nightLight, false);
  await page.waitForFunction(() => {
    const fixture = window.residenceProbe.scene.getObjectByName('Residence light fixture LD-night');
    return fixture && fixture.material.isMeshStandardMaterial === true;
  });
  await page.keyboard.press('Escape');
  await button(page, 'リビング・ダイニングの照明を一括消灯').click();
  await light('LD-pendant-east', false);

  await go({ x: 17.97, z: -1.55, yaw: Math.PI, pitch: -.72 });
  await button(page, 'ソファ横のランプを点ける').waitFor();
  const dark = await brightness(canvas, [.29, .44, .42, .39]);
  await capture(page, 'residence-local-light-theater-off', landscape);
  await page.keyboard.press('e');
  await light('LD-table', true);
  await light('LD-pendant-east', false);
  const lit = await brightness(canvas, [.29, .44, .42, .39]);
  assert.ok(lit.mean > dark.mean + 1, JSON.stringify({ dark, lit }));
  await capture(page, 'residence-local-light-theater-table', landscape);
  await openResidenceDevice(page, '照明', 'リビング・ダイニング');
  await pressed(theater, true);
  await pressed(table, true);
  await table.click();
  await pendant.click();
  await pressed(pendant, true);
  await pressed(theater, true);
  await page.keyboard.press('Escape');
  await light('LD-pendant-east', true);
  await button(page, 'ソファ横のランプを点ける').waitFor();
  await button(page, 'ソファ横のランプを点ける').click();
  await light('LD-table', true);
  await openResidenceDevice(page, '照明', 'リビング・ダイニング');
  await theater.click();
  await pressed(table, false);
  await pressed(pendant, false);
  await pressed(nightLight, true);
  await page.keyboard.press('Escape');
  await light('LD-table', false);

  await go({ x: 12.72, z: -1.27, yaw: Math.PI / 2, pitch: -.18 });
  await button(page, 'フロアランプを消す').click();
  await light('LD-floor', false);

  await go({ x: 6.20, z: -3.414, yaw: -Math.PI / 2, pitch: -.8 });
  await button(page, '行灯を消す').click();
  await light('04-alcove', true);
  await openResidenceDevice(page, '照明', '茶室04');
  await pressed(lantern, false);
  await page.keyboard.press('Escape');

  await go({ x: 8.63, z: -2.025, yaw: Math.PI / 2, pitch: -.54 });
  await button(page, 'デスクライトを消す').click();
  await light('05-desk', false);
  await light('05-reading', true);
  await openResidenceDevice(page, '照明', '書斎05');
  await pressed(desk, false);
  await desk.click();
  await page.keyboard.press('Escape');
  await button(page, 'デスクライトを消す').waitFor();
  await light('05-desk', true);

  await go({ x: 10.68, z: -4.42, yaw: 0, pitch: -.35 });
  await button(page, '書斎05の照明を一括消灯').click();
  await light('05-reading', false);
  await light('05-desk', false);
  assert.equal(await dialog.isVisible(), false);

  await go({ x: 7.24, z: -2.025, yaw: -Math.PI / 2, pitch: -.54 });
  await page.waitForFunction(() => window.residenceProbe.camera.x < 7.30);
  assert.equal(await button(page, 'デスクライトを点ける').isVisible(), false);

  await go({ x: 19.77, z: -14.53, yaw: 0, pitch: -.7 });
  await button(page, 'ベッド脇のランプ（東）を消す').click();
  await light('01-bed-east', false);
  await light('01-bed-west', true);
  assert.deepEqual(errors, []);
});
