/**
 * Presets: one editor's settings and text saved as a JSON file, optionally
 * with the user's own files (fonts, .cube LUT, logo, overlay animation)
 * embedded as base64 so the preset works on any device. Media — clips,
 * covers, photos — is never part of a preset.
 *
 * Pure data functions; reading and writing actual files is in lib/presetFiles.ts.
 */
import { defaultProject, newSlide, uid } from './defaults';
import { CUSTOM_LUT_PREFIX, LOOKS, type Lut } from './luts';
import { defaultReel, MIN_ITEM_DURATION, setAllDurations, type ReelOverlay, type ReelProject, type ReelTransition } from './reel';
import {
  RATIOS,
  type CoverStyle,
  type EndCard,
  type ExportSettings,
  type MotionSettings,
  type Placement,
  type PostSettings,
  type Project,
  type Ratio,
  type TextSection,
  type TextStyle,
  type VideoSettings,
} from './types';

export const PRESET_APP = 'CoverVinyl';
export const PRESET_VERSION = 1;
export const PRESET_EXTENSION = '.covervinyl.json';

export type PresetMode = 'cover' | 'reel';

/** A file carried inside the preset. */
export interface EmbeddedFile {
  name: string;
  type: string;
  /** Base64 of the file's bytes. */
  data: string;
}

/** An uploaded .cube LUT, stored as its baked table. */
export interface EmbeddedLut {
  name: string;
  size: number;
  /** Base64 of size³ RGB bytes, red varying fastest. */
  data: string;
}

export interface PresetFiles {
  fonts?: EmbeddedFile[];
  lut?: EmbeddedLut;
  logo?: EmbeddedFile;
  /** One file, or every frame of an image sequence. */
  overlay?: EmbeddedFile[];
}

export interface CoverPresetSettings {
  ratio: Ratio;
  text: TextStyle;
  cover: CoverStyle;
  placement: Record<Ratio, Placement>;
  video: Omit<VideoSettings, 'start'>;
  motion: MotionSettings;
  sections: TextSection[];
  slides: { texts: Record<string, string>; morphFrom: string; duration: number }[];
  endCard: Omit<EndCard, 'logoId'>;
  post: PostSettings;
  export: ExportSettings;
}

export interface ReelPresetSettings {
  ratio: Ratio;
  transition: ReelTransition;
  zoom: number;
  bpm: number;
  beatsPerCut: number;
  /** Length given to every shot. */
  shotLength: number;
  overlay: Omit<ReelOverlay, 'assetId'>;
  music: { volume: number };
  post: PostSettings;
  export: ExportSettings;
}

interface PresetHeader {
  app: typeof PRESET_APP;
  type: 'preset';
  version: number;
  name: string;
  savedAt: string;
  files: PresetFiles;
}

export type CoverPreset = PresetHeader & { mode: 'cover'; settings: CoverPresetSettings };
export type ReelPreset = PresetHeader & { mode: 'reel'; settings: ReelPresetSettings };
export type Preset = CoverPreset | ReelPreset;

/* ------------------------------------------------------------------ */
/* Parts a preset can be applied in                                    */
/* ------------------------------------------------------------------ */

export type CoverGroup = 'style' | 'look' | 'sections' | 'slides' | 'endCard';
export type ReelGroup = 'overlay' | 'look' | 'timing';
export type PresetGroup = CoverGroup | ReelGroup;

export interface GroupInfo<G extends PresetGroup = PresetGroup> {
  key: G;
  label: string;
  detail: string;
}

export const COVER_GROUPS: GroupInfo<CoverGroup>[] = [
  { key: 'style', label: 'Text style & layout', detail: 'Fonts, text size and colour, covers, placement, motion, clip framing, format' },
  { key: 'look', label: 'Look & grain', detail: 'Colour look or LUT, grain, vignette' },
  { key: 'sections', label: 'Text sections', detail: 'Which sections, their sizes, spacing and colours, footer text' },
  { key: 'slides', label: 'Slide text', detail: 'Each slide’s text, morph intro and duration — your covers stay' },
  { key: 'endCard', label: 'End card', detail: 'Logo, logo colour, text and duration' },
];

export const REEL_GROUPS: GroupInfo<ReelGroup>[] = [
  { key: 'overlay', label: 'Animation on top', detail: 'The animation, its size, position, opacity, speed and blend' },
  { key: 'look', label: 'Look & grain', detail: 'Colour look or LUT, grain, vignette' },
  { key: 'timing', label: 'Timing & format', detail: 'Shot length, BPM, transition, zoom, music volume, ratio, export' },
];

export function presetGroups(mode: PresetMode): GroupInfo[] {
  return mode === 'cover' ? COVER_GROUPS : REEL_GROUPS;
}

