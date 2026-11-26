export const LAKE_LABEL = '湖畔の広間';
export const LAKE_VIEW_FOV = 52;
export const LAKE_WATER_Y = -0.82;

export const LAKE_HALL = {
  halfWidth: 21.6,
  rearZ: 13.2,
  frontZ: -6.2,
  ceilingY: 8.22,
} as const;

export const LAKE_GLAZING = {
  halfWidth: 16.65,
  centralPostX: 5.75,
  headY: 8.10,
} as const;

export const LAKE_VERANDA = {
  endZ: -11.6,
  insideX: 16.65,
  outsideX: 21.6,
} as const;

export const LAKE_TABLE = {
  x: 0,
  z: 0.28,
  width: 3.48,
  depth: 1.58,
  topY: 0.44,
} as const;

export const LAKE_TERRAIN = {
  ringZ: -460,
  ringCenterY: 73,
  ringRadius: 92,
  shoreZ: -365,
} as const;

export const LAKE_SPAWN = { x: 0, z: 7, yaw: 0, pitch: 0.135 } as const;

export const LAKE_DESTINATIONS = [
  { id: 'hall', label: '広間の中央', ...LAKE_SPAWN },
  { id: 'west-veranda', label: '西の縁側', x: -19.3, z: -9.1, yaw: -0.13, pitch: -0.24 },
  { id: 'east-veranda', label: '東の縁側', x: 19.3, z: -9.1, yaw: 0.13, pitch: -0.24 },
] as const;
