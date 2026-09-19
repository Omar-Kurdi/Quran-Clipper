/**
 * The background blur, on the GPU -- where that is actually faster.
 *
 * Whether `ctx.filter = 'blur(…)'` is expensive depends on how the browser
 * draws 2D canvases, which is not something a page can ask. Measured at
 * 1080x1920 on one machine (RTX 5080), one frame's blur, filter vs this:
 *
 *   2D canvas drawn on the GPU (ANGLE/OpenGL)   0.4-0.5 ms   vs 0.6-0.8 ms
 *   2D canvas drawn on the CPU (ANGLE/Vulkan)   10-13 ms     vs 4.6-11 ms
 *   no GPU at all (SwiftShader)                 12-93 ms     vs 9-163 ms
 *
 * So neither path wins everywhere, and this does not guess: `blurPath` times
 * both once, on first use, and the frame uses whichever was faster here. Where
 * it is this one, the background is drawn cover-fitted into a texture, blurred
 * horizontally then vertically, and handed back as a canvas the 2D frame draws
 * like any other image. The two agree to within a level or so of 255 inside
 * the frame.
 *
 * Large radii are blurred at reduced resolution. A Gaussian with a standard
 * deviation of 40 px has nothing finer than a few pixels left in it, so
 * rendering it at a quarter of the size and scaling up loses nothing visible
 * and keeps every pass under `MAX_TAPS` samples each side.
 *
 * Edges are clamped, not faded. The CSS filter samples transparency past the
 * canvas edge, so a blurred full-bleed background used to darken towards the
 * frame's border; here the edge pixels extend instead. Preview and export both
 * go through this, so they still match each other.
 *
 * Anything unusual -- no WebGL, a lost context, a source the GPU cannot read --
 * returns null, and the caller draws with the 2D filter as before.
 */

/** Samples each side of the centre in one pass; the shader's loop bound. */
export const MAX_TAPS = 24;

/**
 * How much to shrink before blurring a Gaussian of `sigma` pixels, so the
 * kernel (three standard deviations each side) fits in `MAX_TAPS`.
 */
export function blurScale(sigma: number): number {
  return Math.max(1, Math.ceil((sigma * 3) / MAX_TAPS));
}

/**
 * One side of a normalised Gaussian kernel, centre first: `weights[0]` for the
 * centre sample, `weights[i]` for each of the two samples `i` away.
 */
export function gaussianWeights(sigma: number): number[] {
  const radius = Math.min(MAX_TAPS, Math.max(1, Math.ceil(sigma * 3)));
  const raw = Array.from({ length: radius + 1 }, (_, i) => Math.exp(-(i * i) / (2 * sigma * sigma)));
  const total = raw[0] + 2 * raw.slice(1).reduce((sum, w) => sum + w, 0);
  return raw.map(w => w / total);
}

/**
 * Texture coordinates across a 1080-pixel frame need more than mediump's ten
 * bits to address single pixels, so fragments ask for highp wherever the GPU
 * has it.
 */
const VERTEX = `
attribute vec2 a_pos;
uniform vec4 u_rect;
varying vec2 v_uv;
void main() {
  v_uv = a_pos;
  vec2 p = u_rect.xy + a_pos * u_rect.zw;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}`;

const COPY = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_tex;
varying vec2 v_uv;
void main() { gl_FragColor = texture2D(u_tex, v_uv); }`;

const BLUR = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_tex;
uniform vec2 u_step;
uniform float u_weights[${MAX_TAPS + 1}];
uniform int u_radius;
varying vec2 v_uv;
void main() {
  vec4 sum = texture2D(u_tex, v_uv) * u_weights[0];
  for (int i = 1; i <= ${MAX_TAPS}; i++) {
    if (i > u_radius) break;
    vec2 offset = u_step * float(i);
    sum += (texture2D(u_tex, v_uv + offset) + texture2D(u_tex, v_uv - offset)) * u_weights[i];
  }
  gl_FragColor = sum;
}`;

type Canvas = OffscreenCanvas | HTMLCanvasElement;
type GL = WebGLRenderingContext;

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

