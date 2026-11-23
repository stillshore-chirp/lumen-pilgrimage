import {
  Color, DataTexture, Group, InstancedMesh, LinearFilter, MeshBasicMaterial, Object3D,
  PlaneGeometry, RGBAFormat, UnsignedByteType, type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CINEMA_PLACES } from './cinemaLayout';
import type { CinemaFinishes } from './cinemaFinishes';

type SeatPart = readonly [
  x: number, y: number, z: number, width: number, height: number, depth: number, tilt?: number,
];

export function createCinemaSeats(group: Group, finish: CinemaFinishes) {
  const main = new Group();
  main.name = 'Folded cinema seats and companion seats';
  const details = new Group();
  details.name = 'Seat fittings and upholstery seams';
  group.add(main, details);

  const places = CINEMA_PLACES.filter(({ kind }) => kind !== 'wheelchair');
  const transform = new Object3D();
  const dye = new Color();
  const darkPine = new Color(0x293c39);
  const lightPine = new Color(0x405751);
  const companion = new Color(0x415e57);

  function addParts(
    parent: Group,
    name: string,
    material: Material,
    parts: readonly SeatPart[],
    rounding: number,
  ): void {
    const geometry = rounding === 0 ? finish.box : new RoundedBoxGeometry(1, 1, 1, 1, rounding);
    const mesh = new InstancedMesh(geometry, material, places.length * parts.length);
    mesh.name = name;
    places.forEach(({ x, y, z, kind, row }, i) => {
      const shade = 0.28 + 0.68 * (Math.sin(i * 17.327 + row * 2.456) * 0.5 + 0.5);
      dye.copy(darkPine).lerp(lightPine, shade);
      if (kind === 'companion') dye.copy(companion);
      parts.forEach(([dx, dy, dz, width, height, depth, tilt = 0], part) => {
        const sideClearance = kind === 'companion' ? 0.98 : 1;
        transform.position.set(x + dx * sideClearance, y + dy, z + dz);
        transform.rotation.x = tilt;
        transform.scale.set(width * sideClearance, height, depth);
        transform.updateMatrix();
        const index = i * parts.length + part;
        mesh.setMatrixAt(index, transform.matrix);
        if (material === finish.seatFabric) mesh.setColorAt(index, dye);
      });
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    parent.add(mesh);
  }

  addParts(main, 'Moulded outer backs', finish.protection, [[0, 0.705, 0.235, 0.647, 0.681, 0.120, 0.13]], 0.12);
  addParts(main, 'Woven back cushions', finish.seatFabric, [
    [0, 0.740, 0.156, 0.610, 0.633, 0.160, 0.13],
    [0, 0.444, 0.080, 0.593, 0.385, 0.142, -0.17],
  ], 0.20);
  addParts(main, 'Powder-coated stanchions', finish.darkSteel, [
    [-0.323, 0.270, 0.102, 0.064, 0.510, 0.278],
    [0.323, 0.270, 0.102, 0.064, 0.510, 0.278],
    [-0.323, 0.035, 0.033, 0.105, 0.063, 0.482],
    [0.323, 0.035, 0.033, 0.105, 0.063, 0.482],
  ], 0);
  addParts(main, 'Soft arm caps', finish.protection, [
    [-0.331, 0.573, -0.05, 0.084, 0.082, 0.495],
    [0.331, 0.573, -0.05, 0.084, 0.082, 0.495],
  ], 0.18);
  addParts(details, 'Pivot hardware and rear seat tags', finish.steel, [
    [-0.354, 0.414, 0.130, 0.012, 0.038, 0.057],
    [0.354, 0.414, 0.130, 0.012, 0.038, 0.057],
    [0, 0.820, 0.319, 0.084, 0.026, 0.008, 0.13],
  ], 0);
  addParts(details, 'Stitched crown seams', finish.seatFabric, [
    [0, 0.988, 0.094, 0.499, 0.010, 0.014, 0.13],
  ], 0);

  // Keep the leg contacts visible in low, diffuse room light.
  const size = 32;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const across = (x + 0.5) / size * 2 - 1;
      const depth = (y + 0.5) / size * 2 - 1;
      const fade = Math.max(0, 1 - across ** 4) * Math.max(0, 1 - depth ** 2);
      const contacts = Math.exp(-((Math.abs(across) - 0.75) ** 2) * 24);
      pixels[4 * (y * size + x) + 3] = 104 * fade * (0.68 + 0.32 * contacts);
    }
  }
  const occlusionMap = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  occlusionMap.minFilter = occlusionMap.magFilter = LinearFilter;
  occlusionMap.needsUpdate = true;
  const occlusion = new InstancedMesh(
    new PlaneGeometry(0.768, 0.626).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: occlusionMap, transparent: true, depthWrite: false, toneMapped: false }),
    places.length,
  );
  occlusion.name = 'Seat leg contact shadows';
  places.forEach(({ x, y, z }, i) => {
    transform.position.set(x, y + 0.002, z + 0.025);
    transform.rotation.set(0, 0, 0);
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    occlusion.setMatrixAt(i, transform.matrix);
  });
  occlusion.instanceMatrix.needsUpdate = true;
  details.add(occlusion);
  return details;
}
