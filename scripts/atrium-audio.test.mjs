import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { test } from 'node:test';

const src = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !extname(specifier);
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const {
  ATRIUM_REFLECTION_MAX_DELAY,
  ATRIUM_SERVICE_SOURCES,
  ATRIUM_SOUND_SPEED,
  atriumLocalTailMix,
  atriumSoundPath,
  atriumSurfaceAt,
  createAtriumSoundPath,
} = await import('../src/coast/world/atrium/atriumAcoustics.ts');
const { createAtriumEquipmentLoop, createAtriumFootfall, createAtriumRoomTail } =
  await import('../src/coast/world/atrium/atriumAudioSamples.ts');
const {
  ATRIUM_BOUNDS, ATRIUM_GALLERY_EDGE,
  ATRIUM_LEVELS, ATRIUM_LOUNGE, ATRIUM_SOFA, ATRIUM_WALK_LEVEL, atriumStairFrame, atriumUpperStairPoint,
} = await import('../src/coast/world/atrium/atriumLayout.ts');
const { ATRIUM_TENANTS, tenantWorldPoint } = await import('../src/coast/world/atrium/atriumTenantPlan.ts');
hooks.deregister();

const open = { x: 0, y: 1.65, z: -19 };
const underGallery = { x: ATRIUM_BOUNDS.maxX - 1.7, y: 1.65, z: -19 };
const sofa = { x: ATRIUM_SOFA.x, y: ATRIUM_SOFA.seatedEyeHeight, z: ATRIUM_SOFA.z };
const upperGallery = { x: ATRIUM_BOUNDS.minX + 2.2, y: ATRIUM_WALK_LEVEL + 1.65, z: -44.1 };

function tenantSoundPoint(bay, u, y, d) {
  return { ...tenantWorldPoint(bay, u, d), y };
}

function checkHorizontalArrival(listener, source, surface) {
  const path = atriumSoundPath(listener, source);
  const reflection = path.reflections.find(arrival => arrival.surface === surface && arrival.gain > 0);
  assert.ok(reflection, `${surface} should produce an early reflection`);
  const { y } = reflection.point;
  const imageDistance = Math.hypot(listener.x - source.x, listener.y - (2 * y - source.y), listener.z - source.z);
  assert.ok(reflection.delay <= ATRIUM_REFLECTION_MAX_DELAY);
  assert.ok(Math.abs(reflection.delay - (imageDistance - path.directDistance) / ATRIUM_SOUND_SPEED) < 1e-9);
  return reflection;
}

test('stone floor, soffit and gallery deck provide different finite image paths', () => {
  const floor = checkHorizontalArrival(open, { x: -1.2, y: 1.25, z: -19.6 }, 'floor');
  assert.equal(floor.point.y, 0);
  const underSource = { x: ATRIUM_GALLERY_EDGE - 0.25, y: 1.31, z: -17 };
  const soffit = checkHorizontalArrival(underGallery, underSource, 'soffit');
  assert.ok(soffit.point.y < ATRIUM_LEVELS[0] && soffit.point.y > ATRIUM_LEVELS[0] - 0.6);
  const gallery = checkHorizontalArrival(upperGallery,
    { x: ATRIUM_BOUNDS.minX + 1.2, y: ATRIUM_WALK_LEVEL + 1.15, z: -42.2 }, 'gallery-floor');
  assert.equal(gallery.point.y, ATRIUM_WALK_LEVEL);

  const path = createAtriumSoundPath();
  const arrivals = [...path.reflections];
  assert.equal(atriumSoundPath(underGallery, underSource, path), path);
  atriumSoundPath(open, underSource, path);
  for (const arrival of arrivals) assert.ok(path.reflections.includes(arrival));
});

