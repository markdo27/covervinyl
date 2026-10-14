/**
 * Sample Flip export. The fast path decodes both clips (frames and sound)
 * with WebCodecs and renders frame by frame; the fallback plays the edit in
 * real time and records it.
 */
import { ALL_FORMATS, BlobSource, Input, type InputVideoTrack, type WrappedCanvas } from 'mediabunny';
import { audioWindow, flipAudioGain, flipClipTime, flipLayersAt, type FlipProject, type FlipTimeline } from '../engine/flip';
import { FlipMedia } from '../engine/flipMedia';
import { flipFrame } from '../engine/flipRenderer';
import type { Lut } from '../engine/luts';
import type { MediaAsset } from '../engine/reel';
import type { DrawableImage } from '../engine/renderer';
import {
  assertWebCodecs,
  canvasSinkFor,
  chooseVideoCodec,
  decodeAudioSpan,
  encodeFrames,
  spanFromBuffer,
  WebCodecsUnavailableError,
} from './encoder';
import { recordRealtime } from './recorder';
import { ExportAbortedError, throwIfAborted, type ExportResult } from './types';

export interface FlipExportJob {
  project: FlipProject;
  timeline: FlipTimeline;
  width: number;
  height: number;
  fps: number;
  /** Footage of [new, original]. */
  footage: [MediaAsset | null, MediaAsset | null];
  /** Each clip's cleaned-up sound when its audio enhance is on. */
  enhanced: [AudioBuffer | null, AudioBuffer | null];
  getImage: (id: string | null) => DrawableImage | null;
  getLut: (key: string) => Lut | null;
  signal: AbortSignal;
  onProgress: (progress: number, label: string) => void;
}

export async function exportFlip(job: FlipExportJob, method: 'auto' | 'realtime'): Promise<ExportResult> {
  if (method === 'auto') {
    try {
      return await exportFlipWebCodecs(job);
    } catch (err) {
      if (err instanceof ExportAbortedError || job.signal.aborted) throw new ExportAbortedError();
      console.warn('[CoverVinyl] WebCodecs flip export failed, falling back to real-time recording:', err);
      job.onProgress(0, 'Switching to real-time recording…');
      const result = await exportFlipRealtime(job);
      const reason = err instanceof Error ? err.message : String(err);
      return { ...result, notes: [`Fast export wasn't possible (${reason}).`, ...result.notes] };
    }
  }
  return exportFlipRealtime(job);
}

const drawable = (c: HTMLCanvasElement | OffscreenCanvas): DrawableImage => ({ source: c, width: c.width, height: c.height });
const imageOf = (asset: MediaAsset | null): DrawableImage | null =>
  asset?.kind === 'image' && asset.image ? { source: asset.image, width: asset.width, height: asset.height } : null;

const SAMPLE_RATE = 48000;

