import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';

const windowViews = [
  { name: 'south', x: 19.78, z: -2.85, yaw: 3.09, pitch: -.26, street: [245, 130, 215, 130] },
  { name: 'east', x: 19.37, z: -3.82, yaw: -1.46, pitch: -.27, street: [325, 130, 175, 115] },
];

test('night windows keep the city lights stable during a slow pan', { timeout: 90_000 }, async t => {
  const server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => server.close());
  const browser = await chromium.launch({
    channel: process.env.COAST_CHROME_CHANNEL || 'chromium',
    args: ['--enable-unsafe-swiftshader'],
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 400;
    const pixels = canvas.getContext('2d', { willReadFrequently: true });
    let pan;
    window.residenceLightMotion = {
      run(view) {
        return new Promise(resolve => {
          pan = { ...view, frame: -5, history: [], highs: 0, luminance: 0, changes: 0, resolve };
        });
      },
      prepare(camera) {
        this.ready = true;
        if (!pan) return;
        camera.position.set(pan.x, 1.65, pan.z);
        camera.rotation.set(pan.pitch, pan.yaw + Math.max(0, pan.frame) * .00045, 0);
        camera.updateMatrixWorld();
      },
      sample(source) {
        if (!pan) return;
        if (pan.frame >= 0) {
          pixels.drawImage(source, 0, 0, canvas.width, canvas.height);
          const { data } = pixels.getImageData(...pan.street);
          const current = new Uint8Array(data.length / 4);
          const [earlier, previous] = pan.history;
          for (let i = 0; i < current.length; i++) {
            const j = i * 4;
            const value = Math.round(.299 * data[j] + .587 * data[j + 1] + .114 * data[j + 2]);
            current[i] = value;
            pan.luminance += value;
            if (value >= 70) pan.highs += 1;
            if (previous) pan.changes += Math.abs(value - 2 * previous[i] + earlier[i]);
          }
          pan.history = previous ? [previous, current] : [...pan.history, current];
        }
        pan.frame += 1;
        if (pan.frame === 26) {
          const size = pan.history[0].length;
          pan.resolve({
            meanLuminance: pan.luminance / (26 * size),
            brightFraction: pan.highs / (26 * size),
            meanHighPass: pan.changes / (24 * size),
          });
          pan = undefined;
        }
      },
    };
  });

  await page.route('**/assets/CoastApp-*.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const render = /this\.world\.prepareRender\?\.\(this\.renderer,(\w+)\),this\.renderer\.render\(this\.world\.scene,[^()]+\)/;
    assert.ok(render.test(source), 'test hook must sample the canvas immediately after the main draw');
    const body = source.replace(render, (draw, camera) => `window.residenceLightMotion.prepare(${camera}),${draw},`
      + 'window.residenceLightMotion.sample(this.renderer.domElement)');
    await route.fulfill({ response, body });
  });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(`${origin}/?world=residence&time=night`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.residenceLightMotion?.ready);
  for (const quality of ['light', 'high']) {
    const choice = page.locator(`.coast-${quality}`);
    await choice.click();
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
    for (const view of windowViews) {
      const stats = await page.evaluate(view => window.residenceLightMotion.run(view), view);
      const details = `${quality}/${view.name} ${JSON.stringify(stats)}`;
      t.diagnostic(details);
      assert.ok(stats.meanHighPass < (quality === 'high' ? 5.0 : 3.0), details);
      assert.ok(stats.meanLuminance > 24 && stats.brightFraction > .012, details);
    }
  }
  assert.deepEqual(errors, []);
});
