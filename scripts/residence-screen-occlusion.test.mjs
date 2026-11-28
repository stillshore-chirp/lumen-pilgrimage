import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
const sourceRoot = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  const internal = context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && !/\.(ts|js|mjs)$/.test(specifier);
  return nextResolve(internal ? specifier + '.ts' : specifier, context);
}});
const { createResidenceScreenOcclusion } = await import('../src/coast/world/residence/residenceScreenOcclusion.ts');
const { createResidenceReflections } = await import('../src/coast/world/residence/residenceReflections.ts');
const { createResidenceLighting } = await import('../src/coast/world/residence/residenceLighting.ts');
const { createResidenceMaterials } = await import('../src/coast/world/residence/residenceMaterials.ts');
hooks.deregister();

function setup() {
  const material = new THREE.MeshStandardMaterial();
  const oldCompile = shader => { shader.fragmentShader += '\n// prior lighting'; };
  const oldCache = () => 'prior-key';
  material.onBeforeCompile = oldCompile; material.customProgramCacheKey = oldCache;
  const group = new THREE.Group(); group.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  const glass = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ transparent: true })); group.add(glass);
  const hidden = glass.clone(); hidden.visible = false; group.add(hidden);
  const scene = new THREE.Scene(); scene.add(group); const override = new THREE.MeshBasicMaterial(); scene.overrideMaterial = override;
  const ao = createResidenceScreenOcclusion(group);
  const shader = { uniforms: {}, fragmentShader: '#include <common>\n// Near-surface occlusion is inserted here for high quality.' };
  material.onBeforeCompile(shader, {});
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, .08, 43500); camera.position.set(4.45, 2.6, -3.9); camera.lookAt(3.944, 2.88, -3.585); camera.updateMatrixWorld();
  const canvas = new EventTarget(); const resources = new Set(); const disposed = new Set();
  const listenerCounts = new Map(), originalAdd = canvas.addEventListener.bind(canvas), originalRemove = canvas.removeEventListener.bind(canvas);
  canvas.addEventListener = (type, fn, options) => { const callbacks = listenerCounts.get(type) ?? new Set(); callbacks.add(fn); listenerCounts.set(type, callbacks); originalAdd(type, fn, options); };
  canvas.removeEventListener = (type, fn, options) => { listenerCounts.get(type)?.delete(fn); originalRemove(type, fn, options); };
  const track = object => { if (!object || resources.has(object)) return; resources.add(object); object.addEventListener('dispose', () => disposed.add(object)); };
  track(shader.uniforms.residenceNearImage.value);
  const previousTarget = new THREE.WebGLRenderTarget(3, 4); const viewport = new THREE.Vector4(1, 2, 12, 16); const scissor = new THREE.Vector4(2, 3, 8, 9);
  const glstate = { mask: false, clear: .25, colorMask: [false, false, false, false], lost: false };
  const context = { DEPTH_WRITEMASK: 1, DEPTH_CLEAR_VALUE: 2, COLOR_WRITEMASK: 3,
    getParameter(key) { return key === 1 ? glstate.mask : key === 2 ? glstate.clear : [...glstate.colorMask]; },
    colorMask(...mask) { glstate.colorMask = mask; }, isContextLost() { return glstate.lost; } };
  const renderer = {
    domElement: canvas, xr: { enabled: true, isPresenting: false }, shadowMap: { autoUpdate: true, needsUpdate: true }, autoClear: true,
    buffer: new THREE.Vector2(1920, 1080), target: previousTarget, face: 2, mip: 1, viewport: viewport.clone(), scissor: scissor.clone(), scissorTest: true,
    clearColor: new THREE.Color(0x304050), alpha: .6, calls: [], renders: 0, failAt: 0, restoreThrows: false,
    state: { buffers: { color: { setMask(value) { glstate.colorMask.fill(value); }, reset() {} }, depth: { setMask(value) { glstate.mask = value; }, setClear(value) { glstate.clear = value; } } } },
    getContext() { return context; }, getDrawingBufferSize(out) { return out.copy(this.buffer); }, getRenderTarget() { return this.target; },
    getActiveCubeFace() { return this.face; }, getActiveMipmapLevel() { return this.mip; }, getViewport(out) { return out.copy(this.viewport); },
    getScissor(out) { return out.copy(this.scissor); }, getScissorTest() { return this.scissorTest; },
    getClearColor(out) { return out.copy(this.clearColor); }, getClearAlpha() { return this.alpha; },
    setClearColor(value, alpha) { this.clearColor.set(value); this.alpha = alpha; },
    setViewport(value) { this.viewport.copy(value); }, setScissor(value) { this.scissor.copy(value); }, setScissorTest(value) { this.scissorTest = value; },
    setRenderTarget(value, face = 0, mip = 0) {
      if (this.restoreThrows && value === previousTarget) throw new Error('controlled restore failure');
      this.target = value; this.face = face; this.mip = mip; this.calls.push(value); if (value !== previousTarget) track(value);
    },
    clear(color, depth, stencil) { assert.deepEqual([color, depth, stencil], [true, true, false]); assert.equal(glstate.mask, true); assert.equal(glstate.clear, 1); },
    resetState() { glstate.mask = true; glstate.clear = 1; glstate.colorMask.fill(true); },
    render(actualScene) {
      this.renders++;
      assert.equal(this.xr.enabled, false); assert.equal(this.shadowMap.autoUpdate, false); assert.equal(this.shadowMap.needsUpdate, false);
      const geometryPass = actualScene === scene;
      assert.equal(glass.visible, false); assert.equal(hidden.visible, false);
      if (geometryPass) {
        const m = actualScene.overrideMaterial; track(m); assert.ok(m instanceof THREE.MeshNormalMaterial); assert.equal(m.flatShading, true);
        assert.equal(this.target.depthTexture.type, THREE.UnsignedIntType); assert.equal(this.target.texture.colorSpace, THREE.NoColorSpace);
      } else {
        const mesh = actualScene.children[0], m = mesh.material; track(m); track(mesh.geometry);
        assert.equal(m.blending, THREE.NoBlending); assert.equal(m.depthWrite, false); assert.equal(m.toneMapped, false);
        assert.equal(this.target.depthBuffer, false); assert.equal(this.target.texture.colorSpace, THREE.NoColorSpace);
        for (const uniform of Object.values(m.uniforms)) {
          assert.notEqual(uniform.value, this.target.texture, 'No pass may sample its attached color target');
          assert.notEqual(uniform.value, this.target.depthTexture, 'No pass may sample its attached depth target');
        }
      }
      if (this.renders === this.failAt) throw new Error('controlled pass failure');
    },
  };
  function restored() {
    assert.equal(scene.overrideMaterial, override); assert.equal(glass.visible, true); assert.equal(hidden.visible, false);
    assert.equal(renderer.target, previousTarget); assert.equal(renderer.face, 2); assert.equal(renderer.mip, 1);
    assert.ok(renderer.viewport.equals(viewport)); assert.ok(renderer.scissor.equals(scissor)); assert.equal(renderer.scissorTest, true);
    assert.equal(renderer.autoClear, true); assert.equal(renderer.xr.enabled, true); assert.equal(renderer.shadowMap.autoUpdate, true); assert.equal(renderer.shadowMap.needsUpdate, true);
    assert.equal(glstate.mask, false); assert.equal(glstate.clear, .25); assert.deepEqual(glstate.colorMask, [false, false, false, false]);
    assert.ok(renderer.clearColor.equals(new THREE.Color(0x304050))); assert.equal(renderer.alpha, .6);
  }
  return { ao, shader, renderer, camera, scene, material, oldCompile, oldCache, canvas, listenerCounts, glstate, resources, disposed, restored };
}

