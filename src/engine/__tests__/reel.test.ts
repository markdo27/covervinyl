import { describe, expect, it } from 'vitest';
import { frameIndexAt } from '../overlay';
import {
  beatDuration,
  buildReelTimeline,
  clipTime,
  defaultReel,
  newReelItem,
  overlayTime,
  reelIndexAt,
  reelLayersAt,
  setAllDurations,
} from '../reel';

const items = (durations: number[]) => durations.map((duration) => newReelItem({ duration }));

describe('reel timing', () => {
  it('converts BPM to a shot length', () => {
    expect(beatDuration(120, 1)).toBe(0.5);
    expect(beatDuration(120, 0.5)).toBe(0.25);
    expect(beatDuration(90, 4)).toBeCloseTo(2.667, 3);
  });

  it('lays shots end to end and finds the shot at a time', () => {
    const tl = buildReelTimeline(items([0.5, 1, 0.5]));
    expect(tl.starts).toEqual([0, 0.5, 1.5]);
    expect(tl.total).toBe(2);
    expect(reelIndexAt(tl, 0)).toBe(0);
    expect(reelIndexAt(tl, 0.49)).toBe(0);
    expect(reelIndexAt(tl, 0.5)).toBe(1);
    expect(reelIndexAt(tl, 1.99)).toBe(2);
  });

  it('cuts show a single shot', () => {
    const p = { items: items([1, 1]), transition: 'cut' as const };
    const tl = buildReelTimeline(p.items);
    expect(reelLayersAt(p, tl, 0.99).layers.map((l) => l.index)).toEqual([0]);
    expect(reelLayersAt(p, tl, 1).layers.map((l) => l.index)).toEqual([1]);
  });

  it('fades overlap the shots around each cut', () => {
    const p = { items: items([1, 1]), transition: 'fade' as const };
    const tl = buildReelTimeline(p.items);
    const before = reelLayersAt(p, tl, 0.95).layers;
    expect(before.map((l) => l.index)).toEqual([0, 1]);
    expect(before[1].alpha).toBeCloseTo((0.95 - 0.85) / 0.3, 5);
    const after = reelLayersAt(p, tl, 1.05).layers;
    expect(after.map((l) => l.index)).toEqual([0, 1]);
    expect(after[1].alpha).toBeCloseTo((1.05 - 0.85) / 0.3, 5);
    expect(reelLayersAt(p, tl, 1.3).layers.map((l) => l.index)).toEqual([1]);
  });

  it('flashes white right after a cut', () => {
    const p = { items: items([1, 1]), transition: 'flash' as const };
    const tl = buildReelTimeline(p.items);
    expect(reelLayersAt(p, tl, 1).flash).toBe(1);
    expect(reelLayersAt(p, tl, 1.5).flash).toBe(0);
    expect(reelLayersAt(p, tl, 0.1).flash).toBe(0);
  });

  it('loops clips from their start point', () => {
    const item = newReelItem({ start: 1 });
    expect(clipTime(item, 3, 0.5)).toBe(1.5);
    expect(clipTime(item, 3, 2.5)).toBeCloseTo(1.5);
    expect(clipTime(item, 3, -0.2)).toBe(1);
  });

  it('loops the overlay at its speed', () => {
    expect(overlayTime(1.5, 1, 1)).toBeCloseTo(0.5);
    expect(overlayTime(1.5, 2, 1)).toBeCloseTo(0);
    expect(overlayTime(5, 1, 0)).toBe(0);
  });

  it('applies one length to every shot', () => {
    const p = setAllDurations(defaultReel(), 0.25);
    expect(new Set(p.items.map((i) => i.duration))).toEqual(new Set([0.25]));
  });
});

describe('overlay frames', () => {
  it('steps image sequences at the chosen fps', () => {
    expect(frameIndexAt(null, 12, 12, 0)).toBe(0);
    expect(frameIndexAt(null, 12, 12, 0.5)).toBe(6);
    expect(frameIndexAt(null, 12, 12, 1.01)).toBe(0);
  });

  it('follows per-frame delays for animated images', () => {
    const delays = [0.1, 0.5, 0.1];
    expect(frameIndexAt(delays, 3, 12, 0.05)).toBe(0);
    expect(frameIndexAt(delays, 3, 12, 0.3)).toBe(1);
    expect(frameIndexAt(delays, 3, 12, 0.65)).toBe(2);
  });
});
