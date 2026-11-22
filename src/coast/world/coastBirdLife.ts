import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BIRD_CALL_RANGE, type CoastBirdCue, type CoastBirdSpecies } from '../coastBirdCue';
import { coastRandom, groundHeight, SEA_LEVEL, smoothstep, UPLAND_LAKE } from '../terrain';
import { createBirdMaterials, createBirdModel, type BirdKind, type CoastBirdModel } from './coastBirdModels';
import { coastSwellPhase } from './coastSwell';

type Viewer = { x: number; y: number; z: number };
type Stop = { point: THREE.Vector3; mode: 'branch' | 'ground' | 'water'; yaw: number; contact?: THREE.Mesh };
type Flight = { curve: THREE.CubicBezierCurve3; start: number; duration: number };
type Resident = {
  id: number;
  kind: CoastBirdSpecies;
  model: CoastBirdModel;
  stops: Stop[];
  stop: number;
  switchAt: number;
  callAt: number;
  callUntil: number;
  random: () => number;
  yaw: number;
  flight?: Flight;
  kick: number;
};
type Duck = { model: CoastBirdModel; phase: number; wake: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> };
const tau = Math.PI * 2;
const heading = (x: number, z: number) => Math.atan2(x, z);
const lift = (floor: number, x: number, z: number) => new THREE.Vector3(x, floor, z);
const ground = (x: number, z: number, yaw: number): Stop => ({
  point: lift(groundHeight(x, z) + .012, x, z), yaw, mode: 'ground',
});
const water = (x: number, z: number, yaw: number): Stop => ({ point: lift(SEA_LEVEL, x, z), yaw, mode: 'water' });
const cueCadence: Record<CoastBirdSpecies, [min: number, variation: number, duration: number, gain: number]> = {
  gull: [21, 23, 1.85, .79],
  whiteEye: [13, 16, 1.72, .69],
  bushWarbler: [19, 20, 1.76, .82],
  thrush: [17, 22, 2.83, .77],
};

// Out-of-sight territories on rock ledges, in canopy and in scrub beside the walks.
const territories: readonly [kind: CoastBirdSpecies, x: number, z: number, height: number, firstCall: number][] = [
  ['gull', -155, 11, .75, 18], ['gull', -83, -48, .72, 32],
  ['gull', 89, -38, .58, 23], ['gull', 141, -5, .72, 11],
  ['whiteEye', -112, 90, 5.3, 8], ['whiteEye', 79, 86, 4.4, 18],
  ['whiteEye', -37, 243, 5.0, 12], ['bushWarbler', -43, 326, 2.5, 6],
  ['thrush', 48, 349, 5.0, 17],
  ['bushWarbler', 79, 414, 2.6, 9], ['whiteEye', 119, 481, 5.3, 39],
  ['thrush', 53, 554, 6.4, 7], ['bushWarbler', 24, 644, 3.2, 22],
  ['whiteEye', 169, 682, 5.4, 10], ['bushWarbler', 225, 749, 4.8, 19],
  ['thrush', 177, 828, 6.0, 11], ['bushWarbler', 42, 785, 2.9, 18],
  ['thrush', 37, 892, 4.9, 14], ['bushWarbler', -84, 891, 2.65, 18],
  ['bushWarbler', -67, 1086, 3.1, 43], ['thrush', 59, 1058, 3.6, 8],
  ['bushWarbler', 150, 969, 3.5, 11],
  ['whiteEye', 203, 909, 6.1, 7], ['thrush', 223, 990, 6.2, 17],
  ['bushWarbler', 197, 1026, 3.2, 23],
  ['whiteEye', -18, 898, 3.4, 38], ['whiteEye', 18, 1091, 4.2, 38],
];
const flapRate: Record<BirdKind, number> = { gull: 3.7, whiteEye: 12.4, thrush: 9.5, bushWarbler: 13, duck: 7.5 };

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

const twigAxis = new THREE.Vector3(0, 1, 0);