async function exportFlipWebCodecs(job: FlipExportJob): Promise<ExportResult> {
  assertWebCodecs();
  const { project, timeline, width, height, fps, signal, onProgress } = job;
  const codec = await chooseVideoCodec(width, height, fps);
  const notes: string[] = [];
  const inputs: Input[] = [];
  const generators = new Map<number, AsyncGenerator<WrappedCanvas | null>>();

  try {
    onProgress(0, 'Reading clips…');
    const total = timeline.total;
    const frameCount = Math.max(1, Math.round(total * fps));

    // 1. Which parts are on screen in every output frame, and at what clip time.
    const perFrame: number[][] = [];
    const times = new Map<number, number[]>();
    for (let f = 0; f < frameCount; f++) {
      const parts: number[] = [];
      for (const layer of flipLayersAt(project, timeline, f / fps).layers) {
        const asset = job.footage[layer.part];
        if (asset?.kind !== 'video') continue;
        parts.push(layer.part);
        const list = times.get(layer.part) ?? [];
        list.push(flipClipTime(project.parts[layer.part], asset.duration, layer.local));
        times.set(layer.part, list);
      }
      perFrame.push(parts);
    }

    // 2. Open the clips.
    const tracks = new Map<number, { track: InputVideoTrack; first: number; input: Input }>();
    for (const part of [0, 1]) {
      const asset = job.footage[part];
      if (asset?.kind !== 'video') continue;
      const input = new Input({ source: new BlobSource(asset.file), formats: ALL_FORMATS });
      inputs.push(input);
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) {
        throw new WebCodecsUnavailableError(`this browser can't decode "${asset.name}" with WebCodecs`);
      }
      tracks.set(part, { track, first: await track.getFirstTimestamp(), input });
    }

    // 3. Both clips' sound, crossfaded at the cut.
    let audio: AudioBuffer | null = null;
    for (const [part, { input }] of tracks) {
      if (project.parts[part].volume <= 0) continue;
      const win = audioWindow(timeline, part);
      const enhanced = job.enhanced[part];
      if (enhanced) {
        const span = await spanFromBuffer(enhanced, {
          from: project.parts[part].start,
          loop: true,
          total: Math.max(0.05, win.end - win.start),
          fadeOut: 0,
          sampleRate: SAMPLE_RATE,
        });
        audio ??= new AudioBuffer({ length: Math.ceil(total * SAMPLE_RATE), numberOfChannels: 2, sampleRate: SAMPLE_RATE });
        mixInto(audio, span, win.start, (t) => flipAudioGain(project, timeline, part, t));
        continue;
      }
      const track = await input.getPrimaryAudioTrack();
      if (!track) continue;
      if (!(await track.canDecode())) {
        notes.push(`The sound of "${job.footage[part]!.name}" couldn't be decoded here, so it's silent.`);
        continue;
      }
      onProgress(0, 'Preparing audio…');
      const first = await track.getFirstTimestamp();
      const end = await track.computeDuration();
      const span = await decodeAudioSpan(track, {
        from: first + Math.min(project.parts[part].start, Math.max(0, end - first - 0.1)),
        end,
        loop: true,
        total: Math.max(0.05, win.end - win.start),
        signal,
        fadeOut: 0,
        sampleRate: SAMPLE_RATE,
      });
      audio ??= new AudioBuffer({ length: Math.ceil(total * SAMPLE_RATE), numberOfChannels: 2, sampleRate: SAMPLE_RATE });
      mixInto(audio, span, win.start, (t) => flipAudioGain(project, timeline, part, t));
      throwIfAborted(signal);
    }

    // 4. Render and encode.
    const remaining = new Map([...times].map(([k, v]) => [k, v.length]));
    const current = new Map<number, DrawableImage>();
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
        for (const part of perFrame[i]) {
          let frames = generators.get(part);
          if (!frames && (remaining.get(part) ?? 0) > 0) {
            const { track, first } = tracks.get(part)!;
            frames = canvasSinkFor(track).canvasesAtTimestamps(times.get(part)!.map((x) => first + x));
            generators.set(part, frames);
          }
          if (!frames) continue;
          const next = await frames.next();
          if (!next.done && next.value) current.set(part, drawable(next.value.canvas));
          const left = (remaining.get(part) ?? 1) - 1;
          remaining.set(part, left);
          if (left <= 0) {
            await frames.return(undefined);
            generators.delete(part);
          }
        }
        compositor.drawLayers(
          flipFrame(
            {
              project,
              timeline,
              t,
              footage: (part) => imageOf(job.footage[part]) ?? current.get(part) ?? null,
              getImage: job.getImage,
            },
            job.getLut,
            false,
          ),
        );
      },
    });
  } finally {
    for (const frames of generators.values()) await frames.return(undefined).catch(() => undefined);
    for (const input of inputs) input.dispose();
  }
}

/** Adds `src` into `out` starting at `startSeconds`, scaled by gain(t). */
function mixInto(out: AudioBuffer, src: AudioBuffer, startSeconds: number, gain: (t: number) => number): void {
  const rate = out.sampleRate;
  const offset = Math.round(startSeconds * rate);
  const block = 64;
  for (let c = 0; c < out.numberOfChannels; c++) {
    const dst = out.getChannelData(c);
    const from = src.getChannelData(Math.min(c, src.numberOfChannels - 1));
    for (let i = 0; i < from.length; i += block) {
      const g = gain((offset + i) / rate);
      if (g <= 0) continue;
      const end = Math.min(from.length, i + block);
      for (let k = i; k < end; k++) {
        const j = offset + k;
        if (j >= 0 && j < dst.length) dst[j] += from[k] * g;
      }
    }
  }
}

function exportFlipRealtime(job: FlipExportJob): Promise<ExportResult> {
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
    setup: async ({ captureAudio, captureBuffer }) => {
      const host = document.createElement('div');
      host.className = 'offscreen-media';
      document.body.appendChild(host);
      const media = new FlipMedia(host);
      media.setAssets(job.footage);
      onProgress(0, 'Loading clips…');
      await media.ready();
      // Enhanced clips are pre-mixed into one soundtrack; the others are captured live.
      let mix: AudioBuffer | null = null;
      for (const part of [0, 1]) {
        const el = media.element(part);
        if (!el || project.parts[part].volume <= 0) continue;
        const enhanced = job.enhanced[part];
        if (enhanced) {
          media.setAudio(part, 'mute');
          const win = audioWindow(timeline, part);
          const span = await spanFromBuffer(enhanced, {
            from: project.parts[part].start,
            loop: true,
            total: Math.max(0.05, win.end - win.start),
            fadeOut: 0,
            sampleRate: SAMPLE_RATE,
          });
          mix ??= new AudioBuffer({ length: Math.ceil(timeline.total * SAMPLE_RATE), numberOfChannels: 2, sampleRate: SAMPLE_RATE });
          mixInto(mix, span, win.start, (t) => flipAudioGain(project, timeline, part, t));
        } else if (!captureAudio(el)) {
          notes.push(`The sound of "${job.footage[part]?.name}" couldn't be captured, so it's silent.`);
        }
      }
      if (mix && !captureBuffer(mix)) notes.push("The clips' cleaned-up sound couldn't be captured, so it's silent.");
      media.sync(project, timeline, 0, false, true);
      return {
        draw: (compositor, t) =>
          compositor.drawLayers(
            flipFrame({ project, timeline, t, footage: (part) => media.frame(part), getImage: job.getImage }, job.getLut, false),
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
