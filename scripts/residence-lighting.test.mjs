import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { Group, Scene, Vector3 } from 'three';

const src = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { createResidenceMaterials } = await import('../src/coast/world/residence/residenceMaterials.ts');
const { createResidenceFurniture } = await import('../src/coast/world/residence/residenceFurniture.ts');
const { createResidenceLighting } = await import('../src/coast/world/residence/residenceLighting.ts');
const { createResidenceCurtains } = await import('../src/coast/world/residence/residenceCurtains.ts');
const { createResidenceLightSpill } = await import('../src/coast/world/residence/residenceLightSpill.ts');
const { roomSources, residenceFieldOrigin, residenceFieldExtent } =
  await import('../src/coast/world/residence/residenceLightField.ts');
hooks.deregister();

const materials = createResidenceMaterials();
const scene = new Scene();
const furniture = createResidenceFurniture(materials);
const curtains = createResidenceCurtains(materials);
let invalidations = 0;
const lighting = createResidenceLighting(scene, materials, furniture.obstacles, () => invalidations++);
lighting.attachInterior(new Group(), furniture.group);

after(() => {
  lighting.dispose();
  curtains.dispose();
  furniture.dispose();
  materials.dispose();
});

function configuredShader(material) {
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
  material.onBeforeCompile(shader);
  return shader.uniforms;
}

function measure(texture, east, north, height) {
  const { data, width, height: depth, depth: levels } = texture.image;
  const position = new Vector3(east, north, height).sub(residenceFieldOrigin).divide(residenceFieldExtent);
  const channels = data.length / (width * depth * levels);
  const index = channels * ((Math.floor(position.z * levels) * depth + Math.floor(position.y * depth)) * width
    + Math.floor(position.x * width));
  return Array.from(data.slice(index, index + channels));
}

