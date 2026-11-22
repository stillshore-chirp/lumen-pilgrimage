import * as THREE from 'three';

type Point = [number, number];
type Ring = { elevation: number; outline: Point[]; ridge?: number[] };
type Surface = { color: THREE.ColorRepresentation; facade?: number; glow?: number };

export type SkylineLight = { x: number; y: number; z: number; kind: number; power: number };

const projection = (lat: number, lon: number): Point => [(lon + 118.30040) * 92170, (lat - 34.11843) * 110950];
const downtownGrid = -0.53;

function rectangle(width: number, depth: number): Point[] {
  return [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]];
}

function chamfer(width: number, depth: number, cut: number): Point[] {
  const w = width / 2, d = depth / 2;
  return [[-w + cut, -d], [w - cut, -d], [w, -d + cut], [w, d - cut],
    [w - cut, d], [-w + cut, d], [-w, d - cut], [-w, -d + cut]];
}

function oval(rx: number, rz: number, sides = 16): Point[] {
  return Array.from({ length: sides }, (_, side) => {
    const angle = (side + 0.5) * 2 * Math.PI / sides;
    return [Math.cos(angle) * rx, Math.sin(angle) * rz];
  });
}

class CityGeometry {
  private readonly positions: number[] = [];
  private readonly shades: number[] = [];
  private readonly facades: number[] = [];
  private readonly color = new THREE.Color();

  triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, surface: Surface, edgeCoordinate?: [number, number, number]): void {
    this.color.set(surface.color);
    for (const [i, v] of [a, b, c].entries()) {
      this.positions.push(v.x, v.y, v.z);
      this.shades.push(this.color.r, this.color.g, this.color.b);
      this.facades.push(edgeCoordinate?.[i] ?? 0, v.y, surface.facade ?? 0, surface.glow ?? 0);
    }
  }

  extrusion(x: number, y: number, z: number, yaw: number, rings: Ring[], surface: Surface,
    roofColor: THREE.ColorRepresentation = surface.color): void {
    const cosine = Math.cos(yaw), sine = Math.sin(yaw);
    const world = (ring: Ring, i: number) => {
      const [u, v] = ring.outline[i];
      return new THREE.Vector3(x + u * cosine + v * sine, y + ring.elevation + (ring.ridge?.[i] ?? 0),
        z - u * sine + v * cosine);
    };
    const sideCount = rings[0].outline.length;
    let u = 0;
    for (let face = 0; face < sideCount; face += 1) {
      const next = (face + 1) % sideCount;
      const top = rings[rings.length - 1];
      const left = world(rings[0], face), right = world(rings[0], next);
      const width = left.distanceTo(right);
      const from = u, to = u + width;
      for (let level = 0; level < rings.length - 1; level += 1) {
        const a = world(rings[level], face), b = world(rings[level], next);
        const c = world(rings[level + 1], next), d = world(rings[level + 1], face);
        this.triangle(a, d, c, surface, [from, from, to]);
        this.triangle(a, c, b, surface, [from, to, to]);
      }
      if (face > 0 && face < sideCount - 1) this.triangle(world(top, 0), world(top, next), world(top, face), { color: roofColor, glow: surface.glow });
      u += width;
    }
  }

  finish(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.shades, 3));
    geometry.setAttribute('cityFacade', new THREE.Float32BufferAttribute(this.facades, 4));
    geometry.computeVertexNormals();
    return geometry;
  }
}

