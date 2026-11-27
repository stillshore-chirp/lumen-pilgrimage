import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import {
  BoxGeometry, Camera, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, Scene, ShaderLib, Texture, UniformsUtils, Vector3,
} from 'three';

const source = new URL('../src/coast/world/cinema/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const local = context.parentURL?.startsWith(source) && specifier.startsWith('./') && !specifier.endsWith('.ts');
    return nextResolve(local ? `${specifier}.ts` : specifier, context);
  },
});
const { createCinemaLighting } = await import('../src/coast/world/cinema/cinemaLighting.ts');
const { cinemaFinishes } = await import('../src/coast/world/cinema/cinemaFinishes.ts');
const { applyCinemaMetricBoxUv } = await import('../src/coast/world/cinema/cinemaMetricUv.ts');
const {
  bakeCinemaLightTransport, cinemaLightQuality, cinemaPictureOpening, cinemaProjectionFalloff, cinemaScreenLevels,
  CINEMA_LIGHT_BOUNCE, CINEMA_LIGHT_CROWN, CINEMA_ROOM_RETURN,
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

test('16:9 screen fits landscape and portrait content without distorting it', () => {
  for (const aspect of [9 / 16, 1, 4 / 3, 16 / 9, 1.85, 2.39, 3]) {
    const [x, y] = cinemaPictureOpening(aspect);
    assert.ok(x <= 1 && y <= 1);
    assert.ok(Math.abs(x * (16 / 9) / y - aspect) < 1e-12);
  }
  assert.deepEqual(cinemaPictureOpening(16 / 9), [1, 1]);
  assert.deepEqual(cinemaPictureOpening(9 / 16), [81 / 256, 1]);
  assert.deepEqual(cinemaPictureOpening(2.39), [1, (16 / 9) / 2.39]);
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

test('a bright frame falls off through the auditorium at each quality', () => {
  for (const quality of ['light', 'high']) {
    const { columns, rows, probeColumns, probeRows } = cinemaLightQuality[quality];
    const transport = bakeCinemaLightTransport(quality);
    const whiteField = index => cinemaProjectionFalloff(
      (index % columns + 0.5) / columns, (Math.floor(index / columns) + 0.5) / rows,
    );
    const wall = column => sum(probe(transport, quality, 2, column, probeRows >> 1), whiteField);
    const floor = row => sum(probe(transport, quality, 0, probeColumns >> 1, row), whiteField);
    const seat = (page, row) => sum(probe(transport, quality, page, probeColumns >> 1, row), whiteField);
    assert.ok(wall(1) > wall(probeColumns - 1) * 5, `${quality} sidewall falloff`);
    assert.ok(floor(1) > floor(probeRows - 1) * 25, `${quality} floor falloff`);
    const row = probeRows >> 1;
    assert.ok(seat(1, row) > seat(CINEMA_LIGHT_CROWN, row) * 1.65, `${quality} grazing seat light`);
    assert.ok(seat(CINEMA_LIGHT_CROWN, row) > 0, `${quality} seat crown receives its own light`);
  }
});

test('raised rear seat receivers still pick up shadows from preceding seat backs', () => {
  const quality = 'high';
  const { columns, rows, probeColumns, probeRows } = cinemaLightQuality[quality];
  const transport = bakeCinemaLightTransport(quality);
  const rearSeat = probe(transport, quality, 1, probeColumns >> 1, probeRows - 1);
  const screenColumn = (columns >> 1) - 1;
  const lower = rearSeat[screenColumn];
  const upper = rearSeat[(rows - 1) * columns + screenColumn];
  assert.ok(lower > 0 && lower < upper * 0.12);
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
  const {
    cinemaLive, cinemaSource, cinemaLamps, cinemaLightPrev, cinemaLightNext, cinemaLightBlend, cinemaProjectorWhite,
  } = shader.uniforms;
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
    lights.update(0.08, camera);
    lights.prepareRender(renderer, camera);
    assert.equal(cinemaLightBlend.value, 0, 'the room still shows the preceding frame on the first sampled update');
    assert.notEqual(cinemaLightPrev.value, cinemaLightNext.value);
    lights.update(0.093, camera);
    lights.prepareRender(renderer, camera);
    assert.ok(cinemaLightBlend.value > 0.25 && cinemaLightBlend.value < 0.6);
    lights.update(0.12, camera);
    lights.prepareRender(renderer, camera);
    assert.equal(cinemaLightBlend.value, 1, 'the new room field settles within the sampling interval');
    lights.update(0, camera);

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
    assert.equal(renders, 6);
    lights.setMode('service');
    assert.ok(cinemaLamps.value.z > 0 && cinemaLamps.value.y === 0);
    lights.update(8.325, camera);
    assert.ok(Math.abs(cinemaLamps.value.y - 0.56) < 1e-9);
    assert.ok(Math.abs(cinemaLamps.value.z - 0.48) < 1e-9);
    assert.equal(cinemaLive.value, 0);
    lights.update(8.65, camera);
    assert.ok(cinemaLamps.value.y > 1.11 && cinemaLamps.value.z < 1e-9);

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
    const beforeHidden = renders;
    lights.prepareRender(renderer, camera);
    assert.equal(renders, beforeHidden, 'a hidden source skips both light transport passes');
    lights.setFrame(frame, 16 / 9);
    lights.prepareRender(renderer, camera);
    assert.equal(cinemaLive.value, 1);
    assert.equal(renders, beforeHidden + 2);
    assert.equal(cinemaLightPrev.value, cinemaLightNext.value, 'resuming uses the fresh field immediately');
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

test('metric panel UVs keep a 16 mm pitch after nonuniform and rotated instance transforms', () => {
  const geometry = new BoxGeometry();
  const origin = new Vector3();
  const u = new Vector3();
  const v = new Vector3();
  for (const scale of [[1, 1, 1], [2.91, 14, .18]]) {
    for (const angle of [0, .64]) {
      const matrix = new Matrix4().makeRotationY(angle).scale(new Vector3(...scale));
      const lengths = [0, 1, 2].map(axis => new Vector3().setFromMatrixColumn(matrix, axis).length());
      for (let face = 0; face < 6; face += 1) {
        const dimensions = face < 2 ? [lengths[2], lengths[1]] : face < 4 ? [lengths[0], lengths[2]] : [lengths[0], lengths[1]];
        origin.fromBufferAttribute(geometry.attributes.position, face * 4).applyMatrix4(matrix);
        u.fromBufferAttribute(geometry.attributes.position, face * 4 + 1).applyMatrix4(matrix);
        v.fromBufferAttribute(geometry.attributes.position, face * 4 + 2).applyMatrix4(matrix);
        const pitches = [u.distanceTo(origin), v.distanceTo(origin)]
          .map((length, axis) => length / (8 * 7.8125 * dimensions[axis]));
        for (const pitch of pitches) assert.ok(Math.abs(pitch - .016) < 1e-12);
      }
    }
  }
  geometry.dispose();
});

test('metric panel maps and bumps retain cinema lighting hooks across quality changes', () => {
  const finish = cinemaFinishes();
  const panel = finish.acoustic;
  assert.throws(() => applyCinemaMetricBoxUv(panel, 7.8125), /already configured/);
  assert.deepEqual(panel.map.repeat.toArray(), [1, 1]);
  assert.deepEqual(finish.seatFabric.map.repeat.toArray(), [3.75, 4.25]);
  assert.deepEqual(finish.carpet.map.repeat.toArray(), [1, 1]);
  const legacy = new MeshStandardMaterial({ map: finish.seatFabric.map });
  assert.throws(() => applyCinemaMetricBoxUv(legacy, 1), /unit sampler repeat/);
  const metricCompile = panel.onBeforeCompile;
  const metricKey = panel.customProgramCacheKey();
  const geometry = new BoxGeometry();
  const group = new Group();
  group.add(new InstancedMesh(geometry, panel, 1));
  const lights = createCinemaLighting(new Scene(), group);
  try {
    for (const high of [false, true, false, true]) {
      finish.setHighDetail(high);
      assert.equal(panel.bumpMap, high ? panel.map : null);
      if (high) assert.equal(panel.bumpScale, .0008);
      const shader = {
        uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
        vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader,
      };
      panel.onBeforeCompile(shader, undefined);
      assert.equal(shader.vertexShader.split('uniform float cinemaMetricCycles;').length - 1, 1);
      assert.equal(shader.uniforms.cinemaMetricCycles.value, 7.8125);
      assert.ok(shader.vertexShader.includes('vMapUv = (mapTransform'));
      assert.ok(shader.vertexShader.includes('vBumpMapUv = (bumpMapTransform'));
      assert.ok(shader.vertexShader.includes('cinemaWorld ='));
      assert.ok(shader.fragmentShader.includes('cinemaArchitecturalLight'));
      assert.equal(panel.customProgramCacheKey(), `${metricKey}|cinema-lit-surfaces-v1`);
    }
  } finally {
    lights.dispose();
    assert.equal(panel.onBeforeCompile, metricCompile);
    legacy.dispose();
    geometry.dispose();
    const textures = new Set();
    for (const material of Object.values(finish)) if (material instanceof MeshStandardMaterial) {
      if (material.map) textures.add(material.map);
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    finish.box.dispose();
  }
});
