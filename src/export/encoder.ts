/**
 * Shared WebCodecs (Mediabunny) plumbing for every exporter: codec choice,
 * audio decoding/mixing, and the render → encode loop.
 */
import {
  AudioBufferSink,
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type InputAudioTrack,
  type InputVideoTrack,
  type VideoCodec,
} from 'mediabunny';
import { Compositor } from '../engine/compositor';
import { throwIfAborted, type ExportResult } from './types';

/** Thrown when this path cannot handle the job and the real-time recorder should be tried instead. */
export class WebCodecsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebCodecsUnavailableError';
  }
}

export function assertWebCodecs(): void {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new WebCodecsUnavailableError('WebCodecs is not available in this browser.');
  }
}

const AUDIO_CHUNK_SECONDS = 1;
const MAX_DECODE_SIDE = 2160;

export interface VideoCodecChoice {
  container: 'mp4' | 'webm';
  codec: VideoCodec;
  bitrate: number;
  notes: string[];
}

/** H.264 in MP4 is what Instagram wants; WebM (VP9/VP8/AV1) is the last resort. */
export async function chooseVideoCodec(width: number, height: number, fps: number): Promise<VideoCodecChoice> {
  const bitrate = Math.round(Math.max(3_000_000, Math.min(16_000_000, width * height * fps * 0.16)));
  const avc = await getFirstEncodableVideoCodec(['avc'], { width, height, quality: new Quality({ bitrate }) });
  if (avc) return { container: 'mp4', codec: avc, bitrate, notes: [] };
  const fallback = await getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], { width, height });
  if (!fallback) throw new WebCodecsUnavailableError('No usable video encoder in this browser.');
  return {
    container: 'webm',
    codec: fallback,
    bitrate,
    notes: [
      'This browser cannot encode H.264, so the file is WebM. Instagram prefers MP4 — export from Chrome, Edge or Safari for an MP4.',
    ],
  };
}

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

/** A CanvasSink that decodes frames at most 2160px on the long side. */
export function canvasSinkFor(track: InputVideoTrack, opts: { alpha?: boolean } = {}): CanvasSink {
  const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(track.displayWidth, track.displayHeight));
  return new CanvasSink(track, {
    width: Math.round(track.displayWidth * scale),
    height: Math.round(track.displayHeight * scale),
    fit: 'fill',
    alpha: opts.alpha,
    poolSize: 3,
  });
}

/**
 * Decodes `total` seconds of audio from `track`, starting at timestamp
 * `from` and (optionally) looping back to `from` whenever `end` is reached.
 * Adds a short fade at loop seams and a half-second fade-out at the end.
 */
export async function decodeAudioSpan(
  track: InputAudioTrack,
  opts: { from: number; end: number; loop: boolean; total: number; volume?: number; signal: AbortSignal },
): Promise<AudioBuffer> {
  const { total, signal } = opts;
  const sampleRate = track.sampleRate;
  const channels = Math.min(2, Math.max(1, track.numberOfChannels));
  const length = Math.max(1, Math.ceil(total * sampleRate));
  const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
  const outData = Array.from({ length: channels }, (_, c) => out.getChannelData(c));
  const volume = opts.volume ?? 1;

  const usable = Math.max(0.05, opts.end - opts.from);
  const sink = new AudioBufferSink(track);

  let outPos = 0;
  while (outPos < total) {
    throwIfAborted(signal);
    const segLength = Math.min(usable, total - outPos);
    const startFrame = Math.round(outPos * sampleRate);
    const endFrame = Math.min(length, Math.round((outPos + segLength) * sampleRate));
    for await (const { buffer, timestamp } of sink.buffers(opts.from, opts.from + segLength)) {
      throwIfAborted(signal);
      const dst = startFrame + Math.round((timestamp - opts.from) * sampleRate);
      for (let c = 0; c < channels; c++) {
        const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
        for (let i = 0; i < src.length; i++) {
          const j = dst + i;
          if (j < startFrame) continue;
          if (j >= endFrame) break;
          outData[c][j] = src[i] * volume;
        }
      }
    }
    // Tiny fades at loop seams avoid clicks.
    fade(outData, startFrame, endFrame, Math.round(sampleRate * 0.01));
    if (!opts.loop) break;
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

export interface EncodeOptions {
  width: number;
  height: number;
  fps: number;
  /** Seconds of video to produce. */
  total: number;
  signal: AbortSignal;
  onProgress: (progress: number, label: string) => void;
  codec: VideoCodecChoice;
  audio: AudioBuffer | null;
  notes: string[];
  /** Draws frame `i` (time `t`) through the compositor; may await decoded media first. */
  render: (compositor: Compositor, t: number, i: number) => Promise<void> | void;
}

/** Renders every frame offscreen and encodes it (plus audio) into an MP4 / WebM file. */
export async function encodeFrames(opts: EncodeOptions): Promise<ExportResult> {
  const { width, height, fps, total, signal, onProgress, codec } = opts;
  const notes = [...codec.notes, ...opts.notes];

  let audio = opts.audio;
  let audioCodec: AudioCodec | null = null;
  if (audio) {
    audioCodec = await pickAudioCodec(codec.container, audio.numberOfChannels, audio.sampleRate);
    if (!audioCodec) {
      notes.push('No audio encoder is available in this browser, so the export is silent.');
      audio = null;
    }
  }

  const output = new Output({
    format: codec.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a 2D canvas.');
  const compositor = new Compositor(ctx);

  try {
    const videoSource = new CanvasSource(canvas, {
      codec: codec.codec,
      quality: new Quality({ bitrate: codec.bitrate }),
      keyFrameInterval: 2,
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource: AudioBufferSource | null = null;
    if (audio && audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, quality: new Quality({ bitrate: 192_000 }) });
      output.addAudioTrack(audioSource);
    }
    await output.start();

    // Audio is fed alongside the frames so the muxer can interleave.
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

    const frameCount = Math.max(1, Math.round(total * fps));
    const started = performance.now();
    for (let i = 0; i < frameCount; i++) {
      throwIfAborted(signal);
      const t = i / fps;
      await opts.render(compositor, t, i);
      await feedAudio(t + AUDIO_CHUNK_SECONDS);
      await videoSource.add(t, 1 / fps);

      if (i % 3 === 0 || i === frameCount - 1) {
        const done = (i + 1) / frameCount;
        const elapsed = (performance.now() - started) / 1000;
        const eta = done > 0.02 ? Math.max(0, elapsed / done - elapsed) : NaN;
        onProgress(done * 0.97, `Rendering frame ${i + 1} / ${frameCount}${Number.isFinite(eta) ? ` · ~${Math.ceil(eta)}s left` : ''}`);
      }
    }
    await feedAudio(Infinity);

    videoSource.close();
    audioSource?.close();
    onProgress(0.98, 'Finalizing file…');
    await output.finalize();

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('The encoder produced no data.');
    const mimeType = codec.container === 'mp4' ? 'video/mp4' : 'video/webm';
    onProgress(1, 'Done');
    return {
      blob: new Blob([buffer], { type: mimeType }),
      mimeType,
      extension: codec.container,
      videoCodec: codec.codec === 'avc' ? 'H.264' : codec.codec.toUpperCase(),
      audioCodec: audioSource ? (audioCodec === 'aac' ? 'AAC' : audioCodec === 'opus' ? 'Opus' : String(audioCodec)) : null,
      method: 'webcodecs',
      notes,
    };
  } catch (err) {
    if (output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => undefined);
    }
    throw err;
  } finally {
    compositor.dispose();
  }
}
