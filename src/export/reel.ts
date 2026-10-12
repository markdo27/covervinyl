/**
 * Photo Reel export. The fast path decodes every clip, the alpha overlay and
 * the soundtrack with WebCodecs and renders frame by frame; the fallback
 * plays the reel in real time and records it.
 */
import {
  ALL_FORMATS,
  BlobSource,
  Input,
  type InputVideoTrack,
  type WrappedCanvas,
} from 'mediabunny';
import type { Lut } from '../engine/luts';
import type { OverlayAsset } from '../engine/overlay';
import { clipTime, overlayTime, reelLayersAt, type MediaAsset, type ReelProject, type ReelTimeline } from '../engine/reel';
import { ReelMedia, type MusicAsset } from '../engine/reelMedia';
import { reelFrame } from '../engine/reelRenderer';
import type { DrawableImage } from '../engine/renderer';
import {
  assertWebCodecs,
  canvasSinkFor,
  chooseVideoCodec,
  decodeAudioSpan,
  encodeFrames,
  WebCodecsUnavailableError,
} from './encoder';
import { recordRealtime } from './recorder';
import { ExportAbortedError, type ExportResult } from './types';

export interface ReelExportJob {
  project: ReelProject;
  timeline: ReelTimeline;
  width: number;
  height: number;
  fps: number;
  media: MediaAsset[];
  getMedia: (id: string | null) => MediaAsset | null;
  overlay: OverlayAsset | null;
  music: MusicAsset | null;
  getLut: (key: string) => Lut | null;
  signal: AbortSignal;
  onProgress: (progress: number, label: string) => void;
}

export async function exportReel(job: ReelExportJob, method: 'auto' | 'realtime'): Promise<ExportResult> {
  if (method === 'auto') {
    try {
      return await exportReelWebCodecs(job);
    } catch (err) {
      if (err instanceof ExportAbortedError || job.signal.aborted) throw new ExportAbortedError();
      console.warn('[CoverVinyl] WebCodecs reel export failed, falling back to real-time recording:', err);
      job.onProgress(0, 'Switching to real-time recording…');
      const result = await exportReelRealtime(job);
      const reason = err instanceof Error ? err.message : String(err);
      return { ...result, notes: [`Fast export wasn't possible (${reason}).`, ...result.notes] };
    }
  }
  return exportReelRealtime(job);
}

const drawable = (c: HTMLCanvasElement | OffscreenCanvas): DrawableImage => ({ source: c, width: c.width, height: c.height });

