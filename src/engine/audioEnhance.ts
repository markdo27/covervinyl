/**
 * Clean-up for clips recorded on a phone microphone (typically a record
 * playing in a room): steady background noise reduction (spectral gating
 * against a learned noise profile), a rumble cut, a "clarity" EQ +
 * compressor that brings the music forward, and loudness normalisation to
 * Instagram's level with a peak limiter.
 *
 * Pure DSP on Float32Arrays — it runs in a worker (see lib/audioEnhance.ts).
 */

export interface AudioEnhance {
  enabled: boolean;
  /** 0..1 how much steady background noise (hiss, hum, air-con, room tone) to remove. */
  denoise: number;
  /** 0..1 EQ + gentle compression that brings the music forward. */
  clarity: number;
  /** Cut rumble below ~75 Hz (handling noise, wind, traffic). */
  rumble: boolean;
  /** Bring the level to Instagram's loudness with a peak limiter. */
  normalize: boolean;
}

export const DEFAULT_ENHANCE: AudioEnhance = { enabled: false, denoise: 0.6, clarity: 0.5, rumble: true, normalize: true };

/** Integrated loudness Instagram (and most social apps) normalise to. */
export const TARGET_LUFS = -14;
/** Sample-peak ceiling after normalisation, in dBFS. */
export const PEAK_CEILING = -1;

export interface EnhanceStats {
  inputLufs: number;
  outputLufs: number;
  /** Change of the background level relative to the overall loudness, in dB (negative = cleaner). */
  noiseDb: number;
}

const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));
const fromDb = (d: number) => Math.pow(10, d / 20);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ */
/* Biquad filters (RBJ cookbook)                                       */
/* ------------------------------------------------------------------ */

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function biquad(type: 'highpass' | 'peaking' | 'highshelf', f0: number, sampleRate: number, q: number, gainDb = 0): Biquad {
  const w0 = (2 * Math.PI * Math.min(f0, sampleRate * 0.45)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'highpass') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === 'peaking') {
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  } else {
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * cos + s);
    b1 = -2 * A * (A - 1 + (A + 1) * cos);
    b2 = A * (A + 1 + (A - 1) * cos - s);
    a0 = A + 1 - (A - 1) * cos + s;
    a1 = 2 * (A - 1 - (A + 1) * cos);
    a2 = A + 1 - (A - 1) * cos - s;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Filters `x` in place (transposed direct form II). */
export function runBiquad(x: Float32Array, c: Biquad): void {
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = c.b0 * v + z1;
    z1 = c.b1 * v - c.a1 * y + z2;
    z2 = c.b2 * v - c.a2 * y;
    x[i] = y;
  }
}

/* ------------------------------------------------------------------ */
/* Loudness (ITU-R BS.1770 / EBU R128 integrated)                      */
/* ------------------------------------------------------------------ */

/** The K-weighting pre-filter + RLB high-pass for any sample rate (as in libebur128). */
function kWeighting(sampleRate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, highpass];
}

/** Integrated loudness in LUFS (-Infinity for silence). */
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  if (!channels.length || !channels[0].length) return -Infinity;
  const [shelf, hp] = kWeighting(sampleRate);
  const length = channels[0].length;
  // Prefix sums of the K-weighted power, summed over channels.
  const prefix = new Float64Array(length + 1);
  for (const ch of channels) {
    const y = ch.slice();
    runBiquad(y, shelf);
    runBiquad(y, hp);
    let acc = 0;
    for (let i = 0; i < length; i++) {
      acc += y[i] * y[i];
      prefix[i + 1] += acc;
    }
  }
  const block = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  const energies: number[] = [];
  if (length < block) energies.push(prefix[length] / length);
  else for (let s = 0; s + block <= length; s += step) energies.push((prefix[s + block] - prefix[s]) / block);
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const absolute = energies.filter((z) => z > 0 && lufs(z) > -70);
  if (!absolute.length) return -Infinity;
  const relative = lufs(absolute.reduce((a, b) => a + b, 0) / absolute.length) - 10;
  const gated = absolute.filter((z) => lufs(z) > relative);
  return lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/** The quiet floor of a clip: 10th percentile of 50 ms RMS levels, in dBFS. */
export function backgroundLevel(channels: Float32Array[], sampleRate: number): number {
  const length = channels[0]?.length ?? 0;
  const block = Math.max(1, Math.round(0.05 * sampleRate));
  const levels: number[] = [];
  for (let s = 0; s + block <= length; s += block) {
    let acc = 0;
    for (const ch of channels) for (let i = s; i < s + block; i++) acc += ch[i] * ch[i];
    levels.push(10 * Math.log10(acc / (block * channels.length) + 1e-20));
  }
  if (!levels.length) return -Infinity;
  levels.sort((a, b) => a - b);
  return levels[Math.floor(levels.length * 0.1)];
}

