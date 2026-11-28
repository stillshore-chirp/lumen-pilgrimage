import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Camera, Object3D } from 'three';

const src = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts')
    ? `${specifier}.ts` : specifier, context);
} });
const { createResidenceMonitorPlaybackFactory } = await import('../src/coast/world/residence/residenceMonitorAudio.ts');
const { createResidencePropagationDelay } = await import('../src/coast/world/residence/residencePropagationDelay.ts');
hooks.deregister();

function contextFixture(rate = 48000, failConvolver = 0) {
  const nodes = [];
  const buffers = [];
  const parameter = initial => ({ value: initial, targets: [],
    setTargetAtTime(value) { this.value = value; this.targets.push(value); },
    setValueAtTime(value) { this.value = value; this.targets.push(value); },
    cancelScheduledValues() {}, linearRampToValueAtTime(value) { this.value = value; this.targets.push(value); },
  });
  const context = { sampleRate: rate, currentTime: 1, createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    buffers.push(sampleRate);
    return { length, sampleRate, getChannelData: channel => data[channel] };
  } };
  const node = kind => {
    const value = { context, kind, disconnected: 0, destinations: [],
      connect(destination) { this.destinations.push(destination); return destination; },
      disconnect() { this.disconnected++; },
    };
    nodes.push(value);
    return value;
  };
  context.createGain = () => Object.assign(node('gain'), { gain: parameter(1) });
  context.createDelay = () => Object.assign(node('delay'), { delayTime: parameter(0) });
  context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: parameter(350), Q: parameter(1) });
  context.createPanner = () => Object.assign(node('panner'), {
    positionX: parameter(0), positionY: parameter(0), positionZ: parameter(0),
  });
  let convolutionCount = 0;
  context.createConvolver = () => {
    if (++convolutionCount === failConvolver) throw new Error('Fixture convolver failure');
    return node('convolver');
  };
  const destination = { context, disconnected: 0, disconnect() { this.disconnected++; } };
  return { context, destination, nodes, buffers };
}

function factoryFor(rate = 48000) {
  return createResidenceMonitorPlaybackFactory({ doorOpenness: () => 1, balconyDoor: () => 1,
    latency: () => ({ sampleRate: rate, wetDelaySeconds: .005, referenceOnsetSamples: 0,
      hrtfOnsetSamples: [240, 240, 240, 240], threshold: 1e-12, method: 'native-context-impulse' }) });
}

test('provider owns mono inputs and one context-rate IR bank without adding source cones or LFE filters', () => {
  const fixture = contextFixture(44100);
  const objects = [new Object3D(), new Object3D()];
  objects[0].position.set(19, 1.4, -2);
  objects[1].position.set(18, .3, -2);
  const factory = createResidenceMonitorPlaybackFactory({ doorOpenness: () => 1, balconyDoor: () => 1 });
  const handle = factory(fixture.context, fixture.destination, objects.map((object, index) => ({
    id: String(index), object, band: index === 0 ? 'fullrange' : 'lfe',
  })));
  assert.equal(handle.inputs.length, 2);
  assert.notEqual(handle.inputs[0], handle.inputs[1]);
  assert.ok(handle.inputs.every(input => input.context === fixture.context && input.channelCount === 1));
  assert.equal(fixture.nodes.filter(node => node.kind === 'convolver').length, 7);
  assert.equal(fixture.nodes.find(node => node.kind === 'delay').delayTime.value, 0);
  assert.ok(fixture.buffers.every(rate => rate === 44100));
  const panners = fixture.nodes.filter(node => node.kind === 'panner');
  assert.equal(panners.length, 6);
  assert.ok(panners.every(node => node.panningModel === 'HRTF' && node.rolloffFactor === 0
    && node.coneInnerAngle === 360 && node.coneOuterAngle === 360));
  assert.ok(fixture.nodes.filter(node => node.kind === 'filter').every(filter => filter.type === 'lowpass'));
  const camera = new Camera();
  camera.position.set(20, 1.65, -3);
  handle.setQuality('high');
  handle.update(camera);
  assert.ok(panners.some(node => node.positionX.targets.length > 0));
  const firstDry = fixture.nodes.find(node => node.kind === 'gain' && node.destinations.includes(panners[0]));
  assert.ok(Math.abs(firstDry.gain.value - .28) < 1e-10, 'near-source distance preserves the existing 3 m reference');
  handle.dispose();
  handle.dispose();
  assert.ok(fixture.nodes.every(node => node.disconnected === 1));
  assert.equal(fixture.destination.disconnected, 0);
  const targets = panners.reduce((sum, panner) => sum + panner.positionX.targets.length, 0);
  fixture.context.currentTime = 2;
  handle.update(camera);
  assert.equal(panners.reduce((sum, panner) => sum + panner.positionX.targets.length, 0), targets);
});

