/**
 * Fallback export: plays the edit in real time on an offscreen canvas and
 * records it with MediaRecorder (MP4 where supported, otherwise WebM).
 * Takes as long as the video itself and needs the tab to stay visible.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';
import { renderFrame, type DrawableImage } from '../engine/renderer';
import { sourceTime } from '../engine/timeline';
import { ExportAbortedError, type ExportJob, type ExportResult } from './types';

// Explicit H.264 MP4 first (what Instagram wants). A bare 'video/mp4' comes last
// because some browsers put VP9 inside it.
const MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.640028,mp4a.40.2"',
  'video/mp4;codecs="avc1.4d002a,mp4a.40.2"',
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  'video/mp4;codecs=avc1',
  'video/webm;codecs="vp9,opus"',
  'video/webm;codecs="vp8,opus"',
  'video/webm',
  'video/mp4',
];

function describeCodecs(mime: string): { video: string; audio: string } {
  const video = /avc1|h264/i.test(mime)
    ? 'H.264'
    : /vp0?9/i.test(mime)
      ? 'VP9'
      : /vp0?8/i.test(mime)
        ? 'VP8'
        : /av0?1/i.test(mime)
          ? 'AV1'
          : mime.startsWith('video/mp4')
            ? 'H.264'
            : 'VP8';
  const audio = /mp4a|aac/i.test(mime) ? 'AAC' : /opus/i.test(mime) ? 'Opus' : mime.startsWith('video/mp4') ? 'AAC' : 'Opus';
  return { video, audio };
}

export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

function once<T extends Event>(target: EventTarget, event: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new ExportAbortedError());
    target.addEventListener(event, (e) => {
      signal?.removeEventListener('abort', onAbort);
      resolve(e as T);
    }, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * MediaRecorder output lacks a duration (WebM) or is fragmented (MP4), which
 * trips up some players and upload forms. Remuxing — no re-encode — fixes both.
 */
async function remux(blob: Blob, mp4: boolean): Promise<Blob | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const output = new Output({
      format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target: new BufferTarget(),
    });
    const conversion = await Conversion.init({ input, output });
    if (!conversion.isValid) return null;
    await conversion.execute();
    const buffer = output.target.buffer;
    return buffer ? new Blob([buffer], { type: blob.type }) : null;
  } catch (err) {
    console.warn('[CoverVinyl] Remuxing the recording failed; keeping the raw file.', err);
    return null;
  } finally {
    input.dispose();
  }
}

export async function exportWithRecorder(job: ExportJob): Promise<ExportResult> {
  const { width, height, fps, project, timeline, signal, onProgress } = job;
  const mimeType = pickRecorderMime();
  if (!mimeType) throw new Error('This browser cannot record video. Please use a recent Chrome, Edge, Safari or Firefox.');
  const notes = ['Recorded in real time — keep this tab visible while exporting.'];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a 2D canvas.');
  const stream = canvas.captureStream(fps);

  let video: HTMLVideoElement | null = null;
  let audioCtx: AudioContext | null = null;
  let hasAudio = false;
  const total = timeline.total;

  try {
    if (job.video) {
      video = document.createElement('video');
      video.src = job.video.url;
      video.playsInline = true;
      video.preload = 'auto';
      video.muted = !project.video.audio;
      await once(video, 'loadeddata', signal);
      if (project.video.audio) {
        try {
          audioCtx = new AudioContext();
          const src = audioCtx.createMediaElementSource(video);
          const dest = audioCtx.createMediaStreamDestination();
          src.connect(dest);
          for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
          hasAudio = true;
        } catch {
          notes.push("The clip's audio couldn't be captured, so the export is silent.");
          video.muted = true;
        }
      }
      video.currentTime = project.video.start;
      await once(video, 'seeked', signal);
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: Math.round(Math.min(16e6, width * height * fps * 0.16)),
      audioBitsPerSecond: 192_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };

    const clip = video
      ? { start: project.video.start, loop: project.video.loop, duration: video.duration, frameStep: 1 / fps }
      : null;
    const drawAt = (t: number) => {
      const frame: DrawableImage | null =
        video && video.readyState >= 2 ? { source: video, width: video.videoWidth, height: video.videoHeight } : null;
      renderFrame(ctx, width, height, { project, timeline, t, getImage: job.getImage, video: frame });
    };

    drawAt(0);
    await audioCtx?.resume();
    if (video) await video.play();
    recorder.start(250);
    const t0 = performance.now();

    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (signal.aborted) {
          reject(new ExportAbortedError());
          return;
        }
        const t = (performance.now() - t0) / 1000;
        if (t >= total) {
          drawAt(total - 1 / fps);
          resolve();
          return;
        }
        if (video && clip) {
          const expected = sourceTime(t, clip);
          const drift = Math.abs(video.currentTime - expected);
          if (drift > 0.25 && !video.seeking) video.currentTime = expected;
          if (video.paused && !video.ended && clip.loop) void video.play().catch(() => undefined);
        }
        drawAt(t);
        onProgress(t / total, `Recording ${t.toFixed(1)}s / ${total.toFixed(1)}s (real time)`);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const stopped = once(recorder, 'stop');
    recorder.stop();
    await stopped;

    // The recorder reports the codecs it actually picked, which can differ from the request.
    const actual = recorder.mimeType || mimeType;
    const type = actual.split(';')[0];
    const isMp4 = type === 'video/mp4';
    const codecs = describeCodecs(actual);
    if (!isMp4 || codecs.video !== 'H.264') {
      notes.push('This browser could not record H.264. Instagram prefers H.264 MP4 — use Chrome, Edge or Safari for that.');
    }
    onProgress(0.99, 'Finalizing file…');
    const raw = new Blob(chunks, { type });
    const blob = (await remux(raw, isMp4)) ?? raw;
    onProgress(1, 'Done');
    return {
      blob,
      mimeType: type,
      extension: isMp4 ? 'mp4' : 'webm',
      videoCodec: codecs.video,
      audioCodec: hasAudio ? codecs.audio : null,
      method: 'realtime',
      notes,
    };
  } finally {
    video?.pause();
    if (video) {
      video.removeAttribute('src');
      video.load();
    }
    for (const track of stream.getTracks()) track.stop();
    await audioCtx?.close().catch(() => undefined);
  }
}
