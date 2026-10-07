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
    text: '**"Song Title" Artist Name**\n*Album Title* **1970**\n-\n**"Track It Was Sampled On"**\nProduced by **Producer**',
    morphFrom: '',
    duration: 4,
    ...partial,
  };
}

export function defaultProject(): Project {
  return {
    ratio: '9:16',
    slides: [
      newSlide({
        morphFrom: '# ~vinyl~**cuts**',
        text: '# ~vinyl samples:~ **deep cuts**',
        duration: 3.5,
      }),
      newSlide({
        text: '**"Song Title" Artist Name**\n*Album Title* **1978**\n-\n**"Track It Was Sampled On"**\nProduced by **Producer**',
      }),
      newSlide({
        text: '**"Another Song" Another Artist**\n*Album Title* **1975**\n-\n**"Track Name"**\nProduced by **Producer**',
      }),
    ],
    footer: '**your name** archives #01',
    footerGap: 1.6,
    text: {
      family: 'inter',
      headlineFamily: 'inter',
      color: '#ffffff',
      size: 0.039,
      headlineScale: 1.55,
      footerScale: 0.85,
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
      text: '**your name**\n~record bar~',
      duration: 2.5,
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
