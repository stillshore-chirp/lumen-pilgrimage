import { Group, MathUtils, type MeshStandardMaterial } from 'three';
import { FurnitureModel, type FurniturePiece } from './residenceFurnitureModel';
import type { ResidenceMaterials } from './residenceMaterials';

const LEAF_WIDTH = .690;
const LEAF_HEIGHT = 2.046;
const LEAF_BOTTOM = .135;
const PARKED_OFFSET = .975;
const SILL_NORTH = .590;
const FIXED_NORTH = .574;
const SLIDING_NORTH = .610;
const SLIDE_SECONDS = .65;
const REACH = 1.24;

export const RESIDENCE_TEA_SHOJI = {
  center: 5.480,
  bottom: LEAF_BOTTOM,
  top: LEAF_BOTTOM + LEAF_HEIGHT,
  openHalfWidth: PARKED_OFFSET - LEAF_WIDTH / 2,
  diffuseTransmission: .40,
} as const;

export function teaShojiTransmission(openness: number): number {
  const { openHalfWidth, diffuseTransmission } = RESIDENCE_TEA_SHOJI;
  const width = 2 * PARKED_OFFSET + LEAF_WIDTH;
  const uncovered = 2 * openHalfWidth * MathUtils.clamp(openness, 0, 1);
  const doubleLayer = 4 * LEAF_WIDTH + uncovered - width;
  const singleLayer = width - uncovered - doubleLayer;
  return (uncovered + singleLayer * diffuseTransmission + doubleLayer * diffuseTransmission ** 2) / width;
}

function buildLeaf(panel: FurniturePiece, cedar: MeshStandardMaterial, paper: MeshStandardMaterial) {
  const centerY = LEAF_BOTTOM + LEAF_HEIGHT / 2;
  // The opaque surface and its shadow occlude the view and direct sun. The room's daylight adds diffuse transmission.
  panel.box(paper, 0, centerY, .001, LEAF_WIDTH - .036, LEAF_HEIGHT - .033, .005);
  for (const side of [-1, 1]) {
    panel.box(cedar, side * (LEAF_WIDTH / 2 - .012), centerY, 0, .024, LEAF_HEIGHT, .026, .001, 0, true);
    panel.box(cedar, 0, centerY + side * (LEAF_HEIGHT / 2 - .018),
      0, LEAF_WIDTH - .046, .036, .026, .001);
  }
  for (const x of [-LEAF_WIDTH / 6, LEAF_WIDTH / 6]) {
    panel.box(cedar, x, centerY, -.009, .012, LEAF_HEIGHT - .066, .017, .001, 0, true);
  }
  for (let i = 1; i < 8; i++) {
    panel.box(cedar, 0, LEAF_BOTTOM + i * LEAF_HEIGHT / 8, -.009, LEAF_WIDTH - .042, .012, .017, .001);
  }
  panel.box(cedar, 0, LEAF_BOTTOM + .068, -.008, LEAF_WIDTH - .046, .098, .021, .002);
}

export function addTeaRoomShoji(model: FurnitureModel, materials: ResidenceMaterials) {
  const { center, top, bottom, openHalfWidth } = RESIDENCE_TEA_SHOJI;
  const sill = model.at(center, SILL_NORTH);
  const cedar = materials.cedar;
  const casingWidth = 2.680;
  sill.box(cedar, 0, .0665, 0, casingWidth, .133, .094, .004);
  sill.box(cedar, 0, 2.206, 0, casingWidth, .050, .094, .003);
  sill.box(cedar, 0, 2.352, -.006, casingWidth, .257, .033, .003);
  for (const x of [-1.337, 1.337]) {
    sill.box(cedar, x, 1.17, 0, .029, 2.086, .091, .003, 0, true);
  }
  for (const north of [.555, (FIXED_NORTH + SLIDING_NORTH) / 2, .629]) {
    const z = SILL_NORTH - north;
    sill.box(cedar, 0, bottom, z, casingWidth, .008, .006, .001);
    sill.box(cedar, 0, top, z, casingWidth, .008, .006, .001);
  }

  const paper = materials.washi.clone();
  paper.name = 'Tea room shoji paper';
  paper.emissive.set(0xfff6e7);
  paper.emissiveMap = paper.map;
  paper.emissiveIntensity = 0;
  const leaf = new FurnitureModel();
  buildLeaf(leaf.at(0, 0), cedar, paper);
  leaf.finish();

  const group = new Group();
  group.name = 'Tea room shoji';
  model.group.add(group);
  const sliding = ([-1, 1] as const).map(side => {
    const name = side < 0 ? 'west' : 'east';
    const fixed = leaf.group.clone();
    fixed.name = `Tea room shoji fixed ${name}`;
    fixed.position.set(center + side * PARKED_OFFSET, 0, -FIXED_NORTH);
    const moving = leaf.group.clone();
    moving.name = `Tea room shoji sliding ${name}`;
    moving.traverse(object => { object.userData.dynamicResidenceShadow = true; });
    moving.position.set(center + side * PARKED_OFFSET, 0, -SLIDING_NORTH);
    group.add(fixed, moving);
    return { side, moving };
  });

  // Start with the central city view open, matching the tea room's initial view.
  let target = 1;
  let amount = 1;
  const control = {
    kind: 'toggle' as const, id: 'shoji', label: '障子',
    location: { roomId: '04', markers: [[center - casingWidth / 2, SLIDING_NORTH, center + casingWidth / 2, SLIDING_NORTH] as const] },
    get: () => target === 1,
    set(open: boolean) { target = Number(open); },
  };
  return {
    control,
    openness: () => amount,
    setPaperLight(intensity: number) { paper.emissiveIntensity = Math.max(0, intensity); },
    nearby(position: { x: number; z: number }) {
      const distance = Math.hypot(position.x - center, position.z + SLIDING_NORTH);
      if (position.z >= -SLIDING_NORTH || distance > REACH) return null;
      return {
        distance,
        label: `茶室の障子を${control.get() ? '閉める' : '開ける'}`,
        invoke() { control.set(!control.get()); },
      };
    },
    update(dt: number) {
      if (dt <= 0 || amount === target) return false;
      const step = Math.min(dt / SLIDE_SECONDS, Math.abs(amount - target));
      amount = MathUtils.clamp(amount + Math.sign(target - amount) * step, 0, 1);
      for (const { side, moving } of sliding) {
        moving.position.x = center + side * (LEAF_WIDTH / 2 + openHalfWidth * amount);
      }
      return true;
    },
    dispose() {
      leaf.dispose();
      paper.dispose();
    },
  };
}
