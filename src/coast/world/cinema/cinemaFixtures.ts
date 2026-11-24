import {
  BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Mesh,
  MeshBasicMaterial, Object3D, SRGBColorSpace, Vector3, type Group,
} from 'three';
import { cinemaBoxes, type CinemaBox, type CinemaFinishes } from './cinemaFinishes';
import {
  CINEMA_DOOR_HEIGHT, CINEMA_DOOR_WIDTH, CINEMA_EXITS, CINEMA_PLACES, CINEMA_ROWS, type CinemaExit,
} from './cinemaLayout';

const SIGN_COLUMNS = 4;
const SIGN_ROWS = 8;
const CELL_WIDTH = 256;
const CELL_HEIGHT = 128;
const WHEELCHAIR_SIGN = 28;

function drawSigns(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = SIGN_COLUMNS * CELL_WIDTH;
  canvas.height = SIGN_ROWS * CELL_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  function atCell(index: number, draw: () => void): void {
    ctx.save();
    ctx.translate(index % SIGN_COLUMNS * CELL_WIDTH, Math.floor(index / SIGN_COLUMNS) * CELL_HEIGHT);
    draw();
    ctx.restore();
  }

  CINEMA_EXITS.forEach(({ id }, i) => atCell(i, () => {
    ctx.fillStyle = '#054c3b';
    ctx.fillRect(3, 3, 250, 122);
    ctx.strokeStyle = '#7dbf96';
    ctx.lineWidth = 3;
    ctx.strokeRect(7, 7, 242, 114);
    ctx.fillStyle = '#e3ffe8';
    ctx.fillRect(21, 20, 51, 87);
    ctx.fillStyle = '#138259';
    ctx.fillRect(29, 27, 34, 76);
    ctx.fillStyle = '#e3ffe8';
    ctx.beginPath();
    ctx.arc(54, 48, 9, 0, 2 * Math.PI);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#e3ffe8';
    ctx.beginPath();
    ctx.moveTo(46, 90);
    ctx.lineTo(54, 73);
    ctx.lineTo(67, 78);
    ctx.lineTo(78, 97);
    ctx.moveTo(54, 73);
    ctx.lineTo(62, 57);
    ctx.lineTo(76, 66);
    ctx.lineTo(90, 61);
    ctx.stroke();
    ctx.font = 'bold 53px system-ui, sans-serif';
    ctx.fillText('出口', 151, 66);
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(id, 224, 67);
  }));

  CINEMA_ROWS.forEach(({ number }, i) => atCell(i + 8, () => {
    ctx.fillStyle = '#3e3731';
    ctx.fillRect(3, 7, 250, 114);
    ctx.strokeStyle = '#a48b66';
    ctx.lineWidth = 3;
    ctx.strokeRect(7, 11, 242, 106);
    ctx.fillStyle = '#e9d8ae';
    ctx.font = 'bold 83px monospace';
    ctx.fillText('R' + String(number).padStart(2, '0'), 128, 67);
  }));

  atCell(WHEELCHAIR_SIGN, () => {
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#9fa68c';
    ctx.fillStyle = '#9fa68c';
    ctx.beginPath();
    ctx.arc(120, 22, 9, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(108, 81, 27, Math.PI * 0.26, Math.PI * 1.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(121, 39);
    ctx.lineTo(125, 73);
    ctx.lineTo(151, 73);
    ctx.lineTo(165, 100);
    ctx.lineTo(180, 96);
    ctx.moveTo(124, 57);
    ctx.lineTo(148, 57);
    ctx.stroke();
  });

  const atlas = new CanvasTexture(canvas);
  atlas.colorSpace = SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

function createCinemaSigns(group: Group): void {
  const vertices: number[] = [];
  const uvs: number[] = [];
  const sign = new Object3D();
  const vertex = new Vector3();
  function add(index: number, x: number, y: number, z: number, width: number, height: number, yaw: number, pitch = 0): void {
    sign.position.set(x, y, z);
    sign.rotation.set(pitch, yaw, 0, 'YXZ');
    sign.scale.set(width, height, 1);
    sign.updateMatrix();
    const column = index % SIGN_COLUMNS;
    const row = Math.floor(index / SIGN_COLUMNS);
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
      vertex.set(u - 0.5, v - 0.5, 0).applyMatrix4(sign.matrix);
      vertices.push(vertex.x, vertex.y, vertex.z);
      uvs.push((column + u) / SIGN_COLUMNS, 1 - (row + 1 - v) / SIGN_ROWS);
    }
  }

  CINEMA_EXITS.forEach((exit, i) => {
    const [x, y, z] = doorBox(exit, [0, CINEMA_DOOR_HEIGHT + 0.29, 0.127, 1, 1, 1]);
    add(i, x, y, z, 0.84, 0.37, doorYaw(exit));
  });
  for (const { number, y, z, hasWheelchairBays } of CINEMA_ROWS) {
    for (const side of [-1, 1]) {
      add(number + 7, 5.451 * side, y + 0.582, z - 0.11, 0.162, 0.067, side * Math.PI / 2);
      add(number + 7, 7.869 * side, y + 0.582, z - 0.11, 0.162, 0.067, -side * Math.PI / 2);
      const outer = hasWheelchairBays ? 13.976 : 14.091;
      add(number + 7, outer * side, y + 0.582, z - 0.11, 0.162, 0.067, side * Math.PI / 2);
    }
  }
  for (const { kind, x, y, z } of CINEMA_PLACES) {
    if (kind === 'wheelchair') add(WHEELCHAIR_SIGN, x, y + 0.005, z + 0.025, 0.79, 0.53, Math.PI, -Math.PI / 2);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  const material = new MeshBasicMaterial({ map: drawSigns(), alphaTest: 0.34, toneMapped: false, side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'Emergency exit signs, row numbers and wheelchair markings';
  group.add(mesh);
}

function doorYaw(exit: CinemaExit): number {
  if (exit.side === 'rear') return Math.PI;
  return exit.side === 'left' ? Math.PI / 2 : -Math.PI / 2;
}

function doorBox(exit: CinemaExit, [x, y, z, width, height, depth]: CinemaBox): CinemaBox {
  const yaw = doorYaw(exit);
  return [
    exit.x + x * Math.cos(yaw) + z * Math.sin(yaw), exit.y + y,
    exit.z - x * Math.sin(yaw) + z * Math.cos(yaw), width, height, depth, yaw,
  ];
}

export function createCinemaExits(group: Group, finish: CinemaFinishes) {
  const aperture: CinemaBox[] = [];
  const doorsills: CinemaBox[] = [];
  const vestibules: CinemaBox[] = [];
  const safety: CinemaBox[] = [];
  const steel: CinemaBox[] = [];
  const side = CINEMA_DOOR_WIDTH * 0.5;

  function closedParts(parts: readonly CinemaBox[]): CinemaBox[] {
    return CINEMA_EXITS.flatMap(exit => [-1, 1].flatMap(sign => parts.map(([x, y, z, width, height, depth]) =>
      doorBox(exit, [sign * (side - x), y, z - 0.046, width, height, depth]))));
  }

  for (const exit of CINEMA_EXITS) {
    for (const x of [-side - 0.070, side + 0.070]) {
      aperture.push(doorBox(exit, [x, CINEMA_DOOR_HEIGHT * 0.5, 0.055, 0.14, CINEMA_DOOR_HEIGHT, 0.27]));
    }
    aperture.push(doorBox(exit, [0, CINEMA_DOOR_HEIGHT + 0.055, 0.055, 2.08, 0.11, 0.27]));
    aperture.push(doorBox(exit, [0, CINEMA_DOOR_HEIGHT + 0.29, 0.074, 0.86, 0.39, 0.102]));
    doorsills.push(doorBox(exit, [0, 0.002, 0.022, 1.80, 0.004, 0.35]));
    vestibules.push(
      doorBox(exit, [0, 1.21, -1.39, 2.24, 2.56, 0.25]),
      doorBox(exit, [0, -0.054, -0.70, 2.24, 0.102, 1.49]),
      doorBox(exit, [0, 2.49, -0.70, 2.24, 0.14, 1.49]),
      doorBox(exit, [-1.021, 1.21, -0.70, 0.23, 2.56, 1.49]),
      doorBox(exit, [1.021, 1.21, -0.70, 0.23, 2.56, 1.49]),
    );
    const serviceSide = exit.side === 'right' ? -1 : 1;
    const cabinetX = serviceSide * 1.54;
    safety.push(
      doorBox(exit, [cabinetX, 0.853, 0.126, 0.40, 0.77, 0.238]),
      doorBox(exit, [cabinetX, 1.395, 0.208, 0.103, 0.103, 0.078]),
    );
    steel.push(
      doorBox(exit, [cabinetX, 1.138, 0.250, 0.323, 0.17, 0.012]),
      doorBox(exit, [cabinetX + 0.138, 0.91, 0.253, 0.035, 0.115, 0.018]),
    );
  }
  cinemaBoxes(group, 'Sealed door frames', finish.box, finish.darkSteel, aperture);
  cinemaBoxes(group, 'Flush egress thresholds', finish.box, finish.bronze, doorsills);
  cinemaBoxes(group, 'Light-trap vestibules', finish.box, finish.matte, vestibules);
  cinemaBoxes(group, 'Recessed fire safety cabinets and alarm buttons', finish.box, finish.safetyRed, safety);
  cinemaBoxes(group, 'Fire cabinet metalwork', finish.box, finish.steel, steel);
  cinemaBoxes(group, 'Sealed acoustic door leaves', finish.box, finish.bulkhead,
    closedParts([[0.45, 1.211, 0, 0.884, 2.406, 0.082]]));
  cinemaBoxes(group, 'Door inset and hardware backplates', finish.box, finish.darkSteel, closedParts([
    [0.45, 1.471, 0.047, 0.768, 1.55, 0.023],
    [0.45, 1.025, 0.081, 0.79, 0.109, 0.048],
  ]));
  cinemaBoxes(group, 'Steel panic bars and strike plates', finish.box, finish.steel, closedParts([
    [0.45, 1.025, 0.112, 0.67, 0.041, 0.040],
    [0.21, 0.185, 0.044, 0.231, 0.208, 0.009],
    [0.80, 0.185, 0.044, 0.094, 0.208, 0.009],
  ]));
  createCinemaSigns(group);
}
