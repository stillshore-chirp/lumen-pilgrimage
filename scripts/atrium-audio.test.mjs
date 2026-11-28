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
  ATRIUM_AIR_SOURCES,
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
const { ATRIUM_FRONT_END_BAYS, atriumFrontWindowMullions } = await import('../src/coast/world/atrium/atriumFrontPlan.ts');
const { ATRIUM_MONITOR_SPEAKERS, atriumMonitorChannel, atriumMonitorPath } = await import('../src/coast/world/atrium/atriumMonitorAudio.ts');
const { ATRIUM_CAFE_SPEAKERS, atriumCafeWorldPoint } = await import('../src/coast/world/atrium/atriumCafePlan.ts');
hooks.deregister();

test('shared facility output follows equipment and cafe opening/partition geometry', () => {
  assert.equal(ATRIUM_MONITOR_SPEAKERS.length, 18);
  assert.equal(ATRIUM_CAFE_SPEAKERS.length, 6);
  for (const speaker of ATRIUM_CAFE_SPEAKERS) {
    const [left, right] = speaker.position[2] < -38.5 ? [0, 1] : [1, 0];
    assert.equal(atriumMonitorChannel('cafe', speaker), left);
    assert.notEqual(atriumMonitorChannel('cafe', speaker), right);
  }
  assert.ok(ATRIUM_MONITOR_SPEAKERS.every(speaker => atriumMonitorChannel('atrium', speaker)
    === (speaker.position[0] < 0 ? 0 : 1)));
  const location = (u, d) => {
    const [x, y, z] = atriumCafeWorldPoint(u, d, 1.6);
    return { x, y, z };
  };
  const speaker = ATRIUM_CAFE_SPEAKERS.at(-2);
  const inside = atriumMonitorPath('cafe', speaker, location(5.05, 14.8));
  const outside = atriumMonitorPath('cafe', speaker, location(4.15, -2));
  assert.ok(inside.gain > outside.gain * 3);
  assert.equal(inside.cutoff, 8_000);
  assert.ok(outside.cutoff <= 1_800);
  assert.notEqual(outside.point.x, speaker.position[0], 'outside arrival comes through the entrance');
  assert.ok(inside.reflections.every(reflection => reflection.delay > 0 && reflection.gain > 0));
  const blocked = atriumMonitorPath('cafe', speaker, location(2, 17));
  assert.equal(blocked.cutoff, 900);
  assert.ok(blocked.reflections.every(reflection => reflection.gain === 0));
  assert.ok(blocked.gain < inside.gain * .25);
  const behindPartition = atriumMonitorPath('cafe', speaker, location(6.4, 17.7));
  assert.equal(behindPartition.cutoff, 900,
    'a segment that enters and leaves the closed store room is blocked even with both endpoints outside');
  assert.ok(behindPartition.reflections.every(reflection => reflection.gain === 0));
  for (const emitter of ATRIUM_MONITOR_SPEAKERS) {
    const path = atriumMonitorPath('atrium', emitter, open);
    assert.ok(Number.isFinite(path.gain) && path.gain > 0);
    assert.ok(path.cutoff > 0 && Number.isFinite(path.lateSend));
    const throughDoor = atriumMonitorPath('atrium', emitter, location(5.05, 12));
    assert.ok(throughDoor.cutoff <= 1_800 && throughDoor.gain < path.gain);
    assert.ok(throughDoor.reflections.every(reflection =>
      reflection.point.x === throughDoor.point.x && reflection.point.y === throughDoor.point.y
      && reflection.point.z === throughDoor.point.z && reflection.cutoff <= 1_800),
    'all outside arrivals finish through the same cafe opening');
  }
});

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

test('the front glazing returns a near footfall from the shared finished face on each level', () => {
  for (const floor of [0, ...ATRIUM_LEVELS]) {
    for (const x of floor === 0 ? [-2.7] : [-6.5, -2.7, 6.5]) {
      const listener = { x, y: floor + 1.65, z: 1.2 };
      const source = { x, y: floor + 0.045, z: 1.2 };
      const path = atriumSoundPath(listener, source);
      const arrival = path.reflections.find(reflection => reflection.surface === 'front-glass' && reflection.gain > 0);
      assert.ok(arrival, `the bay at (${x}, ${floor}) m has a finite front-glass arrival`);
      assert.equal(path.reflections.length, 2);
      assert.equal(arrival.point.x, x);
      assert.equal(arrival.point.z, 3.040, 'the atrium-side glass face, not the slab centre, defines the reflection');
      assert.ok(Math.abs(arrival.point.y - (floor + 0.8475)) < 1e-9);
      assert.ok(Math.abs(arrival.delay - 0.007026) < 0.000001, 'the excess path is approximately 7.026 ms');
    }
  }
});

