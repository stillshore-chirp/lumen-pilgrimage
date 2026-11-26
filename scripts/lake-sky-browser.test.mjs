import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const probeModule = '/lake-sky-probe.js';

// Loaded as a Vite module so the probe uses the same Three.js instance and asset loader as the world.
async function installProbe() {
  const { world, lakeSettings } = await loadLakeScene();
  const width = 960;
  const height = 540;
  const renderer = new WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  renderer.toneMapping = NeutralToneMapping;
  const camera = new PerspectiveCamera(LAKE_VIEW_FOV, width / height, 0.10, 2400);
  camera.setViewOffset(width, height, 0, LAKE_VIEW_VERTICAL_OFFSET * height, width, height);
  camera.position.set(LAKE_SPAWN.x, 1.65, LAKE_SPAWN.z);
  const cumulus = [];
  world.scene.traverse(mesh => {
    if (mesh.name === 'Lake cumulus') cumulus.push(mesh);
  });
  const crop = document.createElement('canvas');
  crop.width = 480;
  crop.height = 206;
  const pixels = crop.getContext('2d', { willReadFrequently: true });

  function render() {
    renderer.render(world.scene, camera);
    // The middle of the front window includes the main valley and the stone ring.
    pixels.drawImage(renderer.domElement, 240, 92, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return pixels.getImageData(0, 0, crop.width, crop.height).data;
  }

  function averageLight(x, y, width, height) {
    pixels.drawImage(renderer.domElement, x, y, width, height, 0, 0, width, height);
    const data = pixels.getImageData(0, 0, width, height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
    return sum / (width * height * 3);
  }

  window.lakeSkyProbe = {
    get ready() { return cumulus[0].material.uniforms.uCumulus.value.image?.naturalWidth > 0; },
    sample(seconds) {
      world.update(seconds, camera);
      const withClouds = render();
      for (const cloud of cumulus) cloud.visible = false;
      const withoutClouds = render();
      for (const cloud of cumulus) cloud.visible = true;
      let affectedPixels = 0;
      let horizontalSum = 0;
      for (let i = 0; i < withClouds.length; i += 4) {
        const difference = Math.abs(withClouds[i] - withoutClouds[i])
          + Math.abs(withClouds[i + 1] - withoutClouds[i + 1])
          + Math.abs(withClouds[i + 2] - withoutClouds[i + 2]);
        if (difference >= 24) {
          affectedPixels += 1;
          horizontalSum += (i / 4) % crop.width;
        }
      }
      return { affectedPixels, averageX: horizontalSum / Math.max(1, affectedPixels) };
    },
    sampleMoon(visible, liveReflection) {
      // This direction puts the lunar disc in clear sky just right of the ring.
      lakeSettings.update({ moonAzimuth: 15, moonElevation: 20, moonVisible: visible });
      world.setTimeOfDay('night');
      world.update(0, camera);
      if (liveReflection) world.prepareRender(renderer, camera);
      renderer.render(world.scene, camera);
      return {
        sky: averageLight(620, 128, 18, 14),
        water: averageLight(600, 355, 56, 42),
        andon: averageLight(645, 449, 34, 33),
      };
    },
    dispose() {
      world.dispose();
      renderer.dispose();
    },
  };
}

test('lake sky remains animated and responds to the lunar visibility setting', { timeout: 90_000 }, async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'lumen-lake-sky-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const server = await createServer({
    cacheDir,
    configFile: false,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'lake-sky-browser-probe',
      resolveId(id) {
        if (id === probeModule) return id;
      },
      load(id) {
        if (id !== probeModule) return;
        return `
          import { NeutralToneMapping, PerspectiveCamera, WebGLRenderer } from 'three';
          import { LAKE_SPAWN, LAKE_VIEW_FOV, LAKE_VIEW_VERTICAL_OFFSET } from '/src/coast/world/lake/lakeLayout.ts';
          import { loadLakeScene } from '/src/coast/world/lake/LakeWorld.ts';
          await (${installProbe})();
        `;
      },
    }],
  });
  t.after(() => server.close());
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({
    channel: process.env.COAST_CHROME_CHANNEL || 'chromium',
    args: ['--enable-unsafe-swiftshader'],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route(`${origin}/lake-sky-probe.html`, route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><script type="module" src="${probeModule}"></script>`,
  }));
  await page.goto(`${origin}/lake-sky-probe.html`);
  await page.waitForFunction(() => window.lakeSkyProbe?.ready);
  await t.test('cumulus crosses the front window across several circulation periods', async () => {
    const times = [0, 25, 400, 520, 900, 1800, 3600, 10800];
    const samples = await page.evaluate(times => times.map(time => window.lakeSkyProbe.sample(time)), times);
    for (const [index, { affectedPixels }] of samples.entries()) {
      assert.ok(affectedPixels > 100, `only ${affectedPixels} pixels of cumulus at ${times[index]} seconds`);
    }
    assert.ok(Math.abs(samples[1].averageX - samples[0].averageX) > 5, 'clouds move through the front window');
  });
  await t.test('hiding the moon removes its sky and water light while keeping the andon lit', async () => {
    for (const liveReflection of [false, true]) {
      const [visible, hidden] = await page.evaluate(liveReflection =>
        [true, false].map(visible => window.lakeSkyProbe.sampleMoon(visible, liveReflection)), liveReflection);
      assert.ok(visible.sky - hidden.sky > 30);
      assert.ok(visible.water - hidden.water > 30);
      assert.ok(Math.abs(visible.andon - hidden.andon) < 1);
    }
  });
  await page.evaluate(() => window.lakeSkyProbe.dispose());
  assert.deepEqual(errors, []);
});
