import * as THREE from 'three';
import { RESIDENCE_ROOMS, RESIDENCE_WALLS, type ResidenceDoorOpening, type ResidenceRoom } from './residencePlan';

interface Aperture {
  readonly axis: 'e' | 'n';
  readonly fixed: number;
  readonly from: number;
  readonly to: number;
  readonly bottom: number;
  readonly top: number;
  readonly thickness: number;
  readonly rooms: readonly [negative: ResidenceRoom, positive: ResidenceRoom];
  readonly door?: ResidenceDoorOpening;
}

const interiorRooms = RESIDENCE_ROOMS.filter(room => room.ceiling !== null && room.floor !== 'deck');
const walls = RESIDENCE_WALLS.filter(wall => wall.kind !== 'guard');

function roomAt(east: number, north: number): ResidenceRoom | undefined {
  return interiorRooms.find(room => room.rectangles.some(([w, s, e, n]) => east >= w && east < e && north >= s && north < n));
}

function point(axis: Aperture['axis'], along: number, across: number): [east: number, north: number] {
  return axis === 'e' ? [along, across] : [across, along];
}

function interiorApertures(): Aperture[] {
  const apertures: Aperture[] = [];
  for (const wall of walls) {
    for (const opening of wall.openings ?? []) {
      if (opening.kind === 'window' || opening.kind === 'balcony-door') continue;
      const center = (opening.from + opening.to) / 2;
      const offset = wall.thickness / 2 + .08;
      const negative = roomAt(...point(wall.axis, center, wall.fixed - offset));
      const positive = roomAt(...point(wall.axis, center, wall.fixed + offset));
      if (!negative || !positive || negative === positive) continue;
      apertures.push({
        axis: wall.axis, fixed: wall.fixed, from: opening.from + .035, to: opening.to - .035,
        bottom: opening.bottom, top: opening.top - .035, thickness: wall.thickness,
        rooms: [negative, positive], door: 'id' in opening ? opening : undefined,
      });
    }
  }

  // Continuous floor-plan boundaries also form openings when no wall occupies them.
  for (const negative of interiorRooms) {
    for (const positive of interiorRooms) {
      if (negative === positive) continue;
      for (const a of negative.rectangles) for (const b of positive.rectangles) {
        for (const axis of ['e', 'n'] as const) {
          const along = axis === 'e' ? 0 : 1;
          const across = 1 - along;
          const fixed = a[across + 2];
          if (fixed !== b[across]) continue;
          const from = Math.max(a[along], b[along]);
          const to = Math.min(a[along + 2], b[along + 2]);
          if (to - from < .16) continue;
          const occluders = walls.filter(wall => wall.axis === axis && wall.fixed === fixed && wall.to > from && wall.from < to)
            .sort((left, right) => left.from - right.from);
          let cursor = from;
          for (const wall of occluders) {
            if (wall.from - cursor >= .16) addGap(cursor, wall.from);
            cursor = Math.max(cursor, wall.to);
          }
          if (to - cursor >= .16) addGap(cursor, to);

          function addGap(from: number, to: number): void {
            apertures.push({
              axis, fixed, from, to, bottom: 0, top: Math.min(negative.ceiling!, positive.ceiling!),
              thickness: 0, rooms: [negative, positive],
            });
          }
        }
      }
    }
  }
  return apertures;
}

function reachesAperture(east: number, north: number, apertureEast: number, apertureNorth: number): boolean {
  for (const wall of walls) {
    const across = wall.axis === 'e' ? north : east;
    const endAcross = wall.axis === 'e' ? apertureNorth : apertureEast;
    if (Math.abs(endAcross - across) < .00001) continue;
    const fraction = (wall.fixed - across) / (endAcross - across);
    if (fraction <= .001 || fraction >= .999) continue;
    const from = wall.axis === 'e' ? east : north;
    const to = wall.axis === 'e' ? apertureEast : apertureNorth;
    const along = THREE.MathUtils.lerp(from, to, fraction);
    if (along > wall.from && along < wall.to) return false;
  }
  return true;
}

type DonorLight = (room: string, east: number, north: number, height: number) => readonly [electric: number, sky: number];

