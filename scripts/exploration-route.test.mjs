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
const [route, destinations] = await Promise.all([
  import('../src/coast/explorationRoute.ts'),
  import('../src/coast/coastDestinations.ts'),
]);
hooks.deregister();

test('monitor sender selection wins across exploration URL combinations', () => {
  for (const search of [
    '?monitor=sender',
    '?monitor=sender&world=overlook',
    '?scene=expedition&monitor=sender&world=residence&place=tea-room&time=night',
    '?world=cinema&monitor=sender&scene=expedition',
    '?monitor=sender&world=unknown',
  ]) {
    assert.equal(route.parseStartupRoute(search).monitorSender, true, search);
  }

  assert.equal(route.parseStartupRoute('?monitor=viewer&monitor=sender').monitorSender, false);
  assert.equal(route.parseStartupRoute('?monitor=sender&monitor=viewer').monitorSender, true);
});

test('startup accepts exact world IDs and sends unknown or retired scene URLs to coast', () => {
  for (const worldId of ['coast', 'overlook', 'residence', 'cinema', 'atrium']) {
    const address = new URL(`https://example.test/?world=${worldId}&scene=expedition`);
    assert.equal(route.parseStartupRoute(address.search).worldId, worldId);
  }

  for (const search of [
    '',
    '?scene=expedition',
    '?world=unknown',
    '?world=Overlook',
    '?world=coast&world=residence',
    '?world=unknown&world=residence',
  ]) {
    assert.equal(route.parseStartupRoute(search).worldId, 'coast', search);
  }

  assert.equal(route.parseStartupRoute('?scene=expedition&world=overlook').worldId, 'overlook');
});

test('initial time defaults to night only for a residence URL without a time value', () => {
  const initial = route.readInitialExplorationState;
  assert.equal(initial('residence', '').time, 'night');
  assert.equal(initial('residence', '?time=night').time, 'night');
  assert.equal(initial('residence', '?time=').time, 'day');
  assert.equal(initial('residence', '?time=evening').time, 'day');
  assert.equal(initial('coast', '').time, 'day');
  assert.equal(initial('overlook', '').time, 'day');
  assert.equal(initial('cinema', '?time=night').time, 'night');
  assert.equal(initial('atrium', '').time, 'day');
  assert.equal(initial('residence', '?time=night&time=day').time, 'night');
  assert.equal(initial('residence', '?time=day&time=night').time, 'day');
  assert.equal(initial('residence', '?place=living-window&place=tea-room').placeId, 'living-window');
});

test('destination lookup stays scoped to a known world and place ID', () => {
  const { findDestination } = destinations;
  assert.equal(findDestination('residence', 'living-window')?.id, 'living-window');
  assert.equal(findDestination('coast', 'inlet')?.id, 'inlet');
  assert.equal(findDestination('residence', 'inlet'), undefined);
  assert.equal(findDestination('coast', 'living-window'), undefined);
  assert.equal(findDestination('atrium', 'lounge')?.seatedEyeHeight, 1.20);
  assert.equal(findDestination('atrium', 'upper-gallery')?.floorY, 9.15);
  assert.equal(findDestination('residence', 'missing'), undefined);
  assert.equal(findDestination('unknown', 'inlet'), undefined);
});

test('travel reloads across worlds and relocates within a world while preserving URL state', () => {
  const href = 'https://example.test/explore?keep=1&time=day&time=night&world=coast&place=inlet&view=wide#scene';
  const destination = destinations.findDestination('residence', 'tea-room');
  const crossWorld = route.decideTravel({
    href,
    currentWorldId: 'coast',
    targetWorldId: 'residence',
    destination,
    time: 'night',
  });

  assert.equal(crossWorld.kind, 'navigate');
  assert.equal(crossWorld.destination, destination);
  assert.equal(crossWorld.url.pathname, '/explore');
  assert.equal(crossWorld.url.searchParams.get('keep'), '1');
  assert.equal(crossWorld.url.searchParams.get('view'), 'wide');
  assert.deepEqual(crossWorld.url.searchParams.getAll('time'), ['night']);
  assert.equal(crossWorld.url.searchParams.get('world'), 'residence');
  assert.equal(crossWorld.url.searchParams.get('place'), 'tea-room');
  assert.equal(crossWorld.url.hash, '#scene');

  const sameWorld = route.decideTravel({
    href,
    currentWorldId: 'residence',
    targetWorldId: 'residence',
    destination,
    time: 'day',
  });
  assert.equal(sameWorld.kind, 'relocate');
  assert.equal(sameWorld.destination, destination);
  assert.equal(sameWorld.url.searchParams.get('world'), 'residence');
  assert.equal(sameWorld.url.searchParams.get('place'), 'tea-room');
  assert.equal(sameWorld.url.searchParams.get('time'), 'day');
  assert.equal(sameWorld.url.hash, '#scene');

  const invalid = route.decideTravel({
    href,
    currentWorldId: 'coast',
    targetWorldId: 'residence',
    destination: destinations.findDestination('residence', 'inlet'),
    time: 'night',
  });
  assert.equal(invalid.kind, 'invalid');
});

test('changing time preserves the current URL query and hash', () => {
  const updated = route.urlForTime(
    'https://example.test/explore?world=overlook&place=east-terrace&time=night&time=day&keep=1#deck',
    'day',
  );
  assert.equal(updated.pathname, '/explore');
  assert.equal(updated.searchParams.get('world'), 'overlook');
  assert.equal(updated.searchParams.get('place'), 'east-terrace');
  assert.equal(updated.searchParams.get('keep'), '1');
  assert.deepEqual(updated.searchParams.getAll('time'), ['day']);
  assert.equal(updated.hash, '#deck');
});
