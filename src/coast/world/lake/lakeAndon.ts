import {
  Box3, DataTexture, DoubleSide, Group, LatheGeometry, LinearFilter, LinearMipmapLinearFilter, MathUtils, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, NoColorSpace, PlaneGeometry, PointLight, QuadraticBezierCurve3,
  Ray, RepeatWrapping, RGBAFormat,
  SRGBColorSpace, TextureLoader, TubeGeometry, Vector2, Vector3,
} from 'three';
import type { DesktopGrabTarget } from '../../DesktopGrab';
import { beginLakeHallAssembly } from './lakeHallGeometry';
import { LAKE_TABLE } from './lakeLayout';
import { lakeNavigation } from './lakeNavigation';

const halfWidth = .135;
const shadeBottom = .051;
const shadeTop = .402;
const flameY = .205;

function makePaperMaps() {
  const size = 128;
  const paperPixels = new Uint8Array(size * size * 4);
  const lightPixels = new Uint8Array(paperPixels.length);
  for (let y = 0; y < size; y += 1) {
    const v = y / (size - 1);
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      const hash = Math.sin(127.1 * x + 311.7 * y) * 43758.5453;
      const fleck = hash - Math.floor(hash);
      const fibre = Math.sin(x * 1.8 + .87 * Math.sin(y * .16)) * Math.sin(y * .33 + .038 * x);
      const pulp = 225 + 13 * (fleck - .5) + 5.1 * fibre;
      const margin = Math.min(u, 1 - u, v, 1 - v);
      const seam = .83 + .17 * Math.min(1, margin / .052);
      const height = shadeBottom + (shadeTop - shadeBottom) * v;
      const distance = Math.hypot(.111, .226 * (u - .5), height - flameY);
      const glow = (pulp / 255) * seam * (.20 + .80 * .111 / distance);
      const index = 4 * (y * size + x);
      for (let channel = 0; channel < 3; channel += 1) {
        paperPixels[index + channel] = pulp * seam;
        lightPixels[index + channel] = 255 * glow;
      }
      paperPixels[index + 3] = lightPixels[index + 3] = 255;
    }
  }
  const maps = [paperPixels, lightPixels].map(pixels => {
    const texture = new DataTexture(pixels, size, size, RGBAFormat);
    texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  });
  return { map: maps[0], emissiveMap: maps[1] };
}

