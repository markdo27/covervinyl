/**
 * Decodes a clip's sound, runs the clean-up (in a worker) and caches the
 * result, so the preview and the exporters share one enhanced soundtrack.
 */
import { useEffect, useState } from 'react';
import { enhanceChannels, enhanceKey, type AudioEnhance, type EnhanceStats } from '../engine/audioEnhance';

export interface EnhancedAudio {
  /** The whole clip's sound, cleaned up; position t seconds = clip time t. */
  buffer: AudioBuffer;
  stats: EnhanceStats;
}

/* ---------------- Decoding ---------------- */

const decoded = new WeakMap<File, Promise<AudioBuffer | null>>();

/** A clip's whole soundtrack, aligned so sample 0 is clip time 0; null when it has no sound. */
export function decodeClipAudio(file: File): Promise<AudioBuffer | null> {
  let promise = decoded.get(file);
  if (!promise) {
    promise = decodeWithMediabunny(file).catch(() => decodeWithWebAudio(file));
    decoded.set(file, promise);
  }
  return promise;
}

async function decodeWithMediabunny(file: File): Promise<AudioBuffer | null> {
  const { ALL_FORMATS, AudioBufferSink, BlobSource, Input } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    if (!(await track.canDecode())) throw new Error('No decoder for this audio.');
    const end = await track.computeDuration();
    const sampleRate = track.sampleRate;
    const channels = Math.min(2, Math.max(1, track.numberOfChannels));
    const out = new AudioBuffer({ length: Math.max(1, Math.ceil(end * sampleRate)), numberOfChannels: channels, sampleRate });
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      let offset = Math.round(timestamp * sampleRate);
      let skip = 0;
      if (offset < 0) {
        skip = -offset;
        offset = 0;
      }
      const count = Math.min(buffer.length - skip, out.length - offset);
      if (count <= 0) continue;
      for (let c = 0; c < channels; c++) {
        const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
        out.copyToChannel(src.subarray(skip, skip + count), c, offset);
      }
    }
    return out;
  } finally {
    input.dispose();
  }
}

async function decodeWithWebAudio(file: File): Promise<AudioBuffer | null> {
  try {
    const ctx = new OfflineAudioContext(2, 1, 48000);
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null;
  }
}

/* ---------------- Processing ---------------- */

interface Pending {
  resolve: (r: { channels: Float32Array[]; stats: EnhanceStats }) => void;
  reject: (err: Error) => void;
  onProgress?: (p: number) => void;
}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./audioEnhance.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      if ('progress' in e.data) job.onProgress?.(e.data.progress);
      else if ('error' in e.data) {
        pending.delete(e.data.id);
        job.reject(new Error(e.data.error));
      } else {
        pending.delete(e.data.id);
        job.resolve({ channels: e.data.channels, stats: e.data.stats });
      }
    };
    worker.onerror = () => {
      for (const job of pending.values()) job.reject(new Error('The audio worker stopped.'));
      pending.clear();
      worker?.terminate();
      worker = null;
      workerBroken = true;
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function process(source: AudioBuffer, settings: AudioEnhance, onProgress?: (p: number) => void) {
  const channels = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c).slice());
  const w = getWorker();
  if (!w) return Promise.resolve(enhanceChannels(channels, source.sampleRate, settings, onProgress));
  const id = nextId++;
  return new Promise<{ channels: Float32Array[]; stats: EnhanceStats }>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, channels, sampleRate: source.sampleRate, settings }, channels.map((c) => c.buffer));
  });
}

/* ---------------- Cache ---------------- */

const fileIds = new WeakMap<File, number>();
let fileCounter = 0;
const results = new Map<string, Promise<EnhancedAudio | null>>();
const MAX_CACHED = 6;

/** The cleaned-up sound of a clip for these settings (cached); null if the clip has no sound. */
export function enhanceClipAudio(file: File, settings: AudioEnhance, onProgress?: (p: number) => void): Promise<EnhancedAudio | null> {
  if (!fileIds.has(file)) fileIds.set(file, ++fileCounter);
  const key = `${fileIds.get(file)}:${enhanceKey(settings)}`;
  const cached = results.get(key);
  if (cached) {
    // Most recently used goes to the back.
    results.delete(key);
    results.set(key, cached);
    return cached;
  }
  const promise = (async () => {
    const source = await decodeClipAudio(file);
    if (!source) return null;
    const { channels, stats } = await process(source, settings, onProgress);
    const buffer = new AudioBuffer({ length: source.length, numberOfChannels: channels.length, sampleRate: source.sampleRate });
    channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    return { buffer, stats };
  })();
  promise.catch(() => results.delete(key));
  results.set(key, promise);
  while (results.size > MAX_CACHED) results.delete(results.keys().next().value!);
  return promise;
}

/* ---------------- React ---------------- */

export type EnhanceStatus =
  | { state: 'off' }
  | { state: 'working'; progress: number }
  | { state: 'ready'; stats: EnhanceStats }
  | { state: 'no-audio' }
  | { state: 'error'; message: string };

/**
 * The enhanced sound for a clip, recomputed (after a short pause) whenever
 * the settings change. While a new version is processed the previous one
 * keeps playing.
 */
export function useEnhancedAudio(file: File | null, settings: AudioEnhance | null): { buffer: AudioBuffer | null; status: EnhanceStatus } {
  const [state, setState] = useState<{ file: File | null; buffer: AudioBuffer | null; status: EnhanceStatus }>({
    file: null,
    buffer: null,
    status: { state: 'off' },
  });
  const enabled = !!file && !!settings?.enabled;
  const key = enabled && settings ? enhanceKey(settings) : null;

  useEffect(() => {
    if (!enabled || !file || !settings) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setState((s) => ({ file, buffer: s.file === file ? s.buffer : null, status: { state: 'working', progress: 0 } }));
      enhanceClipAudio(file, settings, (progress) => {
        if (!cancelled) setState((s) => ({ ...s, status: { state: 'working', progress } }));
      })
        .then((result) => {
          if (cancelled) return;
          setState(result ? { file, buffer: result.buffer, status: { state: 'ready', stats: result.stats } } : { file, buffer: null, status: { state: 'no-audio' } });
        })
        .catch((err: unknown) => {
          if (!cancelled) setState({ file, buffer: null, status: { state: 'error', message: err instanceof Error ? err.message : String(err) } });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `key` captures the settings that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, key, enabled]);

  if (!enabled || state.file !== file) return { buffer: null, status: { state: 'off' } };
  return { buffer: state.buffer, status: state.status };
}
