import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { connectExplorationOutput } from '../src/coast/explorationOutput.ts';
import { DEFAULT_EXPLORATION_MIX } from '../src/coast/explorationSound.ts';
import { COAST_FALLS, COAST_WALKS, SEA_LEVEL, SPAWN, groundHeight } from '../src/coast/terrain.ts';

const acousticsUrl = new URL('../src/coast/coastAcoustics.ts', import.meta.url).href;
const shoreUrl = new URL('../src/coast/coastShore.ts', import.meta.url).href;
const birdLifeUrl = new URL('../src/coast/world/coastBirdLife.ts', import.meta.url).href;
const birdModelsUrl = new URL('../src/coast/world/coastBirdModels.ts', import.meta.url).href;
const foleyUrl = new URL('../src/coast/CoastFoley.ts', import.meta.url).href;
const controlsUrl = new URL('../src/coast/CoastControls.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = [acousticsUrl, shoreUrl, birdLifeUrl, birdModelsUrl, foleyUrl, controlsUrl].includes(context.parentURL)
      && specifier.startsWith('.');
    const path = internal ? `${specifier}.ts` : specifier;
    return nextResolve(path, context);
  },
});
const { airCutoff, listenerTerrain, terrainArrival, terrainOcclusion, thermalLowShelfDb, thermalRayLift } =
  await import(acousticsUrl);
const {
  buildShorePatches, selectShorePatches, shoreTransmission, shoreWavePoint,
  SHORE_VOICE_COUNT, SHORE_REF_DISTANCE, SHORE_ROLLOFF,
} = await import(shoreUrl);
const { createCoastBirdLife } = await import(birdLifeUrl);
const { CoastFoley } = await import(foleyUrl);
const { groundEyeHeight } = await import(controlsUrl);
hooks.deregister();

const shore = buildShorePatches();

function ear(x, z) {
  return { x, y: groundHeight(x, z) + 1.68, z };
}

