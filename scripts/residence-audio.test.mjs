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
  BALCONY_DOOR, RESIDENCE_INTERIOR_DOORS, RESIDENCE_ROADS, STREET_REFLECTION,
  residenceReceiver, residenceSoundPath, residenceSurfaceAt, residenceTrafficPath,
} = await import('../src/coast/world/residence/residenceAcoustics.ts');
const { RESIDENCE_AVENUE, RESIDENCE_BALCONY_REFLECTOR, RESIDENCE_CROSS_STREETS, RESIDENCE_STREET_LEVEL } =
  await import('../src/coast/world/residence/residenceCityPlan.ts');
const { RESIDENCE_FLOOR_ABOVE_STREET } = await import('../src/coast/world/residence/residenceFloor.ts');
const { RESIDENCE_ROOM_RESPONSES, createFootfall, createInteriorDoorSound, createRoomImpulse, createSlider } =
  await import('../src/coast/world/residence/residenceAudioSamples.ts');
hooks.deregister();

const ear = (x, north) => ({ x, y: 1.65, z: -north });
const south = RESIDENCE_ROADS[0].patches[0];
const east = RESIDENCE_ROADS[2].patches[1];
const core = ear(10.95, 13.8);
const living = ear(20, 0.9);
const bed = ear(19.4, -BALCONY_DOOR.z);
const balcony = ear(21.93, -BALCONY_DOOR.z);

test('traffic reaching the open balcony retains height, direction and distance', () => {
  const receiver = residenceReceiver(balcony, 0);
  const westArrival = residenceTrafficPath(receiver, south, true);
  const eastArrival = residenceTrafficPath(receiver, east, true);
  assert.equal(receiver.exterior, 1);
  assert.ok(eastArrival.arrival.x > balcony.x && westArrival.arrival.x < balcony.x);
  assert.ok(eastArrival.arrival.y < balcony.y - 8 && westArrival.arrival.y < balcony.y - 8);
  assert.equal(-east.y + 0.55, RESIDENCE_FLOOR_ABOVE_STREET);
  const near = residenceTrafficPath(receiver, { ...east, z: -15 }, false);
  const farSource = { ...east, z: -390 };
  const far = residenceTrafficPath(receiver, farSource, false);
  assert.ok(far.cutoff < near.cutoff * 0.55);
  assert.ok(far.gain < near.gain * 0.5);
  assert.ok(residenceTrafficPath(receiver, farSource, true).gain > far.gain * 1.35);
  const rail = residenceTrafficPath(residenceReceiver(ear(22.48, -BALCONY_DOOR.z), 0), east, true);
  assert.ok(rail.gain > eastArrival.gain * 1.3 && rail.cutoff > eastArrival.cutoff * 1.3);
  assert.ok(RESIDENCE_ROADS.every(road => road.patches.length === 2 && road.activity.night < road.activity.day));
});

test('the local street emitters stay on asphalt and the east reflection meets a facade', () => {
  const { from, to, patches } = RESIDENCE_ROADS[2];
  const { minX, maxX, minZ, maxZ } = RESIDENCE_AVENUE;
  for (const point of [from, ...patches, to]) {
    assert.ok(point.x > minX && point.x < maxX && point.z >= minZ && point.z <= maxZ);
  }
  assert.ok(from.z < patches[0].z && patches[0].z < east.z && east.z < to.z);
  const { minX: facade, minZ: north, maxZ: south, height } = RESIDENCE_BALCONY_REFLECTOR;
  assert.equal((east.x + STREET_REFLECTION.x) / 2, facade);
  const t = (facade - balcony.x) / (STREET_REFLECTION.x - balcony.x);
  const y = balcony.y + t * (STREET_REFLECTION.y - balcony.y) - RESIDENCE_STREET_LEVEL;
  const z = balcony.z + t * (STREET_REFLECTION.z - balcony.z);
  assert.ok(t > 0 && t < 1 && y > 0 && y < height && z > north && z < south);
});

test('the avenue traffic bed stays south of the closest boulevard', () => {
  const { from, to, patches } = RESIDENCE_ROADS[1];
  const { minX, maxX, minZ, maxZ } = RESIDENCE_AVENUE;
  const southEdge = RESIDENCE_CROSS_STREETS[0].maxZ;
  assert.ok(from.z < patches[0].z && patches[0].z < patches[1].z && patches[1].z < to.z);
  for (const point of [from, ...patches, to]) {
    assert.ok(point.x > minX && point.x < maxX && point.z > southEdge && point.z >= minZ && point.z <= maxZ);
  }
});

