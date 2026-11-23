import { seededDetail } from '../overlook/overlookModel';
import {
  RESIDENCE_CITY_BUILDINGS, RESIDENCE_CITY_LIMITS, RESIDENCE_DISTRICT_ROADS, RESIDENCE_TOWER, type CityRect, type DistrictBuilding,
} from './residenceCityPlan';

export type DistrictYard = CityRect & { surface: 'service' | 'paving' | 'platform' };
type Face = {
  axis: 'x' | 'z'; side: -1 | 1; edge: number; from: number; to: number;
};

export function districtParcelsOverlap(a: CityRect, b: CityRect, gap: number): boolean {
  return a.minX < b.maxX + gap && a.maxX > b.minX - gap
    && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
}

function contains(lot: CityRect, x: number, z: number): boolean {
  return x >= lot.minX && x <= lot.maxX && z >= lot.minZ && z <= lot.maxZ;
}

function areaAt(x: number, z: number, width: number, depth: number): CityRect {
  return { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
}

function blockFootprints() {
  const streets = RESIDENCE_DISTRICT_ROADS.map(({ rect }) => rect);
  const edgesX = [...new Set(streets.flatMap(({ minX, maxX }) => [minX, maxX]))].sort((a, b) => a - b);
  const edgesZ = [...new Set(streets.flatMap(({ minZ, maxZ }) => [minZ, maxZ]))].sort((a, b) => a - b);
  const byId = new Map<number, CityRect>();
  const width = edgesX.length - 1;
  const cellId = (col: number, row: number) => row * width + col;
  const west = RESIDENCE_DISTRICT_ROADS.find(({ id }) => id === 'west-loop')!.center;
  const east = RESIDENCE_DISTRICT_ROADS.find(({ id }) => id === 'east-loop')!.center;
  const north = RESIDENCE_DISTRICT_ROADS.find(({ id }) => id === 'north-loop')!.center;
  const south = RESIDENCE_DISTRICT_ROADS.find(({ id }) => id === 'south-loop')!.center;
  const inner = { minX: west, maxX: east, minZ: north, maxZ: south };
  for (let row = 0; row < edgesZ.length - 1; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const minX = edgesX[col], maxX = edgesX[col + 1], minZ = edgesZ[row], maxZ = edgesZ[row + 1];
      const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
      if (contains(inner, x, z) && !streets.some(street => contains(street, x, z))) {
        byId.set(cellId(col, row), { minX, maxX, minZ, maxZ });
      }
    }
  }

  const blocks: { cells: CityRect[]; faces: Face[] }[] = [];
  for (const [start] of byId) {
    const cells: CityRect[] = [];
    const external = new Map<string, Face[]>();
    const queued = new Set([start]);
    const frontier = [start];
    for (const id of frontier) {
      const cell = byId.get(id)!;
      const { minX, maxX, minZ, maxZ } = cell;
      cells.push(cell);
      const sides = [
        { id: id - 1, axis: 'x', side: -1, edge: minX, from: minZ, to: maxZ },
        { id: id + 1, axis: 'x', side: 1, edge: maxX, from: minZ, to: maxZ },
        { id: id - width, axis: 'z', side: -1, edge: minZ, from: minX, to: maxX },
        { id: id + width, axis: 'z', side: 1, edge: maxZ, from: minX, to: maxX },
      ] as const;
      for (const { id: neighbor, ...face } of sides) {
        if (byId.has(neighbor)) {
          if (!queued.has(neighbor)) {
            queued.add(neighbor);
            frontier.push(neighbor);
          }
        } else {
          const key = `${face.axis}/${face.side}/${face.edge}`;
          const parts = external.get(key);
          if (parts) parts.push(face);
          else external.set(key, [face]);
        }
      }
    }
    for (const id of frontier) byId.delete(id);
    const faces: Face[] = [];
    for (const parts of external.values()) {
      parts.sort((a, b) => a.from - b.from);
      let previous: Face | undefined;
      for (const part of parts) {
        if (previous?.to === part.from) previous.to = part.to;
        else {
          faces.push(part);
          previous = part;
        }
      }
    }
    blocks.push({ cells, faces });
  }
  return blocks;
}

