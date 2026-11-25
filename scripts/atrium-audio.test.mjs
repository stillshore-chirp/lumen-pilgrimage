import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const src = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const {
  atriumSoundPath,
  atriumCafeSource,
  atriumGallerySources,
  atriumSurfaceAt,
  ATRIUM_SOUND_SPEED,
} = await import('../src/coast/world/atrium/atriumAcoustics.ts');
const {
  createAtriumAirLoop,
  createAtriumCrowdLoop,
  createAtriumDishEvent,
  createAtriumFootfall,
  createAtriumGalleryEvent,
  createAtriumGalleryLoop,
  createAtriumRoomTail,
} = await import('../src/coast/world/atrium/atriumAudioSamples.ts');
const { ATRIUM_CAFE, ATRIUM_GALLERY_EDGE, ATRIUM_LEVELS, ATRIUM_SOFA, atriumStairFrame, atriumUpperStairPoint } =
  await import('../src/coast/world/atrium/atriumLayout.ts');
hooks.deregister();

test('atrium early arrivals use the shared layout and physical image excess', () => {
  const cafe = atriumCafeSource();
  const listener = { x: ATRIUM_SOFA.x, y: ATRIUM_SOFA.seatedEyeHeight, z: ATRIUM_SOFA.z };
  const path = atriumSoundPath(listener, cafe);
  assert.ok(path.directDistance > 11 && path.directDistance < 12);
  assert.ok(path.reflections.length <= 2);
  assert.ok(path.reflections.some(reflection => reflection.surface === 'floor'));
  const imageDistance = Math.hypot(
    listener.x - cafe.x,
    listener.y + cafe.y,
    listener.z - cafe.z,
  );
  const floor = path.reflections.find(reflection => reflection.surface === 'floor');
  assert.ok(floor);
  assert.ok(Math.abs(floor.delay - (imageDistance - path.directDistance) / ATRIUM_SOUND_SPEED) < 1e-9);
  assert.ok(floor.gain > 0 && floor.gain < 0.4);
  assert.ok(path.lateSend > 0.18 && path.lateSend < 0.72);
});

test('gallery slab shelter removes high frequencies while the open void remains live', () => {
  const [, gallery] = atriumGallerySources();
  const underGallery = { x: 9.25, y: 1.65, z: -16.8 };
  const openVoid = { x: 0, y: 1.65, z: -16.8 };
  const sheltered = atriumSoundPath(underGallery, gallery);
  const open = atriumSoundPath(openVoid, gallery);
  assert.ok(sheltered.shelter > 0.2);
  assert.equal(open.shelter, 0);
  assert.ok(sheltered.cutoff < open.cutoff * 0.64);
  assert.ok(sheltered.lateSend > open.lateSend);
});

test('atrium floor levels and footstep materials follow the shared plan', () => {
  assert.equal(atriumSurfaceAt(0, -24, 0), 'stone');
  assert.equal(atriumSurfaceAt(-2.1, -32, 0), 'rug');
  assert.equal(atriumSurfaceAt(ATRIUM_GALLERY_EDGE + 0.2, -20, 0), 'stone');
  assert.equal(atriumSurfaceAt(ATRIUM_GALLERY_EDGE + 0.2, -20, ATRIUM_LEVELS[1]), 'gallery');
  for (const point of [atriumStairFrame(8.2), atriumUpperStairPoint(4.5, 0)]) {
    assert.equal(atriumSurfaceAt(point.x, point.z, point.y), 'stair');
  }
  assert.equal(ATRIUM_CAFE.x, 8.9);
  assert.equal(ATRIUM_CAFE.z, -30.7);
});

class AudioBuffers {
  sampleRate = 48_000;

  createBuffer(numberOfChannels, length, sampleRate) {
    const data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    return {
      duration: length / sampleRate,
      sampleRate,
      numberOfChannels,
      getChannelData: channel => data[channel],
    };
  }
}

function energy(samples) {
  return samples.reduce((sum, value) => sum + value * value, 0);
}

test('procedural source loops and void tail are deterministic, bounded, and seam-safe', () => {
  const context = new AudioBuffers();
  const crowdA = createAtriumCrowdLoop(context, 1_731).getChannelData(0);
  const crowdB = createAtriumCrowdLoop(context, 1_731).getChannelData(0);
  assert.deepEqual(crowdA, crowdB);
  for (const samples of [
    crowdA,
    createAtriumGalleryLoop(context, 2_417).getChannelData(0),
    createAtriumAirLoop(context, 3_811).getChannelData(0),
    createAtriumDishEvent(context, 4_771).getChannelData(0),
    createAtriumGalleryEvent(context, 5_311).getChannelData(0),
  ]) {
    assert.equal(samples[0], 0);
    assert.equal(samples.at(-1), 0);
    assert.ok(energy(samples) > 0);
    assert.ok(samples.every(sample => Math.abs(sample) < 1));
  }
  const tail = createAtriumRoomTail(context, 10_731);
  assert.equal(tail.numberOfChannels, 2);
  assert.ok(tail.duration > 1.9 && tail.duration < 2.01);
  assert.notDeepEqual(tail.getChannelData(0), tail.getChannelData(1));
  const tailEnergy = energy(tail.getChannelData(0));
  const lateEnergy = energy(tail.getChannelData(0).slice(Math.round(context.sampleRate * 1.55)));
  assert.ok(tailEnergy > 0 && lateEnergy > 0);
  for (const surface of ['stone', 'rug', 'stair', 'gallery']) {
    const hard = createAtriumFootfall(context, surface, 81).getChannelData(0);
    assert.equal(hard[0], 0);
    assert.equal(hard.at(-1), 0);
    assert.ok(energy(hard) > 0);
  }
});
