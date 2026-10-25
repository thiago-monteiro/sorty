/**
 * Raw WebXR camera capture for the metric + VLM agent.
 *
 * `capture` must be called synchronously from an XR animation frame. It reads
 * the real `XRView.camera` texture exposed by the optional `camera-access`
 * feature, blits it through a quad shader into a private RGBA8 framebuffer,
 * and encodes a bounded JPEG. It never reads the AR canvas and never invents
 * a screen/DPR crop: the camera image is guaranteed by the Raw Camera Access
 * spec to be aligned with the XRView frustum, so the whole texture is sampled.
 *
 * Three's WebGLState caches bindings. This module restores the raw GL state it
 * changes, but after capture the caller should still call
 * `renderer.state.reset()` before the next Three render in the same frame.
 */

import { CAPTURE_JPEG_QUALITY, fitFrame } from "../scene/camera";

declare global {
  interface XRCamera {
    readonly width: number;
    readonly height: number;
  }
  interface XRView {
    readonly camera?: XRCamera | null;
  }
  interface XRWebGLBinding {
    getCameraImage(camera: XRCamera): WebGLTexture | null;
  }
}

export type CapturedView = {
  image: string;
  width: number;
  height: number;
  cameraWorld: number[];
  projection: number[];
  capturedAt: number;
};

type CameraCapture = {
  capture(
    frame: XRFrame,
    view: XRView,
    reference: XRReferenceSpace,
  ): CapturedView | null;
  dispose(): void;
};

type BindingCtor = new (
  session: XRSession,
  context: WebGLRenderingContext,
) => XRWebGLBinding;

const MAX_EDGE = 960;
/** Bound the reported source used for aspect math; the destination is <= 960. */
const MAX_SOURCE_EDGE = 1920;

const VERTEX_SOURCE = `#version 300 es
out vec2 vUv;
void main() {
  // One oversized triangle; gl_VertexID avoids touching vertex buffers.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D uCamera;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 camera = texture(uCamera, vUv);
  // The spec requires premultiplied alpha when the camera texture has alpha.
  vec3 rgb = camera.a < 1.0
    ? camera.rgb / max(camera.a, 0.0001)
    : camera.rgb;
  outColor = vec4(rgb, 1.0);
}`;

type SavedGLState = {
  drawFramebuffer: WebGLFramebuffer | null;
  readFramebuffer: WebGLFramebuffer | null;
  viewport: Int32Array;
  program: WebGLProgram | null;
  activeTexture: number;
  texture0: WebGLTexture | null;
  sampler0: WebGLSampler | null;
  vao: WebGLVertexArrayObject | null;
  arrayBuffer: WebGLBuffer | null;
  pixelPackBuffer: WebGLBuffer | null;
  packAlignment: number;
  packRowLength: number;
  packSkipPixels: number;
  packSkipRows: number;
  colorMask: boolean[];
  enabled: [number, boolean][];
};

function saveState(gl: WebGL2RenderingContext): SavedGLState {
  const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  gl.activeTexture(gl.TEXTURE0);
  const texture0 = gl.getParameter(
    gl.TEXTURE_BINDING_2D,
  ) as WebGLTexture | null;
  const sampler0 = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
  gl.activeTexture(activeTexture);
  const caps = [
    gl.BLEND,
    gl.DEPTH_TEST,
    gl.CULL_FACE,
    gl.SCISSOR_TEST,
    gl.STENCIL_TEST,
    gl.SAMPLE_ALPHA_TO_COVERAGE,
    gl.SAMPLE_COVERAGE,
    gl.RASTERIZER_DISCARD,
  ];
  return {
    drawFramebuffer: gl.getParameter(
      gl.DRAW_FRAMEBUFFER_BINDING,
    ) as WebGLFramebuffer | null,
    readFramebuffer: gl.getParameter(
      gl.READ_FRAMEBUFFER_BINDING,
    ) as WebGLFramebuffer | null,
    viewport: new Int32Array(gl.getParameter(gl.VIEWPORT) as Int32Array),
    program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    activeTexture,
    texture0,
    sampler0,
    vao: gl.getParameter(
      gl.VERTEX_ARRAY_BINDING,
    ) as WebGLVertexArrayObject | null,
    arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
    pixelPackBuffer: gl.getParameter(
      gl.PIXEL_PACK_BUFFER_BINDING,
    ) as WebGLBuffer | null,
    packAlignment: gl.getParameter(gl.PACK_ALIGNMENT) as number,
    packRowLength: gl.getParameter(gl.PACK_ROW_LENGTH) as number,
    packSkipPixels: gl.getParameter(gl.PACK_SKIP_PIXELS) as number,
    packSkipRows: gl.getParameter(gl.PACK_SKIP_ROWS) as number,
    colorMask: Array.from(
      gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
    ),
    enabled: caps.map((cap) => [cap, gl.isEnabled(cap)] as [number, boolean]),
  };
}

