import { describe, expect, it } from 'vitest';
import { buildTimeline, fitDurations, formatTime, slideIndexAt, sourceTime } from '../timeline';

const project = (durations: number[], end = 2, enabled = true) => ({
  slides: durations.map((duration, i) => ({ id: String(i), coverId: null, texts: {}, morphFrom: '', duration })),
  endCard: { enabled, logoId: null, logoSize: 0.3, text: '', duration: end },
});

describe('buildTimeline', () => {
  it('lays slides and the end card end to end', () => {
    const tl = buildTimeline(project([3, 4, 4]));
    expect(tl.slideStarts).toEqual([0, 3, 7]);
    expect(tl.endStart).toBe(11);
    expect(tl.total).toBe(13);
    expect(tl.segments.at(-1)?.kind).toBe('end');
  });

  it('skips a disabled end card and enforces a minimum slide length', () => {
    const tl = buildTimeline(project([0.1, 2], 2, false));
    expect(tl.total).toBe(2.5);
    expect(tl.endStart).toBe(tl.total);
  });

  it('finds the slide at a given time', () => {
    const tl = buildTimeline(project([3, 4, 4]));
    expect(slideIndexAt(tl, 0)).toBe(0);
    expect(slideIndexAt(tl, 3)).toBe(1);
    expect(slideIndexAt(tl, 12)).toBe(2);
  });
});

describe('sourceTime', () => {
  it('loops after the trim start', () => {
    const opts = { start: 2, loop: true, duration: 7 };
    expect(sourceTime(1, opts)).toBe(3);
    expect(sourceTime(6, opts)).toBeCloseTo(3);
  });

  it('holds the last frame when not looping', () => {
    const opts = { start: 0, loop: false, duration: 5, frameStep: 0.1 };
    expect(sourceTime(10, opts)).toBeCloseTo(4.9);
  });
});

describe('fitDurations', () => {
  it('scales the edit to the target length', () => {
    const fitted = fitDurations(project([3, 4, 4]), 26);
    expect(buildTimeline(fitted).total).toBeCloseTo(26, 0);
  });
});

describe('formatTime', () => {
  it('formats minutes and tenths', () => {
    expect(formatTime(65.25)).toBe('1:05.3');
    expect(formatTime(3)).toBe('0:03.0');
  });
});
