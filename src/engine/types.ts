export type Ratio = '9:16' | '3:4';

export const RATIOS: Record<Ratio, { w: number; h: number; label: string }> = {
  '9:16': { w: 9, h: 16, label: 'Reels / Stories' },
  '3:4': { w: 3, h: 4, label: 'Feed post' },
};

export interface Slide {
  id: string;
  /** Asset id of the album cover image, or null to show a placeholder. */
  coverId: string | null;
  /** Text for each per-slide section, keyed by section id, in CoverVinyl markup (see markup.ts). */
  texts: Record<string, string>;
  /**
   * Optional text the slide's first per-slide section starts with and morphs
   * into (the intro "jazzmatic" effect).
   */
  morphFrom: string;
  /** Seconds this slide stays on screen (includes the transition into it). */
  duration: number;
}

/**
 * A block of text stacked under the cover. Sections render top to bottom in
 * list order; empty ones take no space.
 */
export interface TextSection {
  id: string;
  name: string;
  /** 'slide': different text on every slide (animates per slide); 'shared': one text on every slide. */
  mode: 'slide' | 'shared';
  /** The text when mode is 'shared'. */
  text: string;
  /** Font size multiplier relative to the base text size. */
  scale: number;
  /** Space above the section, in body line heights. */
  gap: number;
}

export interface PostSettings {
  /** 'none', a preset key (see luts.ts) or 'custom:<id>' for an uploaded .cube file. */
  lut: string;
  /** 0..1 blend between the original and the graded image. */
  lutIntensity: number;
  /** 0..1 film grain strength. */
  grain: number;
  /** Grain particle size in pixels at 1080p. */
  grainSize: number;
  /** 0..1 darkening towards the frame edges. */
  vignette: number;
}

export interface TextStyle {
  /** Font family key (see fonts.ts) for regular text lines. */
  family: string;
  /** Font family key for `# headline` lines. */
  headlineFamily: string;
  color: string;
  /** Body font size as a fraction of the canvas width. */
  size: number;
  headlineScale: number;
  lineHeight: number;
  /** Letter spacing in em. */
  tracking: number;
  weights: { light: number; regular: number; bold: number };
  shadow: boolean;
}

export interface CoverStyle {
  /** Cover edge length as a fraction of canvas width. */
  size: number;
  /** Horizontal offset between stacked covers, as a fraction of the cover size. */
  stackOffset: number;
  /** How many upcoming covers peek out behind the current one (0 = no stack). */
  stackCount: number;
  /** Corner radius as a fraction of cover size. */
  radius: number;
  shadow: boolean;
}

/** Top-left of the cover, as fractions of canvas width / height. */
export interface Placement {
  x: number;
  y: number;
}

export interface VideoSettings {
  /** Seconds to skip at the start of the uploaded clip. */
  start: number;
  zoom: number;
  /** -1..1, shifts the crop window when the clip is cropped to fit. */
  panX: number;
  panY: number;
  /** 0..1 black overlay to keep the text readable. */
  dim: number;
  /** Loop the clip when the edit is longer than it; otherwise freeze on the last frame. */
  loop: boolean;
  /** Include the clip's audio in preview + export. */
  audio: boolean;
}

export interface MotionSettings {
  /** Seconds for the cover flip / text swap between slides. */
  transition: number;
  /** Fan the crate of covers out at the start of the video. */
  fanOut: boolean;
  /** Seconds before the intro fan-out + title morph start. */
  introDelay: number;
  /** Seconds the title morph takes. */
  morphDuration: number;
}

export interface EndCard {
  enabled: boolean;
  logoId: string | null;
  /** Logo width as a fraction of canvas width. */
  logoSize: number;
  text: string;
  duration: number;
}

export interface ExportSettings {
  resolution: 1080 | 720;
  fps: 24 | 30 | 60;
  /** 'auto' tries fast WebCodecs encoding and falls back to real-time recording. */
  method: 'auto' | 'realtime';
}

export interface Project {
  ratio: Ratio;
  slides: Slide[];
  sections: TextSection[];
  text: TextStyle;
  cover: CoverStyle;
  placement: Record<Ratio, Placement>;
  video: VideoSettings;
  motion: MotionSettings;
  endCard: EndCard;
  post: PostSettings;
  export: ExportSettings;
}

export interface ImageAsset {
  id: string;
  name: string;
  url: string;
  image: HTMLImageElement;
  width: number;
  height: number;
}

export interface VideoAsset {
  file: File;
  name: string;
  url: string;
  duration: number;
  width: number;
  height: number;
}
