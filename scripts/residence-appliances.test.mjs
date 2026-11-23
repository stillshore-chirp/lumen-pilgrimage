import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';

const src = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { createApplianceCycle } = await import('../src/coast/world/residence/residenceApplianceCycle.ts');
const { FurnitureModel } = await import('../src/coast/world/residence/residenceFurnitureModel.ts');
const { createResidenceMaterials } = await import('../src/coast/world/residence/residenceMaterials.ts');
const { addServiceFurniture } = await import('../src/coast/world/residence/residenceFurnitureFixtures.ts');
hooks.deregister();

let seconds = 0;
const model = new FurnitureModel();
const materials = createResidenceMaterials();
const appliances = addServiceFurniture(model, materials, () => seconds);
model.finish();
after(() => {
  appliances.dispose();
  model.dispose();
  materials.dispose();
});
const controls = id => Object.fromEntries(appliances.sections.find(section => section.id === id).controls
  .map(control => [control.id, control]));
const source = id => appliances.audioSources.find(candidate => candidate.id === id);
const advance = duration => {
  seconds += duration;
  appliances.update(.05);
};

test('appliance cycle rejects invalid settings and emits each completion once', () => {
  let time = 0;
  const cycle = createApplianceCycle(() => time);
  for (const invalid of [-1, NaN, Infinity]) {
    cycle.set(invalid);
    cycle.start();
    assert.equal(cycle.running, false);
  }
  cycle.set(10);
  cycle.start();
  time = 2.4;
  cycle.advance();
  cycle.set(100);
  cycle.start();
  cycle.stop();
  assert.equal(cycle.remaining, 7.6);
  time = 50;
  cycle.advance();
  assert.equal(cycle.remaining, 7.6);
  cycle.start();
  time = 58;
  cycle.advance();
  cycle.advance();
  assert.equal(cycle.finished, true);
  assert.equal(cycle.completions, 1);
  assert.equal(cycle.remaining, 0);
});

test('microwave adds 10 seconds and 1 minute, pauses, resumes and clears at zero', () => {
  const microwave = controls('microwave');
  const voice = source('microwave');
  assert.equal(microwave.start.disabled(), true);
  microwave['add-10'].invoke();
  microwave['add-60'].invoke();
  assert.equal(microwave.time.read(), '01:10');
  assert.equal(microwave.status.read(), '時間設定済み');
  microwave.start.invoke();
  assert.ok(voice.level() > 0);
  assert.equal(microwave['add-60'].disabled(), true);
  microwave['add-60'].invoke();
  advance(20.25);
  assert.equal(microwave.time.read(), '00:50');
  microwave.stop.invoke();
  assert.equal(microwave.status.read(), '停止中');
  assert.equal(voice.level(), 0);
  advance(60);
  assert.equal(microwave.time.read(), '00:50');
  microwave.start.invoke();
  advance(49.75);
  assert.equal(microwave.time.read(), '00:00');
  assert.equal(microwave.status.read(), '加熱完了');
  assert.equal(voice.level(), 0);
  assert.equal(voice.completionCount(), 1);
  advance(20);
  assert.equal(voice.completionCount(), 1);
  for (let i = 0; i < 35; i++) microwave['add-60'].invoke();
  assert.equal(microwave.time.read(), '30:00');
  assert.equal(microwave['add-10'].disabled(), true);
  microwave.reset.invoke();
  assert.equal(microwave.status.read(), '待機中');
  assert.equal(microwave.start.disabled(), true);
});

test('washer exposes four modes and holds its state independently from the second machine', () => {
  const washer = controls('washer-front');
  const other = controls('washer-back');
  const voice = source('washer-front');
  const modes = ['wash', 'rinse', 'spin', 'dry'];
  const defaults = ['00:40', '00:30', '00:22', '01:00'];
  assert.deepEqual(washer.mode.options.map(option => option.value), modes);
  const levels = new Set();
  for (const [i, mode] of modes.entries()) {
    washer.mode.set(mode);
    washer.mode.set('invalid');
    assert.equal(washer.mode.get(), mode);
    assert.equal(washer.status.read(), `待機中・設定 ${defaults[i]}`);
    washer.power.set(true);
    assert.equal(washer.mode.disabled(), true);
    washer.mode.set(modes[(i + 1) % modes.length]);
    assert.equal(washer.mode.get(), mode);
    assert.equal(other.power.get(), false);
    levels.add(voice.level());
    advance(1);
    const elapsed = washer.status.read();
    washer.power.set(false);
    const stopped = washer.status.read();
    advance(80);
    assert.equal(washer.status.read(), stopped);
    assert.equal(voice.level(), 0);
    washer.power.set(true);
    assert.equal(washer.status.read(), elapsed);
    advance(60);
    assert.equal(washer.power.get(), false);
    assert.equal(washer.status.read(), '完了');
    assert.equal(voice.completionCount(), i + 1);
  }
  assert.equal(levels.size, 4);
});

