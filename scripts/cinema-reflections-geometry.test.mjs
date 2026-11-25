import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const src = new URL('../src/', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { CINEMA_RENDER_SPEAKERS } = await import('../src/coast/world/cinema/cinemaSpeakers.ts');
const { findCinemaEarlyPaths } = await import('../src/coast/world/cinema/cinemaReflectionsGeometry.ts');
hook.deregister();

function surfaceOf(point) {
  if (Math.abs(point[0] + 20) < 1e-6) return 'left';
  if (Math.abs(point[0] - 20) < 1e-6) return 'right';
  if (Math.abs(point[2] - 53.9) < 1e-6) return 'rear';
  if (Math.abs(point[2] + 3.1) < 1e-6) return 'front';
  if (Math.abs(point[1] - 22) < 1e-6) return 'ceiling';
  if (Math.abs(point[1]) < 1e-6) return 'floor';
  return undefined;
}

test('early reflection paths are finite, bounded, deterministic and subwoofer-free', () => {
  const paths = findCinemaEarlyPaths([0, 4.4, 10]);
  assert.equal(paths.length, 48);
  assert.deepEqual(paths, findCinemaEarlyPaths([0, 4.4, 10]));
  for (const path of paths) {
    assert.ok(path.speaker >= 0 && path.speaker < CINEMA_RENDER_SPEAKERS.length);
    assert.notEqual(CINEMA_RENDER_SPEAKERS[path.speaker].kind, 'screenSub');
    assert.notEqual(CINEMA_RENDER_SPEAKERS[path.speaker].kind, 'surroundSub');
    assert.ok(path.point.every(Number.isFinite));
    assert.ok(surfaceOf(path.point));
    assert.ok(path.delaySamples >= 0 && path.delaySamples <= 12_000);
    assert.ok(path.gain > 0 && Number.isFinite(path.gain));
    assert.ok(path.highGain >= 0 && path.highGain <= 1);
  }
});
test('primary and secondary candidates cover the finite room surfaces', () => {
  const nearFront = findCinemaEarlyPaths([0, 4.4, 10]);
  const reference = findCinemaEarlyPaths([0, 5, 35.85]);
  const surfaces = new Set([...nearFront, ...reference].map(path => surfaceOf(path.point)));
  for (const name of ['left', 'right', 'rear', 'front', 'ceiling', 'floor']) assert.ok(surfaces.has(name), name);
  assert.ok(new Set(reference.map(path => path.speaker)).size > 1);
});

test('the caller can reduce the candidate budget and outside listeners are silent', () => {
  assert.equal(findCinemaEarlyPaths([0, 4.4, 10], 1).length, 1);
  assert.equal(findCinemaEarlyPaths([0, 4.4, 10], 0).length, 0);
  assert.equal(findCinemaEarlyPaths([0, 4.4, 10], 100).length, 48);
  assert.deepEqual(findCinemaEarlyPaths([0, 4.4, 60]), []);
});
