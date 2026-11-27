import { ArrayCamera, Box2, Box3, Frustum, Matrix4, Mesh, Points, Vector2, Vector3, Vector4,
  type Group, type Object3D, type PerspectiveCamera, type Scene } from 'three';
import { RESIDENCE_ROOMS, RESIDENCE_WALLS, type ResidenceWall } from './residencePlan';

const WALL_EDGE_MARGIN = .023;
const GLAZING_MARGIN = .06;
const ROOM_INSET = .14;
// Regional light sprites extend beyond their projected centers. This covers their largest radius.
const GLAZING_PIXEL_MARGIN = 24;
// Each bit joins the two corners that differ along one axis.
const BOX_EDGES = Array.from({ length: 8 }, (_, a) => [1, 2, 4]
  .map(bit => a ^ bit).filter(b => b > a).map(b => [a, b] as const)).flat();

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

function regionalBounds(object: Mesh | Points): Box3 | undefined {
  const geometry = object.geometry;
  geometry.computeBoundingBox();
  const shape = geometry.boundingBox;
  if (!shape || shape.isEmpty()) return;
  const centers = geometry.getAttribute('cityCenter');
  const scales = geometry.getAttribute('cityScale');
  if (!centers || !scales) {
    // Unknown instance transforms are outside the proof used for this filter.
    if (geometry.type === 'InstancedBufferGeometry' || 'isInstancedMesh' in object) return;
    return shape.clone().applyMatrix4(object.matrixWorld);
  }
  const halfX = Math.max(Math.abs(shape.min.x), Math.abs(shape.max.x));
  const halfZ = Math.max(Math.abs(shape.min.z), Math.abs(shape.max.z));
  const bounds = new Box3();
  const point = new Vector3();
  for (let i = 0; i < centers.count; i += 1) {
    const x = centers.getX(i), y = centers.getY(i), z = centers.getZ(i);
    const radius = Math.hypot(halfX * scales.getX(i), halfZ * scales.getZ(i));
    const height = scales.getY(i);
    // The placement shader rotates the scaled footprint around Y.
    bounds.expandByPoint(point.set(x - radius, y + shape.min.y * height, z - radius));
    bounds.expandByPoint(point.set(x + radius, y + shape.max.y * height, z + radius));
  }
  return bounds.applyMatrix4(object.matrixWorld);
}