test('closed glazing favors low traffic frequencies and the stone core is quieter', () => {
  const outdoor = residenceTrafficPath(residenceReceiver(balcony, 0), east, true);
  const window = residenceTrafficPath(residenceReceiver(living, 0), south, true);
  const closedBed = residenceTrafficPath(residenceReceiver(bed, 0), east, true);
  const inner = residenceTrafficPath(residenceReceiver(core, 0), east, true);
  assert.ok(window.cutoff < 460 && window.gain > 0.02);
  assert.ok(closedBed.cutoff < outdoor.cutoff * 0.22 && closedBed.gain < outdoor.gain * 0.18);
  assert.ok(inner.gain < closedBed.gain * 0.25);
  assert.ok(window.arrival.z > living.z && window.arrival.y > living.y - 4);
});

test('the actual sliding door changes the primary bedroom continuously and stays local', () => {
  const amounts = [0, 0.12, 0.5, 0.82, 1].map(fraction =>
    residenceTrafficPath(residenceReceiver(bed, fraction), east, true));
  for (let i = 1; i < amounts.length; i += 1) {
    assert.ok(amounts[i].gain > amounts[i - 1].gain);
    assert.ok(amounts[i].cutoff > amounts[i - 1].cutoff);
  }
  assert.ok(amounts[4].gain > amounts[0].gain * 2.4);
  assert.ok(amounts[4].cutoff > amounts[0].cutoff * 3.5);
  const openCore = residenceTrafficPath(residenceReceiver(core, 1), east, true);
  const closedCore = residenceTrafficPath(residenceReceiver(core, 0), east, true);
  assert.deepEqual(openCore, closedCore);
  const threshold = [];
  for (let x = 20.44; x <= 21.44; x += 0.025) {
    const receiver = residenceReceiver(ear(x, -BALCONY_DOOR.z), 1);
    threshold.push(residenceTrafficPath(receiver, east, true).gain);
  }
  assert.ok(threshold.every((gain, i) => i === 0 || Math.abs(gain - threshold[i - 1]) < 0.07));
});

test('interior doors attenuate transmitted sound and its high frequencies independently', () => {
  assert.equal(RESIDENCE_INTERIOR_DOORS.length, 14);
  for (const { wall, opening } of RESIDENCE_INTERIOR_DOORS) {
    const at = (offset) => {
      const center = (opening.from + opening.to) / 2;
      return wall.axis === 'e' ? ear(center, wall.fixed + offset) : ear(wall.fixed + offset, center);
    };
    const listener = at(-0.78);
    const source = at(0.88);
    const paths = [0, 0.06, 0.24, 0.60, 1].map(amount => residenceSoundPath(listener, source,
      (_wall, gap) => gap === opening ? amount : 0));
    for (let index = 1; index < paths.length; index += 1) {
      assert.ok(paths[index].gain > paths[index - 1].gain);
      assert.ok(paths[index].cutoff > paths[index - 1].cutoff);
      assert.ok(paths[index].diffuseGain > paths[index - 1].diffuseGain);
    }
    assert.ok(paths[4].gain > paths[0].gain * 3.8);
    assert.ok(paths[4].cutoff > paths[0].cutoff * 10);
  }
});

test('the fusuma changes the arriving bearing, connected room reflections and south-window traffic', () => {
  const teaDoor = RESIDENCE_INTERIOR_DOORS.find(({ id }) => id === 'tea-room');
  const besideTea = ear(6.49, 5.77);
  const openness = amount => (_wall, opening) => opening === teaDoor.opening ? amount : 1;
  const closed = residenceReceiver(besideTea, 0, openness(0));
  const partway = residenceReceiver(besideTea, 0, openness(0.5));
  const open = residenceReceiver(besideTea, 0, openness(1));
  assert.ok(closed.wet[5] < partway.wet[5] && partway.wet[5] < open.wet[5]);
  assert.ok(Math.abs(open.wet.reduce((sum, value) => sum + value, 0) - 1) < 1e-8);
  assert.ok(open.south.gain > closed.south.gain * 3 && open.south.cutoff > closed.south.cutoff * 1.25);
  const offAxisListener = ear(5.2, 5.79);
  const offAxisSource = ear(5.2, 3.8);
  const path = residenceSoundPath(offAxisListener, offAxisSource, openness(1));
  assert.ok(path.arrival.x > 6 && Math.abs(path.arrival.z + 5) < 0.01);
  assert.ok(path.cutoff > residenceSoundPath(offAxisListener, offAxisSource, openness(0)).cutoff * 4);
  assert.deepEqual(residenceSoundPath(ear(6.2, 3.5), offAxisSource, openness(0)),
    residenceSoundPath(ear(6.2, 3.5), offAxisSource, openness(1)));
});

class AudioBuffers {
  sampleRate = 48_000;

  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: i => data[i], duration: length / sampleRate, sampleRate };
  }
}