test('provider fails before allocation when context preparation is absent', () => {
  const fixture = contextFixture();
  const factory = createResidenceMonitorPlaybackFactory({ doorOpenness: () => 1, balconyDoor: () => 0, latency: () => undefined });
  assert.throws(() => factory(fixture.context, fixture.destination, []), /preparation/);
  assert.equal(fixture.nodes.length, 0);
  assert.equal(fixture.destination.disconnected, 0);
});

test('path replacement fades the old response without rewriting its arrival before silence', () => {
  const fixture = contextFixture();
  const object = new Object3D();
  object.position.set(18.4, 1.65, -12.1);
  const handle = createResidenceMonitorPlaybackFactory({ doorOpenness: () => 1, balconyDoor: () => 1 })(
    fixture.context, fixture.destination, [{ id: 'floating', object, band: 'fullrange' }]);
  const camera = new Camera();
  camera.position.set(18.8, 1.65, -12.1);
  const panners = fixture.nodes.filter(node => node.kind === 'panner');
  handle.update(camera);
  const old = panners.slice(0, 2).map(panner => ({ panner, x: panner.positionX.value, z: panner.positionZ.value,
    uploads: panner.positionX.targets.length }));
  fixture.context.currentTime = 1.06;
  camera.position.z = -13.3;
  handle.update(camera);
  for (const { panner, x, z, uploads } of old) {
    assert.equal(panner.positionX.value, x);
    assert.equal(panner.positionZ.value, z);
    assert.equal(panner.positionX.targets.length, uploads);
    assert.equal(fixture.nodes.find(node => node.kind === 'gain' && node.destinations.includes(panner)).gain.value, 0);
  }
  assert.equal(panners[2].positionX.value, object.position.x, 'a silent spare slot receives the new direct route');
  const count = fixture.nodes.length;
  for (const [time, quality] of [[1.12, 'light'], [1.18, 'high'], [1.24, 'light'], [1.30, 'high']]) {
    fixture.context.currentTime = time;
    handle.setQuality(quality);
    handle.update(camera);
  }
  assert.equal(fixture.nodes.length, count);
  handle.dispose();
  assert.ok(fixture.nodes.every(node => node.disconnected === 1));
});

test('partial graph construction releases its nodes without disposing the shared destination', () => {
  const fixture = contextFixture(48000, 3);
  assert.throws(() => factoryFor()(fixture.context, fixture.destination, []), /Fixture/);
  assert.ok(fixture.nodes.length > 0 && fixture.nodes.every(node => node.disconnected === 1));
  assert.equal(fixture.destination.disconnected, 0);
});

test('propagation delay changes only its silent tap and retains history through rapid updates', () => {
  const fixture = contextFixture();
  const delay = createResidencePropagationDelay(fixture.context, fixture.destination);
  const taps = fixture.nodes.filter(node => node.kind === 'delay');
  delay.update(.1, 1);
  assert.deepEqual(taps.map(tap => tap.delayTime.value), [.1, .1]);
  delay.update(.2, 1.06);
  assert.deepEqual(taps.map(tap => tap.delayTime.value), [.1, .2]);
  delay.update(.3, 1.07);
  assert.deepEqual(taps.map(tap => tap.delayTime.value), [.1, .2], 'a tap still fading out must not be reassigned');
  delay.update(.3, 1.12);
  assert.deepEqual(taps.map(tap => tap.delayTime.value), [.3, .2]);
  delay.dispose();
  delay.dispose();
  assert.ok(fixture.nodes.every(node => node.disconnected === 1));
  assert.equal(fixture.destination.disconnected, 0);
});
