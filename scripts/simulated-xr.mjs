export function installSimulatedXR(options = 'base') {
  const { layerType = 'base', supported = true, profile = 'meta-quest-touch-plus' } = typeof options === 'string'
    ? { layerType: options } : options;
  const fixture = {
    supported, checks: 0, requests: 0, ends: 0, xrDraws: 0, desktopDraws: 0, strayDraws: 0, frames: 0, activations: [],
    head: { x: 0, y: 1.65, z: 0, yaw: 0, pitch: 0 }, eyePoses: {},
  };
  window.xrFixture = fixture;
  const raf = window.requestAnimationFrame.bind(window);
  const cancelRaf = window.cancelAnimationFrame.bind(window);
  let presenting = false;
  let inXRFrame = false;
  let viewX = 0;

  const gl = WebGL2RenderingContext.prototype;
  const drawElements = gl.drawElements;
  gl.drawElements = function (...args) {
    if (inXRFrame) ++fixture.xrDraws;
    else if (presenting) ++fixture.strayDraws;
    else ++fixture.desktopDraws;
    return drawElements.apply(this, args);
  };
  gl.makeXRCompatible = async () => {};
  const viewport = gl.viewport;
  gl.viewport = function (x, ...rest) {
    viewX = x;
    return viewport.call(this, x, ...rest);
  };
  const locateUniform = gl.getUniformLocation;
  const setMatrix = gl.uniformMatrix4fv;
  const viewMatrices = new WeakSet();
  gl.getUniformLocation = function (program, name) {
    const location = locateUniform.call(this, program, name);
    if (name === 'viewMatrix' && location) viewMatrices.add(location);
    return location;
  };
  gl.uniformMatrix4fv = function (location, transpose, matrix, ...rest) {
    if (inXRFrame && viewMatrices.has(location) && matrix.length === 16) {
      fixture.eyePoses[viewX] = {
        x: -(matrix[0] * matrix[12] + matrix[1] * matrix[13] + matrix[2] * matrix[14]),
        y: -(matrix[4] * matrix[12] + matrix[5] * matrix[13] + matrix[6] * matrix[14]),
        z: -(matrix[8] * matrix[12] + matrix[9] * matrix[13] + matrix[10] * matrix[14]),
        yaw: Math.atan2(matrix[2], matrix[0]),
      };
    }
    return setMatrix.call(this, location, transpose, matrix, ...rest);
  };
  const fillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
    if (this.canvas.width === 960 && this.canvas.height === 680) {
      if (y === 58 && x === 34) fixture.menuTitle = text;
      if (text.startsWith('›  ')) fixture.selection = text.slice(3);
    }
    if (this.canvas.width === 960 && this.canvas.height === 104) fixture.hint = text;
    return fillText.call(this, text, x, y, ...rest);
  };
  const framebufferWidth = 640;
  const framebufferHeight = 480;
  const eyeViewport = ({ eye }) => ({ x: eye === 'left' ? 0 : 320, y: 0, width: 320, height: 480 });
  const Binding = layerType === 'projection' ? class {
    constructor(_session, context) {
      this.context = context;
    }
    createProjectionLayer({ scaleFactor, colorFormat, depthFormat }) {
      const context = this.context;
      const texture = format => {
        const result = context.createTexture();
        context.bindTexture(context.TEXTURE_2D, result);
        context.texStorage2D(context.TEXTURE_2D, 1, format, framebufferWidth, framebufferHeight);
        context.bindTexture(context.TEXTURE_2D, null);
        return result;
      };
      this.colorTexture = texture(colorFormat);
      this.depthStencilTexture = texture(depthFormat);
      fixture.scaleFactor = scaleFactor;
      return { textureWidth: framebufferWidth, textureHeight: framebufferHeight, ignoreDepthValues: true, fixedFoveation: 1 };
    }
    getViewSubImage(_layer, view) {
      return { colorTexture: this.colorTexture, depthStencilTexture: this.depthStencilTexture, viewport: eyeViewport(view) };
    }
  } : undefined;
  Object.defineProperty(window, 'XRWebGLBinding', { value: Binding, configurable: true });
  window.XRWebGLLayer = class {
    framebuffer = null;
    framebufferWidth = framebufferWidth;
    framebufferHeight = framebufferHeight;
    fixedFoveation = 1;
    constructor(_session, _context, options) {
      fixture.scaleFactor = options.framebufferScaleFactor;
    }
    getViewport(view) { return eyeViewport(view); }
  };

  const projectionMatrix = new Float32Array([
    1.3, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1.001, -1, 0, 0, -.2, 0,
  ]);

  function viewPose() {
    const { x, y, z, yaw, pitch } = fixture.head;
    const center = new DOMMatrix().translate(x, y, z)
      .rotate(0, yaw * 180 / Math.PI, 0).rotate(pitch * 180 / Math.PI, 0, 0);
    const transform = { matrix: center.toFloat32Array() };
    const views = ['left', 'right'].map((eye, index) => ({
      eye, projectionMatrix,
      transform: { matrix: center.translate(index === 0 ? -.032 : .032, 0, 0).toFloat32Array() },
    }));
    return { transform, views };
  }

  function controllerSpace(handedness) {
    const position = { x: handedness === 'left' ? -.24 : .24, y: 1.3, z: -.23 };
    const orientation = { x: 0, y: 0, z: 0, w: 1 };
    const transform = {
      position, orientation,
      get matrix() {
        const matrix = new DOMMatrix().translate(position.x, position.y, position.z);
        const { x, y, z, w } = orientation;
        const axisLength = Math.hypot(x, y, z);
        if (axisLength) matrix.rotateAxisAngleSelf(x, y, z, 2 * Math.atan2(axisLength, w) * 180 / Math.PI);
        return matrix.toFloat32Array();
      },
    };
    return { transform, emulatedPosition: false, tracked: true };
  }

  function controller(handedness) {
    return {
      handedness, targetRayMode: 'tracked-pointer', profiles: [profile],
      gamepad: {
        mapping: 'xr-standard', axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 7 }, () => ({ pressed: false, value: 0 })),
      },
      gripSpace: controllerSpace(handedness), targetRaySpace: controllerSpace(handedness),
    };
  }

  class Session extends EventTarget {
    inputSources = [controller('left'), controller('right')];
    visibilityState = 'visible';
    async requestReferenceSpace() { return new EventTarget(); }
    updateRenderState({ baseLayer, layers }) {
      fixture.layer = baseLayer ?? layers?.[0] ?? fixture.layer;
    }
    makeFrame() {
      return { session: this, getViewerPose: viewPose, getPose: space => space?.tracked === false ? null : space ?? null };
    }
    dispatchInput(type, inputSource) {
      const frame = this.makeFrame();
      if (type.startsWith('squeeze')) {
        frame.getViewerPose = () => { throw new DOMException('', 'InvalidStateError'); };
      }
      this.dispatchEvent(Object.assign(new Event(type), { inputSource, frame }));
    }
    requestAnimationFrame(callback) {
      return raf(time => {
        presenting = inXRFrame = true;
        try {
          callback(time, this.makeFrame());
          ++fixture.frames;
        } finally {
          inXRFrame = false;
        }
      });
    }
    cancelAnimationFrame(id) { cancelRaf(id); }
    async end() {
      ++fixture.ends;
      presenting = false;
      this.dispatchEvent(new Event('end'));
    }
  }

  fixture.mutate = async change => {
    const { session } = fixture;
    const source = session?.inputSources.find(({ handedness }) => handedness === change.side);
    if (change.axes) source.gamepad.axes.splice(2, 2, ...change.axes);
    if (change.button !== undefined) source.gamepad.buttons[change.button] = {
      pressed: change.pressed, value: Number(change.pressed),
    };
    for (const name of ['gripSpace', 'targetRaySpace']) {
      const pose = change[name];
      if (!pose) continue;
      const space = source[name];
      if (pose.tracked !== undefined) space.tracked = pose.tracked;
      Object.assign(space.transform.position, pose.position);
      Object.assign(space.transform.orientation, pose.orientation);
    }
    if (change.select) session.dispatchInput('select', session.inputSources[1]);
    if (change.squeeze !== undefined) {
      source.gamepad.buttons[1] = { pressed: change.squeeze, value: Number(change.squeeze) };
      if (!change.squeeze) session.dispatchInput('squeeze', source);
      session.dispatchInput(change.squeeze ? 'squeezestart' : 'squeezeend', source);
    }
    if (change.head) Object.assign(fixture.head, change.head);
    if (change.visibility) {
      session.visibilityState = change.visibility;
      session.dispatchEvent(new Event('visibilitychange'));
    }
    const before = fixture.frames;
    if (!change.select) {
      while (fixture.frames < before + (change.frames ?? 2)) await new Promise(raf);
    }
  };

  const xr = new EventTarget();
  xr.isSessionSupported = async () => {
    ++fixture.checks;
    return fixture.supported;
  };
  xr.requestSession = async (mode, features) => {
    ++fixture.requests;
    fixture.features = { mode, ...features };
    fixture.activations.push(navigator.userActivation.isActive);
    if (fixture.denyNext) {
      fixture.denyNext = false;
      throw new DOMException('', 'NotAllowedError');
    }
    return fixture.session = new Session();
  };
  Object.defineProperty(navigator, 'xr', { value: xr });
}
