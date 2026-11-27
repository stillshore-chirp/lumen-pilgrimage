import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Independent from simulated-xr.mjs: this fixture exercises the diagnostic's real
// WebGL1 writes/readbacks through an ordinary texture FBO, never an XR compositor.
function installXR() {
  const fixture = { supported: true, requests: 0, ends: 0, activations: [], references: [], outsideFrameReads: 0 };
  window.testXR = fixture;
  const xrContexts = new WeakSet();
  const realRead = WebGLRenderingContext.prototype.readPixels;
  WebGLRenderingContext.prototype.makeXRCompatible = async function () {};
  WebGLRenderingContext.prototype.readPixels = function (...args) {
    if (xrContexts.has(this)) {
      if (!fixture.inFrame) { fixture.outsideFrameReads++; throw new DOMException('', 'InvalidStateError'); }
      if (fixture.rejectRead) throw new DOMException('', 'SecurityError');
      if (fixture.zeroRead) { args[6].fill(0); return; }
    }
    return realRead.apply(this, args);
  };
  class Session extends EventTarget {
    visibilityState = 'visible';
    ended = false;
    updateRenderState({ baseLayer }) { this.layer = baseLayer; }
    async requestReferenceSpace(type) {
      fixture.references.push(type);
      if (fixture.hangReference) return new Promise(() => {});
      return {};
    }
    requestAnimationFrame(callback) {
      return window.requestAnimationFrame(time => {
        if (this.ended) return;
        fixture.inFrame = true;
        try { callback(time, { getViewerPose: () => fixture.noPose ? null : { views: [{ eye: 'left' }, { eye: 'right' }] } }); }
        finally { fixture.inFrame = false; }
      });
    }
    cancelAnimationFrame(id) { window.cancelAnimationFrame(id); }
    async end() {
      if (fixture.rejectEnd) { fixture.rejectEnd = false; throw new DOMException('', 'OperationError'); }
      this.ended = true; fixture.ends++; this.dispatchEvent(new Event('end'));
    }
  }
  window.XRWebGLLayer = class {
    constructor(session, gl, init) {
      fixture.layerInit = init; xrContexts.add(gl);
      this.framebufferWidth = 640; this.framebufferHeight = 320; this.antialias = false;
      this.framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 640, 320, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    }
    getViewport(view) {
      // Prototype getters match native XRViewport's non-enumerable properties.
      return new class { get x() { return view.eye === 'left' ? 0 : 320; } get y() { return 0; }
        get width() { return 320; } get height() { return 320; } }();
    }
  };
  Object.defineProperty(navigator, 'xr', { configurable: true, value: {
    isSessionSupported: async () => fixture.supported,
    requestSession: async (mode, options) => {
      fixture.requests++; fixture.activations.push(navigator.userActivation.isActive);
      fixture.options = options; fixture.mode = mode;
      if (fixture.denyNext) { fixture.denyNext = false; throw new DOMException('', 'NotAllowedError'); }
      const session = new Session(); fixture.session = session;
      if (fixture.delayRequest) await new Promise(resolve => { fixture.resolveRequest = resolve; });
      return session;
    },
  } });
}

async function latest(page) {
  return JSON.parse(await page.locator('#results pre').first().textContent());
}
async function waitStatus(page, status) {
  await page.waitForFunction(expected => {
    const pre = document.querySelector('#results pre');
    return pre && JSON.parse(pre.textContent).status === expected;
  }, status);
}
async function waitEnded(page) {
  await page.waitForFunction(() => {
    const pre = document.querySelector('#results pre');
    return pre && JSON.parse(pre.textContent).sessionEnded === true;
  });
}
async function begin(page) {
  await page.waitForFunction(() => !document.getElementById('start-xr').disabled);
  await page.click('#start-xr');
}