function separation(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function firstArrival(listener, source) {
  const distance = separation(listener, source);
  return terrainArrival(listener, source, listenerTerrain(listener), distance, terrainOcclusion(listener, source));
}

test('calm night changes distant low-band transmission while leaving nearby sources stable', () => {
  assert.equal(Math.abs(thermalLowShelfDb(40, 'day')), 0);
  assert.equal(thermalLowShelfDb(40, 'night'), 0);
  assert.ok(Math.abs(thermalRayLift(40, 'night') - thermalRayLift(40, 'day')) < 0.02);
  assert.ok(airCutoff(380) < airCutoff(40) * 0.25);
  assert.ok(thermalLowShelfDb(380, 'night') - thermalLowShelfDb(380, 'day') > 3);
  assert.ok(thermalLowShelfDb(2200, 'night', 2300) > thermalLowShelfDb(1000, 'night', 2300) + 1.5);
  assert.ok(thermalRayLift(6000, 'night') <= 14);

  const path = COAST_FALLS[2].path;
  const fall = path[Math.round((path.length - 1) * 0.65)];
  const listener = ear(110, 165);
  const distance = Math.hypot(listener.x - fall.x, listener.z - fall.z);
  const day = terrainOcclusion(listener, fall, thermalRayLift(distance, 'day'));
  const night = terrainOcclusion(listener, fall, thermalRayLift(distance, 'night'));
  assert.ok(day - night > 0.12 && night > 0.35, 'the ridge still screens the distant fall at night');
});

test('anchored surf covers the outer coast and the west and east paths with a bounded mix', () => {
  const sites = [SPAWN, ...COAST_WALKS.map(walk => walk.overlook),
    { x: -61, z: 0 }, { x: -75, z: -34 }, { x: 71, z: -8 }, { x: 77, z: -26 }];
  const selections = sites.map(({ x, z }) => {
    const listener = ear(x, z);
    const selected = selectShorePatches(shore, listener, new Set());
    assert.equal(selected.length, SHORE_VOICE_COUNT);
    const powers = selected.map(({ crest, wash }) => {
      assert.ok(groundHeight(crest.x, crest.z) < SEA_LEVEL - 0.5);
      assert.ok(groundHeight(wash.x, wash.z) < SEA_LEVEL - 0.5);
      const distance = separation(listener, crest);
      const direct = shoreTransmission(distance, terrainOcclusion(listener, crest));
      const spread = SHORE_REF_DISTANCE / (SHORE_REF_DISTANCE + SHORE_ROLLOFF * Math.max(0, distance - SHORE_REF_DISTANCE));
      return (direct.gain * spread) ** 2;
    });
    assert.ok(Math.sqrt(powers.reduce((sum, power) => sum + power, 0)) > 0.36, `weak shore at ${x}, ${z}`);
    return selected;
  });
  assert.ok(selections[1].some(patch => patch.wash.x < -175));
  assert.ok(selections[2].some(patch => patch.wash.x > 195));
  assert.ok(!selections[4].some(patch => selections[6].includes(patch)));

  const sideways = selections[1].find(patch => Math.abs(patch.crest.x - patch.wash.x) > 3);
  assert.ok(sideways);
  assert.deepEqual(shoreWavePoint(sideways, 0.1), sideways.crest);
  assert.deepEqual(shoreWavePoint(sideways, 0.57), sideways.wash);
  assert.deepEqual(shoreWavePoint(sideways, 0.99), sideways.crest);
});

test('a passage and open sand at the same surf distance have different tone and direction', () => {
  const open = ear(43, 32);
  const sheltered = ear(92, -28);
  const patch = shore.find(({ crest }) => Math.hypot(57.37 - crest.x, -7 - crest.z) < 1.2);
  assert.ok(patch);
  const source = patch.crest;
  assert.ok(selectShorePatches(shore, sheltered, new Set()).includes(patch));
  const openDistance = separation(open, source);
  const shelteredDistance = separation(sheltered, source);
  assert.ok(Math.abs(openDistance - shelteredDistance) < 0.15);
  const bright = shoreTransmission(openDistance, terrainOcclusion(open, source));
  const shaded = shoreTransmission(shelteredDistance, terrainOcclusion(sheltered, source));
  assert.ok(shaded.cutoff < bright.cutoff * 0.22);
  assert.ok(shaded.gain > 0.38 && shaded.gain < bright.gain * 0.66);

  assert.ok((firstArrival(open, source)?.gain ?? 0) < 0.035);
  const reflection = firstArrival(sheltered, source);
  assert.ok(reflection && reflection.gain > 0.16 && reflection.delay > 0.035 && reflection.delay < 0.063);
  const sourceBearing = Math.atan2(source.z - sheltered.z, source.x - sheltered.x);
  const reflectionBearing = Math.atan2(reflection.point.z - sheltered.z, reflection.point.x - sheltered.x);
  assert.ok(Math.cos(sourceBearing - reflectionBearing) < 0, 'the reflection arrives from the opposite side of the path');
});

test('coastal rock produces a delayed directional arrival where the open shore has none', () => {
  const beach = ear(SPAWN.x, SPAWN.z);
  const passage = ear(-92, 112);
  const mainFall = COAST_FALLS[0].path;
  const source = mainFall[Math.round((mainFall.length - 1) * 0.65)];
  assert.equal(firstArrival(beach, source), undefined);
  assert.ok(listenerTerrain(passage).enclosure > 0.7);

  const arrival = firstArrival(passage, source);
  assert.ok(arrival.gain > 0.1);
  assert.ok(arrival.delay > 0.018 && arrival.delay < 0.1);
  assert.ok(Math.hypot(arrival.point.x - passage.x, arrival.point.z - passage.z) < 16);
});

test('an occluded forest call can reach the slot through its north opening', () => {
  const listener = ear(-63, 298);
  const source = { x: -45, y: groundHeight(-45, 329) + 7, z: 329 };
  assert.ok(terrainOcclusion(listener, source) > 0.45);
  assert.ok(listenerTerrain(listener).enclosure > 0.8);

  const arrival = firstArrival(listener, source);
  assert.deepEqual([arrival.point.x, arrival.point.z], [-52, 323]);
  assert.ok(arrival.gain > 0.22);
  assert.ok(arrival.cutoff <= 3_650);
  assert.ok(arrival.distance > Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z));
});

test('the canopy shades a listener under it and opens up at the vista or above the trees', () => {
  const grove = ear(-45, 246);
  assert.ok(listenerTerrain(grove).canopy > 0.9);
  assert.equal(listenerTerrain(ear(-14, 392)).canopy, 0);
  assert.equal(listenerTerrain({ ...grove, y: grove.y + 30 }).canopy, 0);
});

test('a resident and a flying gull can call from beyond their model culling distances', () => {
  const wildlife = createCoastBirdLife();
  const listener = ear(-29, 198);
  const calls = [];
  for (let elapsed = 0; elapsed <= 18; elapsed += 0.25) {
    for (const cue of wildlife.update(elapsed, listener)) {
      const name = cue.vx === undefined ? `${cue.species}-${cue.id}` : `gull-flight-${cue.id - 101}`;
      const model = wildlife.group.getObjectByName(name);
      if (model?.visible === false) calls.push(cue);
    }
  }
  assert.ok(calls.some(cue => cue.species === 'whiteEye' && separation(cue, listener) > 90));
  assert.ok(calls.some(cue => cue.species === 'gull' && cue.vx !== undefined && separation(cue, listener) > 190));
});

