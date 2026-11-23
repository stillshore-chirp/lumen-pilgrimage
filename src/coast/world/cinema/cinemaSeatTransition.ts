import { MathUtils, Mesh, PlaneGeometry, ShaderMaterial, type Scene } from 'three';

const FADE_OUT_SECONDS = .11;
const FADE_IN_SECONDS = .14;

export function createCinemaSeatTransition(scene: Scene) {
  const darkness = { value: 0 };
  const cover = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
    uniforms: { darkness },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform float darkness; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, darkness); }',
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }));
  // Clip space covers each eye's viewport in WebXR as well as the desktop viewport.
  cover.name = 'Cinema seat transition';
  cover.frustumCulled = false;
  cover.renderOrder = 10_000;
  cover.visible = false;
  scene.add(cover);

  let time = 0;
  let move: (() => void) | null = null;

  return {
    get active() { return cover.visible; },
    start(relocate: () => void) {
      time = darkness.value * FADE_OUT_SECONDS;
      move = relocate;
      cover.visible = true;
    },
    update(dt: number) {
      if (!cover.visible) return;
      time += dt;
      if (move && time >= FADE_OUT_SECONDS) {
        const relocate = move;
        move = null;
        time = FADE_OUT_SECONDS;
        relocate();
      }
      darkness.value = move
        ? MathUtils.clamp(time / FADE_OUT_SECONDS, 0, 1)
        : MathUtils.clamp(1 - (time - FADE_OUT_SECONDS) / FADE_IN_SECONDS, 0, 1);
      cover.visible = move !== null || darkness.value > 0;
    },
    dispose() {
      cover.visible = false;
      cover.removeFromParent();
      cover.geometry.dispose();
      cover.material.dispose();
      move = null;
    },
  };
}
