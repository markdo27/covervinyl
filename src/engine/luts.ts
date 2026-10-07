/**
 * Colour looks as 3D lookup tables. Built-in looks are written as small
 * colour functions and baked into a 33³ LUT; users can also load their own
 * Adobe/Resolve `.cube` files. LUT data is RGBA8 with red varying fastest,
 * which matches both the .cube order and a WebGL 3D texture's (x, y, z).
 */

export interface Lut {
  key: string;
  name: string;
  size: number;
  data: Uint8Array;
}

type RGB = [number, number, number];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const luma = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = (x: number) => x * x * (3 - 2 * x);
/** Filmic S-curve: k = 0 is linear, 1 is a full smoothstep. */
const sCurve = (x: number, k: number) => mix(x, smooth(clamp01(x)), k);
const map = (c: RGB, fn: (v: number) => number): RGB => [fn(c[0]), fn(c[1]), fn(c[2])];
const saturate = (c: RGB, s: number): RGB => {
  const l = luma(c);
  return [l + (c[0] - l) * s, l + (c[1] - l) * s, l + (c[2] - l) * s];
};
/** Remaps 0..1 to black..white (lifted blacks / rolled-off whites). */
const range = (x: number, black: number, white: number) => black + x * (white - black);
/** Adds a tint to the shadows and another to the highlights. */
const splitTone = (c: RGB, shadow: RGB, highlight: RGB): RGB => {
  const l = clamp01(luma(c));
  const ws = (1 - l) * (1 - l);
  const wh = l * l;
  return [c[0] + shadow[0] * ws + highlight[0] * wh, c[1] + shadow[1] * ws + highlight[1] * wh, c[2] + shadow[2] * ws + highlight[2] * wh];
};

interface Look {
  key: string;
  name: string;
  fn: (c: RGB) => RGB;
}

export const LOOKS: Look[] = [
  {
    key: 'teal-orange',
    name: 'Teal & Orange',
    fn: (c) => map(splitTone(saturate(c, 1.08), [-0.07, 0.02, 0.07], [0.09, 0.03, -0.07]), (v) => sCurve(v, 0.35)),
  },
  {
    key: 'film-print',
    name: 'Film Print',
    fn: (c) =>
      map(saturate(splitTone(map(c, (v) => sCurve(v, 0.45)), [-0.03, 0.012, 0.025], [0.05, 0.02, -0.04]), 0.9), (v) =>
        range(v, 0.025, 0.97),
      ),
  },
  {
    key: 'bleach-bypass',
    name: 'Bleach Bypass',
    fn: (c) => {
      const graded = map(saturate(c, 0.42), (v) => sCurve(v, 0.75));
      return [graded[0] - 0.005, graded[1], graded[2] + 0.01];
    },
  },
  {
    key: 'faded-matte',
    name: 'Faded Matte',
    fn: (c) =>
      splitTone(saturate(map(c, (v) => range(sCurve(v, 0.15), 0.09, 0.93)), 0.85), [0.02, 0.01, 0.03], [0.03, 0.02, 0]),
  },
  {
    key: 'warm-70s',
    name: 'Warm 70s',
    fn: (c) =>
      map(saturate(splitTone(c, [0.03, 0.03, -0.04], [0.07, 0.03, -0.08]), 0.85), (v) => range(sCurve(v, 0.2), 0.06, 0.95)),
  },
  {
    key: 'moonlight',
    name: 'Moonlight',
    fn: (c) => {
      const d = saturate(c, 0.55);
      return map([d[0] * 0.9, d[1] * 0.97, d[2] * 1.08 + 0.03], (v) => sCurve(Math.pow(clamp01(v), 1.12), 0.2));
    },
  },
  {
    key: 'cross-process',
    name: 'Cross Process',
    fn: ([r, g, b]) => saturate([sCurve(r, 0.7), range(Math.pow(clamp01(g), 0.9), 0.03, 1), range(b, 0.12, 0.78)], 1.05),
  },
  {
    key: 'vivid',
    name: 'Vivid',
    fn: (c) => map(saturate(c, 1.3), (v) => sCurve(v, 0.3)),
  },
  {
    key: 'noir',
    name: 'Noir',
    fn: (c) => {
      const l = range(sCurve(clamp01(luma(c)), 0.65), 0.02, 0.98);
      return [l, l, l];
    },
  },
];

export const LUT_SIZE = 33;

export function bakeLut(fn: (c: RGB) => RGB, size = LUT_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = fn([r / (size - 1), g / (size - 1), b / (size - 1)]);
        data[i++] = Math.round(clamp01(out[0]) * 255);
        data[i++] = Math.round(clamp01(out[1]) * 255);
        data[i++] = Math.round(clamp01(out[2]) * 255);
        data[i++] = 255;
      }
    }
  }
  return data;
}

const presetCache = new Map<string, Lut>();

