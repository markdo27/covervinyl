/**
 * Fast, frame-accurate export for the cover-crate mode using WebCodecs (via
 * Mediabunny): the clip is decoded frame by frame, each output frame is
 * rendered offscreen and encoded to H.264 + AAC in an MP4, independent of
 * playback speed.
 */
import { ALL_FORMATS, BlobSource, Input, type InputAudioTrack, type WrappedCanvas } from 'mediabunny';
import type { DrawableImage } from '../engine/renderer';
import { sourceTime } from '../engine/timeline';
import {
  assertWebCodecs,
  canvasSinkFor,
  chooseVideoCodec,
  decodeAudioSpan,
  encodeFrames,
  WebCodecsUnavailableError,
} from './encoder';
import type { ExportJob, ExportResult } from './types';

export { WebCodecsUnavailableError } from './encoder';

export async function exportWithWebCodecs(job: ExportJob): Promise<ExportResult> {
  assertWebCodecs();
  const { width, height, fps, project, timeline, signal, onProgress } = job;
  const notes: string[] = [];
  const codec = await chooseVideoCodec(width, height, fps);

  let input: Input | null = null;
  let frames: AsyncGenerator<WrappedCanvas | null> | null = null;
  try {
    let audioTrack: InputAudioTrack | null = null;
    let first = 0;
    let clipEnd = 0;

    if (job.video) {
      onProgress(0, 'Reading video…');
      input = new Input({ source: new BlobSource(job.video.file), formats: ALL_FORMATS });
      const vt = await input.getPrimaryVideoTrack();
      if (!vt || !(await vt.canDecode())) {
        throw new WebCodecsUnavailableError("This browser can't decode the uploaded clip with WebCodecs.");
      }
      first = await vt.getFirstTimestamp();
      clipEnd = await vt.computeDuration();
      const frameCount = Math.max(1, Math.round(timeline.total * fps));
      const clip = { start: project.video.start, loop: project.video.loop, duration: clipEnd - first, frameStep: 1 / fps };
      frames = canvasSinkFor(vt).canvasesAtTimestamps(
        (function* () {
          for (let i = 0; i < frameCount; i++) yield first + sourceTime(i / fps, clip);
        })(),
      );
      if (project.video.audio) {
        const at = await input.getPrimaryAudioTrack();
        if (at && (await at.canDecode())) audioTrack = at;
        else if (at) notes.push("The clip's audio codec couldn't be decoded here, so the export is silent.");
      }
    }

    let audio: AudioBuffer | null = null;
    if (audioTrack) {
      onProgress(0, 'Preparing audio…');
      audio = await decodeAudioSpan(audioTrack, {
        from: first + Math.min(project.video.start, Math.max(0, clipEnd - first - 0.05)),
        end: clipEnd,
        loop: project.video.loop,
        total: timeline.total,
        signal,
      });
    }

    let current: DrawableImage | null = null;
    return await encodeFrames({
      width,
      height,
      fps,
      total: timeline.total,
      signal,
      onProgress,
      codec,
      audio,
      notes,
      render: async (compositor, t) => {
        if (frames) {
          const next = await frames.next();
          if (!next.done && next.value) {
            const c = next.value.canvas;
            current = { source: c, width: c.width, height: c.height };
          }
        }
        compositor.draw({ project, timeline, t, getImage: job.getImage, getLut: job.getLut, video: current });
      },
    });
  } finally {
    await frames?.return(undefined).catch(() => undefined);
    input?.dispose();
  }
}
