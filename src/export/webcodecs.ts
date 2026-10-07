/**
 * Fast, frame-accurate export using WebCodecs (via Mediabunny): the clip is
 * decoded frame by frame, each output frame is rendered offscreen and encoded
 * to H.264 + AAC in an MP4, independent of playback speed.
 */
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type InputAudioTrack,
  type VideoCodec,
  type WrappedCanvas,
} from 'mediabunny';
import { Compositor } from '../engine/compositor';
import type { DrawableImage } from '../engine/renderer';
import { sourceTime } from '../engine/timeline';
import { throwIfAborted, type ExportJob, type ExportResult } from './types';

/** Thrown when this path cannot handle the job and the real-time recorder should be tried instead. */
export class WebCodecsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebCodecsUnavailableError';
  }
}

const AUDIO_CHUNK_SECONDS = 1;
const MAX_DECODE_SIDE = 2160;

let aacEncoderRegistered = false;

async function pickAudioCodec(container: 'mp4' | 'webm', numberOfChannels: number, sampleRate: number) {
  const opts = { numberOfChannels, sampleRate };
  if (container === 'mp4') {
    if (!(await canEncodeAudio('aac', opts)) && !aacEncoderRegistered) {
      // Firefox and Chromium on Linux have no native AAC encoder; use the WASM one.
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
      aacEncoderRegistered = true;
    }
    if (await canEncodeAudio('aac', opts)) return 'aac' as AudioCodec;
  }
  if (await canEncodeAudio('opus', opts)) return 'opus' as AudioCodec;
  return null;
}

function videoBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.max(3_000_000, Math.min(16_000_000, width * height * fps * 0.16)));
}

/**
 * Decodes the audio for the edit's whole duration into one AudioBuffer,
 * honouring trim start, looping, and a short fade-out at the very end.
 */
async function buildAudio(
  track: InputAudioTrack,
  job: ExportJob,
  firstTimestamp: number,
  clipEnd: number,
): Promise<AudioBuffer> {
  const { project, timeline, signal } = job;
  const sampleRate = track.sampleRate;
  const channels = Math.min(2, Math.max(1, track.numberOfChannels));
  const total = timeline.total;
  const length = Math.max(1, Math.ceil(total * sampleRate));
  const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
  const outData = Array.from({ length: channels }, (_, c) => out.getChannelData(c));

  const segStart = firstTimestamp + Math.min(project.video.start, Math.max(0, clipEnd - firstTimestamp - 0.05));
  const usable = Math.max(0.05, clipEnd - segStart);
  const sink = new AudioBufferSink(track);

  let outPos = 0;
  while (outPos < total) {
    throwIfAborted(signal);
    const segLength = Math.min(usable, total - outPos);
    const startFrame = Math.round(outPos * sampleRate);
    const endFrame = Math.min(length, Math.round((outPos + segLength) * sampleRate));
    for await (const { buffer, timestamp } of sink.buffers(segStart, segStart + segLength)) {
      throwIfAborted(signal);
      const dst = startFrame + Math.round((timestamp - segStart) * sampleRate);
      for (let c = 0; c < channels; c++) {
        const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
        for (let i = 0; i < src.length; i++) {
          const j = dst + i;
          if (j < startFrame) continue;
          if (j >= endFrame) break;
          outData[c][j] = src[i];
        }
      }
    }
    // Tiny fades at loop seams avoid clicks.
    fade(outData, startFrame, endFrame, Math.round(sampleRate * 0.01));
    if (!project.video.loop) break;
    outPos += segLength;
  }

  // Fade out over the last half second so the video doesn't end on a cut.
  const fadeFrames = Math.min(length, Math.round(sampleRate * 0.5));
  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < fadeFrames; i++) outData[c][length - fadeFrames + i] *= 1 - i / fadeFrames;
  }

  if (sampleRate === 44100 || sampleRate === 48000) return out;
  // AAC encoders are picky about unusual sample rates; resample to 48 kHz.
  const offline = new OfflineAudioContext(channels, Math.ceil(total * 48000), 48000);
  const node = offline.createBufferSource();
  node.buffer = out;
  node.connect(offline.destination);
  node.start();
  return offline.startRendering();
}

function fade(data: Float32Array[], start: number, end: number, frames: number) {
  if (end - start < frames * 2) return;
  for (const ch of data) {
    for (let i = 0; i < frames; i++) {
      const k = i / frames;
      ch[start + i] *= k;
      ch[end - 1 - i] *= k;
    }
  }
}

