import * as THREE from 'three';
import type { OverlookFinishes, OverlookModel } from './overlookModel';

const centerZ = 19.1;
const wingZ = 21.45;

function addEntrySconce(model: OverlookModel, finish: OverlookFinishes, x: number, y: number, z: number): void {
  model.block(finish.bronze, x, y, z + 0.10, 0.32, 1.21, 0.21);
  model.block(finish.frosted, x, y, z - 0.022, 0.29, 0.72, 0.2);
  for (const offset of [-0.13, 0, 0.13]) {
    model.block(finish.bronze, x + offset, y, z - 0.141, 0.022, 0.83, 0.031);
  }
  for (const offset of [-0.4, 0.4]) {
    model.block(finish.bronze, x, y + offset, z - 0.01, 0.39, 0.10, 0.34);
    model.block(finish.brass, x, y + offset * 1.11, z - 0.01, 0.30, 0.044, 0.26);
  }
}

function addWindow(model: OverlookModel, finish: OverlookFinishes,
  x: number, y: number, z: number, width: number, height: number): void {
  const edge = width * 0.5;
  model.block(finish.shadowStone, x, y, z + 0.01, width + 0.30, height + 0.30, 0.17);
  model.block(finish.bronze, x, y, z - 0.077, width + 0.10, height + 0.12, 0.064);
  model.block(finish.window, x, y, z - 0.117, width, height, 0.044);
  for (const mullion of [-edge, -edge / 3, edge / 3, edge]) {
    model.block(finish.bronze, x + mullion, y, z - 0.155, 0.047, height + 0.08, 0.056);
  }
  for (const transom of [-0.49, -0.24, 0.07, 0.37, 0.49]) {
    model.block(finish.bronze, x, y + transom * height, z - 0.152, width, 0.053, 0.061);
  }
  model.block(finish.cream, x, y - height * 0.5 - 0.15, z - 0.08, width + 0.52, 0.15, 0.51);
}

function addWing(model: OverlookModel, finish: OverlookFinishes, side: number): void {
  const x = 16.8 * side;
  model.block(finish.limestone, x, 3.45, wingZ, 14.25, 6.9, 18.1);
  model.block(finish.shadowStone, x, 0.43, wingZ - 0.02, 14.36, 0.86, 18.15);
  model.block(finish.cream, x, 0.88, wingZ - 0.04, 14.53, 0.16, 18.27);
  model.block(finish.shadowStone, x, 6.70, wingZ - 0.015, 14.43, 0.13, 18.22);
  model.block(finish.cream, x, 6.91, wingZ - 0.025, 14.55, 0.32, 18.28);
  model.block(finish.cream, x, 7.13, wingZ - 0.035, 14.91, 0.13, 18.53);
  model.block(finish.limestone, x, 7.41, wingZ + 0.26, 13.79, 0.43, 17.45);
  model.block(finish.cream, x, 7.69, wingZ + 0.26, 13.95, 0.13, 17.54);

  for (const offset of [-4.64, -1.54, 1.54, 4.64]) {
    addWindow(model, finish, x + offset, 3.55, 12.38, 1.48, 3.55);
    model.block(finish.shadowStone, x + offset, 5.76, 12.28, 1.70, 0.23, 0.38);
    model.block(finish.cream, x + offset, 5.94, 12.19, 1.85, 0.18, 0.54);
  }
  for (const offset of [-6.88, -3.10, 0, 3.10, 6.88]) {
    model.block(finish.limestone, x + offset, 3.67, 12.20, 0.42, 5.53, 0.56);
    model.block(finish.cream, x + offset, 3.69, 11.89, 0.20, 5.48, 0.11);
    model.block(finish.cream, x + offset, 6.38, 12.08, 0.55, 0.18, 0.75);
  }

  const endX = side * 21.7;
  model.block(finish.limestone, endX, 8.3, wingZ + 0.08, 3.45, 1.49, 16.83);
  model.block(finish.cream, endX, 9.065, wingZ + 0.08, 3.65, 0.17, 16.97);
  model.block(finish.limestone, endX, 9.28, wingZ + 0.08, 2.96, 0.30, 16.32);
  model.block(finish.copperSeam, endX, 9.44, wingZ + 0.08, 3.06, 0.054, 16.44);
  for (const offset of [-0.68, 0, 0.68]) {
    model.block(finish.cream, endX + offset, 8.15, 13.01, 0.14, 1.28, 0.17);
  }
}

