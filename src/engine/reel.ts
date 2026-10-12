/**
 * Photo Reel mode: a beat-cut sequence of the user's photos and clips with
 * an animated (alpha) overlay on top. Model, defaults and timing — no DOM.
 */
import { uid } from './defaults';
import { sourceTime } from './timeline';
import type { ExportSettings, PostSettings, Ratio } from './types';

export interface MediaAsset {
  id: string;
  kind: 'image' | 'video';
  name: string;
  file: File;
  url: string;
  width: number;
  height: number;
  /** Seconds (videos only, 0 for photos). */
  duration: number;
  /** Decoded photo (images only). */
  image: HTMLImageElement | null;
  /** Small preview for the UI. */
  thumb: string;
}

export interface ReelItem {
  id: string;
  /** Media asset, or null for a placeholder frame. */
  assetId: string | null;
  /** Seconds on screen. */
  duration: number;
  /** Seconds into a video clip to start playing from. */
  start: number;
}

export type ReelTransition = 'cut' | 'fade' | 'flash';
export type OverlayBlend = 'normal' | 'screen' | 'multiply' | 'overlay';

export interface ReelOverlay {
  /** Uploaded overlay animation, or null for the built-in demo. */
  assetId: string | null;
  visible: boolean;
  /** Centre of the overlay as fractions of canvas width / height. */
  x: number;
  y: number;
  /** Overlay width as a fraction of canvas width. */
  scale: number;
  opacity: number;
  /** Playback speed multiplier. */
  speed: number;
  /** Frame rate for image sequences. */
  fps: number;
  blend: OverlayBlend;
  /** Keep the overlay out of the colour look, grain and vignette. */
  abovePost: boolean;
}

export interface ReelMusic {
  assetId: string | null;
  /** Seconds into the track to start from. */
  start: number;
  volume: number;
}

export interface ReelProject {
  ratio: Ratio;
  items: ReelItem[];
  transition: ReelTransition;
  /** Slow push-in on every shot, 0..0.25 (fraction of extra scale by the end of the shot). */
  zoom: number;
  bpm: number;
  beatsPerCut: number;
  overlay: ReelOverlay;
  music: ReelMusic;
  post: PostSettings;
  export: ExportSettings;
}

export const MIN_ITEM_DURATION = 0.1;

export function beatDuration(bpm: number, beatsPerCut: number): number {
  return Math.max(MIN_ITEM_DURATION, Math.round((60 / Math.max(20, bpm)) * beatsPerCut * 1000) / 1000);
}

export function newReelItem(partial: Partial<ReelItem> = {}): ReelItem {
  return { id: uid('shot'), assetId: null, duration: 0.5, start: 0, ...partial };
}

export function defaultReel(): ReelProject {
  const bpm = 120;
  const beatsPerCut = 1;
  const duration = beatDuration(bpm, beatsPerCut);
  return {
    ratio: '9:16',
    items: Array.from({ length: 8 }, () => newReelItem({ duration })),
    transition: 'cut',
    zoom: 0,
    bpm,
    beatsPerCut,
    overlay: {
      assetId: null,
      visible: true,
      x: 0.5,
      y: 0.48,
      scale: 0.62,
      opacity: 1,
      speed: 1,
      fps: 12,
      blend: 'normal',
      abovePost: true,
    },
    music: { assetId: null, start: 0, volume: 1 },
    post: { lut: 'warm-70s', lutIntensity: 0.6, grain: 0.35, grainSize: 1.5, vignette: 0.25 },
    export: { resolution: 1080, fps: 30, method: 'auto' },
  };
}

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* ------------------------------------------------------------------ */

export interface ReelTimeline {
  starts: number[];
  total: number;
}

export function buildReelTimeline(items: ReelItem[]): ReelTimeline {
  const starts: number[] = [];
  let t = 0;
  for (const item of items) {
    starts.push(t);
    t += Math.max(MIN_ITEM_DURATION, item.duration || 0);
  }
  return { starts, total: Math.max(t, MIN_ITEM_DURATION) };
}

export function reelIndexAt(tl: ReelTimeline, t: number): number {
  const { starts } = tl;
  if (!starts.length) return -1;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface ReelLayer {
  index: number;
  /** Seconds since the shot started (negative while fading in early). */
  local: number;
  alpha: number;
}

/** Which shots are visible at time t, bottom to top, plus the white flash amount. */
export function reelLayersAt(project: Pick<ReelProject, 'items' | 'transition'>, tl: ReelTimeline, t: number) {
  const n = project.items.length;
  const i = reelIndexAt(tl, t);
  if (i < 0) return { layers: [] as ReelLayer[], flash: 0 };
  const dur = (k: number) => Math.max(MIN_ITEM_DURATION, project.items[k].duration);
  const layers: ReelLayer[] = [{ index: i, local: t - tl.starts[i], alpha: 1 }];
  let flash = 0;

  if (project.transition === 'fade') {
    // Crossfade centred on each cut, never longer than half a shot.
    const fadeLen = (k: number) => Math.min(0.3, dur(k) * 0.5, k > 0 ? dur(k - 1) * 0.5 : Infinity);
    const end = tl.starts[i] + dur(i);
    if (i + 1 < n) {
      const f = fadeLen(i + 1);
      if (t > end - f / 2) layers.push({ index: i + 1, local: t - tl.starts[i + 1], alpha: (t - (end - f / 2)) / f });
    }
    if (i > 0) {
      const f = fadeLen(i);
      if (t < tl.starts[i] + f / 2) {
        layers[0].alpha = (t - (tl.starts[i] - f / 2)) / f;
        layers.unshift({ index: i - 1, local: t - tl.starts[i - 1], alpha: 1 });
      }
    }
  } else if (project.transition === 'flash' && i > 0) {
    flash = Math.max(0, 1 - (t - tl.starts[i]) / 0.18);
  }
  return { layers, flash };
}

/** Time inside a video clip for a shot that has been on screen for `local` seconds (loops the clip). */
export function clipTime(item: ReelItem, clipDuration: number, local: number): number {
  return sourceTime(Math.max(0, local), { start: Math.min(item.start, Math.max(0, clipDuration - 0.1)), loop: true, duration: clipDuration });
}

/** Time inside the overlay animation at reel time t (loops). */
export function overlayTime(t: number, speed: number, duration: number): number {
  if (duration <= 0) return 0;
  const x = t * Math.max(0.05, speed);
  return ((x % duration) + duration) % duration;
}

/** Sets every shot to the same length (e.g. from the BPM). */
export function setAllDurations(project: ReelProject, duration: number): ReelProject {
  return { ...project, items: project.items.map((it) => ({ ...it, duration })) };
}