for (const pass of [1, 2, 3, 4]) test(`failure in capture pass ${pass} restores state and leaves AO invalid`, () => {
  const f = setup(); f.ao.setActive(true); f.renderer.failAt = pass;
  assert.throws(() => f.ao.capture(f.renderer, f.scene, f.camera, 960, 540), /controlled pass failure/);
  f.restored(); assert.equal(f.shader.uniforms.residenceNearAO.value, 0); assert.equal(f.ao.needsCapture(f.renderer, true), true);
  f.ao.dispose();
});

test('desired activation, validity, eligibility, resize and context restoration have distinct states', () => {
  const f = setup(); const { ao, shader, renderer } = f;
  assert.equal(ao.needsCapture(renderer, false), false); assert.equal(ao.needsCapture(renderer, true), true);
  ao.setActive(true); assert.equal(shader.uniforms.residenceNearAO.value, 0);
  ao.capture(renderer, f.scene, f.camera, 960, 540); f.restored();
  assert.equal(shader.uniforms.residenceNearAO.value, 1); assert.equal(ao.needsCapture(renderer, true), false);
  assert.deepEqual(renderer.calls.slice(0, 4).map(t => [t.width, t.height]), [[960, 540], [960, 540], [960, 540], [960, 540]]);
  ao.setActive(false); assert.equal(shader.uniforms.residenceNearAO.value, 0); assert.equal(ao.needsCapture(renderer, true), false);
  ao.setActive(true); assert.equal(shader.uniforms.residenceNearAO.value, 1);
  renderer.xr.isPresenting = true; ao.setActive(false); assert.equal(ao.needsCapture(renderer, true), false); assert.equal(shader.uniforms.residenceNearAO.value, 0);
  renderer.xr.isPresenting = false; renderer.buffer.set(640, 360); assert.equal(ao.needsCapture(renderer, false), false); assert.equal(ao.needsCapture(renderer, true), true); assert.equal(shader.uniforms.residenceNearAO.value, 0);
  ao.capture(renderer, f.scene, f.camera, 480, 270); assert.equal(ao.needsCapture(renderer, true), false);
  assert.deepEqual(renderer.calls.slice(-4, -1).map(t => [t.width, t.height]), [[320, 180], [320, 180], [320, 180]], 'AO follows half actual buffer, not minimum480 depth');
  f.glstate.lost = true; f.canvas.dispatchEvent(new Event('webglcontextlost')); assert.equal(shader.uniforms.residenceNearAO.value, 0); assert.equal(ao.needsCapture(renderer, true), false);
  f.glstate.lost = false; f.canvas.dispatchEvent(new Event('webglcontextrestored')); assert.equal(ao.needsCapture(renderer, true), true); assert.equal(shader.uniforms.residenceNearAO.value, 0);
  ao.capture(renderer, f.scene, f.camera, 480, 270); assert.equal(ao.needsCapture(renderer, true), false);
  const calls = renderer.renders; assert.equal(ao.needsCapture(renderer, false), false); assert.equal(renderer.renders, calls, 'Consulting dirty state must not render');
  ao.dispose();
});