/* ------------------------------------------------------------------ */
/* Capturing settings                                                  */
/* ------------------------------------------------------------------ */

export function coverPresetSettings(p: Project): CoverPresetSettings {
  const { zoom, panX, panY, dim, loop, audio } = p.video;
  const { enabled, logoSize, logoColor, text, duration } = p.endCard;
  return {
    ratio: p.ratio,
    text: p.text,
    cover: p.cover,
    placement: p.placement,
    video: { zoom, panX, panY, dim, loop, audio },
    motion: p.motion,
    sections: p.sections,
    slides: p.slides.map((s) => ({ texts: s.texts, morphFrom: s.morphFrom, duration: s.duration })),
    endCard: { enabled, logoSize, logoColor, text, duration },
    post: p.post,
    export: p.export,
  };
}

/** The most common shot length, so one odd shot doesn't define the preset. */
function commonDuration(p: ReelProject): number {
  const counts = new Map<number, number>();
  for (const item of p.items) counts.set(item.duration, (counts.get(item.duration) ?? 0) + 1);
  let best = p.items[0]?.duration ?? 0.5;
  for (const [d, n] of counts) if (n > (counts.get(best) ?? 0)) best = d;
  return best;
}

export function reelPresetSettings(p: ReelProject): ReelPresetSettings {
  const { visible, x, y, scale, opacity, speed, fps, blend, abovePost } = p.overlay;
  return {
    ratio: p.ratio,
    transition: p.transition,
    zoom: p.zoom,
    bpm: p.bpm,
    beatsPerCut: p.beatsPerCut,
    shotLength: commonDuration(p),
    overlay: { visible, x, y, scale, opacity, speed, fps, blend, abovePost },
    music: { volume: p.music.volume },
    post: p.post,
    export: p.export,
  };
}

/* ------------------------------------------------------------------ */
/* Applying settings                                                   */
/* ------------------------------------------------------------------ */

export interface ApplyContext {
  /** Key the preset's embedded LUT is registered under, or null if it has none. */
  lutKey: string | null;
}

export interface CoverApplyContext extends ApplyContext {
  /** Whether a font key can be drawn (built-in, or an uploaded family that's loaded). */
  hasFont: (key: string) => boolean;
  /** The preset's logo once loaded, or null to keep the current logo. */
  logoId: string | null;
}

/** Points a custom LUT at the copy loaded from the preset (or drops it when the preset didn't carry it). */
function resolvePost(post: PostSettings, lutKey: string | null): PostSettings {
  return post.lut.startsWith(CUSTOM_LUT_PREFIX) ? { ...post, lut: lutKey ?? 'none' } : post;
}

/**
 * Re-keys slide text from one list of sections to another: ids that exist
 * in both carry over, the rest map by position among per-slide sections.
 */
export function remapSlideTexts(texts: Record<string, string>, from: TextSection[], to: TextSection[]): Record<string, string> {
  const toIds = new Set(to.map((s) => s.id));
  const fromSlide = from.filter((s) => s.mode === 'slide');
  const toSlide = to.filter((s) => s.mode === 'slide');
  const out: Record<string, string> = {};
  for (const [id, text] of Object.entries(texts)) if (toIds.has(id)) out[id] = text;
  for (const [id, text] of Object.entries(texts)) {
    if (toIds.has(id)) continue;
    const target = toSlide[fromSlide.findIndex((s) => s.id === id)];
    if (target && !(target.id in out)) out[target.id] = text;
  }
  return out;
}

export function applyCoverPreset(p: Project, s: CoverPresetSettings, groups: ReadonlySet<PresetGroup>, ctx: CoverApplyContext): Project {
  let next: Project = { ...p };
  if (groups.has('style')) {
    const font = (key: string) => (ctx.hasFont(key) ? key : 'inter');
    next = {
      ...next,
      ratio: s.ratio,
      text: { ...s.text, family: font(s.text.family), headlineFamily: font(s.text.headlineFamily) },
      cover: s.cover,
      placement: s.placement,
      video: { ...s.video, start: p.video.start },
      motion: s.motion,
      export: s.export,
    };
  }
  if (groups.has('look')) next.post = resolvePost(s.post, ctx.lutKey);
  if (groups.has('sections')) {
    next.sections = s.sections;
    next.slides = next.slides.map((slide) => ({ ...slide, texts: remapSlideTexts(slide.texts, p.sections, s.sections) }));
  }
  if (groups.has('slides') && s.slides.length) {
    // Text goes onto the current slides in order, keeping their covers; extra preset slides
    // arrive with placeholder covers that the next cover upload fills.
    const incoming = s.slides.map((ps, i) => {
      const texts = remapSlideTexts(ps.texts, s.sections, next.sections);
      const current = next.slides[i];
      return current
        ? { ...current, texts, morphFrom: ps.morphFrom, duration: ps.duration }
        : newSlide({ texts, morphFrom: ps.morphFrom, duration: ps.duration });
    });
    next.slides = [...incoming, ...next.slides.slice(incoming.length)];
  }
  if (groups.has('endCard')) next.endCard = { ...s.endCard, logoId: ctx.logoId ?? p.endCard.logoId };
  return next;
}