export function createOverlookSkyline(heightAt: (x: number, z: number) => number) {
  const builder = new CityGeometry();
  const lights: SkylineLight[] = [];
  const exclusions: Array<{ x: number; z: number; radius: number }> = [];
  const glass = 0x527181;
  const mercury = 0x899394;
  const concrete = 0xa9a29a;
  const bronze = 0x4f4b49;
  const darkGlass = 0x424d56;

  const building = (lat: number, lon: number, footprint: number, shape: (x: number, y: number, z: number) => void) => {
    const [x, z] = projection(lat, lon);
    exclusions.push({ x, z, radius: footprint });
    shape(x, heightAt(x, z) - 2, z);
  };
  const floor = (x: number, y: number, z: number, w: number, d: number, h: number, surface: Surface,
    yaw = downtownGrid, cut = 0) => {
    const outline = cut > 0 ? chamfer(w, d, cut) : rectangle(w, d);
    builder.extrusion(x, y, z, yaw, [{ elevation: 0, outline }, { elevation: h, outline }], surface, 0x8d8982);
  };
  const beacon = (x: number, y: number, z: number, power = 0.75) => lights.push({ x, y, z, kind: 4, power });

  // Glass tower with an asymmetrical rising sail and a needle at the high end.
  building(34.05019, -118.26059, 60, (x, y, z) => {
    floor(x, y, z, 122, 78, 26, { color: concrete, facade: 0.69 });
    const outline = chamfer(65, 51, 9);
    builder.extrusion(x - 8, y, z + 3, downtownGrid, [
      { elevation: 20, outline },
      { elevation: 219, outline },
      { elevation: 252, outline: chamfer(63, 49, 10) },
    ], { color: 0x628eaa, facade: 1.02 });
    const crown = chamfer(59, 42, 9);
    builder.extrusion(x - 9, y, z + 3, downtownGrid, [
      { elevation: 250, outline: crown },
      { elevation: 261, outline: chamfer(54, 38, 9), ridge: [18, 9, -1, -4, -4, 5, 16, 23] },
    ], { color: 0x6889a0, glow: 0.36 }, 0x9db8c5);
    builder.extrusion(x - 24, y, z - 6, downtownGrid, [
      { elevation: 270, outline: oval(1.78, 1.78, 8) },
      { elevation: 318, outline: oval(1.05, 1.05, 8) },
      { elevation: 335, outline: oval(0.54, 0.54, 8) },
    ], { color: 0xb7c1c7, glow: 0.29 });
    beacon(x - 24, y + 335, z - 6, 1.2);
  });

  // Rounded tower with stepped masonry and a glass crown.
  building(34.05098, -118.25422, 57, (x, y, z) => {
    floor(x, y, z, 81, 70, 32, { color: concrete, facade: 0.77 }, downtownGrid, 10);
    builder.extrusion(x, y, z, downtownGrid, [
      { elevation: 11, outline: chamfer(60, 61, 8) },
      { elevation: 172, outline: chamfer(60, 61, 8) },
      { elevation: 178, outline: chamfer(55, 57, 9) },
      { elevation: 228, outline: chamfer(55, 57, 9) },
      { elevation: 241, outline: chamfer(47, 48, 10) },
      { elevation: 269, outline: chamfer(47, 48, 10) },
    ], { color: 0xa6a5a1, facade: 1.18 });
    builder.extrusion(x, y, z, downtownGrid, [
      { elevation: 203, outline: oval(27.5, 27.5) },
      { elevation: 267, outline: oval(26.5, 26.5) },
      { elevation: 274, outline: oval(24, 24) },
      { elevation: 294, outline: oval(24, 24) },
    ], { color: 0xa2a9a7, facade: 0.93 });
    builder.extrusion(x, y, z, downtownGrid, [
      { elevation: 294, outline: oval(23.5, 23.5) },
      { elevation: 309, outline: oval(23.5, 23.5) },
      { elevation: 310, outline: oval(22, 22) },
    ], { color: 0x9cbbc9, glow: 0.56 }, 0xcbcbbe);
    beacon(x, y + 312, z, 0.9);
  });

  const slabs: Array<[number, number, number, number, number, number, number]> = [
    [34.04964, -118.25755, 51, 46, 262, bronze, 0],
    [34.05114, -118.25041, 50, 51, 228, 0x555f6c, 7],
    [34.05254, -118.25027, 49, 48, 176, 0x62838e, 6],
    [34.05292, -118.25306, 57, 53, 220, 0x797a7e, 6],
    [34.05240, -118.25245, 52, 46, 171, 0x8d827a, 5],
    [34.05354, -118.25405, 55, 56, 224, 0x535e61, 0],
    [34.05074, -118.25929, 51, 51, 219, 0x625f65, 14],
    [34.05155, -118.25613, 42, 43, 213, 0x49595a, 0],
    [34.05107, -118.25666, 42, 43, 213, 0x485958, 0],
    [34.05059, -118.25295, 50, 42, 228, 0x5e7e93, 9],
    [34.05189, -118.25522, 54, 50, 191, 0x8a938c, 7],
    [34.04846, -118.26139, 47, 44, 213, 0xc2c2b9, 7],
    [34.04957, -118.26081, 54, 50, 163, glass, 3],
    [34.05323, -118.25737, 51, 46, 157, 0xb3b3a1, 0],
    [34.04817, -118.26247, 39, 38, 158, 0x879eab, 2],
    [34.04668, -118.26484, 66, 46, 188, 0x65869a, 6],
    [34.04561, -118.26297, 48, 45, 182, 0x5b7081, 4],
    [34.04496, -118.26236, 37, 35, 132, 0x657383, 3],
    [34.04463, -118.26185, 39, 34, 118, 0x647584, 3],
    [34.04425, -118.25605, 44, 34, 153, 0x6c8b96, 2],
    [34.04856, -118.25384, 44, 36, 130, mercury, 1],
    [34.04768, -118.25709, 50, 36, 151, 0x6e8590, 0],
    [34.04827, -118.25063, 50, 56, 128, concrete, 0],
    [34.05341, -118.25215, 47, 57, 127, 0x98a6ac, 3],
    [34.05572, -118.24595, 60, 57, 106, 0xa9a49b, 0],
    [34.05327, -118.24591, 53, 47, 116, 0x949ca0, 6],
    [34.05635, -118.24061, 49, 46, 92, concrete, 0],
  ];
  for (const [lat, lon, width, depth, height, color, cut] of slabs) {
    building(lat, lon, Math.max(width, depth) * 0.75, (x, y, z) => {
      floor(x, y, z, width * 1.3, depth * 1.32, Math.min(22, height * 0.18), { color: concrete, facade: 0.67 });
      floor(x, y, z, width, depth, height - 5, { color, facade: 0.72 + (height % 8) * 0.046 }, downtownGrid, cut);
      floor(x, y + height - 5, z, width * 0.88, depth * 0.86, 5, { color, glow: height > 171 ? 0.11 : 0 }, downtownGrid, cut);
      if (height > 168 && height % 2 === 0) beacon(x, y + height + 1, z, 0.68);
    });
  }

  // Civic tower in light masonry with a stepped pyramidal roof.
  building(34.05369, -118.24273, 60, (x, y, z) => {
    floor(x, y, z, 116, 72, 28, { color: 0xbfbab0, facade: 0.72 });
    floor(x, y, z, 48, 46, 73, { color: 0xc3bcac, facade: 1 });
    floor(x, y + 72, z, 33, 33, 43, { color: 0xc9c5b7, facade: 0.74 });
    floor(x, y + 113, z, 28, 28, 7, { color: 0xbab6ac, glow: 0.27 });
    builder.extrusion(x, y, z, downtownGrid, [
      { elevation: 119, outline: rectangle(26, 26) },
      { elevation: 125, outline: rectangle(23, 23) },
      { elevation: 133, outline: rectangle(14, 14) },
      { elevation: 138, outline: rectangle(2, 2) },
    ], { color: 0xb5aaa0, glow: 0.15 });
  });

  // Separate civic and commercial districts beyond the main skyline.
  const west: Array<[number, number, number, number, number, number]> = [
    [34.06164, -118.29320, 38, 38, 73, 0xc4b18a],
    [34.06195, -118.30230, 68, 49, 120, 0x6d858f],
    [34.06207, -118.30901, 63, 48, 100, 0x727e86],
    [34.06311, -118.31355, 73, 56, 113, 0x8b9899],
    [34.06178, -118.31292, 52, 49, 96, 0x788e9a],
    [34.06194, -118.33502, 51, 48, 93, concrete],
    [34.06260, -118.34516, 49, 49, 106, 0x687883],
    [34.06335, -118.35658, 49, 41, 117, darkGlass],
    [34.06532, -118.37668, 57, 48, 77, concrete],
    [34.10168, -118.32695, 47, 42, 71, concrete],
    [34.10176, -118.33935, 62, 36, 107, 0x94857d],
    [34.09862, -118.33947, 54, 43, 64, mercury],
    [34.09768, -118.32857, 67, 41, 71, concrete],
    [34.05230, -118.41222, 58, 49, 151, 0x89938c],
    [34.05782, -118.41314, 74, 61, 117, 0x9aaeb7],
    [34.06020, -118.41371, 54, 46, 111, darkGlass],
    [34.06323, -118.41508, 51, 46, 119, mercury],
    [34.05731, -118.41717, 57, 52, 182, 0x8d9aa8],
    [34.05651, -118.41759, 58, 53, 182, 0xa4a9ae],
    [34.14665, -118.25647, 59, 42, 88, 0x8b8984],
    [34.14994, -118.25595, 55, 56, 73, glass],
    [34.14962, -118.25707, 49, 46, 102, 0x8f9a9b],
    [34.14592, -118.14304, 70, 49, 72, 0x92989f],
  ];
  for (const [lat, lon, w, d, h, color] of west) {
    building(lat, lon, Math.max(w, d) * 0.72, (x, y, z) => {
      floor(x, y, z, w * 1.29, d * 1.30, 16, { color: concrete, facade: 0.57 }, 0.03);
      floor(x + 2, y, z - 2, w, d, h, { color, facade: 0.8 }, 0.03, h > 120 ? 7 : 3);
      floor(x, y + h, z, w * 0.46, d * 0.45, 4.5, { color: mercury }, 0.03);
    });
  }
  for (const [lat, lon] of [[34.05734, -118.41289], [34.05645, -118.41327]]) {
    building(lat, lon, 52, (x, y, z) => {
      const outline = oval(39, 39, 3);
      builder.extrusion(x, y, z, 0.24, [{ elevation: 0, outline }, { elevation: 174, outline }],
        { color: 0xaeb1b0, facade: 1.32 }, 0xd0ccc0);
    });
  }

  // Sunken ballpark with interrupted seating tiers and an open outfield.
  building(34.07387, -118.24002, 116, (x, y, z) => {
    const seatColor = [0x738798, 0xa4a194, 0x8c9eaa, 0x9aa492, 0x93a2a3];
    for (let band = 0; band < seatColor.length; band += 1) {
      const radius = 76 + band * 11;
      for (let section = 0; section < 26; section += 1) {
        const a = 0.72 + section * 0.187;
        const b = a + 0.181;
        const outline: Point[] = [[Math.cos(a) * radius, Math.sin(a) * radius * 0.87],
          [Math.cos(b) * radius, Math.sin(b) * radius * 0.87],
          [Math.cos(b) * (radius + 12), Math.sin(b) * (radius + 12) * 0.87],
          [Math.cos(a) * (radius + 12), Math.sin(a) * (radius + 12) * 0.87]].reverse() as Point[];
        builder.extrusion(x, y - 15, z, -0.79, [
          { elevation: 0, outline }, { elevation: 16 + band * 5.2, outline },
        ], { color: seatColor[band], glow: band === 0 ? 0.04 : 0 });
      }
    }
    const field = oval(81, 72, 22);
    builder.extrusion(x, y - 15, z, -0.79, [{ elevation: 1, outline: field }, { elevation: 13, outline: field }],
      { color: 0x4f6a45 }, 0x597648);
    for (const offset of [-96, 96]) {
      floor(x + offset, y, z + 38, 3.1, 3.1, 43, { color: 0xa8a59d }, 0);
      floor(x + offset, y + 41, z + 38, 13, 2.7, 5, { color: 0x9ea6af, glow: 0.44 }, 0);
      lights.push({ x: x + offset, y: y + 43, z: z + 38, kind: 2, power: 1.15 });
    }
  });

  return { geometry: builder.finish(), lights, exclusions };
}
