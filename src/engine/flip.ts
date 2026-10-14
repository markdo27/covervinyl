/**
 * Sample Flip mode: two clips back to back — a track and the original it
 * samples — each with its own cover and credits, then an optional card
 * showing both side by side. Model, defaults and timing — no DOM.
 */
import { easeInOutCubic } from './easing';
import { stripMarkup } from './markup';
import type { ExportSettings, PostSettings, Ratio, TextStyle } from './types';

export type FlipRole = 'new' | 'original';
export type FlipTransition = 'cut' | 'fade' | 'flash' | 'push';
export type FlipTextPosition = 'top' | 'middle' | 'bottom';

export interface FlipCredits {
  /** Small label above the title, e.g. "NEW" / "ORIGINAL". */
  tag: string;
  title: string;
  artist: string;
  released: string;
  album: string;
  genre: string;
  /** A short paragraph about the track (markup allowed). */
  story: string;
}

export interface FlipPart extends FlipCredits {
  /** Footage (video or photo), or null for the built-in stand-in. */
  assetId: string | null;
  /** Album cover image, or null for a placeholder sleeve. */
  coverId: string | null;
  /** Seconds into the clip to start from. */
  start: number;
  /** Seconds on screen. */
  duration: number;
  /** Clip sound level, 0 = muted. */
  volume: number;
}

export interface FlipLabels {
  released: string;
  album: string;
  genre: string;
}

export interface FlipLayout {
  position: FlipTextPosition;
  /** Show the album cover above the credits. */
  cover: boolean;
  /** Cover edge as a fraction of canvas width. */
  coverSize: number;
  /** Size of the story paragraph relative to the credits. */
  storyScale: number;
  /** Keep text inside Instagram's safe zone, shrinking it if it doesn't fit. */
  safeArea: boolean;
  /** 0..1 dark gradient behind the text. */
  scrim: number;
  /** Let the colour look, grain and vignette affect the text too. */
  gradeText: boolean;
}

export interface FlipProject {
  ratio: Ratio;
  /** [the new track, the original it samples]. */
  parts: [FlipPart, FlipPart];
  /** Which one plays first. */
  first: FlipRole;
  transition: FlipTransition;
  /** Big opening line over the first clip before its credits appear. */
  hook: { enabled: boolean; text: string; duration: number };
  showLabels: boolean;
  labels: FlipLabels;
  layout: FlipLayout;
  text: TextStyle;
  /** Colour of the NEW / ORIGINAL tags. */
  accent: string;
  footage: {
    /** 0..1 black over the clips. */
    dim: number;
    /** Slow push-in over each part, 0..0.25. */
    zoom: number;
  };
  /** Closing card: both covers side by side. */
  outro: { enabled: boolean; duration: number; text: string };
  post: PostSettings;
  export: ExportSettings;
}

export const NEW = 0;
export const ORIGINAL = 1;
export const MIN_PART_DURATION = 1;
/** Clips' sound crossfades over at least this long, even on a hard cut. */
export const AUDIO_CROSSFADE = 0.12;

export function newFlipPart(partial: Partial<FlipPart> = {}): FlipPart {
  return {
    assetId: null,
    coverId: null,
    start: 0,
    duration: 8,
    volume: 1,
    tag: '',
    title: '',
    artist: '',
    released: '',
    album: '',
    genre: '',
    story: '',
    ...partial,
  };
}