function frontageArea(face: Face, start: number, span: number, depth: number, offset: number): CityRect {
  const along = start + span / 2, inward = face.edge - face.side * (depth / 2 + offset);
  return face.axis === 'x' ? areaAt(inward, along, depth, span) : areaAt(along, inward, span, depth);
}

function perimeterBlocks() {
  const blocks: { cells: CityRect[]; faces: Face[] }[] = [];
  const directions = [['west-loop', 1], ['east-loop', -1], ['north-loop', 1], ['south-loop', -1]] as const;
  for (const [id, side] of directions) {
    const street = RESIDENCE_DISTRICT_ROADS.find(candidate => candidate.id === id)!;
    const { rect, alongZ } = street;
    const edge = alongZ ? (side === 1 ? rect.minX : rect.maxX) : (side === 1 ? rect.minZ : rect.maxZ);
    const back = alongZ ? (side === 1 ? RESIDENCE_CITY_LIMITS.minX : RESIDENCE_CITY_LIMITS.maxX)
      : (side === 1 ? RESIDENCE_CITY_LIMITS.minZ : RESIDENCE_CITY_LIMITS.maxZ);
    const end = street.to - 15;
    for (let from = street.from + 15; from < end - 28; from += 115) {
      const to = Math.min(end, from + 110);
      const face: Face = { axis: alongZ ? 'x' : 'z', side, edge, from, to };
      blocks.push({ cells: [frontageArea(face, from, to - from, Math.abs(edge - back) - 6.0, 0)], faces: [face] });
    }
  }
  return blocks;
}

const heightAnchors = [
  { x: -264, z: 511, top: 248 }, { x: 233, z: 542, top: 229 },
  { x: -400, z: 669, top: 281 }, { x: 145, z: 787, top: 254 },
  { x: 351, z: 790, top: 308 }, { x: -234, z: 1047, top: 271 },
  { x: 70, z: 1120, top: 326 }, { x: 300, z: 1178, top: 300 },
  { x: 529, z: -280, top: 224 }, { x: 697, z: -115, top: 268 },
  { x: 826, z: 172, top: 247 }, { x: 837, z: -345, top: 256 },
];