export function bindResidenceCityVisibility(scene: Scene, city: Group, regionalCity: Group): void {
  const boundsByTile = new Map<Object3D, Box3>();
  regionalCity.updateWorldMatrix(true, true);
  regionalCity.traverse(tile => {
    // Keeping shadow casters visible also keeps their contribution to surfaces in the eye frustum.
    if (!(tile instanceof Mesh || tile instanceof Points) || tile.castShadow) return;
    const bounds = regionalBounds(tile);
    if (bounds && !bounds.isEmpty()) boundsByTile.set(tile, bounds);
  });

  const frustum = new Frustum();
  const projectionView = new Matrix4();
  const nearClipBounds = new Box3();
  const eyePoint = new Vector3();
  const nearCorner = new Vector3();
  const crop = new Matrix4();
  const clipCorners = Array.from({ length: 8 }, () => new Vector4());
  const intersection = new Vector4();
  const apertureBounds = new Box2();
  const ndc = new Vector2();
  const portalFrustums: Frustum[] = [];
  let portalCount = 0;

  function hasInteriorNearPlane(eye: PerspectiveCamera): boolean {
    eyePoint.setFromMatrixPosition(eye.matrixWorld);
    nearClipBounds.set(eyePoint, eyePoint);
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) nearClipBounds.expandByPoint(nearCorner.set(x, y, -1).unproject(eye));
    }
    return interiors.some(room => room.containsBox(nearClipBounds));
  }

  function expandAperture(point: Vector4): void {
    apertureBounds.expandByPoint(ndc.set(point.x / point.w, point.y / point.w));
  }

  function addPortal(corners: readonly Vector3[], viewport: Vector4): boolean {
    apertureBounds.makeEmpty();
    for (const [index, corner] of corners.entries()) {
      const clip = clipCorners[index].set(corner.x, corner.y, corner.z, 1).applyMatrix4(projectionView);
      if (clip.z + clip.w >= 0) expandAperture(clip);
    }
    // Project the visible part of the glazing box when it crosses the eye's actual near plane.
    for (const [a, b] of BOX_EDGES) {
      const first = clipCorners[a], last = clipCorners[b];
      const firstDepth = first.z + first.w, lastDepth = last.z + last.w;
      if ((firstDepth >= 0) === (lastDepth >= 0)) continue;
      expandAperture(intersection.copy(first).lerp(last, firstDepth / (firstDepth - lastDepth)));
    }
    if (apertureBounds.isEmpty()) return true;
    const marginX = 2 * GLAZING_PIXEL_MARGIN / viewport.z;
    const marginY = 2 * GLAZING_PIXEL_MARGIN / viewport.w;
    const left = Math.max(-1, apertureBounds.min.x - marginX);
    const right = Math.min(1, apertureBounds.max.x + marginX);
    const bottom = Math.max(-1, apertureBounds.min.y - marginY);
    const top = Math.min(1, apertureBounds.max.y + marginY);
    if (![left, right, bottom, top].every(Number.isFinite)) return false;
    if (!(left < right && bottom < top)) return true;
    crop.set(
      2 / (right - left), 0, 0, -(right + left) / (right - left),
      0, 2 / (top - bottom), 0, -(top + bottom) / (top - bottom),
      0, 0, 1, 0,
      0, 0, 0, 1,
    ).multiply(projectionView);
    const portal = portalFrustums[portalCount] ?? (portalFrustums[portalCount] = new Frustum());
    portal.setFromProjectionMatrix(crop);
    portalCount += 1;
    return true;
  }

  let hiddenCity = false;
  const hiddenTiles: Object3D[] = [];
  function restoreVisibility(): void {
    if (hiddenCity) city.visible = true;
    hiddenCity = false;
    for (const tile of hiddenTiles) tile.visible = true;
    hiddenTiles.length = 0;
  }

  scene.onBeforeRender = (renderer, _scene, camera) => {
    restoreVisibility();
    // Three has updated the asymmetric eye projections and world matrices here.
    if (!city.visible || !renderer.xr.enabled || !renderer.xr.isPresenting || !(camera instanceof ArrayCamera)
      || camera.cameras.length === 0 || !camera.cameras.every(hasInteriorNearPlane)) return;
    let hasVisibleAperture = false;
    let usablePortals = true;
    portalCount = 0;
    for (const eye of camera.cameras) {
      eyePoint.setFromMatrixPosition(eye.matrixWorld);
      frustum.setFromProjectionMatrix(projectionView.multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse));
      const viewport = 'viewport' in eye && eye.viewport instanceof Vector4 ? eye.viewport : undefined;
      for (const { bounds, corners } of apertures) {
        // All corners must hit the same solid rectangle before reaching the opening.
        if (!frustum.intersectsBox(bounds)
          || wallSpans.some(wall => corners.every(corner => wallBlocksRay(wall, eyePoint, corner)))) continue;
        hasVisibleAperture = true;
        if (!viewport || !(viewport.z > 0 && viewport.w > 0) || !addPortal(corners, viewport)) usablePortals = false;
      }
    }
    if (!hasVisibleAperture) {
      city.visible = false;
      hiddenCity = true;
      return;
    }
    if (!usablePortals || portalCount === 0) return;
    regionalCity.traverseVisible(tile => {
      const bounds = boundsByTile.get(tile);
      if (!bounds) return;
      for (let i = 0; i < portalCount; i += 1) {
        if (portalFrustums[i].intersectsBox(bounds)) return;
      }
      tile.visible = false;
      hiddenTiles.push(tile);
    });
  };
  scene.onAfterRender = restoreVisibility;
}
