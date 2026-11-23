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
const { BALCONY_DOOR, RESIDENCE_ROADS, residenceReceiver, residenceSurfaceAt, residenceTrafficPath } =
  await import('../src/coast/world/residence/residenceAcoustics.ts');
const { RESIDENCE_ROOM_RESPONSES, createFootfall, createRoomImpulse } =
  await import('../src/coast/world/residence/residenceAudioSamples.ts');
hooks.deregister();

const ear = (x, north) => ({ x, y: 1.65, z: -north });
const south = RESIDENCE_ROADS[0].bed;
const east = RESIDENCE_ROADS[2].bed;
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
  const near = residenceTrafficPath(receiver, { ...east, z: -15 }, false);
  const farSource = { ...east, z: -390 };
  const far = residenceTrafficPath(receiver, farSource, false);
  assert.ok(far.cutoff < near.cutoff * 0.55);
  assert.ok(far.gain < near.gain * 0.5);
  assert.ok(residenceTrafficPath(receiver, farSource, true).gain > far.gain * 1.35);
});

test('closed glazing favors low traffic frequencies and the stone core is quieter', () => {
  const outdoor = residenceTrafficPath(residenceReceiver(balcony, 0), east, true);
  const window = residenceTrafficPath(residenceReceiver(living, 0), south, true);
  const closedBed = residenceTrafficPath(residenceReceiver(bed, 0), east, true);
  const inner = residenceTrafficPath(residenceReceiver(core, 0), east, true);
  assert.ok(window.cutoff < 600 && window.gain > 0.08);
  assert.ok(closedBed.cutoff < outdoor.cutoff * 0.18 && closedBed.gain < outdoor.gain * 0.18);
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
  assert.ok(amounts[4].cutoff > amounts[0].cutoff * 4);
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
  assert.deepEqual(residenceReceiver(living, 0).wet, [1, 0, 0]);
  assert.deepEqual(residenceReceiver(bed, 0).wet, [0, 1, 0]);
  assert.deepEqual(residenceReceiver(core, 0).wet, [0, 0, 1]);
  assert.deepEqual(residenceReceiver(balcony, 0).wet, [0, 0, 0]);
  const [livingTail, bedroomTail, coreTail] = RESIDENCE_ROOM_RESPONSES.map((profile, index) =>
    createRoomImpulse(contexts, profile, index + 1));
  assert.equal(livingTail.sampleRate, contexts.sampleRate);
  assert.ok(bedroomTail.duration < livingTail.duration && livingTail.duration < coreTail.duration);
  assert.notDeepEqual(livingTail.getChannelData(0), livingTail.getChannelData(1));
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
});