test('restore failure never publishes a completed image', () => {
  const f = setup(); f.ao.setActive(true); f.renderer.restoreThrows = true;
  assert.throws(() => f.ao.capture(f.renderer, f.scene, f.camera, 960, 540), /controlled restore failure/);
  assert.equal(f.shader.uniforms.residenceNearAO.value, 0); assert.equal(f.ao.needsCapture(f.renderer, true), true); f.ao.dispose();
});

test('successful pipeline keeps sampler identity, composes/restores hooks and disposes owned resources once', () => {
  const f = setup(); const sampler = f.shader.uniforms.sampledDepth.value;
  assert.ok(f.shader.fragmentShader.includes('// prior lighting')); assert.ok(f.material.customProgramCacheKey().startsWith('prior-key|'));
  f.ao.capture(f.renderer, f.scene, f.camera, 960, 540);
  assert.equal(f.shader.uniforms.sampledDepth.value, sampler); assert.ok(f.shader.uniforms.depthView.value.equals(f.camera.matrixWorldInverse));
  assert.ok(f.shader.uniforms.depthInverseProjection.value.equals(f.camera.projectionMatrixInverse));
  f.ao.dispose(); assert.equal(f.material.onBeforeCompile, f.oldCompile); assert.equal(f.material.customProgramCacheKey, f.oldCache);
  assert.equal(f.disposed.size, 8); const count = f.disposed.size; f.ao.dispose(); assert.equal(f.disposed.size, count);
  f.canvas.dispatchEvent(new Event('webglcontextrestored')); assert.equal(f.ao.needsCapture(f.renderer, true), false);
});


