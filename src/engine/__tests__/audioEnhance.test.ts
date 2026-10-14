import { describe, expect, it } from 'vitest';
import {
  backgroundLevel,
  biquad,
  DEFAULT_ENHANCE,
  denoiseChannel,
  enhanceChannels,
  FFT,
  integratedLoudness,
  limit,
  PEAK_CEILING,
  runBiquad,
  TARGET_LUFS,
} from '../audioEnhance';

const SR = 48000;

function sine(freq: number, seconds: number, amp: number, sr = SR): Float32Array {
  const x = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
}

/** Deterministic white noise. */
function noise(seconds: number, amp: number, seed = 1): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR));
  let s = seed;
  for (let i = 0; i < x.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    x[i] = amp * ((s / 2 ** 32) * 2 - 1);
  }
  return x;
}

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let acc = 0;
  for (let i = from; i < to; i++) acc += x[i] * x[i];
  return Math.sqrt(acc / Math.max(1, to - from));
};
const db = (v: number) => 20 * Math.log10(v);
const peak = (chs: Float32Array[]) => Math.max(...chs.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));

/** "Music": a melody of tone bursts with silent gaps, so gaps show what's left of the noise. */
function bursts(seconds: number, amp: number): { x: Float32Array; on: (i: number) => boolean } {
  const x = new Float32Array(Math.round(seconds * SR));
  const notes = [220, 330, 440, 550, 660, 880];
  const on = (i: number) => Math.floor(i / (SR * 0.25)) % 2 === 0;
  for (let i = 0; i < x.length; i++) {
    if (!on(i)) continue;
    const f = notes[Math.floor(i / (SR * 0.5)) % notes.length];
    x[i] = amp * Math.sin((2 * Math.PI * f * i) / SR);
  }
  return { x, on };
}

describe('loudness', () => {
  it('measures a full-scale 997 Hz tone at -3.01 LUFS (mono) and ~0 LUFS (stereo)', () => {
    const tone = sine(997, 3, 1);
    expect(integratedLoudness([tone], SR)).toBeCloseTo(-3.01, 1);
    expect(integratedLoudness([tone, tone], SR)).toBeCloseTo(0, 1);
    expect(integratedLoudness([sine(997, 3, 0.1, 44100)], 44100)).toBeCloseTo(-23.01, 1);
  });

  it('ignores silence', () => {
    expect(integratedLoudness([new Float32Array(SR)], SR)).toBe(-Infinity);
  });
});

describe('fft', () => {
  it('round-trips a signal', () => {
    const n = 256;
    const fft = new FFT(n);
    const src = noise(n / SR, 1);
    const re = Float64Array.from(src);
    const im = new Float64Array(n);
    fft.transform(re, im, false);
    fft.transform(re, im, true);
    for (let i = 0; i < n; i++) expect(re[i] / n).toBeCloseTo(src[i], 9);
  });
});

describe('noise reduction', () => {
  it('pulls the noise down in the gaps and keeps the notes', () => {
    const { x: music, on } = bursts(4, 0.3);
    const hiss = noise(4, 0.03);
    const mixed = music.map((v, i) => v + hiss[i]);
    const out = denoiseChannel(mixed, SR, 0.8);

    // Compare gap and note energy away from the edges of each note.
    let gapIn = 0, gapOut = 0, noteIn = 0, noteOut = 0, gaps = 0, notes = 0;
    const margin = Math.round(SR * 0.04);
    for (let i = SR; i < mixed.length - SR; i++) {
      const phase = i % (SR * 0.25);
      if (phase < margin || phase > SR * 0.25 - margin) continue;
      if (on(i)) {
        noteIn += music[i] ** 2;
        noteOut += out[i] ** 2;
        notes++;
      } else {
        gapIn += mixed[i] ** 2;
        gapOut += out[i] ** 2;
        gaps++;
      }
    }
    const gapReduction = 10 * Math.log10(gapOut / gapIn);
    const noteChange = 10 * Math.log10(noteOut / notes / (noteIn / notes));
    expect(gapReduction).toBeLessThan(-10);
    expect(Math.abs(noteChange)).toBeLessThan(1.5);
  });

  it('passes audio through untouched at strength 0', () => {
    const x = noise(0.5, 0.2);
    expect(denoiseChannel(x, SR, 0)).toEqual(x);
  });
});

describe('filters and dynamics', () => {
  it('cuts rumble but not the music', () => {
    const hp = biquad('highpass', 75, SR, 0.707);
    const run = (x: Float32Array) => {
      runBiquad(x, hp);
      runBiquad(x, hp);
      return x;
    };
    const low = run(sine(30, 2, 0.5));
    const mid = run(sine(1000, 2, 0.5));
    expect(db(rms(low, SR) / rms(sine(30, 2, 0.5), SR))).toBeLessThan(-15);
    expect(Math.abs(db(rms(mid, SR) / rms(sine(1000, 2, 0.5), SR)))).toBeLessThan(0.3);
  });

  it('limits peaks to the ceiling', () => {
    const x = sine(100, 1, 0.5);
    for (let i = 10000; i < 10100; i++) x[i] = 1.8 * Math.sign(x[i] || 1);
    const ceiling = 10 ** (PEAK_CEILING / 20);
    limit([x], SR, ceiling);
    expect(peak([x])).toBeLessThanOrEqual(ceiling + 1e-6);
    // Away from the peak the level comes back.
    expect(rms(x, SR * 0.6, SR * 0.9)).toBeCloseTo(rms(sine(100, 1, 0.5), SR * 0.6, SR * 0.9), 2);
  });
});

describe('the whole chain', () => {
  it('cleans a quiet, noisy phone recording and brings it to Instagram loudness', () => {
    const { x: music } = bursts(6, 0.04);
    const hiss = noise(6, 0.008, 7);
    const hum = sine(50, 6, 0.01);
    const rumble = sine(20, 6, 0.05);
    const left = music.map((v, i) => v + hiss[i] + hum[i] + rumble[i]);
    const hiss2 = noise(6, 0.008, 9);
    const right = music.map((v, i) => v + hiss2[i] + hum[i] + rumble[i]);

    const started = Date.now();
    const { channels, stats } = enhanceChannels([left, right], SR, { ...DEFAULT_ENHANCE, enabled: true, denoise: 0.8 });
    const ms = Date.now() - started;

    expect(stats.inputLufs).toBeLessThan(-25);
    expect(stats.outputLufs).toBeCloseTo(TARGET_LUFS, 0);
    expect(peak(channels)).toBeLessThanOrEqual(10 ** (PEAK_CEILING / 20) + 1e-6);
    // The quiet floor drops relative to the music.
    expect(stats.noiseDb).toBeLessThan(-10);
    expect(backgroundLevel(channels, SR)).toBeLessThan(backgroundLevel([left, right], SR) + (stats.outputLufs - stats.inputLufs) - 10);
    expect(ms).toBeLessThan(15000);
  });

  it('leaves the level alone without normalisation', () => {
    const { x } = bursts(3, 0.2);
    const before = integratedLoudness([x], SR);
    const { stats } = enhanceChannels([x], SR, { enabled: true, denoise: 0, clarity: 0, rumble: false, normalize: false });
    expect(stats.outputLufs).toBeCloseTo(before, 1);
  });
});
