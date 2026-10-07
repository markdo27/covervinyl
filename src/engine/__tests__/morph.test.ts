import { describe, expect, it } from 'vitest';
import { planMorph } from '../morph';

const glyphs = (spec: [string, string][]) =>
  spec.flatMap(([text, font]) => Array.from(text.replace(/\s/g, '')).map((ch) => ({ key: `${ch}|${font}`, ch })));

describe('planMorph', () => {
  it('keeps shared letters and inserts the rest (jazzmatic → jazz samples: illmatic)', () => {
    const from = glyphs([
      ['jazz', 'light'],
      ['matic', 'bold'],
    ]);
    const to = glyphs([
      ['jazz samples:', 'light'],
      ['illmatic', 'bold'],
    ]);
    const plan = planMorph(from, to);
    expect(plan.matched.map(([a]) => a.ch).join('')).toBe('jazzmatic');
    expect(plan.removed).toHaveLength(0);
    expect(plan.added.map((g) => g.ch).join('')).toBe('samples:ill');
  });

  it('does not match letters across different fonts', () => {
    const plan = planMorph(glyphs([['ab', 'light']]), glyphs([['ab', 'bold']]));
    expect(plan.matched).toHaveLength(0);
    expect(plan.removed).toHaveLength(2);
    expect(plan.added).toHaveLength(2);
  });
});