async function exportReelWebCodecs(job: ReelExportJob): Promise<ExportResult> {
  assertWebCodecs();
  const { project, timeline, width, height, fps, signal, onProgress } = job;
  const codec = await chooseVideoCodec(width, height, fps);
  const notes: string[] = [];
  const inputs: Input[] = [];
  const open = (file: File) => {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    inputs.push(input);
    return input;
  };
  const shotFrames = new Map<number, AsyncGenerator<WrappedCanvas | null>>();
  let overlayFrames: AsyncGenerator<WrappedCanvas | null> | null = null;

  try {
    onProgress(0, 'Reading clips…');
    const total = timeline.total;
    const frameCount = Math.max(1, Math.round(total * fps));

    // 1. Work out, for every output frame, which clip shots are on screen and at what clip time.
    const perFrame: number[][] = [];
    const times = new Map<number, number[]>();
    for (let f = 0; f < frameCount; f++) {
      const { layers } = reelLayersAt(project, timeline, f / fps);
      const shots: number[] = [];
      for (const layer of layers) {
        const item = project.items[layer.index];
        const asset = job.getMedia(item.assetId);
        if (asset?.kind !== 'video') continue;
        shots.push(layer.index);
        const list = times.get(layer.index) ?? [];
        list.push(clipTime(item, asset.duration, layer.local));
        times.set(layer.index, list);
      }
      perFrame.push(shots);
    }

    // 2. Open each clip once.
    const tracks = new Map<string, { track: InputVideoTrack; first: number }>();
    for (const index of times.keys()) {
      const asset = job.getMedia(project.items[index].assetId)!;
      if (tracks.has(asset.id)) continue;
      const track = await open(asset.file).getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) {
        throw new WebCodecsUnavailableError(`this browser can't decode "${asset.name}" with WebCodecs`);
      }
      tracks.set(asset.id, { track, first: await track.getFirstTimestamp() });
    }

    // 3. The overlay, decoded with its alpha channel.
    const overlay = job.overlay;
    if (overlay?.kind === 'video') {
      const track = await open(overlay.file).getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) {
        throw new WebCodecsUnavailableError(`this browser can't decode the overlay "${overlay.name}" with WebCodecs`);
      }
      const first = await track.getFirstTimestamp();
      const length = Math.max(0.05, (await track.computeDuration()) - first);
      const speed = project.overlay.speed;
      overlayFrames = canvasSinkFor(track, { alpha: true }).canvasesAtTimestamps(
        (function* () {
          for (let f = 0; f < frameCount; f++) yield first + overlayTime(f / fps, speed, length);
        })(),
      );
    }

    // 4. Soundtrack.
    let audio: AudioBuffer | null = null;
    if (job.music) {
      onProgress(0, 'Preparing soundtrack…');
      const track = await open(job.music.file).getPrimaryAudioTrack();
      if (track && (await track.canDecode())) {
        const first = await track.getFirstTimestamp();
        const end = await track.computeDuration();
        audio = await decodeAudioSpan(track, {
          from: first + Math.min(project.music.start, Math.max(0, end - first - 0.1)),
          end,
          loop: true,
          total,
          volume: project.music.volume,
          signal,
        });
      } else {
        notes.push("The soundtrack couldn't be decoded here, so the export is silent.");
      }
    }

    // 5. Render and encode.
    const remaining = new Map([...times].map(([k, v]) => [k, v.length]));
    const lastShot = new Map<number, DrawableImage>();
    let overlayFrame: DrawableImage | null = null;

    return await encodeFrames({
      width,
      height,
      fps,
      total,
      signal,
      onProgress,
      codec,
      audio,
      notes,
      render: async (compositor, t, i) => {
        for (const index of perFrame[i]) {
          let frames = shotFrames.get(index);
          if (!frames) {
            const asset = job.getMedia(project.items[index].assetId)!;
            const { track, first } = tracks.get(asset.id)!;
            frames = canvasSinkFor(track).canvasesAtTimestamps(times.get(index)!.map((x) => first + x));
            shotFrames.set(index, frames);
          }
          const next = await frames.next();
          if (!next.done && next.value) lastShot.set(index, drawable(next.value.canvas));
          const left = (remaining.get(index) ?? 1) - 1;
          remaining.set(index, left);
          if (left <= 0) {
            await frames.return(undefined);
            shotFrames.delete(index);
          }
        }
        if (overlayFrames) {
          const next = await overlayFrames.next();
          if (!next.done && next.value) overlayFrame = drawable(next.value.canvas);
        }
        compositor.drawLayers(
          reelFrame(
            {
              project,
              timeline,
              t,
              getMedia: job.getMedia,
              videoFrame: (k) => lastShot.get(k) ?? null,
              overlay,
              overlayVideoFrame: overlayFrame,
            },
            job.getLut,
            false,
          ),
        );
        // Only keep frames of shots that are still on screen.
        for (const k of lastShot.keys()) if (!perFrame[i].includes(k) && !shotFrames.has(k)) lastShot.delete(k);
      },
    });
  } finally {
    for (const frames of shotFrames.values()) await frames.return(undefined).catch(() => undefined);
    await overlayFrames?.return(undefined).catch(() => undefined);
    for (const input of inputs) input.dispose();
  }
}

function exportReelRealtime(job: ReelExportJob): Promise<ExportResult> {
  const { project, timeline, width, height, fps, signal, onProgress } = job;
  const notes: string[] = [];
  return recordRealtime({
    width,
    height,
    fps,
    total: timeline.total,
    signal,
    onProgress,
    notes,
    setup: async ({ captureAudio }) => {
      const host = document.createElement('div');
      host.className = 'offscreen-media';
      document.body.appendChild(host);
      const media = new ReelMedia(host);
      media.setAssets(job.media, job.overlay, job.music, job.getMedia);
      onProgress(0, 'Loading media…');
      await media.ready();
      const musicEl = media.musicElement;
      if (musicEl && !captureAudio(musicEl)) notes.push("The soundtrack couldn't be captured, so the export is silent.");
      media.sync(project, timeline, 0, false, true);
      return {
        draw: (compositor, t) =>
          compositor.drawLayers(
            reelFrame(
              {
                project,
                timeline,
                t,
                getMedia: job.getMedia,
                videoFrame: (i) => media.videoFrame(i),
                overlay: job.overlay,
                overlayVideoFrame: media.overlayFrame(),
              },
              job.getLut,
              false,
            ),
          ),
        sync: (t) => media.sync(project, timeline, t, true, false),
        start: async () => media.sync(project, timeline, 0, true, true),
        dispose: () => {
          media.dispose();
          host.remove();
        },
      };
    },
  });
}