test('a finite gallery slab shelters an elevated source and the lounge softens the floor arrival', () => {
  const upperSource = { x: ATRIUM_GALLERY_EDGE + 0.48, y: ATRIUM_LEVELS[0] + 2.85, z: -18.6 };
  const sheltered = atriumSoundPath(underGallery, upperSource);
  const exposed = atriumSoundPath(open, upperSource);
  assert.ok(sheltered.shelter > 0.7);
  assert.equal(exposed.shelter, 0);
  assert.ok(sheltered.cutoff < exposed.cutoff * 0.45);
  assert.ok(sheltered.gain < exposed.gain, 'obstruction offsets the shorter distance to the elevated source');
  assert.ok(sheltered.lateSend / sheltered.gain > exposed.lateSend / exposed.gain);

  const rugSource = { x: ATRIUM_LOUNGE.x, y: 0.8, z: ATRIUM_LOUNGE.z };
  const rug = checkHorizontalArrival(sofa, rugSource, 'floor');
  const stone = checkHorizontalArrival({ ...sofa, z: sofa.z + 13 }, { ...rugSource, z: rugSource.z + 13 }, 'floor');
  assert.ok(rug.gain < stone.gain * 0.3);
  assert.ok(rug.cutoff < stone.cutoff * 0.4);
});

test('R2 equipment uses the same recessed opening and glazing as the storefront', () => {
  assert.equal(ATRIUM_SERVICE_SOURCES.length, 2);
  const source = ATRIUM_SERVICE_SOURCES[0];
  assert.deepEqual(source, { x: 15.92, y: 0.65, z: -35.45 });
  const cafe = ATRIUM_TENANTS.find(bay => bay.id === 'R2');
  const throughOpening = atriumSoundPath(tenantSoundPoint(cafe, 4.0, 1.65, -2.2), source);
  const throughGlass = atriumSoundPath(tenantSoundPoint(cafe, 1.32, 1.65, -2.2), source);
  const throughWall = atriumSoundPath(tenantSoundPoint(cafe, -1, 1.65, -2.2), source);
  assert.equal(throughOpening.shelter, 0);
  assert.ok(throughGlass.shelter > 0 && throughGlass.shelter < throughWall.shelter);
  assert.ok(throughGlass.gain < throughOpening.gain * 0.75);
  assert.ok(throughGlass.cutoff < throughOpening.cutoff * 0.40);
  assert.ok(throughWall.cutoff < throughGlass.cutoff);
});

test('the R4 entrance passes sound through its clear aperture, including recessed dimensions', () => {
  const bay = ATRIUM_TENANTS.find(bay => bay.id === 'R4');
  const source = tenantSoundPoint(bay, 1.7, 0.68, 4);
  const straight = atriumSoundPath(tenantSoundPoint(bay, 1.7, 1.65, -2), source);
  const glazed = atriumSoundPath(tenantSoundPoint(bay, 2.4, 1.65, -2), source);
  assert.equal(straight.shelter, 0);
  assert.ok(glazed.cutoff < straight.cutoff * 0.40);

  const oblique = atriumSoundPath(tenantSoundPoint(bay, 1.7, 1.65, -1), tenantSoundPoint(bay, 2.25, 0.68, 1));
  const lintel = atriumSoundPath(tenantSoundPoint(bay, 1.7, 2.6, -2), tenantSoundPoint(bay, 1.7, 2.6, 1));
  assert.ok(oblique.shelter > 0, 'the glazing return crosses an oblique ray into the opening');
  assert.ok(lintel.shelter > glazed.shelter, 'the solid lintel blocks a ray above the opening');
});

test('concourse side-wall reflections remain at fixed glazing and stop at the clear aperture', () => {
  const bay = ATRIUM_TENANTS.find(bay => bay.id === 'R4');
  const reachesSideWall = u => atriumSoundPath(tenantSoundPoint(bay, u, 1.65, -0.75),
    tenantSoundPoint(bay, u, 1.55, -0.6)).reflections.some(reflection =>
    reflection.surface === 'right-wall' && reflection.gain > 0);
  assert.equal(reachesSideWall(1.3), false);
  assert.equal(reachesSideWall(2.18), true);
});