function createContactMaterial() {
  const size = 32;
  const pixels = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const r = Math.hypot(i - size / 2, j - size / 2) / (size * .49);
      const alpha = Math.round(255 * (1 - smoothstep(.20, .95, r)));
      pixels.set([alpha, alpha, alpha, 255], (j * size + i) * 4);
    }
  }
  const alphaMap = new THREE.DataTexture(pixels, size, size);
  alphaMap.minFilter = alphaMap.magFilter = THREE.LinearFilter;
  alphaMap.needsUpdate = true;
  return new THREE.MeshBasicMaterial({ color: 0x332e2a, alphaMap, transparent: true,
    opacity: .46, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, fog: false });
}

function contactShadow(stop: Stop, standingY: number, material: THREE.MeshBasicMaterial) {
  const geometry = new THREE.PlaneGeometry(standingY * 1.5, standingY * 2.55, 5, 5)
    .rotateX(-Math.PI / 2).rotateY(stop.yaw)
    .translate(stop.point.x - standingY * .28, 0, stop.point.z + standingY * .2);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    position.setY(i, groundHeight(position.getX(i), position.getZ(i)) + .013);
  }
  const shadow = new THREE.Mesh(geometry, material);
  shadow.visible = false;
  return shadow;
}

function createBranch(group: THREE.Group, branchMaterial: THREE.Material, x: number, z: number, height: number, angle: number): Stop {
  const y = groundHeight(x, z);
  const perch = new THREE.Vector3(x, y + height, z);
  const size = .030 + height * .024;
  const direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
  const at = (along: number, lower: number, across = 0) => perch.clone().addScaledVector(direction, along)
    .add(new THREE.Vector3(direction.z * across, -lower, -direction.x * across));
  const foot = at(-.61, height);
  foot.y = groundHeight(foot.x, foot.z) - .12;
  const fork = at(-.32, .30, .055);
  const elbow = at(-.15, .086);
  const parts = [
    [foot, fork, 1.22, .87], [fork, elbow, .87, .62], [elbow, perch, .62, .56], [perch, at(.30, -.031), .56, .18],
    [fork, at(.104, .14, -.33), .57, .20], [at(.081, .152, -.291), at(.21, .097, -.44), .24, .07],
    [elbow, at(-.029, -.127, .137), .37, .07],
  ] as const;
  const segments = parts.map(([a, b, start, tip]) => {
    const delta = b.clone().sub(a);
    const length = delta.length();
    const bark = new THREE.CylinderGeometry(size * tip, size * start, length, 9, 6);
    const points = bark.getAttribute('position');
    const colors = new Float32Array(points.count * 3);
    for (let i = 0; i < points.count; i++) {
      const angle = Math.atan2(points.getX(i), points.getZ(i));
      const shade = .91 + .13 * Math.cos(angle * 13 + points.getY(i) * 5)
        + .058 * Math.sin(angle * 7 - points.getY(i) * 19);
      colors.set([shade, shade * .95, shade * .89], i * 3);
    }
    bark.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return bark
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(twigAxis, delta.normalize()))
      .translate(...a.clone().lerp(b, .5).toArray());
  });
  group.add(new THREE.Mesh(mergeGeometries(segments), branchMaterial));
  segments.forEach(segment => segment.dispose());
  perch.y += size * .55;
  return { point: perch, yaw: angle + 1.43, mode: 'branch' };
}

function stowWings(model: CoastBirdModel) {
  model.folded.visible = true;
  for (const wing of model.wings) wing.arm.visible = false;
}

function wingStroke(model: CoastBirdModel, kind: BirdKind, time: number, power: number, spread: number, phase: number) {
  const stroke = time * flapRate[kind] * tau + phase;
  const beat = .83 * Math.sin(stroke) + .17 * Math.sin(stroke * 2 - .62);
  const wrist = .59 * Math.sin(stroke - .89) + .19 * Math.sin(stroke * 2 - .46);
  model.folded.visible = false;
  for (const { arm, hand, side } of model.wings) {
    arm.visible = true;
    const bias = Math.sin(time * 1.9 + phase * side) * .025;
    arm.rotation.set(-.02 + .10 * beat * power, side * (.12 + (.98 - spread * .98) + .12 * beat * power),
      side * (.045 + bias + beat * power * .92));
    hand.rotation.set(-.04 - .08 * wrist * power, side * (.08 + (1 - spread) * .69 + .11 * wrist * power),
      side * (-.065 + wrist * power * .63));
  }
}