test('room decay and footfalls follow the floor plan and the audio device rate', () => {
  const bathroom = ear(2, 8);
  const contexts = new AudioBuffers();
  assert.deepEqual([living, bed, core, bathroom, balcony].map(residenceSurfaceAt),
    ['oak', 'oak', 'stone', 'tile', 'balcony']);
  const tea = ear(5.34, 2.52);
  const study = ear(9.42, 2.56);
  assert.deepEqual([tea, study, ear(6.56, 4.15), ear(9.46, 1.26)].map(residenceSurfaceAt),
    ['tatami', 'wool', 'oak', 'oak']);
  assert.deepEqual(residenceReceiver(living, 0).wet, [1, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(residenceReceiver(bed, 0).wet, [0, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(residenceReceiver(core, 0).wet, [0, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual(residenceReceiver(bathroom, 0).wet, [0, 0, 0, 0, 1, 0, 0]);
  assert.deepEqual(residenceReceiver(balcony, 0).wet, [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(residenceReceiver(tea, 0).wet, [0, 0, 0, 0, 0, 1, 0]);
  assert.deepEqual(residenceReceiver(study, 0).wet, [0, 0, 0, 0, 0, 0, 1]);
  const [livingTail, bedroomTail, smallBedroomTail, coreTail, bathTail, teaTail, studyTail] =
    RESIDENCE_ROOM_RESPONSES.map((profile, index) =>
    createRoomImpulse(contexts, profile, index + 1));
  assert.equal(livingTail.sampleRate, contexts.sampleRate);
  assert.ok(bedroomTail.duration < livingTail.duration && livingTail.duration < coreTail.duration
    && coreTail.duration < bathTail.duration);
  assert.ok(teaTail.duration < studyTail.duration && studyTail.duration < smallBedroomTail.duration);
  assert.notDeepEqual(livingTail.getChannelData(0), livingTail.getChannelData(1));
  const firstReflection = buffer => buffer.getChannelData(0).findIndex(sample => Math.abs(sample) > 0.04);
  const livingFirst = firstReflection(livingTail) / contexts.sampleRate;
  const bedroomFirst = firstReflection(bedroomTail) / contexts.sampleRate;
  assert.ok(livingFirst > 0.001 && bedroomFirst > livingFirst && bedroomFirst < 0.02);
  const wood = createFootfall(contexts, 'oak', 81);
  const tile = createFootfall(contexts, 'tile', 81);
  assert.equal(tile.sampleRate, 24_000);
  const brilliance = audio => {
    const samples = audio.getChannelData(0);
    let delta = 0;
    let energy = 0;
    for (let i = 1; i < samples.length; i += 1) {
      delta += (samples[i] - samples[i - 1]) ** 2;
      energy += samples[i] ** 2;
    }
    return delta / energy;
  };
  assert.ok(brilliance(tile) > brilliance(wood) * 1.3);
  const power = audio => audio.getChannelData(0).reduce((sum, sample) => sum + sample ** 2, 0);
  assert.ok(power(createFootfall(contexts, 'tatami', 81)) < power(wood) * .60);
  assert.ok(power(createFootfall(contexts, 'wool', 81)) < power(wood) * .55);
  const woodSamples = wood.getChannelData(0);
  const firstFiveMilliseconds = woodSamples.slice(0, 120);
  assert.ok(firstFiveMilliseconds.every(value => Math.abs(value) < 0.007));
  assert.ok(woodSamples.slice(1_000, 2_400).some(value => Math.abs(value) > 0.025));
  assert.ok(tile.getChannelData(0).every(value => Math.abs(value) < 0.10));
});

test('slider rolls and settles without starting or ending in a click', () => {
  const context = new AudioBuffers();
  const open = createSlider(context, false).getChannelData(0);
  const close = createSlider(context, true).getChannelData(0);
  const peak = samples => samples.reduce((level, value) => Math.max(Math.abs(value), level), 0);
  assert.equal(open[0], 0);
  assert.ok(Math.abs(close[close.length - 1]) < 1e-6);
  assert.ok(peak(open.slice(4_000, 9_000)) > 0.015);
  assert.ok(peak(close.slice(11_520)) > peak(open.slice(11_520)) * 1.4);
});

test('interior sash and hinged doors have quiet, distinct action sounds', () => {
  const context = new AudioBuffers();
  const swing = createInteriorDoorSound(context, false, true).getChannelData(0);
  const slide = createInteriorDoorSound(context, true, true).getChannelData(0);
  const middlePower = samples => samples.slice(4_800, 9_600).reduce((sum, value) => sum + value ** 2, 0);
  assert.ok(middlePower(slide) > middlePower(swing) * 2);
  for (const samples of [slide, swing]) {
    assert.equal(Math.abs(samples[0]), 0);
    assert.ok(Math.abs(samples.at(-1)) < 1e-6);
    assert.ok(samples.every(value => Math.abs(value) < 0.10));
  }
});