/* ------------------------------------------------------------------ */
/* FFT                                                                 */
/* ------------------------------------------------------------------ */

export class FFT {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;

  constructor(readonly n: number) {
    const bits = Math.round(Math.log2(n));
    if (1 << bits !== n) throw new Error('FFT size must be a power of two.');
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** In-place complex FFT; the inverse is unscaled (divide by n). */
  transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const tr = cos[k * step];
          const ti = sign * sin[k * step];
          const a = start + k;
          const b = a + half;
          const xr = re[b] * tr - im[b] * ti;
          const xi = re[b] * ti + im[b] * tr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Noise reduction                                                     */
/* ------------------------------------------------------------------ */

/** Splits Z = FFT(a + i·b) into the spectra of the two real frames a and b at bin k. */
function unpack(re: Float64Array, im: Float64Array, k: number, n: number) {
  const kk = (n - k) % n;
  return {
    ar: (re[k] + re[kk]) / 2,
    ai: (im[k] - im[kk]) / 2,
    br: (im[k] + im[kk]) / 2,
    bi: -(re[k] - re[kk]) / 2,
  };
}

/** Frames of power averaged over ~130 ms before taking the noise percentile. */
const PROFILE_SMOOTH = 12;
/** Turns that percentile of smoothed power back into the mean noise power. */
const PROFILE_BIAS = 2;

/**
 * Spectral gating: learns each frequency's steady noise floor (a low
 * percentile of its smoothed power over the clip) and turns down whatever
 * doesn't rise clearly above it. Gains are smoothed over frequency and
 * time to avoid "musical noise". Two frames share one complex FFT.
 */
export function denoiseChannel(x: Float32Array, sampleRate: number, strength: number, onProgress?: (p: number) => void): Float32Array {
  const N = sampleRate > 32000 ? 2048 : 1024;
  if (strength <= 0 || x.length < N * 2) return x.slice();
  const hop = N / 4;
  const bins = N / 2 + 1;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const pad = N;
  const total = x.length + 2 * pad;
  const frames = Math.floor((total - N) / hop) + 1;
  const fft = new FFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const sample = (i: number) => (i >= 0 && i < x.length ? x[i] : 0);
  const load = (f: number) => {
    const a = f * hop - pad;
    const b = (f + 1) * hop - pad;
    const hasB = f + 1 < frames;
    for (let i = 0; i < N; i++) {
      re[i] = sample(a + i) * win[i];
      im[i] = hasB ? sample(b + i) * win[i] : 0;
    }
    fft.transform(re, im, false);
    return hasB;
  };
  const inside = (f: number) => f * hop - pad >= 0 && f * hop - pad + N <= x.length;

  // 1. Noise profile: a low percentile of each bin's smoothed power, over frames fully inside the clip.
  const stride = Math.max(1, Math.floor(frames / 1500));
  const capacity = Math.ceil(frames / stride);
  const powers = new Float32Array(capacity * bins);
  const ring = new Float64Array(PROFILE_SMOOTH * bins);
  const ringSum = new Float64Array(bins);
  let filled = 0;
  let used = 0;
  const record = (f: number, power: (k: number) => number) => {
    if (!inside(f)) return;
    const slot = (filled % PROFILE_SMOOTH) * bins;
    for (let k = 0; k < bins; k++) {
      const p = power(k);
      ringSum[k] += p - ring[slot + k];
      ring[slot + k] = p;
    }
    filled++;
    if (filled >= PROFILE_SMOOTH && f % stride === 0 && used < capacity) {
      for (let k = 0; k < bins; k++) powers[k * capacity + used] = ringSum[k] / PROFILE_SMOOTH;
      used++;
    }
  };
  for (let f = 0; f < frames; f += 2) {
    const hasB = load(f);
    record(f, (k) => {
      const { ar, ai } = unpack(re, im, k, N);
      return ar * ar + ai * ai;
    });
    if (hasB) {
      record(f + 1, (k) => {
        const { br, bi } = unpack(re, im, k, N);
        return br * br + bi * bi;
      });
    }
    if (onProgress && f % 400 === 0) onProgress((f / frames) * 0.3);
  }
  if (!used) return x.slice();
  const noise = new Float64Array(bins);
  const pick = Math.floor((used - 1) * 0.1);
  for (let k = 0; k < bins; k++) {
    const slice = powers.subarray(k * capacity, k * capacity + used);
    slice.sort();
    noise[k] = slice[pick] * PROFILE_BIAS;
  }

  // 2. Gate every frame and overlap-add.
  const alpha = 1 + 1.5 * strength;
  const floor = fromDb(-(4 + 16 * strength));
  const out = new Float64Array(total);
  const held = new Float64Array(bins).fill(1);
  const prev1 = new Float64Array(bins);
  const prev2 = new Float64Array(bins);
  const raw = new Float64Array(bins);
  const gainA = new Float64Array(bins);
  const gainB = new Float64Array(bins);

  const gate = (power: (k: number) => number, target: Float64Array) => {
    for (let k = 0; k < bins; k++) {
      const p = power(k);
      // Decide on power averaged over three frames, so random noise peaks don't open the gate.
      const decision = (p + prev1[k] + prev2[k]) / 3;
      prev2[k] = prev1[k];
      prev1[k] = p;
      const g = decision > 0 ? Math.sqrt(Math.max(0, 1 - (alpha * noise[k]) / decision)) : 0;
      raw[k] = Math.max(floor, g);
    }
    for (let k = 0; k < bins; k++) {
      const smooth = (raw[Math.max(0, k - 1)] + 2 * raw[k] + raw[Math.min(bins - 1, k + 1)]) / 4;
      // Open instantly for new notes, close gently.
      held[k] = smooth >= held[k] ? smooth : held[k] + (smooth - held[k]) * 0.35;
      target[k] = held[k];
    }
  };

  for (let f = 0; f < frames; f += 2) {
    const hasB = load(f);
    gate((k) => {
      const { ar, ai } = unpack(re, im, k, N);
      return ar * ar + ai * ai;
    }, gainA);
    if (hasB) {
      gate((k) => {
        const { br, bi } = unpack(re, im, k, N);
        return br * br + bi * bi;
      }, gainB);
    }
    for (let k = 0; k <= N / 2; k++) {
      const kk = (N - k) % N;
      const { ar, ai, br, bi } = unpack(re, im, k, N);
      const ga = gainA[k];
      const gb = hasB ? gainB[k] : 0;
      // W = gA·A + i·gB·B at k, and its mirror at N-k (A and B are Hermitian).
      re[k] = ga * ar - gb * bi;
      im[k] = ga * ai + gb * br;
      if (kk !== k) {
        re[kk] = ga * ar + gb * bi;
        im[kk] = -ga * ai + gb * br;
      }
    }
    fft.transform(re, im, true);
    const oa = f * hop;
    const ob = (f + 1) * hop;
    for (let i = 0; i < N; i++) {
      out[oa + i] += (re[i] / N) * win[i];
      if (hasB) out[ob + i] += (im[i] / N) * win[i];
    }
    if (onProgress && f % 400 === 0) onProgress(0.3 + (f / frames) * 0.7);
  }

  // Hann² at 75 % overlap sums to 1.5.
  const result = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) result[i] = out[i + pad] / 1.5;
  return result;
}

/* ------------------------------------------------------------------ */
/* Dynamics                                                            */
/* ------------------------------------------------------------------ */

function scale(channels: Float32Array[], gain: number): void {
  if (gain === 1) return;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
}

/** Stereo-linked feed-forward compressor with a smoothed power detector. */
export function compress(channels: Float32Array[], sampleRate: number, thresholdDb: number, ratio: number, attack = 0.01, release = 0.2): void {
  const aA = Math.exp(-1 / (sampleRate * attack));
  const aR = Math.exp(-1 / (sampleRate * release));
  const slope = 1 - 1 / ratio;
  let env = 0;
  const length = channels[0]?.length ?? 0;
  for (let i = 0; i < length; i++) {
    let p = 0;
    for (const ch of channels) p = Math.max(p, ch[i] * ch[i]);
    env = p > env ? aA * env + (1 - aA) * p : aR * env + (1 - aR) * p;
    const over = 10 * Math.log10(env + 1e-12) - thresholdDb;
    if (over <= 0) continue;
    const g = fromDb(-over * slope);
    for (const ch of channels) ch[i] *= g;
  }
}

/**
 * Look-ahead peak limiter: gain is held at the minimum needed within ±5 ms
 * of every peak and averaged over the same window, so it ramps down before
 * peaks instead of clipping, then recovers smoothly.
 */
export function limit(channels: Float32Array[], sampleRate: number, ceiling: number): void {
  const length = channels[0]?.length ?? 0;
  if (!length) return;
  const req = new Float32Array(length);
  let needed = false;
  for (let i = 0; i < length; i++) {
    let peak = 0;
    for (const ch of channels) peak = Math.max(peak, Math.abs(ch[i]));
    req[i] = peak > ceiling ? ceiling / peak : 1;
    if (req[i] < 1) needed = true;
  }
  if (!needed) return;
  const L = Math.max(1, Math.round(0.005 * sampleRate));
  // Sliding minimum over [i - L, i + L] with a monotonic deque.
  const held = new Float32Array(length);
  const deque = new Int32Array(length);
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let i = 0; i < length; i++) {
    const hi = Math.min(length - 1, i + L);
    while (next <= hi) {
      while (tail > head && req[deque[tail - 1]] >= req[next]) tail--;
      deque[tail++] = next++;
    }
    while (deque[head] < i - L) head++;
    held[i] = req[deque[head]];
  }
  // Moving average over the same window, then a smooth release.
  let sum = 0;
  let lo = 0;
  let hiIdx = -1;
  const rel = 1 - Math.exp(-1 / (sampleRate * 0.08));
  let g = 1;
  for (let i = 0; i < length; i++) {
    const a = Math.max(0, i - L);
    const b = Math.min(length - 1, i + L);
    while (hiIdx < b) sum += held[++hiIdx];
    while (lo < a) sum -= held[lo++];
    const avg = sum / (b - a + 1);
    g = avg < g ? avg : g + (avg - g) * rel;
    for (const ch of channels) ch[i] *= g;
  }
}