export function applyReelPreset(p: ReelProject, s: ReelPresetSettings, groups: ReadonlySet<PresetGroup>, ctx: ApplyContext): ReelProject {
  let next: ReelProject = { ...p };
  if (groups.has('overlay')) next.overlay = { ...s.overlay, assetId: p.overlay.assetId };
  if (groups.has('look')) next.post = resolvePost(s.post, ctx.lutKey);
  if (groups.has('timing')) {
    next = setAllDurations(
      {
        ...next,
        ratio: s.ratio,
        transition: s.transition,
        zoom: s.zoom,
        bpm: s.bpm,
        beatsPerCut: s.beatsPerCut,
        music: { ...p.music, volume: s.music.volume },
        export: s.export,
      },
      s.shotLength,
    );
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Building + reading preset files                                     */
/* ------------------------------------------------------------------ */

export function makePreset(name: string, body: { mode: 'cover'; settings: CoverPresetSettings } | { mode: 'reel'; settings: ReelPresetSettings }, files: PresetFiles): Preset {
  return {
    app: PRESET_APP,
    type: 'preset',
    version: PRESET_VERSION,
    name: name.trim() || 'My preset',
    savedAt: new Date().toISOString(),
    ...body,
    files,
  } as Preset;
}

export function presetFileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return (slug || 'preset') + PRESET_EXTENSION;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Takes `value` where it has the same shape as `def`, falling back to `def` field by field. */
function conform<T>(def: T, value: unknown): T {
  if (def === null) return (typeof value === 'string' || value === null ? value : def) as T;
  if (typeof def === 'number') return (typeof value === 'number' && Number.isFinite(value) ? value : def) as T;
  if (Array.isArray(def)) return def;
  if (isObj(def)) {
    if (!isObj(value)) return def;
    const out: Obj = {};
    for (const key of Object.keys(def)) out[key] = conform(def[key], value[key]);
    return out as T;
  }
  return (typeof value === typeof def ? value : def) as T;
}

const oneOf = <T>(value: T, allowed: readonly T[], fallback: T): T => (allowed.includes(value) ? value : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function cleanPost(post: PostSettings, fallback: PostSettings): PostSettings {
  const known = post.lut === 'none' || post.lut.startsWith(CUSTOM_LUT_PREFIX) || LOOKS.some((l) => l.key === post.lut);
  return { ...post, lut: known ? post.lut : fallback.lut };
}

function cleanExport(e: ExportSettings, fallback: ExportSettings): ExportSettings {
  return {
    resolution: oneOf(e.resolution, [1080, 720] as const, fallback.resolution),
    fps: oneOf(e.fps, [24, 30, 60] as const, fallback.fps),
    method: oneOf(e.method, ['auto', 'realtime'] as const, fallback.method),
  };
}

const cleanRatio = (r: Ratio, fallback: Ratio): Ratio => (r in RATIOS ? r : fallback);

function cleanTexts(value: unknown): Record<string, string> {
  if (!isObj(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v;
  return out;
}

function cleanSections(value: unknown, fallback: TextSection[]): TextSection[] {
  if (!Array.isArray(value)) return fallback;
  const template: TextSection = { id: '', name: 'Text', mode: 'slide', text: '', scale: 1, gap: 0, color: null };
  const seen = new Set<string>();
  return value.slice(0, 24).map((raw) => {
    const s = conform(template, raw);
    const id = s.id && !seen.has(s.id) ? s.id : uid('sec');
    seen.add(id);
    return { ...s, id, mode: oneOf(s.mode, ['slide', 'shared'] as const, 'slide'), scale: clamp(s.scale, 0.2, 5) };
  });
}

function cleanCover(raw: unknown): CoverPresetSettings {
  const def = coverPresetSettings(defaultProject());
  const s = conform(def, raw);
  const rawSlides = isObj(raw) && Array.isArray(raw.slides) ? raw.slides : [];
  const slides = rawSlides.slice(0, 300).map((r) => {
    const slide = conform({ texts: {}, morphFrom: '', duration: 4 }, r);
    return { ...slide, texts: cleanTexts(isObj(r) ? r.texts : null), duration: clamp(slide.duration, 0.3, 120) };
  });
  return {
    ...s,
    ratio: cleanRatio(s.ratio, def.ratio),
    sections: cleanSections(isObj(raw) ? raw.sections : null, def.sections),
    slides: slides.length ? slides : def.slides,
    post: cleanPost(s.post, def.post),
    export: cleanExport(s.export, def.export),
  };
}

function cleanReel(raw: unknown): ReelPresetSettings {
  const def = reelPresetSettings(defaultReel());
  const s = conform(def, raw);
  return {
    ...s,
    ratio: cleanRatio(s.ratio, def.ratio),
    transition: oneOf(s.transition, ['cut', 'fade', 'flash'] as const, def.transition),
    bpm: clamp(s.bpm, 20, 400),
    shotLength: clamp(s.shotLength, MIN_ITEM_DURATION, 60),
    overlay: { ...s.overlay, blend: oneOf(s.overlay.blend, ['normal', 'screen', 'multiply', 'overlay'] as const, def.overlay.blend) },
    post: cleanPost(s.post, def.post),
    export: cleanExport(s.export, def.export),
  };
}

function cleanFile(v: unknown): EmbeddedFile | undefined {
  if (!isObj(v) || typeof v.name !== 'string' || typeof v.data !== 'string') return undefined;
  return { name: v.name, type: typeof v.type === 'string' ? v.type : '', data: v.data };
}

function cleanFiles(raw: unknown): PresetFiles {
  if (!isObj(raw)) return {};
  const files: PresetFiles = {};
  const list = (v: unknown) => (Array.isArray(v) ? v.map(cleanFile).filter((f): f is EmbeddedFile => !!f) : []);
  const fonts = list(raw.fonts);
  if (fonts.length) files.fonts = fonts;
  const overlay = list(raw.overlay);
  if (overlay.length) files.overlay = overlay;
  const logo = cleanFile(raw.logo);
  if (logo) files.logo = logo;
  const lut = raw.lut;
  if (isObj(lut) && typeof lut.name === 'string' && typeof lut.size === 'number' && typeof lut.data === 'string') {
    files.lut = { name: lut.name, size: lut.size, data: lut.data };
  }
  return files;
}

/** Validates a parsed JSON preset, filling anything missing or invalid with defaults. */
export function parsePreset(raw: unknown): Preset {
  if (!isObj(raw) || raw.app !== PRESET_APP || raw.type !== 'preset') {
    throw new Error('That file isn’t a CoverVinyl preset.');
  }
  if (typeof raw.version === 'number' && raw.version > PRESET_VERSION) {
    throw new Error('That preset was saved by a newer version of CoverVinyl — reload the page to update the app.');
  }
  if (raw.mode !== 'cover' && raw.mode !== 'reel') throw new Error('That preset is for an editor this app doesn’t have.');
  const header = {
    app: PRESET_APP as typeof PRESET_APP,
    type: 'preset' as const,
    version: PRESET_VERSION,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : 'Preset',
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
    files: cleanFiles(raw.files),
  };
  return raw.mode === 'cover'
    ? { ...header, mode: 'cover', settings: cleanCover(raw.settings) }
    : { ...header, mode: 'reel', settings: cleanReel(raw.settings) };
}

/* ------------------------------------------------------------------ */
/* Base64 + LUT packing                                                */
/* ------------------------------------------------------------------ */

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Packs a LUT's RGBA table as RGB (alpha is always opaque). */
export function embedLut(lut: Lut): EmbeddedLut {
  const count = lut.size ** 3;
  const rgb = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = lut.data[i * 4];
    rgb[i * 3 + 1] = lut.data[i * 4 + 1];
    rgb[i * 3 + 2] = lut.data[i * 4 + 2];
  }
  return { name: lut.name, size: lut.size, data: bytesToBase64(rgb) };
}

export function unembedLut(e: EmbeddedLut, key: string): Lut {
  const count = e.size ** 3;
  const rgb = base64ToBytes(e.data);
  if (e.size < 2 || e.size > 129 || rgb.length !== count * 3) throw new Error(`The preset’s LUT “${e.name}” is damaged.`);
  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = rgb[i * 3];
    data[i * 4 + 1] = rgb[i * 3 + 1];
    data[i * 4 + 2] = rgb[i * 3 + 2];
    data[i * 4 + 3] = 255;
  }
  return { key, name: e.name, size: e.size, data };
}

/** Whether two LUTs hold the same table (so loading a preset twice doesn't duplicate its LUT). */
export function sameLut(a: Lut, b: Lut): boolean {
  if (a.size !== b.size || a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}