test('each washer adjusts its configured and paused time within bounds and completes once', () => {
  const front = controls('washer-front');
  const back = controls('washer-back');
  const frontSound = source('washer-front');
  const backSound = source('washer-back');
  const frontCompletions = frontSound.completionCount();
  const backCompletions = backSound.completionCount();
  front.mode.set('spin');
  front['time--60'].invoke();
  assert.equal(front.status.read(), '待機中・設定 00:10');
  assert.equal(front['time--10'].disabled(), true);
  front['time--10'].invoke();
  assert.equal(front.status.read(), '待機中・設定 00:10');
  for (let i = 0; i < 61; i++) front['time-60'].invoke();
  assert.equal(front.status.read(), '待機中・設定 60:00');
  assert.equal(front['time-10'].disabled(), true);
  front['reset-time'].invoke();
  assert.equal(front.status.read(), '待機中・設定 00:22');
  front['time-10'].invoke();
  back['time-60'].invoke();
  assert.equal(back.status.read(), '待機中・設定 01:40');
  front.power.set(true);
  assert.equal(front.status.read(), '脱水中・残り 00:32');
  for (const id of ['time--60', 'time--10', 'time-10', 'time-60', 'reset-time']) {
    assert.equal(front[id].disabled(), true);
    front[id].invoke();
  }
  advance(3.4);
  front.power.set(false);
  assert.equal(frontSound.level(), 0);
  assert.equal(front.status.read(), '停止中・残り 00:29');
  front['time-60'].invoke();
  front['time--10'].invoke();
  assert.equal(front.status.read(), '停止中・残り 01:19');
  advance(100);
  assert.equal(front.status.read(), '停止中・残り 01:19');
  assert.equal(frontSound.completionCount(), frontCompletions);
  front['reset-time'].invoke();
  assert.equal(front.status.read(), '停止中・残り 00:22');
  front['time--60'].invoke();
  assert.equal(front.status.read(), '停止中・残り 00:10');
  back.power.set(true);
  front.power.set(true);
  advance(9.5);
  assert.equal(front.status.read(), '脱水中・残り 00:01');
  assert.equal(frontSound.completionCount(), frontCompletions);
  advance(.5);
  assert.equal(front.status.read(), '完了');
  assert.equal(frontSound.completionCount(), frontCompletions + 1);
  assert.equal(back.status.read(), '洗浄中・残り 01:30');
  assert.equal(backSound.completionCount(), backCompletions);
  advance(90.1);
  assert.equal(back.status.read(), '完了');
  assert.equal(backSound.completionCount(), backCompletions + 1);
  assert.equal(frontSound.completionCount(), frontCompletions + 1);
  front.power.set(true);
  assert.equal(front.status.read(), '脱水中・残り 00:32');
  front.power.set(false);
});

test('the nine water outlets run independently and the nearby controls stay within each room', () => {
  const water = appliances.audioSources.filter(voice => voice.kind === 'water');
  assert.equal(water.length, 9);
  for (const voice of water) controls(voice.id).flow.set(true);
  assert.ok(water.every(voice => voice.level() > 0));
  const kitchen = controls('kitchen-tap').flow;
  kitchen.set(false);
  assert.equal(water.filter(voice => voice.level() > 0).length, 8);
  assert.equal(source('kitchen-tap').level(), 0);
  for (const voice of water) controls(voice.id).flow.set(false);
  for (const [x, z, sectionId] of [
    [13.48, -9.03, 'microwave'], [14.52, -9.03, 'kitchen-tap'],
    [7.49, -8.56, 'washer-front'], [7.49, -9.22, 'washer-back'],
    [1.30, -8.30, 'ba-tub'], [1.14, -8.93, 'ba-vanity'],
    [4.38, -8.63, 'bb-shower'], [5.63, -9.00, 'bb-vanity'],
    [14.03, -15.01, 'mb-tub'], [14.50, -14.08, 'mb-shower'],
    [13.84, -12.81, 'mb-vanity'], [8.98, -10.96, 'wc-vanity'],
    [13.48, -10.02, undefined], [8.04, -8.56, undefined], [6.24, -9.00, 'bb-vanity'],
  ]) {
    assert.equal(appliances.nearby({ x, y: 1.64, z })?.sectionId, sectionId, `E${x}, N${-z}`);
  }
});