function sliceAudio(buffer: AudioBuffer, fromFrame: number, toFrame: number): AudioBuffer {
  const length = Math.max(1, toFrame - fromFrame);
  const chunk = new AudioBuffer({ length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    chunk.copyToChannel(buffer.getChannelData(c).subarray(fromFrame, toFrame), c);
  }
  return chunk;
}

export async function exportWithWebCodecs(job: ExportJob): Promise<ExportResult> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new WebCodecsUnavailableError('WebCodecs is not available in this browser.');
  }
  const { width, height, fps, project, timeline, signal, onProgress } = job;
  const notes: string[] = [];
  const bitrate = videoBitrate(width, height, fps);

  // 1. Output codecs: H.264 in MP4 is what Instagram wants; WebM is the last resort.
  let container: 'mp4' | 'webm' = 'mp4';
  let videoCodec: VideoCodec | null = await getFirstEncodableVideoCodec(['avc'], {
    width,
    height,
    quality: new Quality({ bitrate }),
  });
  if (!videoCodec) {
    container = 'webm';
    videoCodec = await getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], { width, height });
  }
  if (!videoCodec) throw new WebCodecsUnavailableError('No usable video encoder in this browser.');
  if (container === 'webm') {
    notes.push(
      'This browser cannot encode H.264, so the file is WebM. Instagram prefers MP4 — export from Chrome, Edge or Safari for an MP4.',
    );
  }

  // 2. Open the background clip.
  let input: Input | null = null;
  let output: Output | null = null;
  let compositor: Compositor | null = null;
  try {
    let sink: CanvasSink | null = null;
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
      const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(vt.displayWidth, vt.displayHeight));
      sink = new CanvasSink(vt, {
        width: Math.round(vt.displayWidth * scale),
        height: Math.round(vt.displayHeight * scale),
        fit: 'fill',
        poolSize: 3,
      });
      if (project.video.audio) {
        const at = await input.getPrimaryAudioTrack();
        if (at && (await at.canDecode())) audioTrack = at;
        else if (at) notes.push("The clip's audio codec couldn't be decoded here, so the export is silent.");
      }
    }

    // 3. Audio.
    let audioCodec: AudioCodec | null = null;
    let audio: AudioBuffer | null = null;
    if (audioTrack) {
      onProgress(0, 'Preparing audio…');
      audio = await buildAudio(audioTrack, job, first, clipEnd);
      audioCodec = await pickAudioCodec(container, audio.numberOfChannels, audio.sampleRate);
      if (!audioCodec) {
        notes.push('No audio encoder is available in this browser, so the export is silent.');
        audio = null;
      }
    }

    // 4. Output file.
    output = new Output({
      format: container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target: new BufferTarget(),
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not create a 2D canvas.');
    compositor = new Compositor(ctx);

    const videoSource = new CanvasSource(canvas, {
      codec: videoCodec,
      quality: new Quality({ bitrate }),
      keyFrameInterval: 2,
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource: AudioBufferSource | null = null;
    if (audio && audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, quality: new Quality({ bitrate: 192_000 }) });
      output.addAudioTrack(audioSource);
    }
    await output.start();

    // 5. Render + encode every frame, feeding audio alongside so the muxer can interleave.
    const frameCount = Math.max(1, Math.round(timeline.total * fps));
    const clip = { start: project.video.start, loop: project.video.loop, duration: clipEnd - first, frameStep: 1 / fps };
    const frames: AsyncGenerator<WrappedCanvas | null> | null = sink
      ? sink.canvasesAtTimestamps(
          (function* () {
            for (let i = 0; i < frameCount; i++) yield first + sourceTime(i / fps, clip);
          })(),
        )
      : null;

    const chunkFrames = audio ? Math.round(audio.sampleRate * AUDIO_CHUNK_SECONDS) : 0;
    let audioPos = 0;
    const feedAudio = async (untilSeconds: number) => {
      if (!audio || !audioSource) return;
      const until = Math.min(audio.length, Math.round(untilSeconds * audio.sampleRate));
      while (audioPos < until) {
        const next = Math.min(audio.length, audioPos + chunkFrames);
        await audioSource.add(sliceAudio(audio, audioPos, next));
        audioPos = next;
      }
    };

    let current: DrawableImage | null = null;
    const started = performance.now();
    for (let i = 0; i < frameCount; i++) {
      throwIfAborted(signal);
      if (frames) {
        const next = await frames.next();
        if (!next.done && next.value) {
          const c = next.value.canvas;
          current = { source: c, width: c.width, height: c.height };
        }
      }
      const t = i / fps;
      compositor.draw({ project, timeline, t, getImage: job.getImage, getLut: job.getLut, video: current });
      await feedAudio(t + AUDIO_CHUNK_SECONDS);
      await videoSource.add(t, 1 / fps);

      if (i % 3 === 0 || i === frameCount - 1) {
        const done = (i + 1) / frameCount;
        const elapsed = (performance.now() - started) / 1000;
        const eta = done > 0.02 ? Math.max(0, elapsed / done - elapsed) : NaN;
        onProgress(done * 0.97, `Rendering frame ${i + 1} / ${frameCount}${Number.isFinite(eta) ? ` · ~${Math.ceil(eta)}s left` : ''}`);
      }
    }
    await frames?.return(undefined);
    await feedAudio(Infinity);

    videoSource.close();
    audioSource?.close();
    onProgress(0.98, 'Finalizing file…');
    await output.finalize();

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('The encoder produced no data.');
    const mimeType = container === 'mp4' ? 'video/mp4' : 'video/webm';
    onProgress(1, 'Done');
    return {
      blob: new Blob([buffer], { type: mimeType }),
      mimeType,
      extension: container,
      videoCodec: videoCodec === 'avc' ? 'H.264' : videoCodec.toUpperCase(),
      audioCodec: audioSource ? (audioCodec === 'aac' ? 'AAC' : audioCodec === 'opus' ? 'Opus' : String(audioCodec)) : null,
      method: 'webcodecs',
      notes,
    };
  } catch (err) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => undefined);
    }
    throw err;
  } finally {
    input?.dispose();
    compositor?.dispose();
  }
}
