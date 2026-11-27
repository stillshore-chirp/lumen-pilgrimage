import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { installFacilityProbe, aimFacilityView, walkFacilityTo } from './atrium-facility-views.mjs';

// Read-only WebGL observations and ordinary pointer-lock / keyboard input are
// shared with the facility audit. Remove its comparison-only FOV preference
// before the application starts so every world retains its own default lens.
const probeScript = `(${installFacilityProbe.toString()})({ freezeTime: false });
  localStorage.removeItem('lumen-pilgrimage:fov');`;

const plan = JSON.parse(await readFile(new URL('./gallery-shots.json', import.meta.url), 'utf8'));
const out = resolve(process.env.GALLERY_OUTPUT || 'artifacts/gallery/raw');
let sourceRevision;
let trackedRuntimeChanges;
try {
  sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  trackedRuntimeChanges = execFileSync('git', ['status', '--porcelain', '--untracked-files=no', '--', 'src', 'public'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
} catch {
  throw new Error('Cannot determine the source revision and runtime working-tree state');
}
assert.match(sourceRevision, /^[a-f0-9]{40}$/);
assert.ok(!trackedRuntimeChanges, 'Commit or discard tracked src/public changes before gallery capture');
const selected = process.argv.slice(2);
assert.ok(selected.every(id => id === '--proof' || plan.shots.some(shot => shot.id === id)),
  'Every selection must be --proof or a known shot ID');
const shots = plan.shots.filter(shot => selected.length === 0
  || selected.includes(shot.id) || selected.includes('--proof') && shot.proof);
assert.ok(shots.length, 'select at least one known shot');
await mkdir(out, { recursive: true });
const server = process.env.GALLERY_ORIGIN ? null : await preview({
  logLevel: 'error', preview: { host: '127.0.0.1', port: 0 },
});
const origin = process.env.GALLERY_ORIGIN || `http://127.0.0.1:${server.httpServer.address().port}`;
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname));
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.COAST_CHROME_CHANNEL || 'chromium',
    args: ['--enable-unsafe-swiftshader'],
  });
  for (const shot of shots) {
    const context = await browser.newContext({ viewport: plan.viewport, deviceScaleFactor: plan.deviceScaleFactor });
    const page = await context.newPage();
    const pageerrors = [], resourceFailures = [], actions = [];
    const scriptResponses = [];
    let sampleStartedAt = null;
    page.on('pageerror', error => pageerrors.push({ name: error.name }));
    page.on('requestfailed', request => resourceFailures.push(new URL(request.url()).pathname));
    page.on('response', response => {
      if (response.status() >= 400) resourceFailures.push({ path: new URL(response.url()).pathname, status: response.status() });
      if (response.request().resourceType() === 'script') scriptResponses.push(response);
    });
    await page.addInitScript({ content: probeScript });
    const route = `/?world=${shot.world}&place=${shot.place}&time=${shot.time}`;
    try {
      const documentResponse = await page.goto(`${origin}${route}`, { waitUntil: 'networkidle', timeout: 120_000 });
      await page.waitForFunction(() => Boolean(window.atriumFacilityProbe?.view), null, { timeout: 120_000 });
      await page.getByRole('button', { name: '高品質', exact: true }).click();
      actions.push('高品質');
      if (shot.cinemaMode) {
        await page.getByRole('button', { name: '上映設定', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '上映設定' });
        await dialog.getByRole('button', { name: shot.cinemaMode, exact: true }).click();
        if (shot.cinemaSample) {
          await dialog.getByRole('button', { name: '試映を再生', exact: true }).click();
          sampleStartedAt = await page.evaluate(() => performance.now());
          actions.push('試映を再生: application-generated built-in sample; no external media');
          await dialog.waitFor({ state: 'hidden' });
        } else await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
        actions.push(`上映設定: ${shot.cinemaMode}`);
      }
      if (shot.lakeOptions) {
        await page.getByRole('button', { name: '環境設定', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '湖畔の環境設定' });
        for (const option of shot.lakeOptions) {
          await dialog.getByRole('button', { name: option, exact: true }).click();
          actions.push(`環境設定: ${option}`);
        }
        await page.keyboard.press('Escape');
      }
      for (const [x, z] of shot.walk || []) {
        await walkFacilityTo(page, x, z);
        actions.push(`walk to (${x}, ${z})`);
      }
      if (shot.yaw !== undefined) {
        await aimFacilityView(page, shot.yaw, shot.pitch || 0);
        actions.push(`mouse look yaw=${shot.yaw} pitch=${shot.pitch || 0}`);
      }
      await page.waitForLoadState('networkidle');
      // Normal animation keeps running, including water reflection updates.
      const startFrame = await page.evaluate(() => window.atriumFacilityProbe.frame);
      await page.waitForFunction(start => window.atriumFacilityProbe.frame >= start + 20, startFrame, { timeout: 120_000 });
      const settleMs = shot.settleMs || (shot.world === 'cinema' ? 9000 : 1500);
      await page.waitForTimeout(settleMs);
      const image = `${shot.id}.png`;
      await page.screenshot({ path: join(out, image), style: '.coast-ui { visibility: hidden !important; }', timeout: 120_000 });
      const rendered = await page.evaluate(() => {
        const { view, projection, draws, frame } = window.atriumFacilityProbe;
        const canvas = document.querySelector('canvas.coast-view');
        return { ...view, projection, draws, frame,
          raster: { width: canvas.width, height: canvas.height, dpr: devicePixelRatio },
          animationTimeMs: performance.now(),
          highQuality: document.querySelector('.coast-high')?.getAttribute('aria-pressed') === 'true',
        };
      });
      assert.deepEqual(rendered.raster, { ...plan.viewport, dpr: 1 });
      assert.equal(rendered.highQuality, true);
      assert.ok(rendered.draws?.onScreenCalls > 0);
      if (shot.ui) await page.screenshot({ path: join(out, `${shot.id}-ui.png`), timeout: 120_000 });
      // Fingerprint the HTML and scripts actually served, including when an
      // existing local origin is used. These hashes identify rendered bytes;
      // they do not establish that dist was built from sourceRevision.
      const servedBuild = {
        htmlSha256: createHash('sha256').update(await documentResponse.body()).digest('hex'),
        scripts: await Promise.all(scriptResponses.map(async response => ({
          path: new URL(response.url()).pathname,
          sha256: createHash('sha256').update(await response.body()).digest('hex'),
        }))),
        sourceRevisionBinding: 'not automatically verified; build dist from the recorded clean source before recapture',
      };
      servedBuild.scripts.sort((a, b) => a.path.localeCompare(b.path));
      assert.ok(servedBuild.scripts.length, 'Observe at least one served application script');
      servedBuild.sha256 = createHash('sha256').update(JSON.stringify({
        htmlSha256: servedBuild.htmlSha256, scripts: servedBuild.scripts,
      })).digest('hex');
      const metadata = { ...shot, image, uiImage: shot.ui ? `${shot.id}-ui.png` : null,
        capturedAt: new Date().toISOString(), sourceRevision,
        trackedSourceAndPublicClean: true, servedBuild,
        url: page.url(), browser: browser.version(), viewport: plan.viewport,
        quality: plan.quality, lighting: 'world default', actions, settleMs,
        animation: 'normal requestAnimationFrame; no time override',
        samplePlaybackSeconds: sampleStartedAt === null ? null : (rendered.animationTimeMs - sampleStartedAt) / 1000,
        input: 'public URL destination, ordinary pointer-lock mouse / keyboard / visible controls; no scene mutation',
        ...rendered, pageerrors, resourceFailures,
        sha256: createHash('sha256').update(await readFile(join(out, image))).digest('hex'),
      };
      await writeFile(join(out, `${shot.id}.json`), JSON.stringify(metadata, null, 2) + '\n');
      assert.deepEqual(pageerrors, []);
      assert.deepEqual(resourceFailures, []);
      console.log(`Captured ${shot.id}: ${rendered.projection.verticalFovDeg.toFixed(1)} deg, ${rendered.frame} frames`);
    } finally {
      await context.close();
    }
  }
} finally {
  try { await browser?.close(); } finally { await server?.close(); }
}
