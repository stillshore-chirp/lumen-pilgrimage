import * as THREE from 'three';
import { groundHeight } from '../terrain';
import { coastNoise } from './coastNoise';

const signs = [
  { x: -30.2, z: 105.2, bearing: Math.PI, label: '東屋', arrow: '←' },
  { x: -8.8, z: 394.0, bearing: Math.PI - 0.27, label: '湖・稜線', arrow: '←' },
  { x: 98.2, z: 842.6, bearing: -0.46, label: '稜線', arrow: '→' },
];

function makeSignFace(label: string, arrow: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#473b26';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#b6ad7e';
  context.lineWidth = 2;
  context.strokeRect(11, 11, 362, 74);
  context.fillStyle = '#f2e6be';
  context.font = '600 42px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(arrow === '←' ? arrow + '  ' + label : label + '  ' + arrow, 192, 50);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createUplandTrailDetails(time: THREE.IUniform<number>, grain: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Trail markers and slow valley mist';
  const wood = new THREE.MeshStandardMaterial({ color: 0x795b3e, map: grain, roughness: 0.89 });
  const postGeometry = new THREE.BoxGeometry(0.11, 1.73, 0.12);
  const boardGeometry = new THREE.BoxGeometry(1.22, 0.325, 0.07);
  const faceGeometry = new THREE.PlaneGeometry(1.186, 0.29);
  for (const sign of signs) {
    const anchor = new THREE.Group();
    anchor.position.set(sign.x, groundHeight(sign.x, sign.z) - 0.16, sign.z);
    anchor.rotation.y = sign.bearing;
    const post = new THREE.Mesh(postGeometry, wood);
    post.position.y = 0.843;
    const board = new THREE.Mesh(boardGeometry, wood);
    board.position.set(0, 1.5, 0.065);
    const face = new THREE.Mesh(faceGeometry, new THREE.MeshStandardMaterial({
      map: makeSignFace(sign.label, sign.arrow), roughness: 0.95,
    }));
    face.position.set(0, 1.5, 0.101);
    post.castShadow = board.castShadow = post.receiveShadow = board.receiveShadow = face.receiveShadow = true;
    anchor.add(post, board, face);
    group.add(anchor);
  }

  const mistGeometry = new THREE.PlaneGeometry(1, 1);
  const mist = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: false, forceSinglePass: true,
    uniforms: { uMistTime: time, uTint: { value: new THREE.Color(0xbcdae3) } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vMistPoint;
      void main() {
        vUv = uv;
        vMistPoint = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vMistPoint, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uMistTime;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying vec3 vMistPoint;
      ${coastNoise}
      void main() {
        vec2 point = 2.0 * vUv - 1.0;
        vec2 drift = vec2(uMistTime * 0.025, -uMistTime * 0.015);
        float shape = 1.0 - smoothstep(0.27, 0.97, length(point));
        float threads = coastNoise(point * vec2(3.4, 5.6) + drift);
        float curl = coastNoise(point * vec2(9.1, 7.4) - drift * 1.48);
        vec3 ray = cameraPosition - vMistPoint;
        float distance = length(ray);
        float slant = 1.0 - smoothstep(0.09, 0.62, abs(ray.y) / max(distance, 1.0));
        float opacity = shape * smoothstep(0.19, 0.74, 0.73 * threads + 0.27 * curl)
          * smoothstep(32.0, 141.0, distance) * (0.07 + 0.093 * slant);
        gl_FragColor = vec4(uTint, opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  for (const [x, y, z, width, length] of [
    [67, 91, 1048, 335, 205], [170, 102, 1115, 404, 229], [203, 119, 1218, 536, 239],
  ]) {
    const bank = new THREE.Mesh(mistGeometry, mist);
    bank.rotation.x = -Math.PI / 2;
    bank.position.set(x, y, z);
    bank.scale.set(width, length, 1);
    bank.renderOrder = 2;
    group.add(bank);
  }
  return group;
}