function launch(bird: Resident, elapsed: number) {
  const from = bird.stops[bird.stop];
  bird.stop = (bird.stop + 1) % bird.stops.length;
  const to = bird.stops[bird.stop];
  const standing = bird.model.standingY;
  const start = from.point.clone().add(new THREE.Vector3(0, from.mode === 'water' ? standing * .13 : standing, 0));
  const end = to.point.clone().add(new THREE.Vector3(0, to.mode === 'water' ? standing * .13 : standing, 0));
  const distance = start.distanceTo(end);
  const gull = bird.kind === 'gull';
  const delta = end.clone().sub(start);
  const cross = new THREE.Vector3(-delta.z, 0, delta.x).normalize();
  const arc = distance * (gull ? .45 : .106) * (bird.random() < .5 ? -1 : 1);
  const climb = gull ? 2.7 + distance * .29 : .57 + distance * .15;
  const lead = start.clone().lerp(end, .23).addScaledVector(cross, arc);
  const approach = start.clone().lerp(end, .81).addScaledVector(cross, -arc * .34);
  lead.y = Math.max(start.y + climb, groundHeight(lead.x, lead.z) + climb);
  approach.y = Math.max(end.y + climb * .43, groundHeight(approach.x, approach.z) + climb * .43);
  bird.flight = { curve: new THREE.CubicBezierCurve3(start, lead, approach, end),
    start: elapsed, duration: (gull ? 1.4 : .38) + distance / (gull ? 4.3 : 4.6) };
}

function settle(bird: Resident, elapsed: number) {
  bird.flight = undefined;
  const stay = bird.kind === 'gull' ? 25 : 29;
  bird.switchAt = elapsed + stay + bird.random() * (bird.kind === 'gull' ? 24 : 43);
}

function beatWindow(kind: BirdKind, time: number, phase: number) {
  const pulse = .5 + .5 * Math.sin(time * (kind === 'gull' ? 1.44 : 3.7) + phase);
  return smoothstep(.22, .76, pulse);
}

// Traveling bearings and banks are derived from the actual flight path.
function flyResident(bird: Resident, elapsed: number, u: number, sample: THREE.Vector3, velocity: THREE.Vector3) {
  const flight = bird.flight!;
  const { model, kind, id } = bird;
  const t = Math.min(1, (elapsed - flight.start) / flight.duration);
  flight.curve.getTangent(u, velocity);
  flight.curve.getTangent(Math.min(1, u + .035), sample);
  bird.yaw = heading(velocity.x, velocity.z);
  const bank = wrapAngle(bird.yaw - heading(sample.x, sample.z)) * 1.7;
  const flare = smoothstep(.70, .99, t);
  const push = 1 - smoothstep(.15, .40, t);
  const pitch = -Math.atan2(velocity.y, Math.hypot(velocity.x, velocity.z)) * .48;
  model.root.rotation.set(pitch * (1 - flare) - flare * .25, bird.yaw, bank * (1 - flare), 'YXZ');
  model.body.rotation.set(0, 0, 0);
  model.tail.rotation.x = flare * .18 + bank * .08;
  model.head.rotation.set(-pitch * .46, bank * .33, 0);
  model.jaw.rotation.x = 0;
  const activeFlap = Math.max(push, beatWindow(kind, elapsed, id) * (1 - flare * .46));
  const spread = (.34 + .66 * smoothstep(0, .08, t)) * (1 - .37 * flare);
  wingStroke(model, kind, elapsed, activeFlap, spread, id * 1.7);
  for (const [index, leg] of model.legs.entries()) {
    leg.visible = true;
    leg.rotation.x = .068 * index + 1.64 * (1 - Math.max(push, flare)) - .38 * flare;
  }
}