test('the four end-display window assemblies reflect their glass and flush metal frames', () => {
  let bays = 0;
  for (const bay of ATRIUM_FRONT_END_BAYS) {
    for (const span of bay.glassX) {
      bays += 1;
      const x = (span[0] + span[1]) * 0.5;
      const listener = { x, y: 1.65, z: 2 };
      const source = { x, y: 0.045, z: 2 };
      const path = atriumSoundPath(listener, source);
      const arrival = path.reflections.find(reflection => reflection.surface === 'front-glass' && reflection.gain > 0);
      assert.ok(arrival, `${bay.id} assembly ${span} returns the near footfall`);
      assert.equal(path.reflections.length, 2);
      assert.equal(arrival.point.z, 3.040);
      assert.ok(Math.abs(arrival.point.y - 0.8475) < 1e-9);
      assert.ok(Math.abs(arrival.delay - 0.002980311) < 1e-9);
      for (const bar of atriumFrontWindowMullions(span)) {
        const atFrame = { x: bar.position, y: 1.2, z: 2.8 };
        assert.ok(atriumSoundPath(atFrame, atFrame).reflections.some(reflection =>
          reflection.surface === 'front-glass' && reflection.gain > 0), 'flush metal is not a silent hole');
      }
    }
  }
  assert.equal(bays, 4);
});

test('front-glass reflections stop at finite panel edges and do not widen other room bounds', () => {
  const hasFront = (listener, source = listener) => atriumSoundPath(listener, source).reflections.some(reflection =>
    reflection.surface === 'front-glass' && reflection.gain > 0);
  assert.equal(hasFront({ x: 4.481, y: 0.8475, z: 1.2 }), false, 'outside the garden glazing width');
  assert.equal(hasFront({ x: 0, y: 0.119, z: 1.2 }), false, 'below the garden glazing');
  assert.equal(hasFront({ x: 0, y: 3.921, z: 1.2 }), false, 'above the garden glazing');
  assert.equal(hasFront({ x: 0, y: 4.3, z: 1.2 }), false, 'between the garden and upper glazing');
  assert.equal(hasFront({ x: 8.851, y: 5.4, z: 1.2 }), false, 'outside the upper glazing width');
  assert.equal(hasFront({ x: -4.72, y: 5.4, z: 1.2 }), false, 'the west support is not part of the glass');
  assert.equal(hasFront({ x: 4.72, y: 5.4, z: 1.2 }), false, 'the east support is not part of the glass');
  for (const x of [-10.801, -8.99, -5, 5, 8.99, 10.801]) {
    assert.equal(hasFront({ x, y: 1.2, z: 2.8 }), false, `the end-display boundary or support excludes x=${x}`);
  }
  assert.equal(hasFront({ x: 7, y: 0.149, z: 2.8 }), false, 'below the end-display glazing');
  assert.equal(hasFront({ x: 7, y: 3.351, z: 2.8 }), false, 'above the end-display glazing');
  assert.equal(hasFront({ x: 0, y: 1.2, z: 3.1 }), false, 'the sealed garden side is not a listening region');

  const outsideWalkBound = atriumSoundPath({ x: -2.7, y: 1.65, z: 3.02 }, { x: -2.7, y: 0.045, z: 3.02 });
  assert.ok(outsideWalkBound.reflections.some(reflection => reflection.surface === 'front-glass' && reflection.gain > 0));
  assert.equal(outsideWalkBound.reflections.some(reflection => reflection.surface !== 'front-glass' && reflection.gain > 0),
    false, 'only the shared front face may extend past the existing maxZ');
  assert.equal(ATRIUM_BOUNDS.maxZ, 3);
});

test('the sofa excludes the 187.566 ms front return while keeping its existing direct path and tail', () => {
  const footfall = { x: sofa.x, y: 0.045, z: sofa.z };
  const footPath = atriumSoundPath(sofa, footfall);
  assert.equal(ATRIUM_REFLECTION_MAX_DELAY, 0.18);
  assert.equal(footPath.reflections.some(reflection => reflection.surface === 'front-glass' && reflection.gain > 0), false);

  // Baseline values captured before adding the front reflection candidate.
  const existing = atriumSoundPath(sofa, ATRIUM_AIR_SOURCES[0]);
  for (const [field, expected] of Object.entries({
    directDistance: 17.857572623399857,
    gain: 0.19485286129805532,
    cutoff: 11595.289025573835,
    shelter: 0,
    lateSend: 0.10046859163898561,
  })) assert.ok(Math.abs(existing[field] - expected) < 1e-9, `${field} retains the pre-change value`);
  assert.ok(Math.abs(atriumLocalTailMix(sofa) - 0.36985712998201664) < 1e-12);
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
  assert.equal(source.x, 17.2);
  assert.equal(source.y, .65);
  assert.ok(Math.abs(source.z + 34.05) < 1e-10);
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
