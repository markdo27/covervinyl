import type { Project, Slide } from './types';

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function newSlide(partial: Partial<Slide> = {}): Slide {
  return {
    id: uid('slide'),
    coverId: null,
    texts: {},
    morphFrom: '',
    duration: 4,
    ...partial,
  };
}

const MAIN_SECTION = 'sec-main';
const FOOTER_SECTION = 'sec-footer';

export function defaultProject(): Project {
  return {
    ratio: '9:16',
    slides: [
      newSlide({
        morphFrom: '# ~vinyl~**cuts**',
        texts: { [MAIN_SECTION]: '# ~vinyl samples:~ **deep cuts**' },
        duration: 3.5,
      }),
      newSlide({
        texts: {
          [MAIN_SECTION]:
            '**"Song Title" Artist Name**\n*Album Title* **1978**\n-\n**"Track It Was Sampled On"**\nProduced by **Producer**',
        },
      }),
      newSlide({
        texts: {
          [MAIN_SECTION]:
            '**"Another Song" Another Artist**\n*Album Title* **1975**\n-\n**"Track Name"**\nProduced by **Producer**',
        },
      }),
    ],
    sections: [
      { id: MAIN_SECTION, name: 'Slide text', mode: 'slide', text: '', scale: 1, gap: 0, color: null },
      {
        id: FOOTER_SECTION,
        name: 'Footer',
        mode: 'shared',
        text: '**your name** archives #01',
        scale: 0.85,
        gap: 1.6,
        color: null,
      },
    ],
    text: {
      family: 'inter',
      headlineFamily: 'inter',
      color: '#ffffff',
      size: 0.039,
      headlineScale: 1.55,
      lineHeight: 1.42,
      tracking: -0.01,
      weights: { light: 300, regular: 400, bold: 700 },
      shadow: true,
    },
    cover: {
      size: 0.29,
      stackOffset: 0.12,
      stackCount: 5,
      radius: 0,
      shadow: true,
    },
    placement: {
      '9:16': { x: 0.14, y: 0.3 },
      '3:4': { x: 0.14, y: 0.17 },
    },
    video: {
      start: 0,
      zoom: 1,
      panX: 0,
      panY: 0,
      dim: 0.12,
      loop: true,
      audio: true,
    },
    motion: {
      transition: 0.6,
      fanOut: true,
      introDelay: 0.45,
      morphDuration: 0.9,
    },
    endCard: {
      enabled: true,
      logoId: null,
      logoSize: 0.28,
      logoColor: null,
      text: '**your name**\n~record bar~',
      duration: 2.5,
    },
    post: {
      lut: 'none',
      lutIntensity: 1,
      grain: 0,
      grainSize: 1.5,
      vignette: 0,
    },
    export: {
      resolution: 1080,
      fps: 30,
      method: 'auto',
    },
  };
}

export const OUTPUT_SIZES = {
  '9:16': { 1080: [1080, 1920], 720: [720, 1280] },
  '3:4': { 1080: [1080, 1440], 720: [720, 960] },
} as const;
