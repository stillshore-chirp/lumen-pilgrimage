import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Camera, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Scene, Texture } from 'three';

const source = new URL('../src/coast/world/cinema/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const local = context.parentURL?.startsWith(source) && specifier.startsWith('./') && !specifier.endsWith('.ts');
    return nextResolve(local ? `${specifier}.ts` : specifier, context);
  },
});
const { createCinemaLighting } = await import('../src/coast/world/cinema/cinemaLighting.ts');
const {
  bakeCinemaLightTransport, cinemaLightQuality, cinemaPictureOpening, cinemaProjectionFalloff, cinemaScreenLevels,
  CINEMA_LIGHT_BOUNCE, CINEMA_ROOM_RETURN,
} = await import('../src/coast/world/cinema/cinemaLightTransport.ts');
hooks.deregister();

function probe(transport, quality, page, column, row) {
  const { probeColumns } = cinemaLightQuality[quality];
  const index = (row * transport.width + page * probeColumns + column) * transport.count;
  return transport.weights.subarray(index, index + transport.count);
}

function sum(values, intensity = () => 1) {
  return values.reduce((total, value, index) => total + value * intensity(index), 0);
}

test('cinema reference white, black floor and intra-frame contrast follow projected APL', () => {
  assert.ok(Math.abs(cinemaScreenLevels(1, 1) - 48) < 1e-12);
  assert.ok(Math.abs(cinemaScreenLevels(0, 0) - 0.034) < 0.00001);
  const black = [0, 0.015, 0.05, 0.10, 0.50].map(mean => cinemaScreenLevels(0, mean));
  assert.deepEqual(black.map(value => +value.toFixed(3)), [0.034, 0.045, 0.072, 0.110, 0.414]);
  const contrasts = [0.015, 0.05, 0.10, 0.50].map(mean =>
    Math.round(cinemaScreenLevels(1, mean) / cinemaScreenLevels(0, mean)));
  assert.deepEqual(contrasts, [1041, 657, 431, 115]);
});

test('fixed-height screen preserves 16:9, 1.85 and 2.39 framing and fits wider footage', () => {
  for (const aspect of [16 / 9, 1.85, 2.39, 3]) {
    const [x, y] = cinemaPictureOpening(aspect);
    assert.ok(x <= 1 && y <= 1);
    assert.ok(Math.abs(x * 2.39 / y - aspect) < 1e-12);
  }
  assert.deepEqual(cinemaPictureOpening(1.85), [1.85 / 2.39, 1]);
  assert.deepEqual(cinemaPictureOpening(NaN), [1, 1]);
  assert.equal(cinemaProjectionFalloff(0.5, 0.5), 1);
  assert.ok(cinemaProjectionFalloff(0, 0) >= 0.75);
});

test('equal APL on opposite sides reverses the room wash at both qualities', () => {
  for (const quality of ['light', 'high']) {
    const { columns, probeRows } = cinemaLightQuality[quality];
    const transport = bakeCinemaLightTransport(quality);
    const band = Math.floor(probeRows / 2);
    const left = probe(transport, quality, 2, 0, band);
    const right = probe(transport, quality, 3, 0, band);
    const leftHalf = index => Number(index % columns < columns / 2);
    const rightHalf = index => 1 - leftHalf(index);
    const LL = sum(left, leftHalf);
    const LR = sum(left, rightHalf);
    const RR = sum(right, rightHalf);
    const RL = sum(right, leftHalf);
    assert.ok(LL > 1.8 * LR && RR > 1.8 * RL, quality);
    assert.ok(Math.abs(LL - RR) < 1e-7 && Math.abs(LR - RL) < 1e-7, quality);
  }
});

test('detailed room return is localized and calibrated at center on the white field', () => {
  const transport = bakeCinemaLightTransport('high');
  const { columns, rows, probeColumns, probeRows } = cinemaLightQuality.high;
  const whiteFalloff = index => cinemaProjectionFalloff(
    (index % columns + 0.5) / columns, (Math.floor(index / columns) + 0.5) / rows,
  );
  const center = probe(transport, 'high', CINEMA_LIGHT_BOUNCE, probeColumns >> 1, probeRows >> 1);
  const left = probe(transport, 'high', CINEMA_LIGHT_BOUNCE, 0, probeRows >> 1);
  assert.ok(Math.abs(sum(center, whiteFalloff) - CINEMA_ROOM_RETURN) < 1e-7);
  assert.ok(sum(left, index => Number(index % columns < columns / 2))
    > sum(left, index => Number(index % columns >= columns / 2)));
  assert.ok(transport.weights.every(value => Number.isFinite(value) && value >= 0));
});

