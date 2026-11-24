import { ArrayCamera, Box3, Frustum, Matrix4, Vector3, type Group, type PerspectiveCamera, type Scene } from 'three';
import { RESIDENCE_ROOMS, RESIDENCE_WALLS, type ResidenceWall } from './residencePlan';

const WALL_EDGE_MARGIN = .023;
const GLAZING_MARGIN = .06;
const ROOM_INSET = .14;

type WallSpan = Pick<ResidenceWall, 'axis' | 'fixed' | 'from' | 'to' | 'height'>;

// Restrict the test to finished rooms. The clip plane can cross geometry when the
// viewer leans into a wall, crosses a threshold, or moves onto the balcony.
const interiors = RESIDENCE_ROOMS.flatMap(({ rectangles, ceiling }) => ceiling === null ? []
  : rectangles.map(([west, south, east, north]) => new Box3(
    new Vector3(west, 0, -north), new Vector3(east, ceiling, -south),
  ).expandByScalar(-ROOM_INSET)));

const apertures = RESIDENCE_WALLS.flatMap(wall => wall.kind !== 'exterior' ? [] : (wall.openings ?? []).map(opening => {
  const point = (along: number, height: number) => wall.axis === 'e'
    ? new Vector3(along, height, -wall.fixed) : new Vector3(wall.fixed, height, -along);
  const bounds = new Box3().setFromPoints([point(opening.from, opening.bottom), point(opening.to, opening.top)]);
  bounds.expandByScalar(wall.thickness / 2 + GLAZING_MARGIN);
  const { min, max } = bounds;
  const corners = [min.x, max.x].flatMap(x => [min.y, max.y].flatMap(y => [min.z, max.z].map(z => new Vector3(x, y, z))));
  return { bounds, corners };
}));

// Use the uninterrupted body of ordinary interior walls. Door openings stay
// available regardless of the moving leaf, including the foyer pocket frame.
const wallSpans = RESIDENCE_WALLS.flatMap(wall => {
  if (wall.kind !== 'interior' || wall.openings?.some(opening => opening.kind === 'gallery-slide')) return [];
  const { axis, fixed, height } = wall;
  const spans: WallSpan[] = [];
  let from = wall.from;
  for (const opening of wall.openings ?? []) {
    spans.push({ axis, fixed, height, from, to: opening.from });
    from = opening.to;
  }
  spans.push({ axis, fixed, height, from, to: wall.to });
  return spans;
});

function wallBlocksRay(wall: WallSpan, eye: Vector3, point: Vector3): boolean {
  const runsEastWest = wall.axis === 'e';
  const start = runsEastWest ? -eye.z : eye.x;
  const end = runsEastWest ? -point.z : point.x;
  const fraction = (wall.fixed - start) / (end - start);
  if (!(fraction > 0 && fraction < 1)) return false;
  const height = eye.y + (point.y - eye.y) * fraction;
  const along = runsEastWest ? eye.x + (point.x - eye.x) * fraction : -(eye.z + (point.z - eye.z) * fraction);
  return along > wall.from + WALL_EDGE_MARGIN && along < wall.to - WALL_EDGE_MARGIN
    && height > WALL_EDGE_MARGIN && height < wall.height - WALL_EDGE_MARGIN;
}

export function bindResidenceCityVisibility(scene: Scene, city: Group): void {
  const frustum = new Frustum();
  const projectionView = new Matrix4();
  const nearClipBounds = new Box3();
  const eyePoint = new Vector3();
  const nearCorner = new Vector3();

  function canSeeExterior(eye: PerspectiveCamera): boolean {
    eyePoint.setFromMatrixPosition(eye.matrixWorld);
    nearClipBounds.set(eyePoint, eyePoint);
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) nearClipBounds.expandByPoint(nearCorner.set(x, y, -1).unproject(eye));
    }
    if (!interiors.some(room => room.containsBox(nearClipBounds))) return true;

    frustum.setFromProjectionMatrix(projectionView.multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse));
    // All corners must hit the same solid rectangle before reaching the opening.
    return apertures.some(({ bounds, corners }) => frustum.intersectsBox(bounds)
      && !wallSpans.some(wall => corners.every(corner => wallBlocksRay(wall, eyePoint, corner))));
  }

  let hiddenForRender = false;
  scene.onBeforeRender = (renderer, _scene, camera) => {
    // Three supplies the current world matrices and asymmetric eye projections
    // here, before building the visible-object list.
    if (city.visible && renderer.xr.enabled && renderer.xr.isPresenting && camera instanceof ArrayCamera
      && camera.cameras.length > 0 && !camera.cameras.some(canSeeExterior)) {
      city.visible = false;
      hiddenForRender = true;
    }
  };
  scene.onAfterRender = () => {
    if (hiddenForRender) {
      city.visible = true;
      hiddenForRender = false;
    }
  };
}
