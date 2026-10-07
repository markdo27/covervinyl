import { uid } from '../engine/defaults';
import type { ImageAsset, VideoAsset } from '../engine/types';

export async function loadImageFile(file: File): Promise<ImageAsset> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`"${file.name}" isn't an image this browser can open.`);
  }
  return { id: uid('img'), name: file.name, url, image, width: image.naturalWidth, height: image.naturalHeight };
}

export function loadVideoFile(file: File): Promise<VideoAsset> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.src = url;
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      resolve({ file, name: file.name, url, duration, width: video.videoWidth, height: video.videoHeight });
      video.removeAttribute('src');
      video.load();
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          `"${file.name}" can't be played in this browser. Try an MP4 (H.264) — iPhone HEVC/MOV clips may need Safari or Chrome with hardware support.`,
        ),
      );
    };
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
