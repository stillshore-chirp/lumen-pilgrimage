export const LAKE_LABEL = '湖畔の広間';
export const LAKE_VIEW_FOV = 52;
export const LAKE_VIEW_VERTICAL_OFFSET = -0.138;
export const LAKE_WATER_Y = -0.82;

export const LAKE_HALL = {
  halfWidth: 21.6,
  rearZ: 16.4,
  frontZ: -6.2,
  ceilingY: 8.22,
} as const;

export const LAKE_GLAZING = {
  halfWidth: 20.92,
  centralPostX: 5.75,
  headY: 7.76,
} as const;

export const LAKE_SIDE_VENTS = {
  x: 21.26,
  y: 2.5,
  z: LAKE_HALL.frontZ,
  width: 0.28,
  height: 0.35,
} as const;

export const LAKE_TATAMI = { halfWidth: 20.4, frontZ: -2.8, rearZ: 14.2 } as const;

export const LAKE_TABLE = {
  x: 0,
  z: -0.17,
  width: 3.36,
  depth: 1.50,
  topY: 0.43,
} as const;

export const LAKE_TERRAIN = {
  ringZ: -460,
  ringCenterY: 73,
  ringRadius: 92,
  shoreZ: -365,
} as const;

export const LAKE_SPAWN = { x: 0, z: 7, yaw: 0, pitch: 0 } as const;
export const LAKE_WINDOW_VIEW_X = 18.7;
export const LAKE_WINDOW_VIEW_Z = -5.1;

export const LAKE_DESTINATIONS = [
  { id: 'hall', label: '広間の中央', ...LAKE_SPAWN },
  { id: 'west-window', label: '西の窓辺', x: -LAKE_WINDOW_VIEW_X, z: LAKE_WINDOW_VIEW_Z, yaw: -0.11, pitch: -0.41 },
  { id: 'east-window', label: '東の窓辺', x: LAKE_WINDOW_VIEW_X, z: LAKE_WINDOW_VIEW_Z, yaw: 0.11, pitch: -0.41 },
] as const;