test('atrium floor levels and footstep materials follow the shared plan', () => {
  assert.equal(atriumSurfaceAt(0, -24, 0), 'stone');
  assert.equal(atriumSurfaceAt(ATRIUM_LOUNGE.x, ATRIUM_LOUNGE.z, 0), 'rug');
  assert.equal(atriumSurfaceAt(ATRIUM_GALLERY_EDGE + 0.2, -20, 0), 'stone');
  for (const level of ATRIUM_LEVELS) {
    assert.equal(atriumSurfaceAt(ATRIUM_GALLERY_EDGE + 0.2, -20, level), 'gallery');
  }
  for (const point of [atriumStairFrame(8.2), atriumUpperStairPoint(4.5, 0)]) {
    assert.equal(atriumSurfaceAt(point.x, point.z, point.y), 'stair');
  }
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

function relativeDerivativeEnergy(samples) {
  let differences = 0;
  for (let index = 1; index < samples.length; index += 1) {
    differences += (samples[index] - samples[index - 1]) ** 2;
  }
  return differences / energy(samples);
}

test('equipment loops have steady, distinct spectra through their loop seams', () => {
  const context = new AudioBuffers();
  const air = createAtriumEquipmentLoop(context, 3_811, 'air').getChannelData(0);
  const service = createAtriumEquipmentLoop(context, 1_731, 'service').getChannelData(0);
  assert.deepEqual(air, createAtriumEquipmentLoop(context, 3_811, 'air').getChannelData(0));
  for (const samples of [air, service]) {
    const meanSquare = energy(samples) / samples.length;
    const seamFrames = Math.round(context.sampleRate * 0.075);
    const seamEnergy = energy(samples.subarray(0, seamFrames)) / seamFrames;
    assert.ok(seamEnergy > meanSquare * 0.65 && seamEnergy < meanSquare * 1.35);
    const jump = samples[0] - samples.at(-1);
    assert.ok(jump * jump < meanSquare * relativeDerivativeEnergy(samples) * 9);
    assert.ok(samples.every(sample => Math.abs(sample) < 0.32));
  }
  assert.ok(relativeDerivativeEnergy(service) < relativeDerivativeEnergy(air) * 0.65);
});

function decayTime(samples, sampleRate, fromDb, toDb) {
  const total = energy(samples);
  const from = total * 10 ** (fromDb / 10);
  const to = total * 10 ** (toDb / 10);
  let remaining = 0;
  let end = -1;
  // Backward integration estimates the decay of the generated impulse response.
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    remaining += samples[i] ** 2;
    if (end < 0 && remaining >= to) end = i;
    if (fromDb < 0 && remaining >= from) return (end - i) * 60 / (sampleRate * (fromDb - toDb));
  }
  if (fromDb === 0 && end >= 0) {
    const start = samples.findIndex(value => value !== 0);
    return (end - start) * 60 / (-sampleRate * toDb);
  }
  throw new Error('decay levels not reached');
}

test('late impulse responses shorten beneath a soffit, on galleries and near the upholstered lounge', () => {
  const context = new AudioBuffers();
  const openResponse = createAtriumRoomTail(context, 10_731, 'void');
  const shelteredResponse = createAtriumRoomTail(context, 10_893, 'sheltered');
  const long = openResponse.getChannelData(0);
  const short = shelteredResponse.getChannelData(0);
  assert.notDeepEqual(long, openResponse.getChannelData(1));
  assert.notDeepEqual(short, shelteredResponse.getChannelData(1));
  const longT20 = decayTime(long, context.sampleRate, -5, -25);
  const shortT20 = decayTime(short, context.sampleRate, -5, -25);
  assert.ok(longT20 > 1.55 && longT20 < 1.95, `open T20 estimate ${longT20}`);
  assert.ok(shortT20 > 0.78 && shortT20 < 1.02, `sheltered T20 estimate ${shortT20}`);
  const localDecay = point => {
    const local = atriumLocalTailMix(point);
    const mixed = long.map((value, index) => value * Math.sqrt(1 - local) + (short[index] ?? 0) * Math.sqrt(local));
    return decayTime(mixed, context.sampleRate, 0, -10);
  };
  const decays = [open, sofa, upperGallery, underGallery].map(localDecay);
  for (let index = 1; index < decays.length; index += 1) {
    assert.ok(decays[index] < decays[index - 1] - 0.07, `estimated early decay ${decays}`);
  }
});

test('rug contact is softer and less bright than polished stone and stair treads', () => {
  const context = new AudioBuffers();
  const createFootfall = surface => createAtriumFootfall(context, surface, 81).getChannelData(0);
  const stone = createFootfall('stone');
  const rug = createFootfall('rug');
  for (const samples of [stone, rug, createFootfall('stair'), createFootfall('gallery')]) {
    assert.equal(samples[0], 0);
    assert.equal(samples.at(-1), 0);
    assert.ok(energy(samples) > 0);
  }
  assert.ok(energy(rug) < energy(stone) * 0.2);
  assert.ok(relativeDerivativeEnergy(rug) < relativeDerivativeEnergy(stone) * 0.4);
});