function addStarburst(model: OverlookModel, finish: OverlookFinishes): void {
  const y = 7.55;
  const z = 9.28;
  const medallion = (radius: number, depth: number, face: number, material: THREE.Material) => {
    model.mesh(new THREE.CylinderGeometry(radius, radius, depth, 48)
      .rotateX(Math.PI / 2).translate(0, y, face), material);
  };
  medallion(1.10, 0.16, z, finish.cream);
  medallion(0.91, 0.06, z - 0.10, finish.shadowStone);
  medallion(0.83, 0.04, z - 0.14, finish.bronze);
  for (let i = 0; i < 16; i += 1) {
    const angle = i * Math.PI / 8;
    const end = i % 4 === 0 ? 0.748 : 0.53 + (i % 2) * 0.07;
    const ray = new THREE.Shape();
    ray.moveTo(Math.sin(angle) * 0.18 - Math.cos(angle) * 0.05, Math.cos(angle) * 0.18 + Math.sin(angle) * 0.05);
    ray.lineTo(Math.sin(angle) * 0.18 + Math.cos(angle) * 0.05, Math.cos(angle) * 0.18 - Math.sin(angle) * 0.05);
    ray.lineTo(Math.sin(angle) * end, Math.cos(angle) * end);
    model.mesh(new THREE.ExtrudeGeometry(ray, { depth: 0.034, bevelEnabled: false }).translate(0, y, z - 0.201),
      finish.brass);
  }
  medallion(0.18, 0.06, z - 0.22, finish.brass);
}

function addPortico(model: OverlookModel, finish: OverlookFinishes): void {
  model.block(finish.limestone, 0, 4.96, 20.34, 20.6, 9.92, 20.70);
  model.block(finish.shadowStone, 0, 0.42, 20.25, 20.75, 0.84, 20.90);
  model.block(finish.cream, 0, 0.86, 20.17, 20.86, 0.14, 21.21);

  model.block(finish.cream, 0, 0.08, 9.30, 10.90, 0.16, 1.47);
  model.block(finish.limestone, 0, 0.20, 9.56, 10.10, 0.10, 1.10);
  model.block(finish.shadowStone, 0, 2.93, 9.90, 8.25, 5.35, 0.18);
  for (const x of [-2.59, 0, 2.59]) {
    addWindow(model, finish, x, 2.9, 9.777, 2.21, 4.71);
    model.block(finish.bronze, x, 0.30, 9.63, 2.48, 0.09, 0.16);
    model.block(finish.bronze, x, 1.10, 9.61, 2.21, 1.15, 0.089);
    model.block(finish.brass, x, 1.82, 9.575, 1.86, 0.033, 0.035);
    for (const handle of [-0.14, 0.14]) {
      model.rod(finish.brass, new THREE.Vector3(x + handle, 1.61, 9.48),
        new THREE.Vector3(x + handle, 2.21, 9.48), 0.035);
    }
  }
  for (const side of [-1, 1]) {
    const x = 5.70 * side;
    model.block(finish.limestone, x, 3.97, 9.59, 2.93, 7.94, 1.64);
    model.block(finish.shadowStone, x, 0.39, 9.50, 3.03, 0.78, 1.72);
    model.block(finish.cream, x, 0.83, 9.478, 3.19, 0.15, 1.82);
    for (const offset of [-0.69, -0.451, 0.451, 0.69]) {
      model.block(finish.cream, x + offset, 4.05, 8.746, 0.108, 6.20, 0.129);
    }
    addEntrySconce(model, finish, x, 3.45, 8.61);
    model.block(finish.cream, x, 7.09, 9.56, 3.21, 0.19, 1.71);
    model.block(finish.cream, x, 7.94, 9.55, 3.24, 0.18, 1.80);
    for (const offset of [-0.83, -0.415, 0, 0.415, 0.83]) {
      model.block(finish.shadowStone, x + offset, 7.48, 8.75, 0.225, 0.52, 0.139);
    }
  }
  model.block(finish.cream, 0, 5.76, 9.53, 8.32, 0.20, 0.86);
  model.block(finish.limestone, 0, 6.56, 9.71, 8.12, 1.47, 0.83);
  model.block(finish.cream, 0, 6.17, 9.43, 8.23, 0.14, 0.67);
  model.block(finish.cream, 0, 8.19, 9.98, 14.95, 0.23, 2.38);
  model.block(finish.shadowStone, 0, 8.36, 9.98, 15.2, 0.10, 2.42);
  model.block(finish.cream, 0, 8.52, 9.98, 15.5, 0.22, 2.62);
  addStarburst(model, finish);

  for (const [height, width, y, depth] of [
    [0.26, 21.01, 9.85, 21.08],
    [0.13, 21.34, 10.02, 21.31],
    [0.44, 19.74, 10.25, 20.08],
    [0.14, 19.97, 10.51, 20.29],
  ]) {
    model.block(finish.cream, 0, y, 20.33, width, height, depth);
  }
}

