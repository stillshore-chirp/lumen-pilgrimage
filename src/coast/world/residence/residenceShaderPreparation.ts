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
  private preparationState: 'pending' | 'ready' | 'failed' = 'pending';
  private deadline = 0;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;

  constructor(renderer: WebGLRenderer, scene: Scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.gl = renderer.getContext();
    this.lights = scene.children.filter(object => object instanceof Light);
    this.reset();
  }

  get state(): 'pending' | 'ready' | 'failed' { return this.preparationState; }

  get pending(): boolean { return this.preparationState === 'pending'; }

  reset(): void {
    this.prepared.clear();
    this.signature = undefined;
    this.queue = [];
    this.preparationState = 'pending';
    try {
      this.parallel = this.gl.isContextLost() ? null : this.gl.getExtension('KHR_parallel_shader_compile');
    } catch {
      this.preparationState = 'failed';
    }
  }

  advance(camera: Camera): void {
    // Without the completion query, the driver can block while reflecting a program.
    // Keep those waits on the flat display before allowing a new immersive session.
    if (this.preparationState === 'failed' || this.gl.isContextLost()
      || (this.renderer.xr.isPresenting && !this.parallel)) return;
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
        this.preparationState = this.prepared.has(signature) ? 'ready' : 'pending';
        if (this.pending) this.prepare(camera);
      }
      if (!this.pending) return;
      if (performance.now() >= this.deadline) {
        this.queue = [];
        this.preparationState = 'failed';
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
        this.preparationState = 'ready';
      }
    } catch {
      this.queue = [];
      this.preparationState = 'failed';
    }
  }

  private prepare(camera: Camera): void {
    this.renderer.compile(this.scene, camera);
    this.deadline = performance.now() + MAX_PREPARATION_IDLE_MS;
    // A failed attempt can leave linked programs whose first-use reflection never
    // completed. Revisit cached programs too; completed getUniforms() calls are cheap.
    this.queue = [...(this.renderer.info.programs ?? [])];
  }
}
