import { CatmullRomCurve3, Group, MathUtils, Vector3 } from 'three';
import type { CoastBirdCue } from '../../coastBirdCue';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { createBirdMaterials, createBirdModel } from '../coastBirdModels';
import { buildLakeFish } from './lakeWildlifeFish';

type FlightPlan = {
  name: string;
  size: number;
  speed: number;
  atNight: boolean;
  firstStroke: number;
  strokeInterval: number;
  call?: { firstAt: number; gain: number };
  points: readonly (readonly [x: number, y: number, z: number])[];
};

const flights: readonly FlightPlan[] = [
  {
    name: 'lake-gull-window', size: 1.39, speed: 8.6, atNight: false,
    firstStroke: 1.56, strokeInterval: 7.3, call: { firstAt: 4.7, gain: .50 },
    // The first leg crosses the aperture of the ring as seen through the middle window.
    points: [
      [-18, 13.4, -49], [-6, 10.7, -40], [12, 8.35, -30], [25.5, 9.5, -36],
      [31, 12, -62], [43, 19, -110], [34, 28, -175], [-11, 31, -205],
      [-40, 29, -159], [-23, 21.5, -115], [-12, 14.5, -79], [-22, 12.9, -60],
    ],
  },
  {
    name: 'lake-gull-shore', size: 1.24, speed: 9.7, atNight: true,
    firstStroke: .26, strokeInterval: 9.8, call: { firstAt: 17.5, gain: .34 },
    points: [
      [31, 11.5, -97], [4, 9.6, -104], [-19, 8.7, -107], [-26, 15.2, -138],
      [-36, 23, -188], [-31, 31, -268], [-4, 34, -337], [96, 28, -294],
      [130, 20, -199], [92, 17, -132], [65, 15, -104],
    ],
  },
  {
    name: 'lake-gull-valley', size: 1.28, speed: 10.5, atNight: false,
    firstStroke: 4.5, strokeInterval: 11.6,
    points: [
      [-50, 35, -179], [-54, 36.4, -218], [-20, 43, -251], [59, 49, -251],
      [111, 53, -292], [149, 46, -367], [78, 39, -402], [-46, 45, -397],
      [-86, 45, -321], [-70, 38, -236],
    ],
  },
];

const { clamp, euclideanModulo, smoothstep } = MathUtils;
const fullCircle = Math.PI * 2;
const bankSampleDistance = 2.8;

export function buildLakeWildlife(root: Group) {
  const birds = new Group();
  birds.name = 'Lake birds';
  root.add(birds);

  const swim = buildLakeFish(root);
  const materials = createBirdMaterials();
  const gulls = flights.map((flight, index) => {
    const model = createBirdModel('gull', flight.size, materials);
    model.root.name = flight.name;
    model.folded.visible = false;
    for (const leg of model.legs) leg.visible = false;
    birds.add(model.root);

    const route = new CatmullRomCurve3(flight.points.map(point => new Vector3(...point)), true);
    route.arcLengthDivisions = 800;
    return {
      ...flight, model, route, length: route.getLength(), id: 401 + index,
      callAt: flight.call?.firstAt ?? Infinity, callUntil: -Infinity,
    };
  });
  const calls: CoastBirdCue[] = [];
  const tangent = new Vector3();
  const before = new Vector3();
  const after = new Vector3();
  const bill = new Vector3();
  let night = false;

  return {
    setTimeOfDay(time: CoastTimeOfDay): void {
      night = time === 'night';
    },

    update(elapsed: number): readonly CoastBirdCue[] {
      calls.length = 0;
      swim(elapsed, night);
      for (const gull of gulls) {
        const { model, route, length, firstStroke, strokeInterval } = gull;
        model.root.visible = !night || gull.atNight;
        const call = model.root.visible && !night && elapsed >= gull.callAt ? gull.call : undefined;
        if (elapsed >= gull.callAt) gull.callAt = elapsed + length / gull.speed;
        if (!model.root.visible) continue;

        const time = elapsed - firstStroke;
        const speedPhase = .46 * time;
        const distance = gull.speed * elapsed + 1.15 * Math.sin(speedPhase);
        const speed = gull.speed + .529 * Math.cos(speedPhase);
        const u = euclideanModulo(distance / length, 1);
        route.getPointAt(u, model.root.position);
        route.getTangentAt(u, tangent);
        // Bank from the horizontal turn rate over a few metres of path.
        const sample = bankSampleDistance / length;
        route.getTangentAt(euclideanModulo(u - sample, 1), before);
        route.getTangentAt(euclideanModulo(u + sample, 1), after);
        const turn = Math.atan2(before.z * after.x - before.x * after.z, before.x * after.x + before.z * after.z);
        const bank = clamp(-Math.atan(speed * speed * turn / (2 * bankSampleDistance * 9.81)), -.53, .53);
        const yaw = Math.atan2(tangent.x, tangent.z);
        const pitch = -.033 - .75 * Math.atan2(tangent.y, Math.hypot(tangent.x, tangent.z));

        const burst = euclideanModulo(time, strokeInterval);
        const strength = smoothstep(burst, 0, .23) * (1 - smoothstep(burst, .83, 1.26)) * (night ? .49 : .76);
        const stroke = fullCircle * 3.1 * time;
        const beat = .84 * Math.sin(stroke) + .16 * Math.sin(2 * stroke - .53);
        const wristBeat = Math.sin(stroke - .85);
        const breath = Math.sin(.74 * time);
        model.root.position.y += .19 * breath + .041 * strength * Math.cos(stroke - .83);
        model.root.rotation.set(pitch + .028 * beat * strength, yaw, bank, 'YXZ');
        model.head.rotation.set(-pitch * .48, -bank * .23, -bank * .24);
        model.tail.rotation.x = .10 * breath + .12 * strength * wristBeat;
        for (const { side, arm, hand } of model.wings) {
          const trim = .023 * breath - side * bank * .09;
          arm.rotation.set(-.025, side * (.094 + trim + .14 * beat * strength),
            side * (.061 + trim + .84 * beat * strength));
          hand.rotation.set(-.036 - .074 * wristBeat * strength,
            side * (.11 + trim + .14 * wristBeat * strength), side * (-.11 + .58 * wristBeat * strength));
        }

        if (call) {
          gull.callUntil = elapsed + .84;
          model.billTip.getWorldPosition(bill);
          calls.push({ id: gull.id, species: 'gull', gain: call.gain, x: bill.x, y: bill.y, z: bill.z,
            vx: tangent.x * speed, vy: tangent.y * speed, vz: tangent.z * speed });
        }
        model.jaw.rotation.x = !night && elapsed < gull.callUntil
          ? .15 + .18 * Math.max(0, Math.sin(stroke * .67)) : 0;
      }
      return calls;
    },
  };
}
