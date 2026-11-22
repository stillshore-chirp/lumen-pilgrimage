// Commercial centers in the terrain's local metre grid. The western and eastern
// districts frame the deeper downtown, with smaller centers on the approaches.
export const OUTER_DISTRICTS = {
  westApproach: [-4050, -6350],
  westJunction: [-7550, -9900],
  westShore: [-10300, -13300],
  westBasin: [-4750, -14200],
  downtown: [2250, -15100],
  eastBasin: [7650, -14900],
  eastJunction: [13100, -14100],
  farWest: [-7800, -17700],
  farCenter: [2250, -19900],
  farEast: [11200, -20800],
} as const;