test('local calls recur along the beach, ravine, saddle, lake, ridge and vermilion trail', () => {
  const sites = [
    [SPAWN.x, SPAWN.z, 35, 12], [-63, 298, 6, 23], [98, 422, 7, 23], [54, 550, 7, 25],
    [213, 743, 8, 20], [32, 876, 7, 28], [-42, 1090, 7, 24], [222, 955, 23, 16],
  ];
  for (const [x, z, minimumCalls, gapLimit] of sites) {
    const wildlife = createCoastBirdLife();
    const listener = ear(x, z);
    const sources = new Set();
    const duration = 90;
    let callCount = 0;
    let lastCall = 0;
    let longestGap = 0;
    for (let elapsed = 0; elapsed <= duration; elapsed += 0.25) {
      for (const cue of wildlife.update(elapsed, listener)) {
        if (separation(cue, listener) > 115 || terrainOcclusion(listener, cue) > 0.42) continue;
        sources.add(cue.id);
        callCount++;
        longestGap = Math.max(longestGap, elapsed - lastCall);
        lastCall = elapsed;
      }
    }
    assert.ok(sources.size >= 2, `fewer than two local sources reach ${x}, ${z}`);
    assert.ok(callCount >= minimumCalls, `fewer than ${minimumCalls} local calls at ${x}, ${z}`);
    assert.ok(Math.max(longestGap, duration - lastCall) <= gapLimit, `call gap exceeds ${gapLimit} s at ${x}, ${z}`);
  }
});

function mockAudioNode(properties = {}) {
  return {
    ...properties,
    connections: [],
    connect(target) { this.connections.push(target); return target; },
    disconnect() { this.connections.length = 0; },
  };
}

test('the final peak ceiling preserves normal sample levels and retains output headroom', () => {
  const compressor = mockAudioNode({ threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} });
  const trim = mockAudioNode({ gain: {} });
  const ceiling = mockAudioNode();
  const destination = mockAudioNode();
  const master = mockAudioNode();
  const output = connectExplorationOutput({
    destination,
    createDynamicsCompressor: () => compressor,
    createGain: () => trim,
    createWaveShaper: () => ceiling,
  }, master);

  const chain = [master, ...output, destination];
  assert.deepEqual(chain, [master, trim, compressor, ceiling, destination]);
  for (let i = 0; i + 1 < chain.length; i++) assert.deepEqual(chain[i].connections, [chain[i + 1]]);
  const { curve } = ceiling;
  for (const sample of [-0.75, -0.25, 0, 0.25, 0.75]) {
    assert.equal(curve[(sample + 1) * (curve.length - 1) / 2], sample);
  }
  assert.ok(curve.every((sample, index) => Math.abs(sample) < 0.97 && (index === 0 || sample >= curve[index - 1])));
});

test('walking and diving contacts follow separate mix controls in direct sound and reflections', () => {
  const param = () => ({
    value: 1,
    setValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; },
  });
  const sources = [];
  const context = {
    currentTime: 0,
    createGain: () => mockAudioNode({ gain: param() }),
    createPanner: () => mockAudioNode({ positionX: param(), positionY: param(), positionZ: param() }),
    createBuffer: (_channels, frames, rate) => ({
      duration: frames / rate, getChannelData: () => new Float32Array(frames),
    }),
    createBufferSource() {
      const source = mockAudioNode({ playbackRate: param(), start() {}, stop() {} });
      sources.push(source);
      return source;
    },
  };
  const direct = mockAudioNode();
  const reflected = mockAudioNode();
  const foley = new CoastFoley(context, direct, reflected);
  const walk = (x, elapsed) => {
    const z = SPAWN.z;
    const y = groundHeight(x, z) + groundEyeHeight('walk');
    foley.update({ x, y, z }, SEA_LEVEL, 'walk', elapsed, elapsed);
  };
  walk(SPAWN.x, 0);
  walk(SPAWN.x + 0.5, 0.16);
  walk(SPAWN.x + 1, 0.32);
  assert.equal(sources.length, 1);
  const dryContact = sources[0].connections[0];
  const nominalStep = dryContact.gain.value;
  assert.ok(nominalStep > 0);
  assert.deepEqual(dryContact.connections.map(branch => branch.connections[0]), [direct, reflected]);

  const footstepsOnly = { ...DEFAULT_EXPLORATION_MIX, environmentOn: false };
  foley.setMix(footstepsOnly);
  assert.equal(dryContact.gain.value, nominalStep);
  const dive = { x: SPAWN.x + 1, y: groundHeight(SPAWN.x + 1, SPAWN.z) + 0.2, z: SPAWN.z };
  foley.update(dive, SEA_LEVEL, 'dive', 0.48, 0.48);
  assert.equal(sources.length, 1, 'disabled water channel suppresses the dive bubbles');

  foley.setMix({ ...DEFAULT_EXPLORATION_MIX, footstepsOn: false });
  assert.equal(dryContact.gain.value, 0);
  walk(dive.x, 0.64);
  foley.update(dive, SEA_LEVEL, 'dive', 0.8, 0.8);
  assert.equal(sources.length, 2);
  const wetContact = sources[1].connections[0];
  const nominalSplash = wetContact.gain.value;
  assert.ok(nominalSplash > 0);
  assert.deepEqual(wetContact.connections.map(branch => branch.connections[0]), [direct, reflected]);
  foley.setMix({ ...DEFAULT_EXPLORATION_MIX, levels: { ...DEFAULT_EXPLORATION_MIX.levels, water: 0.25 } });
  assert.equal(wetContact.gain.value, nominalSplash * 0.25);
  assert.equal(dryContact.gain.value, nominalStep);
  foley.dispose();
});