function compile(gl: GL, vertex: string, fragment: string): WebGLProgram | null {
  const program = gl.createProgram();
  const shaders = ([[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const).map(([kind, text]) => {
    const shader = gl.createShader(kind)!;
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    return shader;
  });
  if (!program || shaders.some(shader => !gl.getShaderParameter(shader, gl.COMPILE_STATUS))) return null;
  shaders.forEach(shader => gl.attachShader(program, shader));
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

function makeTexture(gl: GL): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export class GlBlur {
  private readonly canvas: Canvas;
  private readonly gl: GL;
  private readonly copy: WebGLProgram;
  private readonly blur: WebGLProgram;
  private readonly source: WebGLTexture;
  private targets: Target[] = [];
  private size = { width: 0, height: 0 };

  private constructor(canvas: Canvas, gl: GL, copy: WebGLProgram, blur: WebGLProgram) {
    this.canvas = canvas;
    this.gl = gl;
    this.copy = copy;
    this.blur = blur;
    this.source = makeTexture(gl);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  }

  /** A blurrer, or null where this browser offers no WebGL. */
  static create(): GlBlur | null {
    try {
      const canvas: Canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(2, 2)
        : Object.assign(document.createElement('canvas'), { width: 2, height: 2 });
      // Kept, so the 2D frame can read the result after this call returns.
      const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false }) as GL | null;
      if (!gl) return null;
      const copy = compile(gl, VERTEX, COPY);
      const blur = compile(gl, VERTEX, BLUR);
      return copy && blur ? new GlBlur(canvas, gl, copy, blur) : null;
    } catch {
      return null;
    }
  }

  private resize(width: number, height: number) {
    if (this.size.width === width && this.size.height === height) return;
    const { gl } = this;
    for (const target of this.targets) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    this.targets = [0, 1].map(() => {
      const texture = makeTexture(gl);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return { texture, framebuffer };
    });
    this.canvas.width = width;
    this.canvas.height = height;
    this.size = { width, height };
  }

  private run(program: WebGLProgram, texture: WebGLTexture, into: WebGLFramebuffer | null, rect: [number, number, number, number]) {
    const { gl } = this;
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, into);
    gl.viewport(0, 0, this.size.width, this.size.height);
    const position = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4fv(gl.getUniformLocation(program, 'u_rect'), rect);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private pass(from: WebGLTexture, into: WebGLFramebuffer | null, step: [number, number], weights: number[]) {
    const { gl } = this;
    gl.useProgram(this.blur);
    gl.uniform2fv(gl.getUniformLocation(this.blur, 'u_step'), step);
    const padded = new Float32Array(MAX_TAPS + 1);
    padded.set(weights);
    gl.uniform1fv(gl.getUniformLocation(this.blur, 'u_weights'), padded);
    gl.uniform1i(gl.getUniformLocation(this.blur, 'u_radius'), weights.length - 1);
    this.run(this.blur, from, into, [0, 0, 1, 1]);
  }

  /**
   * `source` cover-fitted into a `width` x `height` frame and blurred by a
   * Gaussian of `sigma` output pixels. The returned canvas is smaller than the
   * frame for large blurs; draw it stretched to `width` x `height`.
   *
   * `rect` is where the source lands in the frame, as fractions: the cover
   * fit the 2D path computes, so both paths frame the picture identically.
   */
  blurCover(
    source: TexImageSource,
    width: number,
    height: number,
    rect: [number, number, number, number],
    sigma: number
  ): Canvas | null {
    const { gl } = this;
    if (gl.isContextLost()) return null;
    try {
      const scale = blurScale(sigma);
      const w = Math.max(1, Math.round(width / scale));
      const h = Math.max(1, Math.round(height / scale));
      this.resize(w, h);
      gl.bindTexture(gl.TEXTURE_2D, this.source);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      const [a, b] = this.targets;
      this.run(this.copy, this.source, a.framebuffer, rect);
      const weights = gaussianWeights(sigma / scale);
      this.pass(a.texture, b.framebuffer, [1 / w, 0], weights);
      this.pass(b.texture, null, [0, 1 / h], weights);
      return gl.getError() === gl.NO_ERROR ? this.canvas : null;
    } catch {
      return null;
    }
  }
}

/** Which blur this browser does faster, decided once per page. */
let chosen: { path: 'gpu' | '2d'; blur: GlBlur | null } | undefined;

/** Median milliseconds of `runs` calls to `fn`, after one to warm up. */
function timed(fn: () => void, flush: () => void, runs = 5): number {
  fn();
  flush();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    flush();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

/**
 * The GPU blurrer if it is the faster way to blur in this browser, else null.
 *
 * Measured on a half-size frame with a representative blur, the same way the
 * frame will use it -- the 2D filter drawn into a 2D canvas, against this
 * drawn into one -- and reading a pixel back after each, so work the browser
 * would otherwise defer is counted. The GPU path must be clearly faster to be
 * chosen: a tie is not worth a second code path's differences.
 */
export function blurPath(): GlBlur | null {
  if (chosen) return chosen.blur;
  const blur = GlBlur.create();
  let path: 'gpu' | '2d' = '2d';
  try {
    if (blur && typeof OffscreenCanvas !== 'undefined') {
      const [w, h, sigma] = [540, 960, 18];
      const pattern = new OffscreenCanvas(w, h);
      const p = pattern.getContext('2d')!;
      for (let i = 0; i < 60; i++) {
        p.fillStyle = `hsl(${(i * 37) % 360}, 60%, ${30 + (i % 5) * 10}%)`;
        p.fillRect((i * 97) % w, (i * 151) % h, 120, 120);
      }
      const out = new OffscreenCanvas(w, h).getContext('2d')!;
      const flush = () => out.getImageData(0, 0, 1, 1);
      const filter = timed(() => {
        out.save();
        out.filter = `blur(${sigma}px)`;
        out.drawImage(pattern, 0, 0);
        out.restore();
      }, flush);
      const gpu = timed(() => {
        const result = blur.blurCover(pattern, w, h, [0, 0, 1, 1], sigma);
        if (result) out.drawImage(result, 0, 0, w, h);
      }, flush);
      path = gpu < filter * 0.7 ? 'gpu' : '2d';
    }
  } catch {
    path = '2d';
  }
  chosen = { path, blur: path === 'gpu' ? blur : null };
  return chosen.blur;
}