test('private fixtures have unique controls and a pendant can be switched independently', () => {
  const { residenceLightVolume, residenceAccentVolume } = configuredShader(materials.ceiling);
  const bounce = residenceLightVolume.value;
  const accents = residenceAccentVolume.value;
  const byRoom = id => lighting.sections.find(section => section.id === `lighting-${id}`).controls;
  const get = (id, control) => byRoom(id).find(candidate => candidate.id === control);
  const ids = lighting.sections.flatMap(section => section.controls.filter(control => control.kind === 'toggle')
    .map(control => control.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.toSorted(), Object.entries(roomSources).filter(([room]) => room !== 'C1')
    .flatMap(([, fixtures]) => fixtures.map(fixture => fixture.id)).toSorted());

  const east = get('LD', 'LD-pendant-east');
  const west = get('LD', 'LD-pendant-west');
  const dining = furniture.group.getObjectByName('Dining room');
  const eastBulb = dining.children.find(mesh => mesh.material.userData.residenceFixtureId === east.id);
  const westBulb = dining.children.find(mesh => mesh.material.userData.residenceFixtureId === west.id);
  const westSpot = scene.children.find(object => object.isSpotLight && object.position.x < 16);
  const eastSpot = scene.children.find(object => object.isSpotLight && object.position.x > 16);

  assert.equal(west.get(), false);
  lighting.setTimeOfDay('night');
  assert.equal(west.get(), true);
  assert.equal(east.get(), true);
  const diningBefore = measure(bounce, 15.42, 4.72, 1.08);
  const accentBefore = measure(accents, 15.42, 4.72, 1.08);
  const kitchenBefore = measure(bounce, 15.42, 8.73, 1.08);

  west.set(false);
  assert.equal(westBulb.material.emissiveIntensity, 0);
  assert.ok(eastBulb.material.emissiveIntensity > 0);
  assert.ok(westSpot.visible === false && eastSpot.visible);
  assert.equal(invalidations, 1);
  assert.ok(measure(bounce, 15.42, 4.72, 1.08)[1] < diningBefore[1]);
  assert.ok(measure(accents, 15.42, 4.72, 1.08)[3] < accentBefore[3]);
  assert.deepEqual(measure(bounce, 15.42, 8.73, 1.08), kitchenBefore);

  get('LD', 'off').invoke();
  assert.ok(byRoom('LD').filter(control => control.kind === 'toggle').every(control => control.get() === false));
  assert.equal(measure(bounce, 15.42, 4.72, 1.08)[2], 0);
  assert.equal(measure(accents, 15.42, 4.72, 1.08)[3], 0);
  assert.ok(get('K', 'K-down').get());

  east.set(true);
  lighting.setTimeOfDay('day');
  lighting.setQuality('high');
  assert.equal(west.get(), false);
  assert.equal(east.get(), true);
  assert.ok(westSpot.visible === false && eastSpot.visible);
  const manuallyLit = measure(bounce, 16.60, 4.72, 1.08)[0];
  east.set(false);
  assert.ok(measure(bounce, 16.60, 4.72, 1.08)[0] < manuallyLit);

  get('LD', 'on').invoke();
  lighting.setTimeOfDay('night');
  assert.ok(byRoom('LD').filter(control => control.kind === 'toggle').every(control => control.get()));
  assert.ok(westSpot.visible && eastSpot.visible);
  assert.equal(lighting.nearby(new Vector3(11.6, 1.65, -4.78)).sectionId, 'lighting-LD');
  assert.equal(lighting.nearby(new Vector3(10.9, 1.65, -4.78)), null);
});

test('room curtains use the same target from the menu and the wall, with animated daylight transmission', () => {
  assert.equal(curtains.sections.length, 6);
  const control = curtains.sections.find(section => section.id === 'curtains-04').controls[0];
  const tea = curtains.daylight.find(({ roomId }) => roomId === '04');
  const living = curtains.daylight.find(({ roomId }) => roomId === 'LD');
  const plate = new Vector3(6.7, 1.65, -4.54);
  assert.equal(tea.transmission(), 1);
  control.set(false);
  assert.match(curtains.nearby(plate).label, /開ける$/);
  assert.equal(tea.transmission(), 1);
  assert.equal(curtains.update(.2), true);
  assert.ok(tea.transmission() < 1 && tea.transmission() > .22);
  assert.equal(living.transmission(), 1);
  curtains.update(3);
  assert.ok(Math.abs(tea.transmission() - .22) < 1e-6);
  curtains.nearby(plate).invoke();
  assert.equal(control.get(), true);
  curtains.update(3);
  assert.equal(tea.transmission(), 1);
});

test('openings carry light from neighbouring fixtures and windows, with local distance falloff', () => {
  const spill = configuredShader(materials.ceiling).residenceSpillVolume.value;
  const controls = (room, id) => lighting.sections.find(section => section.id === `lighting-${room}`)
    .controls.find(control => control.id === id);
  const aperture = amount => {
    lighting.setDoorOpenness('tea-room', amount);
    lighting.invalidateShadows();
  };
  const teaFloor = north => measure(spill, 6.46, north, .24)[0];

  lighting.setTimeOfDay('night');
  controls('04', 'off').invoke();
  controls('H1', 'on').invoke();
  aperture(1);
  const atDoor = teaFloor(4.55);
  assert.ok(atDoor > 8);
  assert.ok(teaFloor(2.40) < atDoor / 2);
  assert.equal(controls('04', '04-lantern').get(), false);
  aperture(.5);
  assert.ok(teaFloor(4.55) >= .45 * atDoor && teaFloor(4.55) <= .55 * atDoor);
  aperture(0);
  assert.equal(teaFloor(4.55), 0);
  aperture(1);
  controls('H1', 'off').invoke();
  assert.equal(teaFloor(4.55), 0);

  const hallSky = () => measure(spill, 6.46, 5.38, .50)[1];
  lighting.setTimeOfDay('day');
  const openWindow = hallSky();
  lighting.setTeaShojiOpenness(0);
  lighting.invalidateShadows();
  const closedShoji = hallSky();
  assert.ok(closedShoji < openWindow);
  lighting.setDaylightTransmission('04', .22);
  lighting.invalidateShadows();
  assert.ok(hallSky() < closedShoji);
  assert.equal(teaFloor(4.55), 0);
});

test('a permanent open boundary transmits light, while an adjoining solid wall blocks it', () => {
  const spill = createResidenceLightSpill(residenceFieldOrigin, residenceFieldExtent);
  try {
    spill.update(id => id === 'K' ? [1, 1] : [0, 0]);
    const living = measure(spill.texture, 16.15, 6.32, .65);
    assert.ok(living[0] > 8 && living[1] > 8);
    assert.deepEqual(measure(spill.texture, 16.15, 10.34, .65), [0, 0]);
  } finally {
    spill.texture.dispose();
  }
});