export function createResidenceLightSpill(origin: THREE.Vector3, extent: THREE.Vector3) {
  const [width, depth, levels] = [112, 100, 14];
  const stride = width * depth;
  const stepEast = extent.x / width;
  const stepNorth = extent.y / depth;
  const stepHeight = extent.z / levels;
  const coordinates = Array.from({ length: stride }, (_, column) => {
    const east = origin.x + (column % width + .5) * stepEast;
    const north = origin.y + (Math.floor(column / width) + .5) * stepNorth;
    return { east, north, room: roomAt(east, north) };
  });

  const doors = new Map<string, { hinged: boolean; transmission: number }>();
  const directions = interiorApertures().flatMap(aperture => {
    const { axis, fixed, from, to, bottom, top, thickness, rooms, door } = aperture;
    const state = door ? { hinged: door.kind === 'door', transmission: 1 } : undefined;
    if (door && state) doors.set(door.id, state);
    const area = (to - from) * (top - bottom);
    const alongSamples = Math.min(5, Math.max(2, Math.ceil((to - from) / .8)));
    const along = Array.from({ length: alongSamples }, (_, sample) =>
      THREE.MathUtils.lerp(from, to, (sample + .5) / alongSamples));
    const heights = [THREE.MathUtils.lerp(bottom, top, .20), THREE.MathUtils.lerp(bottom, top, .62)];
    const reach = Math.min(5.6, 3.65 + (to - from) * .31);
    const apertureGain = .90 * area / (area + 1.35);
    return rooms.map((receiver, side) => {
      const donor = rooms[1 - side];
      const sideSign = side === 0 ? -1 : 1;
      const donorAcross = fixed - sideSign * (thickness / 2 + .37);
      const indices: number[] = [];
      const gains: number[] = [];
      for (const [index, { east, north, room }] of coordinates.entries()) {
        if (room !== receiver) continue;
        const across = sideSign * ((axis === 'e' ? north : east) - fixed);
        const alongCoord = axis === 'e' ? east : north;
        const sideways = Math.max(from - alongCoord, alongCoord - to, 0);
        const distance = Math.hypot(across, sideways);
        if (across < 0 || distance >= reach) continue;
        const visible = along.filter(sample => reachesAperture(east, north, ...point(axis, sample, fixed)));
        if (visible.length === 0) continue;
        const fade = 1 - THREE.MathUtils.smoothstep(distance, reach * .55, reach);
        for (let level = 0; level < levels; level++) {
          const y = origin.z + (level + .5) * stepHeight;
          if (y > receiver.ceiling! + .10) break;
          let gain = 0;
          for (const sample of visible) for (const height of heights) {
            const d2 = across * across + (sample - alongCoord) ** 2 + (height - y) ** 2;
            const projected = .32 + .68 * (across + .15) / Math.sqrt(d2 + .36);
            gain += projected / (1 + .87 * d2);
          }
          const weighted = fade * apertureGain * gain / (alongSamples * heights.length);
          if (weighted >= .0025) {
            indices.push(index + stride * level);
            gains.push(weighted);
          }
        }
      }
      const donors = along.map(sample => point(axis, sample, donorAcross));
      return { donor: donor.id, state, donors, heights, indices: Uint32Array.from(indices), gains: Float32Array.from(gains) };
    });
  });

  const bytes = new Uint8Array(stride * levels * 2);
  const energy = new Float32Array(bytes.length);
  const texture = new THREE.Data3DTexture(bytes, width, depth, levels);
  texture.name = 'Residence indirect light through connecting apertures';
  texture.format = THREE.RGFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  let dirty = true;

  return {
    texture,
    setDoorOpenness(id: string, openness: number) {
      const state = doors.get(id);
      if (!state) return;
      const amount = THREE.MathUtils.clamp(openness, 0, 1);
      const transmission = state.hinged ? 1 - Math.cos(amount * Math.PI / 2) : amount;
      if (state.transmission === transmission) return;
      state.transmission = transmission;
      dirty = true;
    },
    invalidate() { dirty = true; },
    update(lightAt: DonorLight) {
      if (!dirty) return;
      dirty = false;
      energy.fill(0);
      for (const { donor, state, donors, heights, indices, gains } of directions) {
        const uncovered = state?.transmission ?? 1;
        if (uncovered <= 0) continue;
        let electric = 0;
        let sky = 0;
        for (const [e, n] of donors) for (const h of heights) {
          const sample = lightAt(donor, e, n, h);
          electric += sample[0];
          sky += sample[1];
        }
        const transmission = uncovered / (donors.length * heights.length);
        electric *= transmission;
        sky *= transmission;
        if (electric + sky < .001) continue;
        for (let i = 0; i < indices.length; i++) {
          const index = 2 * indices[i];
          energy[index] += electric * gains[i];
          energy[index + 1] += sky * gains[i];
        }
      }
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(255 * Math.min(1, energy[i]));
      texture.needsUpdate = true;
    },
  };
}