test('lamp ramps, display resumption and emergency keep the picture state consistent', async t => {
  const room = new Group();
  const scene = new Scene();
  const camera = new Camera();
  const geometry = new PlaneGeometry();
  const standard = new MeshStandardMaterial();
  const permanent = new MeshBasicMaterial({ color: 0xa19070 });
  const cove = new MeshBasicMaterial({ color: 0xffffff });
  room.add(new Mesh(geometry, standard), new Mesh(geometry, permanent));
  const coveMesh = new Mesh(geometry, cove);
  coveMesh.userData.cinemaLightFixture = 'cove';
  room.add(coveMesh);
  const lights = createCinemaLighting(scene, room);
  const shader = { uniforms: {}, fragmentShader: '', vertexShader: '' };
  lights.screen.material.onBeforeCompile(shader);
  const { cinemaLive, cinemaSource, cinemaLamps, cinemaLightPrev, cinemaLightNext, cinemaProjectorWhite } = shader.uniforms;
  const frame = new Texture();
  const permanentColor = permanent.color.clone();
  const projectionWhite = cinemaProjectorWhite.value;

  let target = null;
  let renders = 0;
  let now = 100;
  t.mock.method(performance, 'now', () => now);
  const atlases = [];
  const renderer = {
    xr: { enabled: true },
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getContext: () => ({ getParameter: () => null, bindBuffer() {} }),
    setRenderTarget(value) { target = value; },
    render() {
      renders += 1;
      if (renders % 2 === 0) atlases.push(target);
    },
    async readRenderTargetPixelsAsync() { return new Uint8Array(4); },
  };
  try {
    lights.setFrame(frame, 16 / 9);
    lights.prepareRender(renderer, camera);
    assert.equal(cinemaLive.value, 1);
    assert.equal(target, null);
    assert.equal(renderer.xr.enabled, true);
    lights.setFrame(frame, 16 / 9);
    lights.prepareRender(renderer, camera);
    assert.equal(renders, 2);
    assert.equal(cinemaSource.value, frame);

    now += 600;
    lights.prepareRender(renderer, camera);
    assert.equal(renders, 4);
    assert.equal(cinemaLightPrev.value, cinemaLightNext.value);

    lights.setMode('screening');
    lights.update(4, camera);
    assert.ok(Math.abs(cinemaLamps.value.x - 0.46) < 1e-12);
    assert.ok(permanent.color.equals(permanentColor));
    lights.update(8, camera);
    assert.equal(cove.color.r, 0);
    assert.equal(cinemaProjectorWhite.value, projectionWhite);
    lights.setMode('emergency');
    assert.equal(cinemaLive.value, 0);
    assert.ok(cinemaLamps.value.z > 0);
    lights.prepareRender(renderer, camera);
    assert.equal(renders, 4);

    lights.setMode('arrival');
    lights.prepareRender(renderer, camera);
    assert.equal(cinemaLive.value, 1);
    const old = cinemaLightNext.value;
    let disposals = 0;
    for (const resource of new Set(atlases)) resource.addEventListener('dispose', () => disposals++);
    const atlasCount = new Set(atlases).size;
    lights.setQuality('high');
    assert.equal(cinemaLive.value, 0);
    assert.notEqual(cinemaLightNext.value, old);
    assert.equal(disposals, atlasCount);
    lights.prepareRender(renderer, camera);
    assert.equal(cinemaLive.value, 1);
    lights.setFrame(null);
    assert.equal(cinemaLive.value, 0);
    assert.notEqual(cinemaSource.value, frame);
  } finally {
    lights.dispose();
    assert.ok(!scene.children.includes(lights.screen));
    geometry.dispose();
    standard.dispose();
    permanent.dispose();
    cove.dispose();
    frame.dispose();
  }
});
