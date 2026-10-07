import type { Lut } from '../engine/luts';
import type { DrawableImage } from '../engine/renderer';
import type { Timeline } from '../engine/timeline';
import type { Project, VideoAsset } from '../engine/types';

export interface ExportJob {
  project: Project;
  timeline: Timeline;
  width: number;
  height: number;
  fps: number;
  video: VideoAsset | null;
  getImage: (id: string | null) => DrawableImage | null;
  getLut: (key: string) => Lut | null;
  signal: AbortSignal;
  onProgress: (progress: number, label: string) => void;
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
  videoCodec: string;
  audioCodec: string | null;
  method: 'webcodecs' | 'realtime';
  notes: string[];
}

export class ExportAbortedError extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportAbortedError';
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ExportAbortedError();
}
