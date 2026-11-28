import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Raycaster, Vector3 } from 'three';

const src = new URL('../src/', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { CINEMA_RETURN_OUTLETS, CINEMA_RETURN_COFFER_BOXES, CINEMA_VENTILATION_PARTS,
  cinemaVentilationWallBoxes, cinemaVentilationBlocked } = await import('../src/coast/world/cinema/cinemaVentilation.ts');
const { createCinemaAuditorium } = await import('../src/coast/world/cinema/cinemaAuditorium.ts');
const { cinemaNavigation } = await import('../src/coast/world/cinema/cinemaNavigation.ts');
hook.deregister();

const parts = [...CINEMA_RETURN_COFFER_BOXES, ...CINEMA_VENTILATION_PARTS.map(part => part.box)];
function inside([x, y, z], [cx, cy, cz, width, height, depth]) {
  return Math.abs(x - cx) < width / 2 - 1e-8
    && Math.abs(y - cy) < height / 2 - 1e-8
    && Math.abs(z - cz) < depth / 2 - 1e-8;
}

test('all four return outlets share a real open route through the coffer and wall takeoff', () => {
  assert.equal(CINEMA_RETURN_OUTLETS.length, 4);
  for (const [x, y, z] of CINEMA_RETURN_OUTLETS) {
    assert.equal(y, 21.62);
    const sign = Math.sign(x);
    const samples = [];
    for (let height = y; height <= 21.8; height += .005) samples.push([x, height, z]);
    for (let horizontal = Math.abs(x); horizontal <= 20.37; horizontal += .01) samples.push([sign * horizontal, 21.8, z]);
    for (let depth = z; depth < z + .61; depth += .005) samples.push([sign * 20.37, 21.8, depth]);
    const wall = [sign * 20.14, 11, z, .28, 22, 3];
    const volumes = [...parts, ...cinemaVentilationWallBoxes([wall])];
    for (const sample of samples) {
      assert.ok(!volumes.some(box => inside(sample, box)), `Blocked air path at ${sample}`);
    }
  }
});

test('actual auditorium meshes leave the mouth open and close it with the recessed plenum top', () => {
  const originalDocument = globalThis.document;
  // Only exit-sign rasterization needs a DOM here. This stub is not a drawing
  // check; rays below inspect the actual auditorium and ventilation geometries.
  globalThis.document = { createElement() { return { getContext() {
    return new Proxy({}, { get: () => () => undefined });
  } }; } };
  let auditorium;
  try {
    auditorium = createCinemaAuditorium();
    auditorium.group.updateMatrixWorld(true);
    const ray = new Raycaster();
    for (const [x, y, z] of CINEMA_RETURN_OUTLETS) {
      ray.set(new Vector3(x, y, z), new Vector3(0, 1, 0));
      const hit = ray.intersectObject(auditorium.group, true)[0];
      assert.ok(hit, `Missing upper plenum closure at ${x}/${z}`);
      assert.ok(Math.abs(hit.point.y - 21.945) < 1e-5, `Unexpected solid in outlet: ${hit.point.y}`);
    }
    // The straight takeoff ends at an opaque elbow, not the outside scene.
    for (const [x, , z] of CINEMA_RETURN_OUTLETS) {
      const sign = Math.sign(x);
      ray.set(new Vector3(sign * 19.07, 21.8, z), new Vector3(sign, 0, 0));
      const hit = ray.intersectObject(auditorium.group, true)[0];
      assert.ok(hit);
      assert.ok(Math.abs(Math.abs(hit.point.x) - 20.45) < 1e-5);
    }
  } finally {
    auditorium?.dispose();
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('visible return parts retain positive dimensions, roof contacts and camera clearance volumes', () => {
  for (const box of parts) {
    assert.ok(box.every(Number.isFinite));
    assert.ok(box.slice(3, 6).every(size => size > 0));
    assert.ok(box[1] + box[4] / 2 <= 22 + 1e-10);
  }
  const supports = CINEMA_VENTILATION_PARTS.filter(part => part.kind === 'support');
  assert.equal(supports.length, 32);
  for (const { box: [x, y, z, , height] } of supports) {
    assert.ok(Math.abs(y + height / 2 - 22) < 1e-12);
    assert.equal(cinemaVentilationBlocked(x, y, z, 0), true);
  }
  for (const [x, , z] of CINEMA_RETURN_OUTLETS) {
    assert.equal(cinemaVentilationBlocked(x, 21.3, z, .25), false);
    assert.equal(cinemaVentilationBlocked(x, 21.5, z, .25), true);
    assert.equal(cinemaNavigation.blocksFlight(x, z, 21.3, .25), false);
    assert.equal(cinemaNavigation.blocksFlight(x, z, 21.5, .25), true);
    assert.equal(cinemaVentilationBlocked(x, 21.8, z, 0), false); // real cavity for tracked-head visibility
  }
  assert.equal(cinemaNavigation.flightCeiling, 22);
});
