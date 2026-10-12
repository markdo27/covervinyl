/**
 * Keeps the reel's media elements (one <video> per clip, the overlay video
 * and the soundtrack) in step with a playhead. Used by the preview and the
 * real-time exporter.
 */
import type { OverlayAsset } from './overlay';
import { clipTime, overlayTime, reelLayersAt, type MediaAsset, type ReelProject, type ReelTimeline } from './reel';
import type { DrawableImage } from './renderer';

export interface MusicAsset {
  id: string;
  name: string;
  file: File;
  url: string;
  duration: number;
}

const DRIFT = 0.25;

function makeVideo(url: string): HTMLVideoElement {
  const el = document.createElement('video');
  el.src = url;
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.className = 'hidden-video';
  return el;
}

function ready(el: HTMLMediaElement): Promise<void> {
  if (el.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    el.addEventListener('loadeddata', done, { once: true });
    el.addEventListener('error', done, { once: true });
  });
}

export class ReelMedia {
  private clips = new Map<string, HTMLVideoElement>();
  private overlayEl: HTMLVideoElement | null = null;
  private overlayId: string | null = null;
  private musicEl: HTMLAudioElement | null = null;
  private musicId: string | null = null;
  private project: ReelProject | null = null;
  private media: (id: string | null) => MediaAsset | null = () => null;
  private overlay: OverlayAsset | null = null;
  private music: MusicAsset | null = null;

  /** Called whenever a video has a new frame to show while paused (after a seek / load). */
  onFrame: () => void = () => undefined;

  constructor(private readonly host: HTMLElement = document.body) {}

  /** Creates / removes elements to match the current assets. */
  setAssets(media: MediaAsset[], overlay: OverlayAsset | null, music: MusicAsset | null, getMedia: (id: string | null) => MediaAsset | null) {
    this.media = getMedia;
    const wanted = new Set(media.filter((m) => m.kind === 'video').map((m) => m.id));
    for (const [id, el] of this.clips) {
      if (!wanted.has(id)) {
        release(el);
        this.clips.delete(id);
      }
    }
    for (const m of media) {
      if (m.kind !== 'video' || this.clips.has(m.id)) continue;
      const el = makeVideo(m.url);
      el.addEventListener('seeked', () => this.onFrame());
      el.addEventListener('loadeddata', () => this.onFrame());
      this.host.appendChild(el);
      this.clips.set(m.id, el);
    }

    this.overlay = overlay;
    const overlayVideoId = overlay?.kind === 'video' ? overlay.id : null;
    if (overlayVideoId !== this.overlayId) {
      release(this.overlayEl);
      this.overlayEl = null;
      this.overlayId = overlayVideoId;
      if (overlay?.kind === 'video') {
        this.overlayEl = makeVideo(overlay.url);
        this.overlayEl.loop = true;
        this.overlayEl.addEventListener('seeked', () => this.onFrame());
        this.overlayEl.addEventListener('loadeddata', () => this.onFrame());
        this.host.appendChild(this.overlayEl);
      }
    }

    this.music = music;
    if ((music?.id ?? null) !== this.musicId) {
      release(this.musicEl);
      this.musicEl = null;
      this.musicId = music?.id ?? null;
      if (music) {
        this.musicEl = document.createElement('audio');
        this.musicEl.src = music.url;
        this.musicEl.preload = 'auto';
        this.host.appendChild(this.musicEl);
      }
    }
  }

  get musicElement(): HTMLAudioElement | null {
    return this.musicEl;
  }

  /** Resolves once every element has its first frame / data. */
  async ready(): Promise<void> {
    const els: HTMLMediaElement[] = [...this.clips.values()];
    if (this.overlayEl) els.push(this.overlayEl);
    if (this.musicEl) els.push(this.musicEl);
    await Promise.all(els.map(ready));
  }

