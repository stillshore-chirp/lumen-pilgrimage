import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, type Group } from 'three';
import { cinemaBoxes, type CinemaBox, type CinemaFinishes } from './cinemaFinishes';
import {
  CINEMA_AISLES, CINEMA_BOUNDS, CINEMA_CROSS_AISLES, CINEMA_PLACES, CINEMA_SEAT_BANKS,
  CINEMA_TREADS, CINEMA_WHEELCHAIR_BAY, cinemaGroundHeight,
} from './cinemaLayout';

type Point = readonly [number, number, number];

function floorSurface() {
  const vertices: number[] = [];
  const uvs: number[] = [];
  function quad(corners: readonly Point[], vertical = false) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [x, y, z] = corners[i];
      vertices.push(x, y, z);
      uvs.push(x * 3.4, (vertical ? y : z) * 3.4);
    }
  }
  return {
    tread(x0: number, x1: number, y: number, z0: number, z1: number) {
      quad([[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]]);
    },
    riser(x0: number, x1: number, y: number, rise: number, z: number) {
      quad([[x1, y - rise, z], [x0, y - rise, z], [x0, y, z], [x1, y, z]], true);
    },
    geometry() {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
      geometry.computeVertexNormals();
      return geometry;
    },
  };
}

export function createCinemaFloor(group: Group, finish: CinemaFinishes) {
  const carpet = floorSurface();
  const aisles = floorSurface();
  const risers = floorSurface();
  const nosings: CinemaBox[] = [];
  const lenses: CinemaBox[] = [];
  const edges: CinemaBox[] = [];
  const bayMarkings: CinemaBox[] = [];
  const railPosts: CinemaBox[] = [];
  const crossLimits = CINEMA_CROSS_AISLES.flatMap(({ z, width }) => [z - width / 2, z + width / 2]);
  const seatLimits = [CINEMA_BOUNDS.minX, ...CINEMA_SEAT_BANKS.flatMap(({ minX, maxX }) => [minX, maxX]), CINEMA_BOUNDS.maxX];

  CINEMA_TREADS.forEach(({ z, y, rise }, i) => {
    const nextZ = CINEMA_TREADS[i + 1]?.z ?? CINEMA_BOUNDS.maxZ;
    const slices = [z, ...crossLimits.filter((edge) => edge > z && edge < nextZ), nextZ];
    for (let j = 0; j < slices.length - 1; j += 1) {
      const [front, rear] = [slices[j], slices[j + 1]];
      const middle = (front + rear) * 0.5;
      if (CINEMA_CROSS_AISLES.some((cross) => Math.abs(middle - cross.z) < cross.width * 0.5)) {
        aisles.tread(CINEMA_BOUNDS.minX, CINEMA_BOUNDS.maxX, y, front, rear);
        continue;
      }
      for (let k = 0; k < seatLimits.length - 1; k += 1) {
        const surface = k % 2 === 0 && rear > 18 ? aisles : carpet;
        surface.tread(seatLimits[k], seatLimits[k + 1], y, front, rear);
      }
    }
    if (rise === 0) return;
    risers.riser(CINEMA_BOUNDS.minX, CINEMA_BOUNDS.maxX, y, rise, z);
    for (const aisle of CINEMA_AISLES) {
      // Flush extrusions at each nose. The baffle lip masks the LED from the rear.
      const { x, width } = aisle;
      nosings.push([x, y - 0.012, z - 0.004, width, 0.025, 0.064]);
      for (const side of [-1, 1]) {
        const marker = x + side * (width * 0.5 - 0.29);
        nosings.push([marker, y - 0.045, z - 0.024, 0.34, 0.061, 0.035]);
        lenses.push([marker, y - 0.060, z - 0.042, 0.28, 0.012, 0.008]);
        edges.push([marker, y + 0.002, z + 0.012, 0.19, 0.005, 0.012]);
      }
    }
  });
  const parts = [
    new Mesh(carpet.geometry(), finish.carpet),
    new Mesh(aisles.geometry(), finish.aisle),
    new Mesh(risers.geometry(), finish.protection),
  ];
  parts.forEach((mesh, i) => {
    mesh.name = ['Carpeted seating decks', 'Level cross aisles and stepped longitudinal aisles', 'Tread risers'][i];
    group.add(mesh);
  });

  for (const place of CINEMA_PLACES) {
    if (place.kind !== 'wheelchair') continue;
    const { x, y, z } = place;
    const { width, depth, centerOffsetZ } = CINEMA_WHEELCHAIR_BAY;
    const centerZ = z + centerOffsetZ;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cornerX = x + sx * width * 0.5;
        const cornerZ = centerZ + sz * depth * 0.5;
        bayMarkings.push([
          cornerX - sx * 0.07, y + 0.0018, cornerZ - sz * 0.010, 0.14, 0.003, 0.020,
        ], [
          cornerX - sx * 0.010, y + 0.0018, cornerZ - sz * 0.07, 0.020, 0.003, 0.14,
        ]);
      }
    }
  }

  // The handrail posts sit outside the route and stop at the edge of the cross aisle.
  const rails: { x: number; y: number; z: number; length: number; slope: number }[] = [];
  for (const cross of CINEMA_CROSS_AISLES.slice(1, 3)) {
    const endZ = cross.z - cross.width * 0.5 - 0.048;
    const startZ = endZ - 0.76;
    for (const x of [-17.62, -5.30, 5.30, 17.62]) {
      const bottom = cinemaGroundHeight(x, startZ);
      const top = cinemaGroundHeight(x, endZ);
      rails.push({
        x, y: (bottom + top) * 0.5 + 0.90, z: (startZ + endZ) * 0.5,
        length: Math.hypot(endZ - startZ, top - bottom), slope: Math.atan2(top - bottom, endZ - startZ),
      });
      railPosts.push([x, bottom + 0.445, startZ, 0.052, 0.89, 0.052]);
      railPosts.push([x, top + 0.445, endZ, 0.052, 0.89, 0.052]);
    }
  }
  cinemaBoxes(group, 'Handrail posts', finish.box, finish.darkSteel, railPosts);
  for (const { x, y, z, length, slope } of rails) {
    const rail = new Mesh(finish.box, finish.bronze);
    rail.name = 'Handrail at three-riser flight';
    rail.position.set(x, y, z);
    rail.rotation.x = -slope;
    rail.scale.set(0.064, 0.053, length + 0.055);
    group.add(rail);
  }
  cinemaBoxes(group, 'Recessed non-slip nosing', finish.box, finish.darkSteel, nosings);
  cinemaBoxes(group, 'Downward-shielded step light lenses', finish.box,
    new MeshBasicMaterial({ color: 0xe4ad63, toneMapped: false }), lenses);
  cinemaBoxes(group, 'Low-level tread markers visible when descending', finish.box,
    new MeshBasicMaterial({ color: 0x765033, toneMapped: false }), edges);
  cinemaBoxes(group, 'Flush wheelchair bay corners', finish.box, finish.bronze, bayMarkings);
}
