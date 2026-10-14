/// Runs the audio clean-up off the main thread.
import { enhanceChannels, type AudioEnhance } from '../engine/audioEnhance';

interface Job {
  id: number;
  channels: Float32Array[];
  sampleRate: number;
  settings: AudioEnhance;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Job>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

scope.onmessage = (e) => {
  const { id, channels, sampleRate, settings } = e.data;
  try {
    let last = 0;
    const result = enhanceChannels(channels, sampleRate, settings, (progress) => {
      if (progress - last >= 0.02) {
        last = progress;
        scope.postMessage({ id, progress });
      }
    });
    scope.postMessage({ id, channels: result.channels, stats: result.stats }, result.channels.map((c) => c.buffer));
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