test('per-channel color masks do not lose depth-state restoration', () => {
  const f = setup(); const mask = [true, false, true, false]; f.glstate.colorMask = [...mask];
  f.ao.capture(f.renderer, f.scene, f.camera, 960, 540);
  assert.deepEqual(f.glstate.colorMask, mask); assert.equal(f.glstate.mask, false); assert.equal(f.glstate.clear, .25); f.ao.dispose();
});

test('actual reflections disables high-eye AO before the no-reflections return and bounds dirty eligible refreshes', () => {
  const f = setup(), renderer = f.renderer;
  renderer.extensions = { has() { return false; } }; renderer.shadowMap.enabled = false;
  renderer.render = function() { this.renders++; };
  const scene = new THREE.Scene(), shell = new THREE.Group(), furniture = new THREE.Group(), exterior = new THREE.Group();
  scene.add(shell, furniture, exterior);
  const materials = Object.fromEntries(['glass', 'clearMirror', 'oak', 'stone', 'tile'].map(key => [key, new THREE.MeshStandardMaterial()]));
  materials.glass.transparent = true;
  const receiverMaterial = new THREE.MeshStandardMaterial(); const receiver = new THREE.Mesh(new THREE.BoxGeometry(), receiverMaterial); shell.add(receiver);
  const farFloor = new THREE.Mesh(new THREE.BoxGeometry(), materials.oak); farFloor.position.set(1000, 0, 1000); shell.add(farFloor);
  const farGlass = new THREE.Mesh(new THREE.PlaneGeometry(), materials.glass); farGlass.position.set(1000, 1, -.1); shell.add(farGlass);
  const reflections = createResidenceReflections(scene, exterior, shell, furniture, materials);
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <worldpos_vertex>', fragmentShader: '#include <common>\n// Near-surface occlusion is inserted here for high quality.' };
  receiverMaterial.onBeforeCompile(shader, renderer);
  const camera = new THREE.PerspectiveCamera(60, 16/9, .08, 43500); camera.position.set(5, 1.6, -2);
  reflections.setQuality('high');
  try {
    reflections.prepareRender(renderer, camera);
    assert.equal(shader.uniforms.residenceNearAO.value, 1, 'Low high-quality pose must create and activate AO');
    const first = renderer.renders;
    camera.position.y = 3.6;
    reflections.prepareRender(renderer, camera);
    assert.equal(shader.uniforms.residenceNearAO.value, 0, 'High eye must disable old AO even when no reflection is visible');
    for (let i = 0; i < 6; i++) reflections.prepareRender(renderer, camera);
    assert.equal(renderer.renders, first, 'An ineligible unchanged pose must not force capture');
    camera.position.y = 1.6; reflections.prepareRender(renderer, camera);
    assert.equal(shader.uniforms.residenceNearAO.value, 1);
    reflections.prepareRender(renderer, camera);
    const stable = renderer.renders;
    renderer.buffer.set(1280, 720); reflections.prepareRender(renderer, camera);
    assert.equal(renderer.renders, stable + 4, 'A changed buffer must regenerate the complete four-pass capture at the same pose');
    reflections.prepareRender(renderer, camera); assert.equal(renderer.renders, stable + 4);
    f.glstate.lost = true; f.canvas.dispatchEvent(new Event('webglcontextlost')); reflections.prepareRender(renderer, camera);
    assert.equal(shader.uniforms.residenceNearAO.value, 0); assert.equal(renderer.renders, stable + 4);
    f.glstate.lost = false; f.canvas.dispatchEvent(new Event('webglcontextrestored')); reflections.prepareRender(renderer, camera);
    assert.equal(shader.uniforms.residenceNearAO.value, 1); assert.equal(renderer.renders, stable + 8);
    reflections.prepareRender(renderer, camera); assert.equal(renderer.renders, stable + 12, 'Context recovery preserves the existing two-refresh policy');
    for (let i = 0; i < 6; i++) reflections.prepareRender(renderer, camera);
    assert.equal(renderer.renders, stable + 12, 'Recovery refresh must converge instead of forcing every frame');
    reflections.setQuality('light'); const lightRenders = renderer.renders;
    for (let i = 0; i < 6; i++) reflections.prepareRender(renderer, camera);
    assert.equal(shader.uniforms.residenceNearAO.value, 0); assert.equal(renderer.renders, lightRenders);
  } finally { reflections.dispose(); f.ao.dispose(); }
});