function resting(bird: Resident, elapsed: number, dt: number) {
  const { kind, model, id } = bird;
  const site = bird.stops[bird.stop];
  const { root, body, head, tail, legs, standingY } = model;
  root.position.copy(site.point);
  const swimming = site.mode === 'water';
  const foraging = kind === 'gull' || kind === 'thrush';
  const glance = smoothstep(.38, .9, Math.sin(elapsed * 1.14 + id * 3.05));
  const peck = foraging && !swimming ? smoothstep(.60, .99, Math.sin(elapsed * .72 + id * 5.6)) : 0;
  const breathing = Math.sin(elapsed * 3.73 + id * 6.04);
  const bob = swimming ? Math.sin(coastSwellPhase(elapsed, root.position.x, root.position.z) * tau) * .057 : 0;
  const call = Number(elapsed < bird.callUntil);
  bird.yaw += wrapAngle(site.yaw - bird.yaw) * Math.min(1, dt * 2);
  root.position.y += swimming ? standingY * .13 + bob : standingY;
  root.rotation.set(swimming ? breathing * .035 : 0, bird.yaw, 0, 'YXZ');
  body.rotation.set(.19 * peck + breathing * .006, 0, .013 * breathing);
  head.rotation.set(peck * .76 - call * .20, .45 * Math.sin(elapsed * 1.34 + id) + glance * .49, -.085 * glance);
  tail.rotation.x = -.11 * glance + peck * .08 + breathing * .022;
  model.jaw.rotation.x = call * (.081 + .36 * Math.max(0, Math.sin(elapsed * (kind === 'bushWarbler' ? 10 : 23) + id)));
  stowWings(model);
  for (const leg of legs) {
    leg.visible = !swimming;
    leg.rotation.x = 0;
  }
}

function distanceToViewer(point: Viewer, viewer: Viewer) {
  return Math.hypot(point.x - viewer.x, point.y - viewer.y, point.z - viewer.z);
}

function placeDuck(duck: Duck, elapsed: number) {
  const { model, wake, phase } = duck;
  const swim = elapsed * .054 + phase + .053 * Math.sin(elapsed * .476 + phase * 6);
  const x = 97 + 4.9 * Math.cos(swim) + .59 * Math.sin(swim * 3 + phase);
  const z = 720 + 5.0 * Math.sin(swim) + 3.5 * phase;
  const feeding = smoothstep(.71, .98, Math.sin(elapsed * .37 + phase * 3 + 2.2));
  const dunk = smoothstep(.49, .93, feeding);
  const paddle = Math.sin(elapsed * 5.4 + phase * 23);
  const waterY = UPLAND_LAKE.level + .012 * paddle;
  model.root.position.set(x, waterY + .055, z);
  const dx = -4.9 * Math.sin(swim) + 1.77 * Math.cos(swim * 3 + phase);
  model.root.rotation.set(feeding * .91 + .021 * paddle, heading(dx, 5 * Math.cos(swim)), .027 * paddle, 'YXZ');
  model.head.rotation.x = .28 * feeding;
  model.head.rotation.y = Math.sin(elapsed * 1.31 + phase) * .14 * (1 - dunk);
  model.tail.rotation.x = -feeding * .10;
  model.jaw.rotation.x = 0;
  stowWings(model);
  for (const [i, leg] of model.legs.entries()) {
    leg.visible = true;
    leg.rotation.x = 1.03 + .57 * Math.sin(elapsed * 7.1 + i * Math.PI + phase * 4) + .82 * dunk;
  }
  wake.position.set(x, UPLAND_LAKE.level + .023, z);
  wake.rotation.y = model.root.rotation.y;
  wake.material.opacity = .29 - feeding * .095;
}

const coastalRoute = new THREE.CatmullRomCurve3([
  [-68, 12, 20], [-12, 6, 42], [41, 8, 27], [76, 16, -28], [23, 22, -73], [-42, 15, -51],
].map(point => new THREE.Vector3(...point)), true);
const outerRoute = new THREE.CatmullRomCurve3([
  [-69, 42, -133], [-7, 34, -107], [66, 42, -129], [86, 63, -195], [38, 62, -259], [-40, 58, -213],
].map(point => new THREE.Vector3(...point)), true);
const gullPasses = [
  { route: coastalRoute, count: 4, period: 43, offset: .24, distance: 190 },
  { route: outerRoute, count: 3, period: 61, offset: .44, distance: 325 },
];

