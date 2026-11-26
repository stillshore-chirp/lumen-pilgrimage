import {
  BufferGeometry, CatmullRomCurve3, Color, DataTexture, Float32BufferAttribute, Group, LinearFilter,
  LinearMipmapLinearFilter, MathUtils, Mesh, MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace,
  TubeGeometry, Vector3,
} from 'three';

const widthSegments = 40;
const lengthSegments = 60;
const stride = widthSegments + 1;
const surfaceVertices = stride * (lengthSegments + 1);

type FabricLayer = {
  name: string;
  width: number;
  length: number;
  x: number;
  z: number;
  cloth: number;
  binding: number;
  lower: (u: number, v: number, top: number) => number;
  upper: (u: number, v: number, loft: number) => number;
  tint?: (v: number) => number;
};

function makeCottonWeave(): DataTexture {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const warp = Math.sin(Math.PI * x / 4);
      const weft = Math.sin(Math.PI * y / 4);
      const fleck = Math.sin(17.6 * x + 3.17 * y) * Math.sin(1.17 * x - 11.3 * y);
      const shade = 228 + 8 * warp * weft + 7 * Math.max(warp, weft) + 4 * fleck;
      const index = (y * size + x) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = shade;
      pixels[index + 3] = 255;
    }
  }
  const weave = new DataTexture(pixels, size, size, RGBAFormat);
  weave.colorSpace = SRGBColorSpace;
  weave.wrapS = weave.wrapT = RepeatWrapping;
  weave.generateMipmaps = true;
  weave.minFilter = LinearMipmapLinearFilter;
  weave.magFilter = LinearFilter;
  weave.anisotropy = 4;
  weave.needsUpdate = true;
  return weave;
}

function addBedding(root: Group, weave: DataTexture, layer: FabricLayer): void {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const uv: number[] = [];
  const tones: number[] = [];
  const faces: number[] = [];
  const perimeter: number[] = [];
  const color = new Color();
  for (const underside of [false, true]) {
    for (let row = 0; row <= lengthSegments; row += 1) {
      const v = row * 2 / lengthSegments - 1;
      for (let column = 0; column <= widthSegments; column += 1) {
        const u = column * 2 / widthSegments - 1;
        const loft = Math.sqrt((1 - Math.abs(u) ** 10) * (1 - Math.abs(v) ** 8));
        // Keep straight seams through the middle and round the corner where the filling tapers.
        const x = layer.width / 2 * u * (1 - .10 * v ** 10);
        const z = layer.length / 2 * v * (1 - .065 * u ** 10);
        const top = layer.upper(u, v, loft);
        const y = underside ? layer.lower(u, v, top) : top;
        positions.push(x, y, z);
        uv.push(x * 20, z * 20);
        const tone = underside ? .78 : .94 + .04 * loft + .018 * Math.sin(9 * u + 2 * v);
        color.setHex(layer.tint?.(v) ?? layer.cloth).multiplyScalar(tone);
        tones.push(color.r, color.g, color.b);
      }
    }
  }
  for (let row = 0; row < lengthSegments; row += 1) {
    for (let column = 0; column < widthSegments; column += 1) {
      const a = row * stride + column;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      const n = surfaceVertices;
      faces.push(a, c, b, b, c, d, a + n, b + n, c + n, b + n, d + n, c + n);
    }
  }
  for (let x = 0; x < widthSegments; x += 1) perimeter.push(x);
  for (let z = 0; z < lengthSegments; z += 1) perimeter.push(z * stride + widthSegments);
  for (let x = widthSegments; x > 0; x -= 1) perimeter.push(lengthSegments * stride + x);
  for (let z = lengthSegments; z > 0; z -= 1) perimeter.push(z * stride);
  const seam: Vector3[] = [];
  for (const [index, a] of perimeter.entries()) {
    const b = perimeter[(index + 1) % perimeter.length];
    const lowerA = a + surfaceVertices;
    const lowerB = b + surfaceVertices;
    faces.push(a, b, lowerA, b, lowerB, lowerA);
    seam.push(new Vector3(
      positions[3 * a], (positions[3 * a + 1] + positions[3 * lowerA + 1]) / 2, positions[3 * a + 2],
    ));
  }
  geometry.setIndex(faces);
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(tones, 3));
  geometry.computeVertexNormals();
  const textile = new Mesh(geometry, new MeshStandardMaterial({
    vertexColors: true, map: weave, bumpMap: weave, bumpScale: .002, roughness: .94,
  }));
  textile.name = layer.name;
  textile.castShadow = textile.receiveShadow = true;
  const hem = new Mesh(
    new TubeGeometry(new CatmullRomCurve3(seam, true), perimeter.length, .0034, 5, true),
    new MeshStandardMaterial({ color: layer.binding, roughness: .95 }),
  );
  hem.name = `${layer.name} bound seam`;
  for (const mesh of [textile, hem]) {
    mesh.position.set(layer.x, 0, layer.z);
    root.add(mesh);
  }
}

export function buildLakeFuton(parent: Group): { setVisible(value: boolean): void } {
  const root = new Group();
  root.name = 'Lake futon';
  root.position.set(-2.70, 0, 1.60);
  root.rotation.y = .09;
  root.visible = false;
  parent.add(root);
  const weave = makeCottonWeave();
  addBedding(root, weave, {
    name: 'Futon mattress', width: 1.02, length: 2.02, x: 0, z: 0, cloth: 0xc3aa8a, binding: 0x87725b,
    lower: () => .006,
    upper: (u, v, loft) => .032 + loft * (.080 + .004 * Math.sin(4 * u + 7 * v)),
  });
  addBedding(root, weave, {
    name: 'Futon pillow', width: .58, length: .36, x: -.047, z: -.735, cloth: 0xd5c7ac, binding: 0x9e8e76,
    lower: () => .106,
    upper: (u, v, loft) => {
      const hollow = Math.exp(-5.4 * (u + .12) ** 2 - 2.9 * (v - .13) ** 2);
      const crease = Math.sin(9 * v + 3 * u) * .004;
      return .125 + loft * (.105 - .039 * hollow + crease);
    },
  });
  addBedding(root, weave, {
    name: 'Futon coverlet', width: 1.09, length: 1.50, x: .028, z: .265, cloth: 0x607d92, binding: 0x40576d,
    lower: (_u, _v, top) => top - .019,
    upper: (u, v, loft) => {
      const drape = .030 * MathUtils.smoothstep(v, .72, 1) + .019 * MathUtils.smoothstep(u, .62, 1);
      const longSeam = (.5 + .5 * Math.cos(Math.PI * 4 * (u + .026 * Math.sin(5 * v)))) ** 16;
      const crossSeam = (.5 + .5 * Math.cos(Math.PI * 5 * (v + .035 * Math.sin(3 * u)))) ** 20;
      const tuck = .018 * Math.exp(-85 * (v + .87 - .04 * u) ** 2);
      const ripple = .006 * Math.sin(13 * v + 4 * u + u * u * 1.4) + .005 * Math.sin(9 * u - 12 * v);
      return .111 + loft * (.046 - .009 * longSeam - .007 * crossSeam) + ripple + tuck - drape;
    },
    tint: v => v < -.84 ? 0xb8ac93 : 0x607d92,
  });

  return {
    setVisible(value) { root.visible = value; },
  };
}