export function defaultFlip(): FlipProject {
  return {
    ratio: '9:16',
    parts: [
      newFlipPart({
        tag: 'New',
        title: 'Song Title',
        artist: 'Artist Name',
        released: 'March 1997',
        album: 'Album Title',
        genre: 'Hip-hop',
        story: 'How the new track flipped the sample — the bassline, the groove, the hook.',
      }),
      newFlipPart({
        tag: 'Original',
        title: 'Original Song',
        artist: 'Original Artist',
        released: 'July 1979',
        album: 'Album Title',
        genre: 'Jazz-funk, disco',
        story: 'A few words about the record that was sampled.',
      }),
    ],
    first: 'new',
    transition: 'push',
    hook: { enabled: true, text: '# ~the sample behind~\n# **{new}**', duration: 2.2 },
    showLabels: true,
    labels: { released: 'Released', album: 'Album', genre: 'Genre' },
    layout: { position: 'bottom', cover: true, coverSize: 0.26, storyScale: 0.82, safeArea: true, scrim: 0.7, gradeText: false },
    text: {
      family: 'inter',
      headlineFamily: 'inter',
      color: '#ffffff',
      size: 0.036,
      headlineScale: 1.9,
      lineHeight: 1.36,
      tracking: -0.01,
      weights: { light: 300, regular: 400, bold: 700 },
      shadow: true,
    },
    accent: '#e2402f',
    footage: { dim: 0.08, zoom: 0.06 },
    outro: { enabled: true, duration: 3, text: '**your name** archives' },
    post: { lut: 'film-print', lutIntensity: 0.45, grain: 0.25, grainSize: 1.5, vignette: 0.2 },
    export: { resolution: 1080, fps: 30, method: 'auto' },
  };
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/** A four-digit year from a release date like "March 1997". */
export function yearOf(released: string): string {
  return /\b(1[89]\d\d|20\d\d)\b/.exec(released)?.[1] ?? '';
}

/** Replaces {new}, {original}, {new-artist}, {original-artist}, {new-year} and {original-year}. */
export function fillTemplate(text: string, p: Pick<FlipProject, 'parts'>): string {
  const values: Record<string, string> = {};
  (['new', 'original'] as const).forEach((role, i) => {
    const part = p.parts[i];
    values[role] = stripMarkup(part.title);
    values[`${role}-artist`] = stripMarkup(part.artist);
    values[`${role}-year`] = yearOf(part.released);
  });
  return text.replace(/\{(new|original)(-artist|-year)?\}/g, (_, role: string, suffix = '') => values[role + suffix] ?? '');
}

/** Title, artist and the labelled details as CoverVinyl markup. */
export function creditsMarkup(part: FlipCredits, p: Pick<FlipProject, 'showLabels' | 'labels'>): string {
  const lines: string[] = [];
  const label = (key: keyof FlipLabels, value: string) => {
    const word = p.labels[key].trim();
    return p.showLabels && word ? `~${word}~ ${value}` : value;
  };
  if (part.title.trim()) lines.push(`# **${part.title.trim()}**`);
  if (part.artist.trim()) lines.push(part.artist.trim());
  if (part.released.trim()) lines.push(label('released', part.released.trim()));
  if (part.album.trim()) lines.push(label('album', `*${part.album.trim()}*`));
  if (part.genre.trim()) lines.push(label('genre', part.genre.trim()));
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* ------------------------------------------------------------------ */

export interface FlipTimeline {
  /** Part indices (NEW = 0, ORIGINAL = 1) in play order. */
  order: [number, number];
  /** On-screen span of each part, by part index. */
  parts: { start: number; end: number }[];
  /** When each part's clip starts playing — a moment before its span when the transition overlaps. */
  playStart: number[];
  /** Time of the switch from the first part to the second. */
  cut: number;
  /** Seconds both parts are on screen around the cut (fade / push). */
  overlap: number;
  /** Seconds both clips are audible around the cut. */
  crossfade: number;
  outroStart: number;
  total: number;
}

export function transitionOverlap(transition: FlipTransition): number {
  return transition === 'fade' || transition === 'push' ? 0.6 : 0;
}

export function buildFlipTimeline(p: Pick<FlipProject, 'parts' | 'first' | 'transition' | 'outro'>): FlipTimeline {
  const order: [number, number] = p.first === 'new' ? [NEW, ORIGINAL] : [ORIGINAL, NEW];
  const d0 = Math.max(MIN_PART_DURATION, p.parts[order[0]].duration || 0);
  const d1 = Math.max(MIN_PART_DURATION, p.parts[order[1]].duration || 0);
  const cut = d0;
  const overlap = Math.min(transitionOverlap(p.transition), d0 / 2, d1 / 2);
  const crossfade = Math.max(overlap, AUDIO_CROSSFADE);
  const outroStart = d0 + d1;
  const total = outroStart + (p.outro.enabled ? Math.max(0.5, p.outro.duration) : 0);
  const parts: FlipTimeline['parts'] = [];
  const playStart: number[] = [];
  parts[order[0]] = { start: 0, end: cut };
  parts[order[1]] = { start: cut, end: outroStart };
  playStart[order[0]] = 0;
  playStart[order[1]] = cut - crossfade / 2;
  return { order, parts, playStart, cut, overlap, crossfade, outroStart, total };
}

export interface FlipLayer {
  part: number;
  alpha: number;
  /** Vertical offset as a fraction of the canvas height (push transition). */
  offset: number;
  /** Seconds since this part's clip started playing. */
  local: number;
}

export interface FlipLayers {
  layers: FlipLayer[];
  /** 0..1 white flash after the cut. */
  flash: number;
  /** 0..1 progress into the closing card. */
  outro: number;
}

/** Which parts are on screen at t, back to front. */
export function flipLayersAt(p: Pick<FlipProject, 'transition'>, tl: FlipTimeline, t: number): FlipLayers {
  const [a, b] = tl.order;
  const lo = tl.cut - tl.overlap / 2;
  const layer = (part: number, alpha: number, offset: number): FlipLayer => ({
    part,
    alpha,
    offset,
    local: Math.max(0, t - tl.playStart[part]),
  });
  let layers: FlipLayer[];
  if (tl.overlap > 0 && t >= lo && t < lo + tl.overlap) {
    const e = easeInOutCubic((t - lo) / tl.overlap);
    layers = p.transition === 'push' ? [layer(a, 1, -e), layer(b, 1, 1 - e)] : [layer(a, 1, 0), layer(b, e, 0)];
  } else {
    layers = [layer(t < tl.cut ? a : b, 1, 0)];
  }
  const sinceCut = t - tl.cut;
  const flash = p.transition === 'flash' && sinceCut >= 0 && sinceCut < 0.35 ? Math.pow(1 - sinceCut / 0.35, 2) : 0;
  const outro = t >= tl.outroStart ? Math.min(1, (t - tl.outroStart) / 0.6) : 0;
  return { layers, flash, outro };
}

/** Time in a part's clip `local` seconds after it started playing, looping a clip that's too short. */
export function flipClipTime(part: Pick<FlipPart, 'start'>, clipDuration: number, local: number): number {
  const usable = Math.max(0.05, clipDuration - part.start);
  return part.start + (((local % usable) + usable) % usable);
}

/** When a part's sound is audible: from its clip starting to the end of the crossfade (or the end). */
export function audioWindow(tl: FlipTimeline, part: number): { start: number; end: number } {
  const first = part === tl.order[0];
  return { start: tl.playStart[part], end: first ? tl.cut + tl.crossfade / 2 : tl.total };
}

const END_FADE = 0.6;

/** Loudness of a part's clip at t: its volume, crossfaded at the cut and faded out at the very end. */
export function flipAudioGain(p: Pick<FlipProject, 'parts'>, tl: FlipTimeline, part: number, t: number): number {
  const volume = Math.max(0, Math.min(1, p.parts[part].volume));
  if (volume <= 0) return 0;
  const lo = tl.cut - tl.crossfade / 2;
  const k = Math.min(1, Math.max(0, (t - lo) / tl.crossfade));
  let gain = part === tl.order[0] ? 1 - k : k;
  if (t > tl.total - END_FADE) gain *= Math.max(0, (tl.total - t) / END_FADE);
  return gain * volume;
}
