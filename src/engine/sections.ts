import { uid } from './defaults';
import { stripMarkup } from './markup';
import type { Project, Slide, TextSection } from './types';

export const PLACEHOLDER_CREDITS =
  '**"Song Title" Artist Name**\n*Album Title* **1970**\n-\n**"Track It Was Sampled On"**\nProduced by **Producer**';

export function newSection(mode: TextSection['mode'], existing: TextSection[]): TextSection {
  const n = existing.length + 1;
  return {
    id: uid('sec'),
    name: mode === 'slide' ? `Slide text ${n}` : `Text ${n}`,
    mode,
    text: '',
    scale: 1,
    gap: existing.length ? 1 : 0,
    color: null,
  };
}

/** The per-slide section that the intro morph applies to (the first one). */
export function morphSection(sections: TextSection[]): TextSection | undefined {
  return sections.find((s) => s.mode === 'slide');
}

/** Final markup of a section on a given slide. */
export function sectionMarkup(section: TextSection, slide: Slide): string {
  return section.mode === 'shared' ? section.text : (slide.texts[section.id] ?? '');
}

/** A one-line label for a slide, taken from its first non-empty per-slide text. */
export function slideCaption(project: Pick<Project, 'sections'>, slide: Slide): string {
  for (const section of project.sections) {
    if (section.mode !== 'slide') continue;
    const plain = stripMarkup(slide.texts[section.id] ?? '');
    if (plain) return plain;
  }
  return '';
}

/**
 * Stacks sections vertically: returns each section's top offset. Empty
 * sections (height 0) take no space and add no gap.
 */
export function stackSections(heights: number[], gaps: number[], lineHeight: number): number[] {
  const tops: number[] = [];
  let y = 0;
  let first = true;
  heights.forEach((h, k) => {
    if (h <= 0) {
      tops.push(y);
      return;
    }
    if (!first) y += gaps[k] * lineHeight;
    tops.push(y);
    y += h;
    first = false;
  });
  return tops;
}