export function presetLut(key: string): Lut | null {
  const cached = presetCache.get(key);
  if (cached) return cached;
  const look = LOOKS.find((l) => l.key === key);
  if (!look) return null;
  const lut = { key: look.key, name: look.name, size: LUT_SIZE, data: bakeLut(look.fn) };
  presetCache.set(key, lut);
  return lut;
}

export const CUSTOM_LUT_PREFIX = 'custom:';

/**
 * Parses a `.cube` LUT (3D, or 1D which is expanded to 3D). Throws a
 * readable error for anything else.
 */
export function parseCubeLut(text: string, key: string, fallbackName: string): Lut {
  let size3d = 0;
  let size1d = 0;
  let title = '';
  let domainMin: RGB = [0, 0, 0];
  let domainMax: RGB = [1, 1, 1];
  const values: number[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) {
      title = line.replace(/^TITLE\s*/i, '').replace(/^"|"$/g, '');
    } else if (upper.startsWith('LUT_3D_SIZE')) {
      size3d = parseInt(line.split(/\s+/)[1], 10);
    } else if (upper.startsWith('LUT_1D_SIZE')) {
      size1d = parseInt(line.split(/\s+/)[1], 10);
    } else if (upper.startsWith('DOMAIN_MIN')) {
      domainMin = line.split(/\s+/).slice(1, 4).map(Number) as RGB;
    } else if (upper.startsWith('DOMAIN_MAX')) {
      domainMax = line.split(/\s+/).slice(1, 4).map(Number) as RGB;
    } else if (/^[-+.\d]/.test(line)) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) continue;
      values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
  }

  const norm = (v: number, ch: number) => (v - domainMin[ch]) / (domainMax[ch] - domainMin[ch] || 1);
  const name = title || fallbackName;

  if (size3d >= 2) {
    if (size3d > 129) throw new Error(`LUT size ${size3d} is too large (max 129).`);
    const count = size3d * size3d * size3d;
    if (values.length < count * 3) throw new Error(`Expected ${count} colour rows but found ${values.length / 3}.`);
    const data = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      data[i * 4] = Math.round(clamp01(norm(values[i * 3], 0)) * 255);
      data[i * 4 + 1] = Math.round(clamp01(norm(values[i * 3 + 1], 1)) * 255);
      data[i * 4 + 2] = Math.round(clamp01(norm(values[i * 3 + 2], 2)) * 255);
      data[i * 4 + 3] = 255;
    }
    return { key, name, size: size3d, data };
  }

  if (size1d >= 2) {
    if (values.length < size1d * 3) throw new Error(`Expected ${size1d} colour rows but found ${values.length / 3}.`);
    const curve = (v: number, ch: number) => {
      const x = clamp01(v) * (size1d - 1);
      const i = Math.min(size1d - 2, Math.floor(x));
      const t = x - i;
      return norm(mix(values[i * 3 + ch], values[(i + 1) * 3 + ch], t), ch);
    };
    return { key, name, size: LUT_SIZE, data: bakeLut(([r, g, b]) => [curve(r, 0), curve(g, 1), curve(b, 2)]) };
  }

  throw new Error('Not a .cube LUT: no LUT_3D_SIZE or LUT_1D_SIZE line found.');
}

/** Applies a LUT to RGBA pixels on the CPU (trilinear), used for thumbnails and tests. */
export function applyLutCpu(pixels: Uint8ClampedArray, lut: Lut, intensity = 1): void {
  const n = lut.size;
  const d = lut.data;
  const at = (r: number, g: number, b: number, ch: number) => d[((b * n + g) * n + r) * 4 + ch];
  for (let p = 0; p < pixels.length; p += 4) {
    const x = (pixels[p] / 255) * (n - 1);
    const y = (pixels[p + 1] / 255) * (n - 1);
    const z = (pixels[p + 2] / 255) * (n - 1);
    const x0 = Math.min(n - 2, Math.floor(x));
    const y0 = Math.min(n - 2, Math.floor(y));
    const z0 = Math.min(n - 2, Math.floor(z));
    const fx = x - x0;
    const fy = y - y0;
    const fz = z - z0;
    for (let ch = 0; ch < 3; ch++) {
      const c00 = mix(at(x0, y0, z0, ch), at(x0 + 1, y0, z0, ch), fx);
      const c10 = mix(at(x0, y0 + 1, z0, ch), at(x0 + 1, y0 + 1, z0, ch), fx);
      const c01 = mix(at(x0, y0, z0 + 1, ch), at(x0 + 1, y0, z0 + 1, ch), fx);
      const c11 = mix(at(x0, y0 + 1, z0 + 1, ch), at(x0 + 1, y0 + 1, z0 + 1, ch), fx);
      const v = mix(mix(c00, c10, fy), mix(c01, c11, fy), fz);
      pixels[p + ch] = mix(pixels[p + ch], v, intensity);
    }
  }
}