  sync(project: ReelProject, timeline: ReelTimeline, t: number, playing: boolean, force: boolean): void {
    this.project = project;
    const { layers } = reelLayersAt(project, timeline, t);
    const active = new Set<HTMLVideoElement>();

    for (const layer of layers) {
      const item = project.items[layer.index];
      const asset = this.media(item.assetId);
      const el = asset?.kind === 'video' ? this.clips.get(asset.id) : undefined;
      if (!asset || !el || el.readyState < 1) continue;
      active.add(el);
      const expected = clipTime(item, asset.duration, layer.local);
      if ((force || Math.abs(el.currentTime - expected) > DRIFT) && !el.seeking) el.currentTime = expected;
      if (playing && el.paused) void el.play().catch(() => undefined);
      if (!playing && !el.paused) el.pause();
    }

    // Park the next clip on its first frame so the cut is instant.
    const next = layers.length ? layers[layers.length - 1].index + 1 : -1;
    const nextItem = next > 0 ? project.items[next] : undefined;
    const nextAsset = nextItem ? this.media(nextItem.assetId) : null;
    const nextEl = nextAsset?.kind === 'video' ? this.clips.get(nextAsset.id) : undefined;
    if (nextItem && nextAsset && nextEl && !active.has(nextEl) && nextEl.readyState >= 1) {
      if (!nextEl.paused) nextEl.pause();
      const first = clipTime(nextItem, nextAsset.duration, 0);
      if (Math.abs(nextEl.currentTime - first) > 0.05 && !nextEl.seeking) nextEl.currentTime = first;
      active.add(nextEl);
    }
    for (const el of this.clips.values()) if (!active.has(el) && !el.paused) el.pause();

    const ov = this.overlayEl;
    if (ov && this.overlay?.kind === 'video' && ov.readyState >= 1) {
      const speed = Math.min(4, Math.max(0.25, project.overlay.speed));
      if (ov.playbackRate !== speed) ov.playbackRate = speed;
      const expected = overlayTime(t, project.overlay.speed, this.overlay.duration);
      const drift = Math.abs(ov.currentTime - expected);
      // Ignore the apparent jump when the loop wraps around.
      const wrapped = Math.abs(drift - this.overlay.duration) < DRIFT;
      if ((force || (drift > DRIFT && !wrapped)) && !ov.seeking) ov.currentTime = expected;
      if (playing && ov.paused) void ov.play().catch(() => undefined);
      if (!playing && !ov.paused) ov.pause();
    }

    const mu = this.musicEl;
    if (mu && this.music && mu.readyState >= 1) {
      mu.volume = Math.min(1, Math.max(0, project.music.volume));
      const len = Math.max(0.1, this.music.duration - project.music.start);
      const expected = project.music.start + (t % len);
      if ((force || Math.abs(mu.currentTime - expected) > DRIFT) && !mu.seeking) mu.currentTime = expected;
      if (playing && mu.paused) void mu.play().catch(() => undefined);
      if (!playing && !mu.paused) mu.pause();
    }
  }

  /** The current frame of the clip shown by item `index`. */
  videoFrame(index: number): DrawableImage | null {
    const item = this.project?.items[index];
    const asset = item ? this.media(item.assetId) : null;
    const el = asset?.kind === 'video' ? this.clips.get(asset.id) : undefined;
    if (!el || el.readyState < 2 || !el.videoWidth) return null;
    return { source: el, width: el.videoWidth, height: el.videoHeight };
  }

  overlayFrame(): DrawableImage | null {
    const el = this.overlayEl;
    if (!el || el.readyState < 2 || !el.videoWidth) return null;
    return { source: el, width: el.videoWidth, height: el.videoHeight };
  }

  pauseAll(): void {
    for (const el of this.clips.values()) el.pause();
    this.overlayEl?.pause();
    this.musicEl?.pause();
  }

  dispose(): void {
    for (const el of this.clips.values()) release(el);
    this.clips.clear();
    release(this.overlayEl);
    release(this.musicEl);
    this.overlayEl = null;
    this.musicEl = null;
  }
}

function release(el: HTMLMediaElement | null): void {
  if (!el) return;
  el.pause();
  el.removeAttribute('src');
  el.load();
  el.remove();
}