/* ------------------------------------------------------------------ */
/* The chain                                                           */
/* ------------------------------------------------------------------ */

export function enhanceChannels(
  input: Float32Array[],
  sampleRate: number,
  s: AudioEnhance,
  onProgress?: (p: number) => void,
): { channels: Float32Array[]; stats: EnhanceStats } {
  let channels: Float32Array[] = input.map((c) => c.slice());
  const inputLufs = integratedLoudness(channels, sampleRate);
  const bgIn = backgroundLevel(channels, sampleRate);

  if (s.rumble) {
    const hp = biquad('highpass', 75, sampleRate, 0.707);
    for (const ch of channels) {
      runBiquad(ch, hp);
      runBiquad(ch, hp);
    }
  }

  const denoise = clamp(s.denoise, 0, 1);
  if (denoise > 0) {
    channels = channels.map((ch, i) =>
      denoiseChannel(ch, sampleRate, denoise, (p) => onProgress?.(((i + p) / channels.length) * 0.85)),
    );
  }

  const clarity = clamp(s.clarity, 0, 1);
  if (clarity > 0) {
    const eq = [
      biquad('peaking', 250, sampleRate, 0.9, -4 * clarity), // less boxy room boom
      biquad('peaking', 3000, sampleRate, 0.8, 4 * clarity), // presence
      biquad('highshelf', 9000, sampleRate, 0.707, 2 * clarity), // air
    ];
    for (const ch of channels) for (const c of eq) runBiquad(ch, c);
    // Compress around a known level so the threshold means the same for every clip.
    const level = integratedLoudness(channels, sampleRate);
    const toRef = Number.isFinite(level) ? clamp(-20 - level, -20, 30) : 0;
    scale(channels, fromDb(toRef));
    compress(channels, sampleRate, -26, 1 + 2 * clarity);
    scale(channels, fromDb(-toRef));
  }

  if (s.normalize) {
    const level = integratedLoudness(channels, sampleRate);
    if (Number.isFinite(level)) scale(channels, fromDb(clamp(TARGET_LUFS - level, -20, 30)));
  }
  limit(channels, sampleRate, fromDb(s.normalize ? PEAK_CEILING : -0.3));

  const outputLufs = integratedLoudness(channels, sampleRate);
  const bgOut = backgroundLevel(channels, sampleRate);
  const noiseDb =
    Number.isFinite(bgIn) && Number.isFinite(bgOut) && Number.isFinite(inputLufs) && Number.isFinite(outputLufs)
      ? bgOut - outputLufs - (bgIn - inputLufs)
      : 0;
  onProgress?.(1);
  return { channels, stats: { inputLufs, outputLufs, noiseDb } };
}

/** Same settings → same result (used for caching). */
export function enhanceKey(s: AudioEnhance): string {
  return [s.denoise.toFixed(2), s.clarity.toFixed(2), s.rumble ? 1 : 0, s.normalize ? 1 : 0].join('|');
}

/** Human-readable dB, e.g. "−12 dB". */
export function formatDb(v: number): string {
  return `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(Math.round(v))} dB`;
}

export { toDb };
