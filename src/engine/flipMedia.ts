/**
 * Keeps the two Sample Flip clips (as <video> elements, with sound) in step
 * with a playhead. Used by the preview and the real-time exporter.
 */
import { flipAudioGain, flipClipTime, flipLayersAt, audioWindow, type FlipProject, type FlipTimeline } from './flip';
import { BufferPlayer } from './bufferPlayer';
import type { MediaAsset } from './reel';
import type { DrawableImage } from './renderer';

const DRIFT = 0.25;

interface Slot {
  assetId: string;
  el: HTMLVideoElement;
}

export class FlipMedia {
  /** One element per part (even if both parts use the same file, they play at different times). */
  private slots: (Slot | null)[] = [null, null];
  private assets: (MediaAsset | null)[] = [null, null];
  /** Per part: a cleaned-up soundtrack to play instead of the clip's own sound, or 'mute'. */
  private audio: (AudioBuffer | 'mute' | null)[] = [null, null];
  private players: (BufferPlayer | null)[] = [null, null];

  /** Called whenever a clip has a new frame to show while paused (after a seek / load). */
  onFrame: () => void = () => undefined;

  constructor(private readonly host: HTMLElement = document.body) {}

  /** Creates / removes elements to match the parts' footage. */
  setAssets(assets: [MediaAsset | null, MediaAsset | null]): void {
    this.assets = assets;
    assets.forEach((asset, part) => {
      const slot = this.slots[part];
      const wanted = asset?.kind === 'video' ? asset : null;
      if (slot && slot.assetId === wanted?.id) return;
      if (slot) release(slot.el);
      this.slots[part] = null;
      if (!wanted) return;
      const el = document.createElement('video');
      el.src = wanted.url;
      el.playsInline = true;
      el.preload = 'auto';
      el.className = 'hidden-video';
      el.addEventListener('seeked', () => this.onFrame());
      el.addEventListener('loadeddata', () => this.onFrame());
      this.host.appendChild(el);
      this.slots[part] = { assetId: wanted.id, el };
    });
  }

  /**
   * Plays `buffer` (the clip's enhanced sound, positioned in clip time) instead
   * of the clip's own sound; 'mute' silences the clip; null restores it.
   */
  setAudio(part: number, audio: AudioBuffer | 'mute' | null): void {
    this.audio[part] = audio;
    if (audio instanceof AudioBuffer) {
      this.players[part] ??= new BufferPlayer();
      this.players[part].setBuffer(audio);
    } else {
      this.players[part]?.dispose();
      this.players[part] = null;
    }
  }

  element(part: number): HTMLVideoElement | null {
    return this.slots[part]?.el ?? null;
  }

  /** Resolves once every clip has its first frame. */
  async ready(): Promise<void> {
    await Promise.all(
      this.slots.map((slot) => {
        const el = slot?.el;
        if (!el || el.readyState >= 2) return undefined;
        return new Promise<void>((resolve) => {
          el.addEventListener('loadeddata', () => resolve(), { once: true });
          el.addEventListener('error', () => resolve(), { once: true });
        });
      }),
    );
  }

  sync(p: FlipProject, tl: FlipTimeline, t: number, playing: boolean, force: boolean): void {
    const visible = new Set(flipLayersAt(p, tl, t).layers.map((l) => l.part));
    this.slots.forEach((slot, part) => {
      const asset = this.assets[part];
      if (!slot || !asset || slot.el.readyState < 1) return;
      const el = slot.el;
      const win = audioWindow(tl, part);
      const live = visible.has(part) || (t >= win.start && t < win.end);
      const override = this.audio[part];
      const player = this.players[part];
      if (live) {
        const expected = flipClipTime(p.parts[part], asset.duration, t - tl.playStart[part]);
        if ((force || Math.abs(el.currentTime - expected) > DRIFT) && !el.seeking) el.currentTime = expected;
        const gain = flipAudioGain(p, tl, part, t);
        if (override) {
          el.muted = true;
          if (player && override instanceof AudioBuffer) {
            const loop = { start: p.parts[part].start, end: Math.min(asset.duration, override.duration) };
            player.sync(expected, playing, force, gain, loop);
          }
        } else {
          el.muted = gain <= 0;
          el.volume = Math.min(1, Math.max(0, gain));
        }
        if (playing && el.paused) void el.play().catch(() => undefined);
        if (!playing && !el.paused) el.pause();
        return;
      }
      player?.stop();
      if (!el.paused) el.pause();
      // Park the upcoming clip on its first frame so the cut is instant.
      if (t < win.start) {
        const first = flipClipTime(p.parts[part], asset.duration, 0);
        if (Math.abs(el.currentTime - first) > 0.05 && !el.seeking) el.currentTime = first;
      }
    });
  }

  /** The current frame of a part's footage: its photo, or its clip's frame once decoded. */
  frame(part: number): DrawableImage | null {
    const asset = this.assets[part];
    if (!asset) return null;
    if (asset.kind === 'image') return asset.image ? { source: asset.image, width: asset.width, height: asset.height } : null;
    const el = this.slots[part]?.el;
    if (!el || el.readyState < 2 || !el.videoWidth) return null;
    return { source: el, width: el.videoWidth, height: el.videoHeight };
  }

  pauseAll(): void {
    for (const slot of this.slots) slot?.el.pause();
    for (const player of this.players) player?.stop();
  }

  dispose(): void {
    for (const slot of this.slots) if (slot) release(slot.el);
    this.slots = [null, null];
    for (const player of this.players) player?.dispose();
    this.players = [null, null];
  }
}

function release(el: HTMLMediaElement): void {
  el.pause();
  el.removeAttribute('src');
  el.load();
  el.remove();
}