function restoreState(gl: WebGL2RenderingContext, state: SavedGLState): void {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.readFramebuffer);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.drawFramebuffer);
  gl.viewport(
    state.viewport[0],
    state.viewport[1],
    state.viewport[2],
    state.viewport[3],
  );
  gl.useProgram(state.program);
  gl.bindVertexArray(state.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, state.pixelPackBuffer);
  gl.pixelStorei(gl.PACK_ALIGNMENT, state.packAlignment);
  gl.pixelStorei(gl.PACK_ROW_LENGTH, state.packRowLength);
  gl.pixelStorei(gl.PACK_SKIP_PIXELS, state.packSkipPixels);
  gl.pixelStorei(gl.PACK_SKIP_ROWS, state.packSkipRows);
  gl.colorMask(
    state.colorMask[0],
    state.colorMask[1],
    state.colorMask[2],
    state.colorMask[3],
  );
  for (const [cap, enabled] of state.enabled) {
    if (enabled) gl.enable(cap);
    else gl.disable(cap);
  }
  // The saved texture/sampler binding belongs to unit 0, not the saved active
  // unit. Restore it while unit 0 is active, then restore the active unit.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.texture0);
  gl.bindSampler(0, state.sampler0);
  gl.activeTexture(state.activeTexture);
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create an XR camera shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(`XR camera shader failed to compile: ${log}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  let fragment: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  try {
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
    program = gl.createProgram();
    if (!program) throw new Error("Could not create an XR camera program.");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "unknown link error";
      throw new Error(`XR camera program failed to link: ${log}`);
    }
    return program;
  } catch (error) {
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }
}

/** Fit the camera image into the bounded capture size without cropping it. */
function captureSize(camera: XRCamera): { width: number; height: number } {
  const width = camera.width;
  const height = camera.height;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("XR camera image has invalid dimensions.");
  }
  // Only the aspect ratio matters; never allocate a source-sized buffer.
  const scale = Math.min(1, MAX_SOURCE_EDGE / Math.max(width, height));
  return fitFrame(width * scale, height * scale, MAX_EDGE);
}

function flipPixelsY(
  pixels: Uint8Array,
  width: number,
  height: number,
): void {
  const rowBytes = width * 4;
  const row = new Uint8Array(rowBytes);
  for (let y = 0; y < height >> 1; y++) {
    const top = y * rowBytes;
    const bottom = (height - 1 - y) * rowBytes;
    row.set(pixels.subarray(top, top + rowBytes));
    pixels.copyWithin(top, bottom, bottom + rowBytes);
    pixels.set(row, bottom);
  }
}

function isBlack(pixels: Uint8Array): boolean {
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] || pixels[i + 1] || pixels[i + 2]) return false;
  }
  return true;
}

function encodeJpeg(
  pixels: Uint8Array,
  width: number,
  height: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas is unavailable; cannot encode XR camera frame.");
  }
  const image = new ImageData(new Uint8ClampedArray(pixels), width, height);
  context.putImageData(image, 0, 0);
  const url = canvas.toDataURL("image/jpeg", CAPTURE_JPEG_QUALITY);
  if (!url.startsWith("data:image/jpeg")) {
    throw new Error("Could not encode the XR camera frame as JPEG.");
  }
  return url;
}

/**
 * Create a capture object for one WebGL2 context.
 *
 * The parent session must have requested the optional `camera-access` feature.
 * The returned object is synchronous and single-use per frame; call `dispose`
 * when the XR session ends.
 */
export function createXRCameraCapture(
  gl: WebGL2RenderingContext,
): CameraCapture {
  const program = createProgram(gl);
  const vao = gl.createVertexArray();
  const framebuffer = gl.createFramebuffer();
  const target = gl.createTexture();
  const uniform = gl.getUniformLocation(program, "uCamera");
  if (!vao || !framebuffer || !target || !uniform) {
    if (vao) gl.deleteVertexArray(vao);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    if (target) gl.deleteTexture(target);
    gl.deleteProgram(program);
    throw new Error("Could not allocate WebGL resources for XR camera capture.");
  }

  const setup = saveState(gl);
  try {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target);
    // ponytail: one fixed 960x960 target (<=3.7 MB); per-size targets if
    // allocation matters.
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, MAX_EDGE, MAX_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      target,
      0,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `XR camera framebuffer is incomplete (0x${status.toString(16)}).`,
      );
    }
  } catch (error) {
    restoreState(gl, setup);
    gl.deleteVertexArray(vao);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(target);
    gl.deleteProgram(program);
    throw error;
  }
  restoreState(gl, setup);

  let disposed = false;
  let binding: XRWebGLBinding | null = null;
  let bindingSession: XRSession | null = null;

  return {
    capture(frame, view, reference) {
      if (disposed) {
        throw new Error("XR camera capture has been disposed.");
      }
      // Matrices from XRView are already relative to the caller's reference
      // space; the reference is accepted for API symmetry and future checks.
      void reference;

      let camera: XRCamera | null | undefined;
      try {
        camera = view.camera;
      } catch (error) {
        throw new Error(
          "XR camera access requires an active animation frame.",
          { cause: error },
        );
      }
      if (!camera) return null;

      const size = captureSize(camera);
      const cameraWorld = Array.from(view.transform.matrix);
      const projection = Array.from(view.projectionMatrix);
      if (
        cameraWorld.length !== 16 ||
        projection.length !== 16 ||
        !cameraWorld.every(Number.isFinite) ||
        !projection.every(Number.isFinite)
      ) {
        throw new Error("XR view has invalid camera or projection matrices.");
      }

      if (!binding || bindingSession !== frame.session) {
        const Binding = (
          globalThis as typeof globalThis & {
            XRWebGLBinding?: BindingCtor;
          }
        ).XRWebGLBinding;
        if (!Binding) return null;
        try {
          binding = new Binding(
            frame.session,
            gl as unknown as WebGLRenderingContext,
          );
        } catch (error) {
          throw new Error(
            "Could not create XRWebGLBinding for raw camera access.",
            { cause: error },
          );
        }
        bindingSession = frame.session;
      }
      if (typeof binding.getCameraImage !== "function") return null;

      let cameraTexture: WebGLTexture | null;
      try {
        cameraTexture = binding.getCameraImage(camera);
      } catch (error) {
        throw new Error("XR camera image is unavailable for this frame.", {
          cause: error,
        });
      }
      if (!cameraTexture) return null;

      const { width, height } = size;
      const pixels = new Uint8Array(width * height * 4);
      const state = saveState(gl);
      let capturedAt: number;
      try {
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        gl.disable(gl.SAMPLE_COVERAGE);
        gl.disable(gl.RASTERIZER_DISCARD);
        gl.colorMask(true, true, true, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(0, 0, width, height);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
        gl.pixelStorei(gl.PACK_ROW_LENGTH, 0);
        gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0);
        gl.pixelStorei(gl.PACK_SKIP_ROWS, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindSampler(0, null);
        gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        gl.uniform1i(uniform, 0);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error(
            `XR camera framebuffer is incomplete (0x${status.toString(16)}).`,
          );
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(
          0,
          0,
          width,
          height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        capturedAt = performance.now();
        // ponytail: reject all-black readback instead of sending a fake frame;
        // a genuinely black camera image is treated as unavailable.
        if (isBlack(pixels)) {
          throw new Error(
            "XR camera capture produced a black frame; the camera image is unavailable.",
          );
        }
      } finally {
        restoreState(gl, state);
      }

      // readPixels is bottom-up; ImageData and canvas are top-down.
      flipPixelsY(pixels, width, height);
      return {
        image: encodeJpeg(pixels, width, height),
        width,
        height,
        cameraWorld,
        projection,
        capturedAt,
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      binding = null;
      bindingSession = null;
      gl.deleteVertexArray(vao);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(target);
      gl.deleteProgram(program);
    },
  };
}
