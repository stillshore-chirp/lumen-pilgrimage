import * as THREE from 'three';
import { COAST_FALLS, SEA_LEVEL, coastRandom, groundHeight, groundSlope } from './terrain';
import { createCoastOceanMaterial } from './world/coastOcean';
import { createCoastSky } from './world/coastSky';
import { createCoastTerrain, loadCoastTexture } from './world/coastSurface';
import { createCoastVegetation } from './world/coastVegetation';
import { createWaterfalls } from './world/coastWaterfall';

export type CoastQuality = 'light' | 'high';

function createShoreRocks(stone: THREE.Texture): THREE.Group {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const fracture = 0.83 + 0.14*Math.sin(x*7.6 + y*7.9 + z*3.3) + 0.12*Math.cos(z*8.3 - y*6.7);
    positions.setXYZ(i, x*fracture + 0.18*y, Math.max(-0.59, Math.min(0.78, y*fracture)), z*fracture);
    const moss = THREE.MathUtils.smoothstep(y, 0.13, 0.76) * (0.6 + 0.4*Math.sin(x*6.2 + z*4.2));
    const wet = THREE.MathUtils.smoothstep(y, -0.63, -0.06);
    colors.set([0.72 + wet*0.23 - moss*0.37, 0.75 + wet*0.22 - moss*0.07, 0.78 + wet*0.16 - moss*0.43], i*3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    map: stone, vertexColors: true, roughness: 0.82, bumpMap: stone, bumpScale: 0.31,
  });
  const random = coastRandom(75782);
  const props = new THREE.Group();
  props.name = 'Broken rock and moss at the tide line';
  const clusters = [
    { x: -29, z: 65, width: 2.8, pieces: 9 },
    { x: 7, z: 77, width: 3.1, pieces: 9 },
    { x: -49, z: 45, width: 7.5, pieces: 15 },
    { x: 39, z: 65, width: 5.2, pieces: 15 },
    { x: -39, z: 25, width: 4.9, pieces: 13 },
    { x: 39, z: 21, width: 6.4, pieces: 16 },
    { x: 48, z: 43, width: 6.2, pieces: 12 },
    { x: 47, z: -6, width: 6.5, pieces: 13 },
    { x: -73, z: 10, width: 7.8, pieces: 16 },
    { x: -65, z: -48, width: 8.9, pieces: 18 },
    { x: 89, z: -52, width: 8.8, pieces: 17 },
  ];
  for (const cluster of clusters) {
    const instance = new THREE.InstancedMesh(geometry, material, cluster.pieces);
    const transform = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < cluster.pieces; i += 1) {
      const angle = random()*Math.PI*2;
      const size = cluster.width * (i === 0 ? 0.67 : 0.05+random()*random()*0.52);
      const radius = cluster.width * (i === 0 ? 0 : 0.32+random()*1.94);
      const x = cluster.x + Math.cos(angle)*radius;
      const z = cluster.z + Math.sin(angle)*radius;
      if (groundSlope(x, z) > 1.1 || groundHeight(x, z) < -3.4) continue;
      const height = 0.37 + random()*0.58;
      transform.position.set(x, groundHeight(x, z) + size*height*0.06, z);
      transform.rotation.set((random()-0.5)*0.40, random()*Math.PI*2, (random()-0.5)*0.45);
      transform.scale.set(size*(0.8+random()*0.62), size*height, size*(0.69+random()*0.66));
      transform.updateMatrix();
      instance.setMatrixAt(placed++, transform.matrix);
    }
    if (placed === 0) continue;
    instance.count = placed;
    instance.castShadow = instance.receiveShadow = true;
    props.add(instance);
  }
  return props;
}

