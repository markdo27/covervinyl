/**
 * GPU post-processing pass (WebGL2): colour LUT, vignette and film grain,
 * applied to a fully rendered frame.
 */
import type { Lut } from './luts';
import type { PostSettings } from './types';

const VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D u_src;
uniform sampler3D u_lut;
uniform float u_lutMix;
uniform float u_lutSize;
uniform float u_grain;
uniform float u_grainSize;
uniform float u_seed;
uniform float u_vignette;
in vec2 v_uv;
out vec4 outColor;

// Hash without sine (Dave Hoskins) — stable across GPUs.
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 c = texture(u_src, v_uv).rgb;

  if (u_lutMix > 0.0) {
    vec3 coord = c * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize;
    c = mix(c, texture(u_lut, coord).rgb, u_lutMix);
  }

  if (u_vignette > 0.0) {
    float d = length(v_uv - 0.5) * 1.41421;
    c *= 1.0 - smoothstep(0.3, 1.1, d) * u_vignette;
  }

  if (u_grain > 0.0) {
    vec2 cell = floor(gl_FragCoord.xy / u_grainSize);
    // Sum of two uniforms -> triangular distribution, closer to real grain.
    float n = hash13(vec3(cell, u_seed)) + hash13(vec3(cell + 17.0, u_seed + 3.17)) - 1.0;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Film grain is most visible in the mid-tones.
    float response = 1.0 - pow(abs(l - 0.5) * 2.0, 2.0) * 0.55;
    c += n * u_grain * 0.2 * response;
  }

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export function postActive(post: PostSettings): boolean {
  return (post.lut !== 'none' && post.lutIntensity > 0) || post.grain > 0 || post.vignette > 0;
}

let supportCache: boolean | null = null;
export function postSupported(): boolean {
  if (supportCache === null) {
    try {
      supportCache = !!document.createElement('canvas').getContext('webgl2');
    } catch {
      supportCache = false;
    }
  }
  return supportCache;
}

export class PostProcessor {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private srcTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private lutKey: string | null = null;
  private lutSize = 2;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  lost = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      // Frames are copied out right after drawing, in the same task, so the buffer needn't be kept.
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas.addEventListener('webglcontextlost', () => (this.lost = true));

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.bindAttribLocation(program, 0, 'a_pos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error');
    this.program = program;
    gl.useProgram(program);
    for (const name of ['u_src', 'u_lut', 'u_lutMix', 'u_lutSize', 'u_grain', 'u_grainSize', 'u_seed', 'u_vignette']) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform1i(this.uniforms.u_src, 0);
    gl.uniform1i(this.uniforms.u_lut, 1);

    // One triangle covering the screen.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.srcTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    for (const [p, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ]) {
      gl.texParameteri(gl.TEXTURE_2D, p, v);
    }

    this.lutTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    for (const [p, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE],
    ]) {
      gl.texParameteri(gl.TEXTURE_3D, p, v);
    }
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }

  private setLut(lut: Lut | null) {
    const key = lut ? `${lut.key}:${lut.size}:${lut.data.length}` : null;
    if (key === this.lutKey || !lut) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data);
    this.lutKey = key;
    this.lutSize = lut.size;
  }

  /** Processes `source` (a rendered frame) into `this.canvas`. */
  render(source: TexImageSource, width: number, height: number, post: PostSettings, lut: Lut | null, t: number): void {
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);

    this.setLut(lut);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    const u = this.uniforms;
    gl.uniform1f(u.u_lutMix, lut && post.lut !== 'none' ? post.lutIntensity : 0);
    gl.uniform1f(u.u_lutSize, this.lutSize);
    gl.uniform1f(u.u_grain, post.grain);
    // Grain size is defined at 1080p so the preview matches the export.
    gl.uniform1f(u.u_grainSize, Math.max(1, (post.grainSize * width) / 1080));
    // New grain 24 times a second, deterministic for a given time.
    gl.uniform1f(u.u_seed, Math.floor(t * 24) % 997);
    gl.uniform1f(u.u_vignette, post.vignette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
