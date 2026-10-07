import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkup, stripMarkup } from '../markup';

describe('parseInline', () => {
  it('splits bold, italic and light runs', () => {
    expect(parseInline('*Double Exposure* **1978**')).toEqual([
      { text: 'Double Exposure', bold: false, italic: true, light: false },
      { text: ' ', bold: false, italic: false, light: false },
      { text: '1978', bold: true, italic: false, light: false },
    ]);
  });

  it('supports combined markers and light text', () => {
    expect(parseInline('~jazz~**matic**')).toEqual([
      { text: 'jazz', bold: false, italic: false, light: true },
      { text: 'matic', bold: true, italic: false, light: false },
    ]);
    expect(parseInline('***both***')).toEqual([{ text: 'both', bold: true, italic: true, light: false }]);
  });

  it('honours escapes and unclosed markers', () => {
    expect(parseInline('5 \\* 3')).toEqual([{ text: '5 * 3', bold: false, italic: false, light: false }]);
    expect(parseInline('**open')).toEqual([{ text: 'open', bold: true, italic: false, light: false }]);
  });
});

describe('inline colours', () => {
  it('colours text between {#hex} and {/}', () => {
    expect(parseInline('Produced by {#E2402F}**DJ Premier**{/}!')).toEqual([
      { text: 'Produced by ', bold: false, italic: false, light: false },
      { text: 'DJ Premier', bold: true, italic: false, light: false, color: '#e2402f' },
      { text: '!', bold: false, italic: false, light: false },
    ]);
  });

  it('supports short hex, runs to the end of the line when unclosed, and ignores non-colours', () => {
    expect(parseInline('{#fff}white')).toEqual([{ text: 'white', bold: false, italic: false, light: false, color: '#fff' }]);
    expect(parseInline('{not a colour} {/}x')).toEqual([{ text: '{not a colour} x', bold: false, italic: false, light: false }]);
    expect(stripMarkup('{#123456}a{/} b')).toBe('a b');
  });
});

describe('parseMarkup', () => {
  it('detects headlines and blank lines and trims the edges', () => {
    const lines = parseMarkup('\n# ~jazz~ **samples**\n\nProduced by **DJ Premier**\n\n');
    expect(lines.map((l) => l.kind)).toEqual(['headline', 'blank', 'body']);
    expect(lines[0].runs.map((r) => r.text).join('')).toBe('jazz samples');
  });

  it('keeps literal dashes and quotes', () => {
    const lines = parseMarkup('-\n“N.Y. State of Mind”');
    expect(lines[0].runs[0].text).toBe('-');
    expect(lines[1].runs[0].text).toBe('“N.Y. State of Mind”');
  });
});

describe('stripMarkup', () => {
  it('returns plain single-line text', () => {
    expect(stripMarkup('**"Mind Rain" Joe Chambers**\n*Double Exposure* **1978**')).toBe(
      '"Mind Rain" Joe Chambers Double Exposure 1978',
    );
  });
});