function gullPosition(flight: { pass: typeof gullPasses[number]; phase: number; side: number; altitude: number; seed: number },
  elapsed: number, position: THREE.Vector3, tangent: THREE.Vector3) {
  const t = (elapsed / flight.pass.period + flight.phase + 1) % 1;
  flight.pass.route.getPointAt(t, position);
  flight.pass.route.getTangentAt(t, tangent);
  position.x += tangent.z * flight.side;
  position.z -= tangent.x * flight.side;
  position.y += flight.altitude + 1.25 * Math.sin(elapsed * .47 + flight.seed * 2.21);
  return t;
}

export function createCoastBirdLife() {
  const group = new THREE.Group();
  group.name = 'Coast wildlife';
  const calls: CoastBirdCue[] = [];
  const residents: Resident[] = [];
  const territorialCalls = territories.map(([species, x, z, height, callAt], index) => ({
    id: 201 + index, species, x, y: groundHeight(x, z) + height, z, callAt,
    random: coastRandom(4177 + index * 139),
  }));
  const ducks: Duck[] = [];
  const sample = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const cuePosition = new THREE.Vector3();
  const futurePosition = new THREE.Vector3();
  const birdMaterials = createBirdMaterials();
  const branchMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x776951, roughness: .98 });
  const contactMaterial = createContactMaterial();
  const branch = (x: number, z: number, height: number, angle: number) =>
    createBranch(group, branchMaterial, x, z, height, angle);
  let lastElapsed = 0;

  function resident(kind: CoastBirdSpecies, size: number, callAt: number, stops: Stop[]) {
    const id = residents.length + 1;
    const random = coastRandom(19343 + id * 723);
    const model = createBirdModel(kind, size, birdMaterials);
    const bird = { id, kind, model, stops, stop: 0,
      switchAt: 22 + random() * 37, yaw: stops[0].yaw, callUntil: 0, random, callAt, kick: 0 };
    model.root.name = `${kind}-${id}`;
    group.add(model.root);
    for (const stop of stops) {
      if (stop.mode !== 'ground') continue;
      stop.contact = contactShadow(stop, model.standingY, contactMaterial);
      group.add(stop.contact);
    }
    resting(bird, 0, 0);
    residents.push(bird);
  }

  resident('gull', 1.14, 5.1, [ground(-15.15, 72.2, 1.02), ground(-16.4, 65.8, -.42), water(-16.0, 58.7, -.45)]);
  resident('gull', .96, 13.4, [ground(-8.4, 74.5, -1.18), water(-10.2, 62.5, 1.07), ground(-7.8, 73.6, .84)]);
  resident('gull', 1.08, 26.1, [water(37.4, 35, -.65), ground(49.3, 39.8, -.46), water(43, 40, .53)]);
  resident('whiteEye', 1.28, 7.8, [branch(-22.5, 75.4, 1.03, .22), branch(-25.3, 70.9, .91, -1.86)]);
  resident('whiteEye', 1.12, 16.2, [branch(-30, 107.4, 1.91, -.71), branch(-26.4, 104.7, 1.12, -.13)]);
  resident('thrush', 1.10, 9.5, [ground(-20.8, 108.9, -1.47), branch(-23.4, 106.0, 1.02, -.47)]);
  resident('bushWarbler', 1.17, 7.2, [branch(-23.8, 170.8, 1.20, 1.49), branch(-16.2, 171.1, .95, -1.55)]);
  resident('thrush', 1.06, 15.5, [ground(15.3, 224.2, -1.26), branch(15.8, 220.2, .98, .58)]);
  resident('bushWarbler', 1.20, 9.1, [branch(41.6, 276.5, 1.54, -.3), branch(42.2, 271.2, .99, 1.36)]);
  resident('whiteEye', 1.23, 5.6, [branch(90, 702.9, 1.36, -.43), branch(94, 706.4, 1.19, -.32)]);
  resident('thrush', 1.16, 17.0, [ground(88.3, 698.5, -1.31), branch(84.8, 696.5, 1.23, 2.3)]);
  resident('thrush', 1.08, 12.2, [branch(-109.3, 977.4, 1.30, -.8), ground(-112.2, 980.7, -2.05)]);
  resident('whiteEye', 1.23, 8.6, [branch(224.0, 939, 1.41, .67), branch(220.3, 943.8, 1.03, -.46)]);
  resident('bushWarbler', 1.15, 17.3, [branch(232.1, 965.7, 1.55, .25), branch(228.3, 964.2, 1.24, .61)]);
  resident('thrush', 1.13, 11.7, [ground(248.2, 1036.6, 1.71), branch(247.3, 1040.4, .98, -1.1)]);

  const wakeGeometry = new THREE.RingGeometry(.337, .358, 18, 1, Math.PI * 1.02, Math.PI * .95);
  wakeGeometry.rotateX(-Math.PI / 2).rotateY(Math.PI).scale(.62, 1, 1.39).translate(0, 0, -.146);
  const wakePoints = wakeGeometry.getAttribute('position');
  const wakeColors = new Float32Array(wakePoints.count * 4);
  for (let i = 0; i < wakePoints.count; i++) {
    const alpha = smoothstep(.19, .58, -wakePoints.getZ(i));
    wakeColors.set([1, 1, 1, alpha], i * 4);
  }
  wakeGeometry.setAttribute('color', new THREE.BufferAttribute(wakeColors, 4));
  for (const [i, phase] of [.18, .68, 1.13].entries()) {
    const model = createBirdModel('duck', .94 + i * .09, birdMaterials);
    model.root.name = `duck-${i + 1}`;
    const wake = new THREE.Mesh(wakeGeometry, new THREE.MeshBasicMaterial({
      color: 0xd4e4dc, side: THREE.DoubleSide, transparent: true, opacity: .25, depthWrite: false, vertexColors: true,
    }));
    wake.name = 'Duck wake';
    wake.renderOrder = 5;
    group.add(model.root, wake);
    ducks.push({ model, phase, wake });
  }

  const flock = gullPasses.flatMap((pass, index) => Array.from({ length: pass.count }, (_, i) => {
    const seed = i + index * 7;
    const random = coastRandom(seed * 731 + 4765);
    const bird = createBirdModel('gull', .95 + random() * .20, birdMaterials);
    bird.root.name = `gull-flight-${seed}`;
    group.add(bird.root);
    return { pass, bird, seed, phase: pass.offset - i * .024 - random() * .024,
      side: (random() - .5) * (index ? 25 : 10), altitude: .7 + i * .63 + random() * 2.5,
      callAt: index === 0 && (i === 0 || i === 3) ? 6.8 + i * 5.7 : index === 1 && i === 0 ? 26.4 : Infinity,
      callUntil: 0, random };
  }));

  return {
    group,
    update(elapsed: number, viewer: Viewer): readonly CoastBirdCue[] {
      calls.length = 0;
      const dt = elapsed - lastElapsed;
      lastElapsed = elapsed;
      for (const bird of residents) {
        const model = bird.model;
        for (const site of bird.stops) {
          if (site.contact) site.contact.visible = false;
        }
        if (bird.flight && elapsed > bird.flight.start + bird.flight.duration) settle(bird, elapsed);
        const site = bird.stops[bird.stop];
        let flightProgress = 0;
        if (bird.flight) {
          const t = (elapsed - bird.flight.start) / bird.flight.duration;
          flightProgress = t * (.62 + t * (1.57 - 1.19 * t));
          bird.flight.curve.getPoint(flightProgress, model.root.position);
        } else {
          model.root.position.copy(site.point);
          model.root.position.y += model.standingY * (site.mode === 'water' ? .13 : 1);
        }
        const distance = distanceToViewer(model.root.position, viewer);
        const gull = bird.kind === 'gull';
        model.root.visible = distance < (gull ? 108 : 49);
        const close = distance < (gull ? 1.85 : 1.35);
        if (!bird.flight && close && bird.kick === 0) bird.kick = elapsed + .37 + bird.random() * .61;
        if (!close) bird.kick = 0;
        const movingSoon = bird.kick > 0 && elapsed > bird.kick;
        if (!bird.flight && (elapsed >= bird.switchAt || movingSoon)) {
          launch(bird, elapsed);
          bird.kick = 0;
        }
        const [minimum, variation, phrase, gain] = cueCadence[bird.kind];
        let cue = false;
        if (elapsed >= bird.callAt) {
          if (bird.flight) {
            bird.callAt = bird.flight.start + bird.flight.duration + 1.3 + bird.random() * 2;
          } else {
            bird.callAt = elapsed + minimum + bird.random() * variation;
            bird.callUntil = elapsed + phrase;
            cue = distance < BIRD_CALL_RANGE[bird.kind] + model.standingY;
          }
        }
        if (!model.root.visible && !cue) continue;
        if (bird.flight) {
          flyResident(bird, elapsed, flightProgress, sample, velocity);
        } else {
          resting(bird, elapsed, dt);
          if (site.contact) site.contact.visible = model.root.visible;
          if (cue) {
            model.billTip.getWorldPosition(cuePosition);
            calls.push({ id: bird.id, species: bird.kind,
              x: cuePosition.x, y: cuePosition.y, z: cuePosition.z, gain });
          }
        }
      }

      for (const perch of territorialCalls) {
        if (elapsed < perch.callAt) continue;
        const [minimum, variation, , gain] = cueCadence[perch.species];
        perch.callAt = elapsed + minimum + 12 + perch.random() * (variation + 12);
        if (distanceToViewer(perch, viewer) < BIRD_CALL_RANGE[perch.species]) {
          const { id, species, x, y, z } = perch;
          calls.push({ id, species, x, y, z, gain: gain * .74 });
        }
      }

      for (const duck of ducks) {
        duck.model.root.visible = Math.hypot(107 - viewer.x, UPLAND_LAKE.level - viewer.y, 724 - viewer.z) < 115;
        duck.wake.visible = duck.model.root.visible;
        if (duck.model.root.visible) placeDuck(duck, elapsed);
      }

      for (const flight of flock) {
        const { pass, bird, seed, altitude } = flight;
        const t = gullPosition(flight, elapsed, bird.root.position, velocity);
        const distance = distanceToViewer(bird.root.position, viewer);
        bird.root.visible = distance < pass.distance;
        const strength = beatWindow('gull', elapsed, seed * 1.12) * (.58 + altitude * .036);
        const calling = elapsed >= flight.callAt && strength < .28;
        const cue = calling && distance < BIRD_CALL_RANGE.gull + bird.standingY;
        if (calling) {
          flight.callAt = elapsed + 44 + 32 * flight.random();
          flight.callUntil = elapsed + cueCadence.gull[2];
        }
        if (!bird.root.visible && !cue) continue;
        pass.route.getTangentAt((t + .017) % 1, sample);
        const yaw = heading(velocity.x, velocity.z);
        const bank = 1.56 * wrapAngle(yaw - heading(sample.x, sample.z));
        bird.root.rotation.set(-velocity.y * .27, yaw, bank, 'YXZ');
        bird.head.rotation.y = -bank * .25;
        bird.head.rotation.x = -.02 + velocity.y * .13;
        bird.tail.rotation.x = -.17 * bank;
        for (const leg of bird.legs) leg.visible = false;
        wingStroke(bird, 'gull', elapsed, strength, .96, seed * 1.7);
        if (cue) {
          bird.billTip.getWorldPosition(cuePosition);
          gullPosition(flight, elapsed + .10, futurePosition, sample);
          velocity.subVectors(futurePosition, bird.root.position).multiplyScalar(10);
          calls.push({ id: 101 + seed, species: 'gull', x: cuePosition.x, y: cuePosition.y, z: cuePosition.z,
            gain: .78, vx: velocity.x, vy: velocity.y, vz: velocity.z });
        }
        bird.jaw.rotation.x = elapsed < flight.callUntil ? .17 + .31 * Math.max(0, Math.sin(elapsed * 12 + seed)) : 0;
      }
      return calls;
    },
  };
}
