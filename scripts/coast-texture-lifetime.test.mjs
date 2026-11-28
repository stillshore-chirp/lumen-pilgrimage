import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { test, after } from 'node:test';
import * as THREE from 'three';

// CPU lifetime fixture: real Three objects/factories, no renderer or network.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/src/') && !/\.\w+$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/coastSceneryAssets.ts')) {
      return { format: 'module', shortCircuit: true, source: 'export const loadCoastScenery = () => new Promise(() => {});' };
    }
    const result = nextLoad(url, context);
    if (url.includes('/src/') && url.endsWith('.ts')) {
      return { ...result, format: 'module', source: stripTypeScriptTypes(String(result.source)
        .replaceAll('import.meta.env.BASE_URL', "'/'"), { mode: 'transform' }) };
    }
    return result;
  },
});
const loaded = [];
const originalLoad = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = function (url) {
  const texture = new THREE.Texture({ width: 4, height: 4, data: new Uint8Array(64), complete: true });
  texture.name = String(url).split('/').at(-1);
  loaded.push(texture);
  return texture;
};
const previousWindow = globalThis.window, previousDocument = globalThis.document;
const noop = () => {};
globalThis.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop };
globalThis.document = { createElement() {
  const context = new Proxy({ measureText: text => ({ width: String(text).length * 8 }),
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: new Uint8ClampedArray(16) }),
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) },
  { get: (target, key) => key in target ? target[key] : noop });
  return { width: 1, height: 1, getContext: () => context, addEventListener: noop, removeEventListener: noop, style: {} };
} };
const { CoastWorld } = await import('../src/coast/CoastWorld.ts');
const { disposeSceneDrawables } = await import('../src/coast/disposeSceneDrawables.ts');
after(() => {
  hooks.deregister(); THREE.TextureLoader.prototype.load = originalLoad;
  if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
});

function texturesInScene(scene, compile) {
  const textures = new Set(), materials = new Set();
  const add = value => { if (value?.isTexture && !value.isRenderTargetTexture) textures.add(value); };
  scene.traverse(object => {
    if (!object.material) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (materials.has(material)) continue;
      materials.add(material);
      Object.values(material).forEach(add);
      if (material.isShaderMaterial) Object.values(material.uniforms).forEach(uniform => add(uniform.value));
      if (compile) {
        const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
        material.onBeforeCompile(shader, {});
        Object.values(shader.uniforms).forEach(uniform => add(uniform.value));
      }
    }
  });
  return textures;
}
const privateNames = ['sand.webp', 'forest-litter.webp', 'forest-mud.webp', 'forest-relief.webp',
  'forest-bark.webp', 'forest-bark-height.webp'];
function fixture(compile) {
  const start = loaded.length, world = new CoastWorld();
  const inputs = loaded.slice(start), textures = texturesInScene(world.scene, compile);
  inputs.forEach(texture => textures.add(texture));
  const counts = new Map([...textures].map(texture => [texture, 0]));
  for (const texture of textures) texture.addEventListener('dispose', () => counts.set(texture, counts.get(texture) + 1));
  return { world, inputs, textures, counts };
}

test('world retirement releases shader-only textures before/after compilation without taking borrowed ownership', () => {
  const first = fixture(false), second = fixture(true);
  try {
    for (const f of [first, second]) {
      const sand = f.inputs.find(texture => texture.name === 'sand.webp');
      const sandClone = [...f.textures].find(texture => texture !== sand && texture.source === sand.source);
      assert.ok(sandClone, 'Reflector makes a distinct sand wrapper');
      assert.notEqual(sandClone, sand);
      for (const name of privateNames) assert.ok(f.inputs.some(texture => texture.name === name), name);
      const originalCounts = new Map(f.counts);
      f.world.terrain.disposeTextures();
      f.world.terrain.disposeTextures();
      for (const name of ['forest-litter.webp', 'forest-mud.webp', 'forest-relief.webp']) {
        assert.equal(f.counts.get(f.inputs.find(texture => texture.name === name)), 1, name);
      }
      for (const name of ['sand.webp', 'limestone.webp', 'forest-rock.webp']) {
        const input = f.inputs.find(texture => texture.name === name);
        assert.ok(input, name); assert.equal(f.counts.get(input), originalCounts.get(input), `terrain borrows ${name}`);
      }
      f.world.vegetation.disposeTextures(); f.world.vegetation.disposeTextures();
      for (const name of ['forest-bark.webp', 'forest-bark-height.webp']) {
        assert.equal(f.counts.get(f.inputs.find(texture => texture.name === name)), 1, name);
      }
      const other = f === first ? second : first;
      for (const input of f.inputs) assert.ok(!other.inputs.includes(input), 'factories do not share Texture wrappers');
    }
    first.world.dispose(); disposeSceneDrawables(first.world.scene);
    for (const input of second.inputs.filter(texture => texture.name === 'sand.webp')) {
      assert.equal(second.counts.get(input), 0, 'retiring one world does not retire the other sand');
    }
    second.world.dispose(); disposeSceneDrawables(second.world.scene);
    for (const f of [first, second]) {
      for (const name of privateNames) assert.equal(f.counts.get(f.inputs.find(texture => texture.name === name)), 1, name);
      for (const texture of f.textures) assert.ok(f.counts.get(texture) >= 1, `released ${texture.name || texture.type}`);
      const before = [...f.counts.values()];
      f.world.dispose(); disposeSceneDrawables(f.world.scene);
      assert.deepEqual([...f.counts.values()], before, 'repeated world retirement is inert');
    }
  } finally {
    for (const f of [first, second]) { f.world.dispose(); disposeSceneDrawables(f.world.scene); }
  }
});

test('cloned uniform Texture wrappers share Source but require independent dispose events', () => {
  const original = new THREE.Texture({ width: 1, height: 1 });
  const clone = THREE.UniformsUtils.clone({ sample: { value: original } }).sample.value;
  assert.notEqual(clone, original); assert.equal(clone.source, original.source);
  let originalCalls = 0, cloneCalls = 0;
  original.addEventListener('dispose', () => originalCalls++);
  clone.addEventListener('dispose', () => cloneCalls++);
  clone.dispose(); assert.equal(originalCalls, 0); assert.equal(cloneCalls, 1);
  original.dispose(); assert.equal(originalCalls, 1); assert.equal(cloneCalls, 1);
});
