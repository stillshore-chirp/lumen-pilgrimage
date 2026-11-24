import { Light, type Camera, type Scene, type WebGLRenderer } from 'three';

type Program = NonNullable<WebGLRenderer['info']['programs']>[number];
const MAX_PREPARATION_IDLE_MS = 5_000;

export class ResidenceShaderPreparation {
  private readonly gl: WebGLRenderingContext | WebGL2RenderingContext;
  private readonly lights: readonly Light[];
  private parallel: KHR_parallel_shader_compile | null = null;
  private readonly prepared = new Set<string>();
  private signature: string | undefined;
  private queue: Program[] = [];
  private ready = false;
  private deadline = 0;

  constructor(private readonly renderer: WebGLRenderer, private readonly scene: Scene) {
    this.gl = renderer.getContext();
    this.lights = scene.children.filter(object => object instanceof Light);
    this.reset();
  }

  get pending(): boolean { return !this.ready; }

  reset(): void {
    this.parallel = this.gl.isContextLost() ? null : this.gl.getExtension('KHR_parallel_shader_compile');
    this.prepared.clear();
    this.signature = undefined;
    this.queue = [];
    this.ready = false;
  }

  advance(camera: Camera): void {
    // Without the completion query, the driver can block while reflecting a program.
    // Keep those waits on the flat display before allowing a new immersive session.
    if (this.gl.isContextLost() || (this.renderer.xr.isPresenting && !this.parallel)) return;
    const target = this.renderer.getRenderTarget();
    const lights = this.lights.map(light => {
      if (!light.visible || !light.layers.test(camera.layers)) return 0;
      return light.castShadow ? 2 : 1;
    }).join('');
    const signature = [target?.texture.colorSpace ?? this.renderer.outputColorSpace, this.renderer.toneMapping,
      this.renderer.shadowMap.enabled, this.renderer.shadowMap.type, lights].join(':');
    try {
      if (signature !== this.signature) {
        this.signature = signature;
        this.ready = this.prepared.has(signature);
        if (!this.ready) this.prepare(camera);
      }
      if (this.ready) return;
      if (performance.now() >= this.deadline) {
        this.queue = [];
        this.ready = true;
        return;
      }
      const program = this.queue.shift();
      if (program?.program instanceof WebGLProgram) {
        if (this.parallel && !this.gl.getProgramParameter(program.program, this.parallel.COMPLETION_STATUS_KHR)) {
          this.queue.push(program);
          return;
        }
        // Three r184 defers shader diagnostics and uniform and attribute discovery
        // until getUniforms() or getAttributes() runs for the first time.
        program.getUniforms();
        this.deadline = performance.now() + MAX_PREPARATION_IDLE_MS;
      }
      if (this.queue.length === 0) {
        this.prepared.add(signature);
        this.ready = true;
      }
    } catch {
      this.queue = [];
      this.ready = true;
      console.warn('Residence VR shader preparation could not finish.');
    }
  }

  private prepare(camera: Camera): void {
    const known = new Set(this.renderer.info.programs);
    const outstanding = new Set(this.queue);
    this.renderer.compile(this.scene, camera);
    this.deadline = performance.now() + MAX_PREPARATION_IDLE_MS;
    this.queue = (this.renderer.info.programs ?? []).filter(program => !known.has(program) || outstanding.has(program));
  }
}