test('AO binds lifecycle before the first capture and releases owned data while lost', () => {
 const f=setup(); let placeholderDisposals=0;
 f.shader.uniforms.residenceNearImage.value.addEventListener('dispose',()=>placeholderDisposals++);
 f.ao.bindRenderer(f.renderer); f.ao.setActive(true);
 f.glstate.lost=true; f.canvas.dispatchEvent(new Event('webglcontextlost'));
 assert.equal(placeholderDisposals,1); assert.equal(f.shader.uniforms.residenceNearAO.value,0);
 f.glstate.lost=false; f.canvas.dispatchEvent(new Event('webglcontextrestored'));
 assert.equal(f.ao.needsCapture(f.renderer,true),true);
 f.ao.dispose(); const after=placeholderDisposals;
 f.glstate.lost=true; f.canvas.dispatchEvent(new Event('webglcontextlost'));
 assert.equal(placeholderDisposals,after,'Disposal detaches the canvas lifecycle listener');
});

test('lighting releases only owned shadow RTs while lost and leaves RC5 main-shadow-first intact', () => {
 const f=setup(),scene=new THREE.Scene(),materials=createResidenceMaterials();
 const lighting=createResidenceLighting(scene,materials);
 lighting.bindRenderer(f.renderer);
 const owned=[];scene.traverse(o=>{if(o.isLight&&o.shadow)owned.push(o);});
 assert.ok(owned.length>0);
 const values=owned.map(o=>({size:o.shadow.mapSize.toArray(),radius:o.shadow.radius,intensity:o.shadow.intensity,cast:o.castShadow,visible:o.visible}));
 let releases=0;
 for(const light of owned){const map=new THREE.WebGLRenderTarget(128,128);map.addEventListener('dispose',()=>releases++);light.shadow.map=map;}
 f.glstate.lost=true;f.canvas.dispatchEvent(new Event('webglcontextlost'));
 assert.equal(releases,owned.length);
 owned.forEach((light,i)=>{assert.equal(light.shadow.map,null);assert.equal(light.shadow.mapPass,null);assert.equal(light.shadow.needsUpdate,true);assert.deepEqual({size:light.shadow.mapSize.toArray(),radius:light.shadow.radius,intensity:light.shadow.intensity,cast:light.castShadow,visible:light.visible},values[i]);});
 f.glstate.lost=false;f.canvas.dispatchEvent(new Event('webglcontextrestored'));
 f.renderer.shadowMap.enabled=true;f.renderer.shadowMap.needsUpdate=false;
 const reflections=createResidenceReflections(scene,new THREE.Group(),new THREE.Group(),new THREE.Group(),materials);reflections.setQuality('high');
 const before=f.renderer.renders;reflections.prepareRender(f.renderer,f.camera);
 assert.equal(f.renderer.renders,before,'Missing shadow targets must be left for the main pass before any offscreen capture');
 assert.equal(f.renderer.shadowMap.needsUpdate,true);
 reflections.dispose();lighting.dispose();const old=releases;
 f.glstate.lost=true;f.canvas.dispatchEvent(new Event('webglcontextlost'));assert.equal(releases,old);
 materials.dispose();f.ao.dispose();
});


test('reflection and AO context listeners are detached after an early shadow-first disposal', () => {
 const f=setup(),scene=new THREE.Scene(),materials=createResidenceMaterials();
 const sun=new THREE.DirectionalLight();sun.castShadow=true;scene.add(sun);
 f.renderer.shadowMap.enabled=true;
 const reflections=createResidenceReflections(scene,new THREE.Group(),new THREE.Group(),new THREE.Group(),materials);
 reflections.setQuality('high');reflections.prepareRender(f.renderer,f.camera);
 assert.equal(f.renderer.renders,0);
 assert.equal(f.listenerCounts.get('webglcontextlost').size,2,'Reflection and AO each own one loss listener before the first capture');
 assert.equal(f.listenerCounts.get('webglcontextrestored').size,2);
 reflections.dispose();
 assert.equal(f.listenerCounts.get('webglcontextlost').size,0);
 assert.equal(f.listenerCounts.get('webglcontextrestored').size,0);
 f.ao.dispose();materials.dispose();
});
