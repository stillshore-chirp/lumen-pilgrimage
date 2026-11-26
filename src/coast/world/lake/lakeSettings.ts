import { MathUtils, Vector3 } from 'three';
import type { CoastTimeOfDay } from '../coastAtmosphere';

const settingsKey = 'lumen-pilgrimage:lake-settings';
export const LAKE_DEFAULT_SUN = new Vector3(0.89, 0.20, -0.37).normalize();
export const LAKE_DEFAULT_MOON = new Vector3(-0.67, 0.31, 0.67).normalize();

function azimuth(direction: Vector3): number {
  return MathUtils.euclideanModulo(MathUtils.radToDeg(Math.atan2(direction.x, -direction.z)), 360);
}

function elevation(direction: Vector3): number {
  return MathUtils.radToDeg(Math.asin(direction.y));
}

const defaultSky = {
  sunAzimuth: azimuth(LAKE_DEFAULT_SUN),
  sunElevation: elevation(LAKE_DEFAULT_SUN),
  moonAzimuth: azimuth(LAKE_DEFAULT_MOON),
  moonElevation: elevation(LAKE_DEFAULT_MOON),
  moonVisible: true,
};

const defaults = { ...defaultSky, futon: false, lanterns: false };
export type LakeSettingsState = Readonly<typeof defaults>;
export type LakeAngle = 'sunAzimuth' | 'sunElevation' | 'moonAzimuth' | 'moonElevation';

export const lakeAngleControls = [
  { key: 'sunAzimuth', label: '太陽の方位', min: 0, max: 359.9 },
  { key: 'sunElevation', label: '太陽の高度', min: 1, max: 89 },
  { key: 'moonAzimuth', label: '月の方位', min: 0, max: 359.9 },
  { key: 'moonElevation', label: '月の高度', min: 1, max: 89 },
] as const;

export const lakeToggleControls = [
  { key: 'futon', label: '布団' },
  { key: 'lanterns', label: '湖の灯籠' },
  { key: 'moonVisible', label: '月の表示' },
] as const;

function sanitize(value: unknown): LakeSettingsState {
  const next = { ...defaults };
  if (!value || typeof value !== 'object') return next;
  const record = value as Record<string, unknown>;
  for (const { key, min, max } of lakeAngleControls) {
    const angle = record[key];
    if (typeof angle === 'number' && Number.isFinite(angle)) next[key] = MathUtils.clamp(angle, min, max);
  }
  for (const { key } of lakeToggleControls) {
    const visible = record[key];
    if (typeof visible === 'boolean') next[key] = visible;
  }
  return next;
}

export function setLakeLightDirection(target: Vector3, state: LakeSettingsState, time: CoastTimeOfDay): void {
  const sun = time === 'day';
  const azimuth = MathUtils.degToRad(sun ? state.sunAzimuth : state.moonAzimuth);
  const elevation = MathUtils.degToRad(sun ? state.sunElevation : state.moonElevation);
  const horizontal = Math.cos(elevation);
  target.set(Math.sin(azimuth) * horizontal, Math.sin(elevation), -Math.cos(azimuth) * horizontal);
}

export function createLakeSettings(changed: (next: LakeSettingsState, previous: LakeSettingsState) => void) {
  let state: LakeSettingsState = { ...defaults };
  try {
    state = sanitize(JSON.parse(globalThis.localStorage.getItem(settingsKey) ?? 'null'));
  } catch {
    // The scene remains adjustable when storage is unavailable.
  }

  function update(patch: Partial<LakeSettingsState>): void {
    const previous = state;
    state = sanitize({ ...state, ...patch });
    changed(state, previous);
    try {
      globalThis.localStorage.setItem(settingsKey, JSON.stringify(state));
    } catch {
      // The running scene already has the new settings.
    }
  }

  return {
    get state() { return state; },
    update,
    resetSky() { update(defaultSky); },
  };
}

export type LakeSettings = ReturnType<typeof createLakeSettings>;
