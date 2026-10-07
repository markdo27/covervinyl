import type { Project } from './types';

export interface Segment {
  kind: 'slide' | 'end';
  /** Slide index (or slides.length for the end card). */
  index: number;
  start: number;
  end: number;
}

export interface Timeline {
  segments: Segment[];
  /** Start time of every slide; slideStarts[i] = segments[i].start. */
  slideStarts: number[];
  /** Start of the end card, or `total` when there is none. */
  endStart: number;
  total: number;
}

export const MIN_SLIDE_DURATION = 0.5;

export function buildTimeline(project: Pick<Project, 'slides' | 'endCard'>): Timeline {
  const segments: Segment[] = [];
  let t = 0;
  project.slides.forEach((slide, index) => {
    const d = Math.max(MIN_SLIDE_DURATION, slide.duration || 0);
    segments.push({ kind: 'slide', index, start: t, end: t + d });
    t += d;
  });
  const endStart = t;
  if (project.endCard.enabled && project.endCard.duration > 0) {
    segments.push({ kind: 'end', index: project.slides.length, start: t, end: t + project.endCard.duration });
    t += project.endCard.duration;
  }
  return { segments, slideStarts: segments.filter((s) => s.kind === 'slide').map((s) => s.start), endStart, total: t };
}

/** Index of the slide on screen at time t (clamped to the last slide during the end card). */
export function slideIndexAt(timeline: Timeline, t: number): number {
  const starts = timeline.slideStarts;
  if (!starts.length) return -1;
  let idx = 0;
  for (let i = 0; i < starts.length; i++) if (t >= starts[i]) idx = i;
  return idx;
}

/**
 * Maps edit time to a time in the uploaded clip, honouring the trim start and
 * looping (or freezing on the last frame).
 */
export function sourceTime(
  t: number,
  opts: { start: number; loop: boolean; duration: number; frameStep?: number },
): number {
  const usable = Math.max(0.05, opts.duration - opts.start);
  if (opts.loop) return opts.start + (((t % usable) + usable) % usable);
  return opts.start + Math.min(Math.max(0, t), usable - (opts.frameStep ?? 1 / 30));
}

/** Rescales every slide (and the end card) so the edit lasts exactly `target` seconds. */
export function fitDurations<P extends Pick<Project, 'slides' | 'endCard'>>(project: P, target: number): P {
  const current = buildTimeline(project).total;
  if (current <= 0 || target <= 0) return project;
  const k = target / current;
  const round = (v: number) => Math.max(MIN_SLIDE_DURATION, Math.round(v * k * 10) / 10);
  return {
    ...project,
    slides: project.slides.map((s) => ({ ...s, duration: round(s.duration) })),
    endCard: { ...project.endCard, duration: project.endCard.enabled ? round(project.endCard.duration) : project.endCard.duration },
  };
}

export function formatTime(t: number, withTenths = true): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const secStr = withTenths ? sec.toFixed(1).padStart(4, '0') : Math.floor(sec).toString().padStart(2, '0');
  return `${m}:${secStr}`;
}
