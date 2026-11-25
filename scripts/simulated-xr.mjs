export function installSimulatedXR() {
  const fixture = {
    requests: 0, ends: 0, xrDraws: 0, desktopDraws: 0, strayDraws: 0, frames: 0, activations: [],
    head: { x: 0, y: 1.65, z: 0, yaw: 0 }, eyePoses: {},
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
  Object.defineProperty(window, 'XRWebGLBinding', { value: undefined, configurable: true });
  window.XRWebGLLayer = class {
    framebuffer = null;
    framebufferWidth = 640;
    framebufferHeight = 480;
    getViewport({ eye }) {
      return { x: eye === 'left' ? 0 : 320, y: 0, width: 320, height: 480 };
    }
  };

  const projectionMatrix = new Float32Array([
    1.3, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1.001, -1, 0, 0, -.2, 0,
  ]);

  function viewPose() {
    const { x, y, z, yaw } = fixture.head;
    const center = new DOMMatrix().translate(x, y, z).rotate(0, yaw * 180 / Math.PI, 0);
    const transform = { matrix: center.toFloat32Array() };
    const views = ['left', 'right'].map((eye, index) => ({
      eye, projectionMatrix,
      transform: { matrix: center.translate(index === 0 ? -.032 : .032, 0, 0).toFloat32Array() },
    }));
    return { transform, views };
  }

  function controller(handedness) {
    const transform = {
      position: { x: handedness === 'left' ? -.24 : .24, y: 1.3, z: -.23 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
    const space = { transform, emulatedPosition: false };
    return {
      handedness, targetRayMode: 'tracked-pointer', profiles: ['meta-quest-touch-plus'],
      gamepad: {
        mapping: 'xr-standard', axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 7 }, () => ({ pressed: false, value: 0 })),
      },
      gripSpace: space, targetRaySpace: space,
    };
  }

  class Session extends EventTarget {
    inputSources = [controller('left'), controller('right')];
    visibilityState = 'visible';
    async requestReferenceSpace() { return new EventTarget(); }
    updateRenderState() {}
    makeFrame() {
      return { session: this, getViewerPose: viewPose, getPose: space => space };
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
    if (change.select) session.dispatchEvent(Object.assign(new Event('select'), {
      inputSource: session.inputSources[1], frame: session.makeFrame(),
    }));
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
  xr.isSessionSupported = async () => true;
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