function createSeabirds(): { mesh: THREE.InstancedMesh; update: (elapsed: number) => void } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0,0,0.33, -0.21,0,-0.39, 0,0,-0.15,
    0,0,0.33, 0,0,-0.15, 0.21,0,-0.39,
    -0.07,0,-0.10, -0.49,0.08,0.02, -1.02,0.06,-0.38,
    -0.07,0,-0.10, -1.02,0.06,-0.38, -0.33,0,-0.29,
    0.07,0,-0.10, 1.02,0.06,-0.38, 0.49,0.08,0.02,
    0.07,0,-0.10, 0.33,0,-0.29, 1.02,0.06,-0.38,
  ], 3));
  const time = { value: 0 };
  const material = new THREE.MeshBasicMaterial({ color: 0xf5f5df, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    shader.uniforms.uFlightTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFlightTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float flap = sin(uFlightTime*6.8 + float(gl_InstanceID)*2.399);
        transformed.y += abs(position.x)*flap*0.42;
      `);
  };
  const flocks = [
    { x: -56, z: -125, y: 29, radius: 37, count: 14, size: 0.65 },
    { x: 39, z: -287, y: 68, radius: 66, count: 16, size: 0.93 },
  ];
  const mesh = new THREE.InstancedMesh(geometry, material, flocks.reduce((total, flock) => total+flock.count, 0));
  mesh.name = 'Seabird flocks';
  mesh.frustumCulled = false;
  const shape = new THREE.Object3D();
  return {
    mesh,
    update(elapsed) {
      time.value = elapsed;
      let index = 0;
      for (const flock of flocks) {
        const angle = elapsed*0.069 + flock.x;
        for (let bird = 0; bird < flock.count; bird += 1) {
          const phase = angle + bird*0.057 + 0.11*Math.sin(bird*8.69);
          const radius = flock.radius + bird*0.91 + 6*Math.sin(bird*2.399);
          shape.position.set(flock.x + Math.cos(phase)*radius, flock.y + 6.3*Math.sin(phase*0.74+bird*1.34),
            flock.z + Math.sin(phase)*radius);
          shape.rotation.set(0.07, -phase, Math.sin(phase+bird)*0.15);
          shape.scale.setScalar(flock.size * (0.66+0.40*Math.sin(bird*3.17)**2));
          shape.updateMatrix();
          mesh.setMatrixAt(index++, shape.matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

export class CoastWorld {
  readonly scene = new THREE.Scene();
  private readonly time = { value: 0 };
  private readonly sun: THREE.DirectionalLight;
  private readonly sky: ReturnType<typeof createCoastSky>;
  private readonly waterfalls: ReturnType<typeof createWaterfalls>;
  private readonly seabirds = createSeabirds();
  private quality: CoastQuality | undefined;
  private lastShadow = 0;

  constructor() {
    this.scene.fog = new THREE.Fog(0xa6d0e8, 135, 854);
    const sunDirection = new THREE.Vector3(0.46, 0.70, 0.58).normalize();
    this.sky = createCoastSky(sunDirection);
    this.scene.add(this.sky.dome, this.sky.clouds);

    this.scene.add(new THREE.HemisphereLight(0xd9eeff, 0x718b8e, 1.72));
    this.scene.add(new THREE.AmbientLight(0xf4f9ed, 0.27));
    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.8);
    this.sun.target.position.set(-8, 26, -39);
    this.sun.position.copy(this.sun.target.position).addScaledVector(sunDirection, 520);
    this.sun.castShadow = true;
    const shadow = this.sun.shadow;
    shadow.camera.left = -225;
    shadow.camera.right = 206;
    shadow.camera.top = 255;
    shadow.camera.bottom = -198;
    shadow.camera.near = 36;
    shadow.camera.far = 921;
    shadow.camera.updateProjectionMatrix();
    shadow.bias = -0.00015;
    shadow.normalBias = 0.37;
    shadow.radius = 2.8;
    shadow.autoUpdate = false;
    this.scene.add(this.sun, this.sun.target);

    const stone = loadCoastTexture('limestone.webp', true);
    const sand = loadCoastTexture('sand.webp', true);
    const canopy = loadCoastTexture('canopy.webp', true);
    this.scene.add(createCoastTerrain(stone, sand, canopy), createShoreRocks(stone));
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(4890, 4700),
      createCoastOceanMaterial(this.time, sunDirection, sand));
    ocean.name = 'Clear shoals and open sea';
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(0, SEA_LEVEL, -230);
    ocean.receiveShadow = true;
    this.scene.add(ocean, createCoastVegetation(canopy, this.time));

    this.waterfalls = createWaterfalls(COAST_FALLS, this.time);
    this.scene.add(this.waterfalls.group, this.seabirds.mesh);
    this.setQuality('light');
  }

  setQuality(quality: CoastQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    const shadow = this.sun.shadow;
    const size = quality === 'high' ? 2304 : 1152;
    shadow.map?.dispose();
    shadow.map = null;
    shadow.mapSize.set(size, size);
    shadow.needsUpdate = true;
  }

  update(elapsed: number, camera: THREE.PerspectiveCamera): void {
    this.time.value = elapsed;
    this.sky.dome.position.copy(camera.position);
    this.waterfalls.update(elapsed);
    this.seabirds.update(elapsed);
    if (this.quality === 'high' && elapsed - this.lastShadow >= 0.18) {
      this.sun.shadow.needsUpdate = true;
      this.lastShadow = elapsed;
    }
  }
}