function addDome(model: OverlookModel, finish: OverlookFinishes): void {
  const drumRotation = Math.PI / 8;
  const courses = [
    [10.63, 8.75, 0.28, finish.shadowStone],
    [10.92, 8.68, 0.37, finish.cream],
    [11.48, 8.22, 0.78, finish.limestone],
    [11.96, 8.46, 0.17, finish.cream],
    [12.14, 8.14, 0.25, finish.cream],
    [12.31, 7.91, 0.14, finish.copperSeam],
  ] as const;
  for (const [y, radius, height, material] of courses) {
    model.column(material, 0, y, centerZ, radius, radius, height, 8, drumRotation);
  }
  const face = 8.22 * Math.cos(Math.PI / 8);
  for (let i = 0; i < 8; i += 1) {
    const angle = i * Math.PI / 4;
    for (const offset of [-1.28, 1.28]) {
      const x = Math.sin(angle) * (face + 0.07) + Math.cos(angle) * offset;
      const z = centerZ + Math.cos(angle) * (face + 0.07) - Math.sin(angle) * offset;
      model.block(finish.cream, x, 11.46, z, 0.34, 0.86, 0.27, angle);
    }
    for (const offset of [-0.38, 0, 0.38]) {
      const x = Math.sin(angle) * (face + 0.035) + Math.cos(angle) * offset;
      const z = centerZ + Math.cos(angle) * (face + 0.035) - Math.sin(angle) * offset;
      model.block(finish.bronze, x, 11.44, z, 0.195, 0.32, 0.14, angle);
    }
  }

  const panels = 24;
  const spring = 12.36;
  const radius = 7.53;
  const height = 5.65;
  const profile = Array.from({ length: 20 }, (_, i) => {
    const angle = i / 19 * Math.PI * 0.5;
    return new THREE.Vector2(Math.max(0.015, radius * Math.cos(angle)), height * Math.sin(angle));
  });
  const palette = [2, 1, 5, 1, 3, 0, 4, 2, 5, 0, 1, 4, 2, 5, 1, 0, 5, 3, 1, 2, 5, 1, 4, 0];
  for (let i = 0; i < panels; i += 1) {
    const start = i * 2 * Math.PI / panels;
    const amount = 2 * Math.PI / panels;
    model.mesh(new THREE.LatheGeometry(profile, 6, start, amount).translate(0, spring, centerZ),
      finish.copper[palette[i]]);
    if (i === panels / 2) {
      model.mesh(new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p.x + 0.045, p.y + 0.046)),
        7, start + 0.015, amount - 0.03).translate(0, spring, centerZ), finish.copperSeam);
    }
    const points = profile.map(p => new THREE.Vector3(
      (p.x + 0.024) * Math.sin(start), spring + p.y, centerZ + (p.x + 0.024) * Math.cos(start)));
    model.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.035, 5, false), finish.copperSeam);
  }
  model.column(finish.copperSeam, 0, spring + 0.045, centerZ, radius + 0.045, radius + 0.045, 0.16, 96);
  model.column(finish.copperSeam, 0, 18.035, centerZ, 0.23, 0.49, 0.195, 24);
  model.mesh(new THREE.SphereGeometry(0.16, 16, 10).translate(0, 18.24, centerZ), finish.bronze);
}

export function addOverlookPavilion(model: OverlookModel, finish: OverlookFinishes): void {
  addWing(model, finish, -1);
  addWing(model, finish, 1);
  addPortico(model, finish);
  addDome(model, finish);
}
