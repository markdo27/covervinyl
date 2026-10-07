import { exportWithRecorder } from './recorder';
import { ExportAbortedError, type ExportJob, type ExportResult } from './types';
import { exportWithWebCodecs } from './webcodecs';

export { ExportAbortedError } from './types';
export type { ExportJob, ExportResult } from './types';

/**
 * Exports with WebCodecs when possible (fast, frame-accurate MP4) and falls
 * back to real-time MediaRecorder capture otherwise.
 */
export async function exportVideo(job: ExportJob, method: 'auto' | 'realtime'): Promise<ExportResult> {
  if (method === 'auto') {
    try {
      return await exportWithWebCodecs(job);
    } catch (err) {
      if (err instanceof ExportAbortedError || job.signal.aborted) throw new ExportAbortedError();
      console.warn('[CoverVinyl] WebCodecs export failed, falling back to real-time recording:', err);
      job.onProgress(0, 'Switching to real-time recording…');
      const result = await exportWithRecorder(job);
      const reason = err instanceof Error ? err.message : String(err);
      return { ...result, notes: [`Fast export wasn't possible (${reason}).`, ...result.notes] };
    }
  }
  return exportWithRecorder(job);
}