export function buildLakeAndon(parent: Group): { grabTarget: DesktopGrabTarget; setLighting(night: boolean, lampsOn: boolean): void } {
  const root = new Group();
  root.name = 'Lake floor andon';
  root.visible = false;

  const loader = new TextureLoader();
  const woodMap = (file: string, color: boolean) => {
    const map = loader.load(`${import.meta.env.BASE_URL}residence-materials/walnut-${file}.webp`);
    map.colorSpace = color ? SRGBColorSpace : NoColorSpace;
    map.wrapS = map.wrapT = RepeatWrapping;
    map.repeat.set(1.7, 2.9);
    map.anisotropy = 4;
    return map;
  };
  const timber = new MeshStandardMaterial({
    name: 'Andon smoked walnut', color: 0x79644f,
    map: woodMap('color', true), normalMap: woodMap('normal', false), roughness: .79, vertexColors: true,
  });
  timber.normalScale.set(.37, .37);
  const frame = beginLakeHallAssembly(root, 'Andon frame and rails', timber);
  const tray = beginLakeHallAssembly(root, 'Andon chamfered foot', timber);
  tray.slab([0, .017, 0], [2 * halfWidth, .034, 2 * halfWidth], .006);
  frame.box([0, .037, 0], [.249, .013, .249], 0, .89);
  const corner = .119;
  const postWidth = .017;
  const railWidth = .238;
  for (const side of [-1, 1]) {
    for (const edge of [-1, 1]) {
      frame.box([side * corner, .224, edge * corner], [postWidth, .379, postWidth], 1);
    }
    for (const y of [.058, .400]) {
      frame.box([0, y, side * corner], [railWidth, .019, .015], 0, .94);
      frame.box([side * corner, y, 0], [.015, .019, railWidth], 2, .94);
    }
    frame.box([0, .310, side * corner], [railWidth, .009, .010], 0, .91);
    frame.box([side * corner, .310, 0], [.010, .009, railWidth], 2, .91);
    frame.box([side * .102, .417, 0], [.024, .030, .029], 1, .89);
  }
  frame.box([0, .406, 0], [railWidth, .013, .024], 0, .92);
  frame.finish();
  tray.finish();

  const bend = new QuadraticBezierCurve3(
    new Vector3(-.102, .423, 0), new Vector3(0, .520, 0), new Vector3(.102, .423, 0),
  );
  const handle = new Mesh(new TubeGeometry(bend, 20, .0092, 8, false),
    new MeshStandardMaterial({ name: 'Andon walnut grip', color: 0x47372a, roughness: .81 }));
  handle.name = 'Andon carrying handle';
  root.add(handle);

  const paper = new MeshStandardMaterial({
    ...makePaperMaps(), name: 'Andon washi diffuser', color: 0xdfcbae, roughness: .96, side: DoubleSide,
    emissive: 0xffc487, emissiveIntensity: 0,
  });
  const skin = new PlaneGeometry(.239, shadeTop - shadeBottom, 6, 8);
  const { position, uv } = skin.attributes;
  for (let index = 0; index < position.count; index += 1) {
    const bow = Math.sin(Math.PI * uv.getX(index)) * Math.sin(Math.PI * uv.getY(index));
    position.setZ(index, .0024 * bow);
  }
  skin.computeVertexNormals();
  for (let face = 0; face < 4; face += 1) {
    const angle = face * Math.PI / 2;
    const shade = new Mesh(skin, paper);
    shade.name = 'Andon paper shade';
    shade.rotation.y = angle;
    shade.position.set(.111 * Math.sin(angle), (shadeTop + shadeBottom) / 2, .111 * Math.cos(angle));
    shade.receiveShadow = true;
    root.add(shade);
  }

  const vesselProfile = [[0, 0], [.031, 0], [.050, .008], [.058, .022], [.061, .027], [.053, .027],
    [.049, .017], [.034, .012], [0, .012]];
  const oilDish = new Mesh(new LatheGeometry(vesselProfile.map(([x, y]) => new Vector2(x, y)), 28),
    new MeshStandardMaterial({ name: 'Andon glazed oil dish', color: 0x443025, roughness: .52 }));
  oilDish.position.y = .148;
  const seat = beginLakeHallAssembly(root, 'Andon oil dish cradle', timber);
  seat.box([0, .140, 0], [.217, .016, .085], 0, .80);
  for (const side of [-1, 1]) seat.box([side * .083, .088, 0], [.021, .100, .029], 1, .80);
  seat.finish();
  root.add(oilDish);

  const flameProfile = [[0, 0], [.007, .002], [.008, .010], [.006, .022], [.003, .036], [0, .046]];
  const flame = new Mesh(new LatheGeometry(flameProfile.map(([x, y]) => new Vector2(x, y)), 12),
    new MeshBasicMaterial({ name: 'Andon flame', color: 0xffcb7a, toneMapped: false }));
  flame.name = 'Andon flame';
  flame.position.y = .172;
  flame.visible = false;
  const glow = new PointLight(0xffbe7d, 0, 2.35, 2);
  glow.name = 'Andon warm light';
  glow.position.y = flameY;
  root.add(flame, glow);

  const bounds = new Box3().setFromObject(root, true);
  const localRay = new Ray();
  const worldToLocal = new Matrix4();
  const hit = new Vector3();
  // The square foot can face either axis at any angle.
  const footRadius = halfWidth * Math.SQRT2;
  // Leave room for the glazing piers and trim inside the hall perimeter.
  const wallInset = 0.25 + footRadius;
  const minX = lakeNavigation.bounds.minX + wallInset;
  const maxX = lakeNavigation.bounds.maxX - wallInset;
  const minZ = lakeNavigation.bounds.minZ + wallInset;
  const maxZ = lakeNavigation.bounds.maxZ - wallInset;
  const overlapsTable = (x: number, z: number) => Math.abs(x - LAKE_TABLE.x) < LAKE_TABLE.width / 2 + footRadius
    && Math.abs(z - LAKE_TABLE.z) < LAKE_TABLE.depth / 2 + footRadius;
  root.position.set(LAKE_TABLE.x + LAKE_TABLE.width / 2 + .53, 0, LAKE_TABLE.z + .23);
  root.rotation.y = -.14;
  parent.add(root);

  return {
    grabTarget: {
      label: '行灯',
      object: root,
      reach: 2.25,
      xrGripAnchor: bend.getPoint(0.5),
      available: () => root.visible,
      hitDistance(ray) {
        root.updateWorldMatrix(true, false);
        localRay.copy(ray.ray).applyMatrix4(worldToLocal.copy(root.matrixWorld).invert());
        if (!localRay.intersectBox(bounds, hit)) return;
        return ray.ray.origin.distanceTo(hit.applyMatrix4(root.matrixWorld));
      },
      floorHeight(x, z) {
        if (x < minX || x > maxX || z < minZ || z > maxZ || overlapsTable(x, z)) return;
        return lakeNavigation.groundHeight();
      },
      constrainCarry(position) {
        position.x = MathUtils.clamp(position.x, minX, maxX);
        position.z = MathUtils.clamp(position.z, minZ, maxZ);
        const bottomY = overlapsTable(position.x, position.z) ? LAKE_TABLE.topY + 0.06 : lakeNavigation.groundHeight();
        position.y = Math.max(position.y, bottomY);
      },
    },
    setLighting(night, lampsOn) {
      const lit = night && lampsOn;
      root.visible = night;
      flame.visible = lit;
      paper.emissiveIntensity = lit ? 1.08 : 0;
      glow.intensity = lit ? .64 : 0;
    },
  };
}