export function createResidenceBlocks() {
  const blocks = [...blockFootprints(), ...perimeterBlocks()];
  const random = seededDetail(44971);
  const buildings: DistrictBuilding[] = [];
  const paved: DistrictYard[] = [];
  const occupied: CityRect[] = [...RESIDENCE_CITY_BUILDINGS, RESIDENCE_TOWER];
  const streets = RESIDENCE_DISTRICT_ROADS.map(({ rect }) => rect);
  const landmarks = new Set<number>();
  const conservativeBounds = (candidate: CityRect, roadBuffer: number, lotBuffer: number) =>
    !streets.some(street => districtParcelsOverlap(candidate, street, roadBuffer))
    && !occupied.some(lot => districtParcelsOverlap(candidate, lot, lotBuffer));
  const stock: readonly DistrictBuilding['form'][] = ['ribbon', 'stone', 'balcony', 'glass'];
  const bricks = [0xae937d, 0xa79280, 0xa58c7b, 0x977d70, 0xb9a991, 0x917e72];
  const stones = [0xa59d90, 0xb6ab96, 0xb2a89a, 0x989789, 0xa39e8e, 0xa6a397];
  const metals = [0x738995, 0x718696, 0x83969b, 0x72868a, 0x87989d, 0x597888];

  for (const { cells, faces } of blocks) {
    const minX = Math.min(...cells.map(cell => cell.minX)), maxX = Math.max(...cells.map(cell => cell.maxX));
    const minZ = Math.min(...cells.map(cell => cell.minZ)), maxZ = Math.max(...cells.map(cell => cell.maxZ));
    const wx = maxX - minX, dz = maxZ - minZ;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const reach = Math.hypot(cx - 19, cz * 0.43);
    const commercial = Math.abs(cx - 140) < 420 && cz > 165 && cz < 1260;
    const mostlyLow = cx > 26 && cx < 400 && cz > -145 && cz < 159;
    const type = random();
    const masonry = type < 0.54;
    const blockTone = type < 0.28 ? bricks : type < 0.81 ? stones : metals;
    for (const cell of cells) paved.push({ ...cell, surface: commercial ? 'paving' : 'service' });

    let count = 0;
    const byLength = [...faces].sort((a, b) => b.to - b.from - (a.to - a.from));
    for (const face of byLength) {
      if (face.to - face.from < 8) continue;
      const walk = frontageArea(face, face.from, face.to - face.from, 2.70, 0);
      if (cells.some(cell => contains(cell, (walk.minX + walk.maxX) / 2, (walk.minZ + walk.maxZ) / 2))
        && !streets.some(street => districtParcelsOverlap(walk, street, -0.005))) {
        paved.push({ ...walk, surface: 'platform' });
      }
      let along = face.from + 3.0;
      while (along + 12 <= face.to - 3.0 && count < 16) {
        const span = Math.min(21 + random() * 27, face.to - along - 3);
        const depth = 23 + random() * (commercial ? 27 : 19);
        let fit: CityRect | undefined;
        for (const scale of [1, 0.76, 0.55]) {
          const parcel = frontageArea(face, along, span * scale, depth * scale, 2.95);
          const x = (parcel.minX + parcel.maxX) * 0.5, z = (parcel.minZ + parcel.maxZ) * 0.5;
          if (cells.some(cell => contains(cell, x, z)) && conservativeBounds(parcel, 2.65, 3.15)) {
            fit = parcel;
            break;
          }
        }
        if (!fit) {
          along += 7.4;
          continue;
        }
        const x = (fit.minX + fit.maxX) / 2, z = (fit.minZ + fit.maxZ) / 2;
        const width = fit.maxX - fit.minX, length = fit.maxZ - fit.minZ;
        const alongActual = face.axis === 'x' ? length : width;
        const closeToAvenue = Math.abs(x - 19.5) < 49 && z < 490;
        let height = 10.8 + 3.6 * Math.floor(random() * (mostlyLow ? 7 : commercial ? 18 : 12));
        let form = stock[Math.floor(random() * stock.length)];
        let color = blockTone[Math.floor(random() * blockTone.length)];
        if (masonry && form === 'glass') form = commercial ? 'ribbon' : 'stone';
        if (closeToAvenue) height = Math.min(height, 24.5);
        if (commercial && !mostlyLow && !closeToAvenue && width > 23 && length > 23 && random() > 0.75) {
          height += 42 + random() * 45;
          form = random() > 0.55 ? 'glass' : 'ribbon';
          if (form === 'glass') color = metals[Math.floor(random() * metals.length)];
        }
        if (width > 24 && length > 24) {
          const anchor = heightAnchors.findIndex(({ x: ax, z: az }, index) =>
            !landmarks.has(index) && Math.hypot(ax - x, az - z) < 61);
          if (anchor >= 0) {
            landmarks.add(anchor);
            height = heightAnchors[anchor].top;
            form = anchor % 3 ? 'glass' : 'ribbon';
            color = metals[anchor % metals.length];
          }
        }
        buildings.push({ ...fit, height, form, color, entrance: { axis: face.axis, side: face.side },
          compact: mostlyLow || height < 50 || (reach > 555 && height < 95) });
        occupied.push(fit);
        along += alongActual + 3.45 + random() * 2.3;
        count += 1;
      }
    }

    // Larger blocks keep a shared delivery court bounded by rear workshops or a parking deck.
    if (wx > 48 && dz > 49) {
      let rear = 0;
      for (let x = minX + 27; x < maxX - 18 && rear < 6; x += 38) {
        for (let z = minZ + 26; z < maxZ - 19 && rear < 6; z += 39) {
          const parcel = areaAt(x, z, 18 + random() * 13, 18 + random() * 15);
          if (!cells.some(cell => contains(cell, x, z)) || !conservativeBounds(parcel, 4.7, 4.3)) continue;
          const height = 10.4 + 3.2 * Math.floor(random() * 9);
          buildings.push({ ...parcel, height, form: commercial ? 'ribbon' : 'stone',
            color: stones[Math.floor(random() * stones.length)], compact: true });
          occupied.push(parcel);
          rear += 1;
        }
      }
    }
  }
  return { buildings, paved };
}
