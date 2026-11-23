import { seededDetail } from '../overlook/overlookModel';
import { DISTRICT_SURFACE } from './residenceCityMaterials';
import { RESIDENCE_CITY_BUILDINGS, RESIDENCE_STREET_LEVEL, RESIDENCE_TOWER, type DistrictBuilding } from './residenceCityPlan';
import { RESIDENCE_FLOOR_ABOVE_STREET } from './residenceFloor';

export type DistrictSolid = {
  x: number; y: number; z: number; w: number; h: number; d: number; color: number;
  surface?: number;
  yaw?: number;
  tilt?: number;
};
export type DistrictFacade = DistrictSolid & { bay: number; floor: number; kind: number; seed: number };

const ground = RESIDENCE_STREET_LEVEL;
const { roof, vegetation, pavingStone, solar } = DISTRICT_SURFACE;

export function shapeDistrictBuildings(
  facades: DistrictFacade[], solids: DistrictSolid[], details: DistrictSolid[],
  rooftopPlanting: DistrictSolid[], machinery: DistrictSolid[], lights: DistrictSolid[],
  surroundings: readonly DistrictBuilding[],
): void {
  const random = seededDetail(6814);

  function body(x: number, z: number, w: number, d: number, low: number, high: number, color: number,
    kind: number, bay: number, floor: number, seed: number): void {
    facades.push({ x, z, w, d, y: ground + (low + high) / 2, h: high - low, color, kind, bay, floor, seed });
  }

  function trim(to: DistrictSolid[], x: number, z: number, w: number, d: number, low: number, high: number,
    color: number, surface = 0, yaw = 0, tilt = 0): void {
    to.push({ x, z, w, d, y: ground + (low + high) / 2, h: high - low, color, surface, yaw, tilt });
  }

  function parapet(x: number, z: number, w: number, d: number, low: number, high: number, color: number): void {
    for (const side of [-1, 1]) {
      trim(solids, x + side * (w - 0.52) / 2, z, 0.52, d, low, high, color);
      trim(solids, x, z + side * (d - 0.52) / 2, w - 1.04, 0.52, low, high, color);
      trim(details, x + side * (w - 0.52) / 2, z, 0.67, d + 0.14, high - 0.05, high + 0.12, 0xb7b3a4);
      trim(details, x, z + side * (d - 0.52) / 2, w - 1.04, 0.67, high - 0.05, high + 0.12, 0xb7b3a4);
    }
  }

  function planter(x: number, z: number, w: number, d: number, deck: number, shade: number): void {
    trim(solids, x, z, w, d, deck, deck + 0.58, 0xa49b85);
    trim(solids, x, z, w - 0.33, d - 0.30, deck + 0.57, deck + 0.67, 0x6a684b, vegetation);
    const n = Math.max(1, Math.floor(w / 1.5));
    for (let i = 0; i < n; i += 1) {
      const px = x + (i + 0.5 - n / 2) * w / n;
      trim(rooftopPlanting, px, z, Math.min(w / n * 1.22, 2.5), Math.min(d * 0.83, 2.5), deck + 0.53, deck + shade,
        random() > 0.51 ? 0x62754e : 0x87916b, vegetation);
    }
  }

  function buildRoof(x: number, z: number, w: number, d: number, deck: number, style: number, close: boolean): void {
    const cap = style === 0 ? 0x9ba4a5 : style === 1 ? 0xc3b798 : 0xaeb0a3;
    const top = style === 0 ? deck + 1.55 : deck + 1.15;
    const membrane = style === 0 ? 0x858778 : 0x9e9383;
    trim(solids, x, z, w, d, deck - 0.48, deck, style === 1 ? 0xa79d8b : membrane, roof);
    parapet(x, z, w, d, deck, top, cap);
    const yardW = w * 0.54, yardD = d * 0.46;
    if (style === 0) {
      // Mechanical penthouse with plenum, panel seams, roof fans and exterior ducts.
      const ax = x - w * 0.11, az = z + d * 0.08;
      const machineryTop = deck + Math.min(6.8, d * 0.24);
      const screenTop = machineryTop + 1.9;
      trim(solids, ax, az, yardW, yardD, deck, machineryTop, 0x7d8d90);
      trim(solids, ax, az, yardW + 0.55, yardD + 0.55, machineryTop, machineryTop + 0.23, 0x9a9c91, roof);
      if (close) {
        for (const side of [-1, 1]) {
          const rails = Math.ceil(yardW / 1.48);
          for (let rail = 0; rail < rails; rail += 1) {
            const px = ax + (rail + 0.5 - rails / 2) * yardW / rails;
            trim(details, px, az + side * yardD * 0.5, 0.12, 0.36, deck + 0.20, screenTop, 0x6d8086);
          }
          for (let row = 0; row < 8; row += 1) {
            const band = deck + 0.6 + (screenTop - deck - 0.6) * row / 8;
            trim(details, ax, az + side * (yardD * 0.5 + 0.13), yardW, 0.32, band, band + 0.22, 0x839194);
          }
        }
      }
      for (const side of [-1, 1]) {
        const px = ax + side * yardW * 0.24, pz = az - yardD * 0.10;
        const span = Math.min(4.5, yardW * 0.29, yardD * 0.58);
        trim(solids, px, pz, span + 0.58, span + 0.58, machineryTop + 0.18, machineryTop + 0.53, 0xa7a69c);
        trim(machinery, px, pz, span, span, machineryTop + 0.54, machineryTop + 0.70, 0x535e63);
        for (let slot = -3; slot <= 3; slot += 1) {
          const slotHalfChord = Math.sqrt(0.23 - (slot / 9.5) ** 2);
          trim(details, px, pz + span * slot / 9.5, span * slotHalfChord * 2, 0.070, machineryTop + 0.68,
            machineryTop + 0.75, 0x99a3a5);
        }
        trim(solids, px, z - d * 0.33, span * 0.52, d * 0.14, deck + 0.26, deck + 1.18, 0x9fa4a0);
      }
      trim(solids, x + w * 0.30, z + d * 0.20, w * 0.105, d * 0.23, deck, deck + 2.7, 0xb4a99a);
      if (close && w > 27 && d > 26) {
        trim(solids, x + w * 0.32, z - d * 0.27, 0.55, 0.55, deck, deck + 8.5, 0x777c76);
        for (let pole = 0; pole < 3; pole += 1) {
          trim(details, x + w * 0.32, z - d * 0.27, 2.65 - pole * 0.48, 0.13,
            deck + 5 + pole * 1.55, deck + 5.12 + pole * 1.55, 0xa7adac);
        }
        trim(lights, x + w * 0.32, z - d * 0.27, 0.65, 0.65, deck + 8.52, deck + 8.82, 0xb63422);
      }
    } else if (style === 1) {
      // Garden terrace, glazed stair exit and a raised shade canopy.
      trim(solids, x + w * 0.03, z + d * 0.13, w * 0.64, d * 0.52, deck, deck + 0.18, 0xb8a88e, pavingStone);
      const ax = x - w * 0.24, az = z - d * 0.21;
      body(ax, az, w * 0.20, d * 0.29, deck, deck + 2.64, 0x718387, 1, 2.05, 2.64, random());
      trim(solids, ax, az, w * 0.23, d * 0.32, deck + 2.62, deck + 2.90, 0x9e9d91, roof);
      const trellisW = Math.min(w * 0.46, 15), trellisD = Math.min(d * 0.24, 8);
      for (const side of [-1, 1]) {
        planter(x, z + side * d * 0.34, w * 0.50, Math.max(2.1, d * 0.08), deck, 1.8);
        for (const end of [-1, 1]) trim(solids, x + side * trellisW * 0.46, z + end * trellisD * 0.41,
          0.20, 0.20, deck + 0.16, deck + 3.0, 0x796858);
      }
      for (let beam = 0; beam < 11; beam += 1) {
        trim(close ? solids : details, x, z + (beam / 10 - 0.5) * trellisD, trellisW, 0.25, deck + 3, deck + 3.25, 0xb1a087);
      }
      for (const side of [-1, 1]) {
        trim(details, x + side * trellisW * 0.19, z, trellisW * 0.22, 0.83, deck + 0.18, deck + 0.72, 0x856e59);
        trim(lights, x + side * trellisW * 0.35, z, 0.55, 0.55, deck + 2.85, deck + 3.02, 0xffdfae);
      }
    } else {
      // Roof arrays vary with width; leave a service aisle and ventilation clearances.
      const px = x + w * 0.20, pz = z - d * 0.23;
      trim(solids, px, pz, w * 0.26, d * 0.20, deck, deck + 2.6, 0x96978b);
      trim(solids, px, pz, w * 0.28, d * 0.22, deck + 2.58, deck + 2.92, 0xb2ab99, roof);
      const count = Math.max(1, Math.floor(d * 0.50 / 3.2));
      for (let row = 0; row < count; row += 1) {
        for (const side of [-1, 1]) {
          trim(solids, x + side * w * 0.155, z + d * 0.18 + (row + 0.5 - count / 2) * 2.83,
            w * 0.25, 1.98, deck + 0.55, deck + 0.71, row % 2 ? 0x354c63 : 0x344658, solar, 0, -0.22);
        }
      }
      const ax = x - w * 0.29, az = z - d * 0.24;
      trim(solids, ax, az, w * 0.16, d * 0.17, deck + 0.04, deck + 1.50, 0xa5a7a2);
      trim(machinery, ax, az, w * 0.10, w * 0.10, deck + 1.49, deck + 1.64, 0x5f6d6e);
    }
  }

  for (const [index, parcel] of [...RESIDENCE_CITY_BUILDINGS, ...surroundings].entries()) {
    const { minX, maxX, minZ, maxZ, height, form, color } = parcel;
    const x = (minX + maxX) * 0.5, z = (minZ + maxZ) * 0.5;
    const w = maxX - minX, d = maxZ - minZ;
    const glass = form === 'glass', balcony = form === 'balcony';
    const kind = glass ? 1 : form === 'ribbon' ? 2 : balcony ? 3 : 0;
    const bay = glass ? 1.85 + random() * 0.8 : 2.74 + random() * (balcony ? 1.25 : 0.72);
    const floor = glass ? 3.73 + random() * 0.46 : 3.04 + random() * 0.72;
    const tall = height > 108;
    const near = index < 39 || (Math.hypot(x - 20, z) < 355 && w > 21);
    const skirt = tall ? (glass ? 10.1 : 12.4) : Math.min(5.7, height * 0.38);
    const seed = random();
    const podiumTint = glass ? 0x858e8a : color;
    if (near) {
      trim(solids, x, z, w + 2.3, d + 2.1, -0.21, 0.059, glass ? 0xa09c8c : 0xa69a86, pavingStone);
    }
    body(x, z, w, d, 0, skirt, podiumTint, 4, 3.6, 4.8, seed);
    trim(solids, x, z, w + 0.18, d + 0.18, skirt - 0.23, skirt + 0.53, glass ? 0x929c9c : 0xb0a48e, roof);
    const shaftW = w - (tall ? 4.9 : 1.14), shaftD = d - (tall ? 5.7 : 1.36);
    const deck = height - (tall ? 2.15 : 1.22);
    const crown = tall ? height - (glass ? 13.8 : 9.75) : deck;
    const offset = glass ? shaftW * (seed - 0.44) * 0.17 : shaftW * (seed - 0.48) * 0.10;
    body(x, z, shaftW, shaftD, skirt, crown, color, kind, bay, floor, seed);
    if (parcel.compact) {
      const roofColor = seed < 0.24 ? 0xb3a79a : seed < 0.62 ? 0x92958b : 0x98958b;
      trim(solids, x, z, shaftW, shaftD, deck - 0.44, deck, roofColor, roof);
      for (const side of [-1, 1]) {
        trim(solids, x + side * (shaftW - 0.34) / 2, z, 0.34, shaftD, deck, deck + 0.84, 0xaba697);
        trim(solids, x, z + side * (shaftD - 0.34) / 2, shaftW - 0.68, 0.34, deck, deck + 0.84, 0xaba697);
      }
      const roofHouse = Math.min(4.8, shaftW * 0.32), roofDepth = Math.min(5, shaftD * 0.35);
      trim(solids, x - shaftW * 0.19, z + shaftD * 0.17, roofHouse, roofDepth, deck, deck + 1.75, 0xa39f8f, roof);
      if (seed > 0.69) {
        for (const side of [-1, 1]) {
          trim(solids, x + shaftW * 0.15, z + shaftD * (side * 0.17 - 0.09), shaftW * 0.42, shaftD * 0.16,
            deck + 0.22, deck + 0.36, 0x3d5364, solar, 0, -0.18);
        }
      } else if (seed > 0.43 && shaftW > 16 && shaftD > 17) {
        // Workshop roof monitors sit on raised frames and light the span behind the podium.
        for (const side of [-1, 1]) {
          const pz = z + shaftD * (side * 0.16 - 0.11);
          trim(solids, x + shaftW * 0.08, pz, shaftW * 0.61, shaftD * 0.17, deck, deck + 0.75, 0xa6a39a);
          trim(solids, x + shaftW * 0.08, pz, shaftW * 0.64, shaftD * 0.18, deck + 0.69, deck + 0.88,
            form === 'glass' ? 0x67818d : 0x8d8475, roof, 0, -0.25);
        }
      } else if (seed > 0.20) {
        const width = shaftW * 0.33, depth = shaftD * 0.18;
        trim(solids, x + shaftW * 0.18, z - shaftD * 0.19, width, depth, deck + 0.08, deck + 1.12, 0x888f8d);
        if (near && width > 3.7) {
          trim(machinery, x + shaftW * 0.18, z - shaftD * 0.19, depth * 0.73, depth * 0.73,
            deck + 1.09, deck + 1.19, 0x555c5e);
        }
      } else {
        trim(solids, x + shaftW * 0.07, z, shaftW * 0.61, shaftD * 0.10, deck, deck + 0.12, 0xb0a698, pavingStone);
      }
    } else if (tall) {
      const upperW = shaftW - (glass ? 5.2 : 6.5), upperD = shaftD - (glass ? 7.4 : 5.6);
      trim(solids, x, z, shaftW + 0.37, shaftD + 0.37, crown - 0.34, crown + 0.42, glass ? 0x99a7a7 : 0xc7bdaa, roof);
      body(x + offset, z - 1.2, upperW, upperD, crown, deck, color, glass ? 2 : kind, bay, floor, seed + 0.69);
      buildRoof(x + offset, z - 1.2, upperW, upperD, deck, glass ? 0 : balcony ? 1 : index % 3, near);
    } else {
      buildRoof(x, z, shaftW, shaftD, deck, balcony ? 1 : index % 3, near);
    }
    if (near && glass) {
      for (const side of [-1, 1]) {
        trim(solids, x + side * (shaftW / 2 - 0.85), z, 0.62, shaftD + 0.64, skirt, crown, 0x8a9b9e);
        trim(solids, x, z + side * (shaftD / 2 - 0.69), shaftW + 0.66, 0.66, skirt, crown, 0x899996);
      }
      for (let story = skirt + floor * 4; story < crown - floor; story += floor * 7) {
        trim(solids, x, z, shaftW + 0.39, shaftD + 0.38, story, story + 0.42, 0x829b9e);
      }
    } else if (near && balcony) {
      const courses = Math.floor((crown - skirt) / floor);
      for (let story = 1; story < courses; story += 1) {
        const elevation = skirt + story * (crown - skirt) / courses;
        const widening = story % 6 === 0 ? 2.18 : 1.50;
        trim(solids, x, z, shaftW + widening, shaftD + widening, elevation, elevation + 0.25, 0xb5a99b);
        if (story % 4 === 1) {
          trim(rooftopPlanting, x + shaftW * 0.23, z + (shaftD + 0.76) / 2, 3.4, 1.0,
            elevation + 0.20, elevation + 1.40, 0x697b54, vegetation);
        }
      }
    } else if (near && tall) {
      for (const side of [-1, 1]) {
        trim(solids, x + side * (shaftW / 2 - 1.16), z, 1.26, shaftD + 0.49, skirt, crown, color);
      }
      trim(solids, x, z, shaftW + 0.91, shaftD + 0.91, crown - floor * 5, crown - floor * 5 + 0.63, color);
    }
    const door = parcel.entrance ?? { axis: 'z', side: -1 };
    const alongX = door.axis === 'z';
    const canopyWidth = Math.min(13.0, (alongX ? w : d) * 0.57);
    const fx = alongX ? x : x + door.side * (w * 0.5 - 0.36);
    const fz = alongX ? z + door.side * (d * 0.5 - 0.36) : z;
    const frontTint = glass ? 0x737f79 : 0x8b7b62;
    trim(solids, fx, fz, alongX ? canopyWidth : 3.9, alongX ? 3.9 : canopyWidth, 3.5, 3.78, frontTint);
    if (near || !parcel.compact) {
      for (const side of [-1, 1]) {
        const ax = fx + (alongX ? canopyWidth * side * 0.43 : door.side * 1.43);
        const az = fz + (alongX ? door.side * 1.43 : canopyWidth * side * 0.43);
        trim(details, ax, az, 0.22, 0.22, 0, 3.73, color);
        trim(lights, fx + (alongX ? canopyWidth * side * 0.28 : door.side), fz + (alongX ? door.side : canopyWidth * side * 0.28),
          0.61, 0.54, 3.48, 3.54, 0xf7d4a6);
      }
    }
  }

  const { minX, maxX, minZ, maxZ, height } = RESIDENCE_TOWER;
  const x = (minX + maxX) * 0.5, z = (minZ + maxZ) * 0.5, w = maxX - minX, d = maxZ - minZ;
  const dwelling = RESIDENCE_FLOOR_ABOVE_STREET;
  // The open storey is fitted by the separately navigable apartment shell.
  body(x, z, w, d, 0, 15, 0xb5afa7, 0, 3.48, 5, 0.52);
  body(x, z, w, d, 15, dwelling - 0.31, 0x869a9c, 2, 3.48, 3.5, 0.42);
  body(x, z, w, d, dwelling + 3.25, height - 1.55, 0x869a9c, 2, 3.48, 3.5, 0.32);
  buildRoof(x, z, w - 1.3, d - 1.3, height - 1.55, 0, true);
}