/** Registered as subtests of the existing monitor browser gate, using its built preview. */
export async function runXRColorProbeBrowserTests(t, { browser, url, screenshotDirectory }) {
  // These are test inputs as well as provenance: the impact planner follows both literal URLs.
  const inputs = await Promise.all([
    readFile(new URL('../tools/xr-color-probe.html', import.meta.url)),
    readFile(new URL('../src/tools/XRColorProbe.ts', import.meta.url)),
  ]);
  const inputHashes = inputs.map(bytes => createHash('sha256').update(bytes).digest('hex'));
  const origin = new URL(url).origin;
  const results = [];
  async function test(name, run) {
    await t.test(name, async () => {
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 1000 } });
      const page = await context.newPage();
      const pageErrors = [];
      const requests = [];
      page.on('pageerror', error => pageErrors.push(error.name));
      page.on('request', request => requests.push(request.url()));
      try {
        await page.addInitScript(installXR);
        await page.goto(new URL('tools/xr-color-probe.html', url).href);
        await waitStatus(page, 'obtained');
        await page.selectOption('#duration', '5');
        await run(page);
        assert.deepEqual(pageErrors, []);
        assert.ok(requests.every(request => request.startsWith(`${origin}/`) || request.startsWith('blob:')));
        assert.equal(await page.evaluate(() => testXR.outsideFrameReads), 0);
        results.push({ name, status: 'passed' });
      } finally {
        await context.close();
      }
    });
  }
  if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
  await test('real desktop framebuffer readback and JSON export', async page => {
    const report = await latest(page);
    assert.equal(report.mode, 'desktop-default-framebuffer');
    assert.equal(report.views[0].patches.length, 13);
    assert.equal(report.views[0].referenceComparison, 'within-one-code-of-8bit-reference');
    assert.ok(report.views[0].patches.every(patch => patch.pixelsRGBA8.length === 36 && patch.maxAbsoluteDifferenceFromReference <= 1));
    const dark = report.views[0].patches.find(patch => patch.id === 'dark-blue');
    assert.deepEqual(dark.pixelsRGBA8.slice(0, 4), [17, 23, 27, 255]);
    const downloadEvent = page.waitForEvent('download'); await page.click('#save-json');
    const download = await downloadEvent;
    const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(saved.reports[0].views[0].patches.length, 13);
    assert.equal(saved.reports[0].status, 'obtained');
    if (screenshotDirectory) {
      await download.saveAs(join(screenshotDirectory, 'xr-color-probe-desktop.json'));
      await page.screenshot({ path: join(screenshotDirectory, 'xr-color-probe-desktop.png'), fullPage: true });
    }
  });
  await test('actual WebGL stereo texture framebuffer with gesture and viewer reference', async page => {
    await begin(page); await waitStatus(page, 'obtained');
    const report = await latest(page);
    assert.equal(report.mode, 'xr-legacy-webgl-layer'); assert.equal(report.views.length, 2);
    assert.deepEqual(report.views.map(view => view.viewport.x), [0, 320]);
    assert.ok(report.views.every(view => view.patches.length === 13 && view.referenceComparison === 'within-one-code-of-8bit-reference'));
    assert.ok(report.views.every(view => view.patches.every(patch => patch.maxAbsoluteDifferenceFromReference <= 1)));
    const data = await page.evaluate(() => ({ activation: testXR.activations[0], references: testXR.references,
      options: testXR.options, init: testXR.layerInit, outside: testXR.outsideFrameReads }));
    assert.equal(data.activation, true); assert.deepEqual(data.references, ['viewer']);
    assert.deepEqual(data.options.requiredFeatures, []); assert.equal(data.init.framebufferScaleFactor, .35);
    assert.equal(data.init.antialias, false); assert.equal(data.outside, 0);
    await page.click('#stop-xr'); await waitEnded(page);
    assert.equal((await latest(page)).views.length, 2);
    if (screenshotDirectory) await writeFile(join(screenshotDirectory, 'xr-color-probe-simulated-stereo.json'), JSON.stringify(await latest(page), null, 2));
  });
  await test('permission rejection, retry, and controller selection end', async page => {
    await page.evaluate(() => { testXR.denyNext = true; }); await begin(page); await waitStatus(page, 'unavailable');
    assert.match((await latest(page)).reason, /NotAllowedError/);
    await begin(page); await waitStatus(page, 'obtained');
    await page.evaluate(() => testXR.session.dispatchEvent(new Event('select'))); await waitEnded(page);
    assert.equal((await latest(page)).endReason, 'controller-select');
  });
  await test('blocked readback remains unavailable with null samples', async page => {
    await page.evaluate(() => { testXR.rejectRead = true; }); await begin(page); await waitStatus(page, 'unavailable');
    const report = await latest(page);
    assert.equal(report.views.length, 2);
    assert.ok(report.views.every(view => view.status === 'unavailable' && view.patches.every(patch =>
      patch.status === 'unavailable' && patch.pixelsRGBA8 === null && /SecurityError/.test(patch.reason))));
    assert.match(await page.locator('#results').textContent(), /SecurityError/);
    await page.click('#stop-xr'); await waitEnded(page);
  });
  await test('all-zero readback cannot establish the white control', async page => {
    await page.evaluate(() => { testXR.zeroRead = true; }); await begin(page); await waitStatus(page, 'unavailable');
    const report = await latest(page);
    assert.ok(report.views.every(view => view.status === 'inconclusive' && view.referenceComparison === 'not-evaluated'));
    assert.match(await page.locator('#result-summary').textContent(), /unavailable/);
    await page.click('#stop-xr'); await waitEnded(page);
  });
  await test('automatic timeout retains successful measurements', async page => {
    await begin(page); await waitStatus(page, 'obtained'); await waitEnded(page);
    const report = await latest(page); assert.equal(report.status, 'obtained');
    assert.match(report.endReason, /^duration-/); assert.equal(report.views.length, 2);
  });
  await test('initialization promise stall ends without fabricated samples', async page => {
    await page.evaluate(() => { testXR.hangReference = true; }); await begin(page); await waitEnded(page);
    const report = await latest(page); assert.equal(report.status, 'unavailable'); assert.deepEqual(report.views, []);
    assert.match(report.endReason, /^duration-/);
  });
  await test('missing pose remains unmeasured after manual end', async page => {
    await page.evaluate(() => { testXR.noPose = true; }); await begin(page);
    await page.waitForFunction(() => /No viewer pose/.test(JSON.parse(document.querySelector('#results pre').textContent).reason));
    await page.click('#stop-xr'); await waitEnded(page);
    const report = await latest(page); assert.equal(report.status, 'unavailable'); assert.deepEqual(report.views, []);
  });
  await test('failed end remains unconfirmed until successful manual retry', async page => {
    await begin(page); await waitStatus(page, 'obtained'); await page.evaluate(() => { testXR.rejectEnd = true; });
    await page.click('#stop-xr');
    await page.waitForFunction(() => document.getElementById('session-status').textContent.includes('終了要求に失敗'));
    assert.equal((await latest(page)).sessionEnded, false);
    await page.click('#stop-xr'); await waitEnded(page); assert.equal((await latest(page)).sessionEnded, true);
  });
  await test('a late session after cancellation is immediately ended', async page => {
    await page.evaluate(() => { testXR.delayRequest = true; }); await begin(page);
    await page.waitForFunction(() => typeof testXR.resolveRequest === 'function');
    await page.click('#stop-xr'); await page.evaluate(() => { testXR.resolveRequest(); });
    await waitEnded(page); const report = await latest(page); assert.equal(report.endReason, 'request-cancelled');
    assert.equal(report.status, 'unavailable'); assert.deepEqual(report.views, []);
  });
  await test('narrow layout retains results without external requests or page exceptions', async page => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal((await latest(page)).views[0].patches.length, 13);
    if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, 'xr-color-probe-mobile.png'), fullPage: true });
  });
  if (screenshotDirectory) await writeFile(join(screenshotDirectory, 'xr-color-probe-results.json'), JSON.stringify({
    inputHashes: { html: inputHashes[0], typescript: inputHashes[1] }, tests: results,
    scope: 'Real desktop WebGL and simulated XR texture framebuffers; no physical HMD/compositor measurement.',
  }, null, 2));
}
