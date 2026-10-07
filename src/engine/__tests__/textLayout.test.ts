import { describe, expect, it } from 'vitest';
import { blockGlyphs, layoutText, type MeasureContext, type TextMetricsStyle } from '../textLayout';

/** Monospace-ish fake: every character is half the font size wide (bold = 0.6). */
function fakeCtx(): MeasureContext {
  return {
    font: '',
    measureText(text: string) {
      const px = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10);
      const k = /\b700\b/.test(this.font) ? 0.6 : 0.5;
      return { width: text.length * px * k };
    },
  };
}

const style: TextMetricsStyle = {
  bodyStack: 'Body',
  headlineStack: 'Head',
  bodyPx: 10,
  headlinePx: 20,
  lineHeight: 1.5,
  tracking: 0,
  weights: { light: 300, regular: 400, bold: 700 },
};

describe('layoutText', () => {
  it('stacks lines using their own sizes', () => {
    const block = layoutText(fakeCtx(), '# Title\nbody line\n\nend', style, 1000);
    expect(block.lines.map((l) => [l.kind, l.top, l.height])).toEqual([
      ['headline', 0, 30],
      ['body', 30, 15],
      ['blank', 45, 7.5],
      ['body', 52.5, 15],
    ]);
    expect(block.height).toBe(67.5);
  });

  it('positions styled runs one after another', () => {
    const [line] = layoutText(fakeCtx(), 'Produced by **DJ**', style, 1000).lines;
    expect(line.runs.map((r) => [r.text, r.x, r.width])).toEqual([
      ['Produced by ', 0, 60],
      ['DJ', 60, 12],
    ]);
  });

  it('wraps long lines at word boundaries', () => {
    const block = layoutText(fakeCtx(), 'aaaa bbbb cccc', style, 50);
    expect(block.lines.map((l) => l.runs.map((r) => r.text).join(''))).toEqual(['aaaa bbbb', 'cccc']);
  });

  it('breaks blocks into positioned glyphs, skipping spaces', () => {
    const ctx = fakeCtx();
    const glyphs = blockGlyphs(ctx, layoutText(ctx, 'ab **c**', style, 1000));
    expect(glyphs.map((g) => [g.ch, g.x])).toEqual([
      ['a', 0],
      ['b', 5],
      ['c', 15],
    ]);
  });
});
