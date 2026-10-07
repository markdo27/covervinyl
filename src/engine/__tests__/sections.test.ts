import { describe, expect, it } from 'vitest';
import { morphSection, newSection, sectionMarkup, slideCaption, stackSections } from '../sections';
import type { Slide, TextSection } from '../types';

const section = (id: string, mode: TextSection['mode'], text = ''): TextSection => ({
  id,
  name: id,
  mode,
  text,
  scale: 1,
  gap: 1,
});
const slide = (texts: Record<string, string>): Slide => ({ id: 's', coverId: null, texts, morphFrom: '', duration: 3 });

describe('stackSections', () => {
  it('adds gaps only between non-empty sections', () => {
    expect(stackSections([30, 20], [0, 2], 10)).toEqual([0, 50]);
    // The empty middle section takes no space and its gap is skipped.
    expect(stackSections([30, 0, 20], [0, 5, 1], 10)).toEqual([0, 30, 40]);
    // A leading empty section doesn't push the first visible one down.
    expect(stackSections([0, 20], [0, 3], 10)).toEqual([0, 0]);
  });
});

describe('section helpers', () => {
  const sections = [section('footer', 'shared', '**me**'), section('credits', 'slide'), section('extra', 'slide')];

  it('reads shared and per-slide markup', () => {
    const s = slide({ credits: 'Song' });
    expect(sectionMarkup(sections[0], s)).toBe('**me**');
    expect(sectionMarkup(sections[1], s)).toBe('Song');
    expect(sectionMarkup(sections[2], s)).toBe('');
  });

  it('morphs the first per-slide section', () => {
    expect(morphSection(sections)?.id).toBe('credits');
    expect(morphSection([sections[0]])).toBeUndefined();
  });

  it('captions a slide from its first non-empty per-slide text', () => {
    expect(slideCaption({ sections }, slide({ credits: '', extra: '**Hi** there' }))).toBe('Hi there');
    expect(slideCaption({ sections }, slide({}))).toBe('');
  });

  it('creates sections with a gap only when others exist', () => {
    expect(newSection('shared', []).gap).toBe(0);
    expect(newSection('slide', sections)).toMatchObject({ mode: 'slide', gap: 1, scale: 1 });
  });
});
