import { uid } from '../engine/defaults';
import type { MediaAsset } from '../engine/reel';
import type { MusicAsset } from '../engine/reelMedia';
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
  return { id: uid('img'), name: file.name, file, url, image, width: image.naturalWidth, height: image.naturalHeight };
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

/* ------------------------------------------------------------------ */
/* Photo Reel uploads                                                  */
/* ------------------------------------------------------------------ */

// A 1080×1920 frame filled by a 4:3 landscape photo needs ~2560px on the long side.
const MAX_PHOTO_SIDE = 2560;

/**
 * Loads a photo, downscaling big camera images once (as a high-quality JPEG)
 * so dozens of 12-megapixel shots don't exhaust memory.
 */
async function loadReelPhoto(file: File): Promise<MediaAsset> {
  let blob: Blob = file;
  try {
    const bitmap = await createImageBitmap(file);
    const long = Math.max(bitmap.width, bitmap.height);
    if (long > MAX_PHOTO_SIDE) {
      const scale = MAX_PHOTO_SIDE / long;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92))) ?? file;
    }
    bitmap.close();
  } catch {
    throw new Error(`"${file.name}" isn't a photo this browser can open (iPhone HEIC photos need converting to JPG).`);
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  await image.decode();
  return {
    id: uid('media'),
    kind: 'image',
    name: file.name,
    file,
    url,
    width: image.naturalWidth,
    height: image.naturalHeight,
    duration: 0,
    image,
    thumb: url,
  };
}

async function loadReelClip(file: File): Promise<MediaAsset> {
  const info = await loadVideoFile(file);
  // Grab a frame for the thumbnail.
  let thumb = '';
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = info.url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('thumb'));
    });
    video.currentTime = Math.min(0.2, info.duration / 2);
    await new Promise<void>((resolve) => (video.onseeked = () => resolve()));
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = Math.round((160 * info.height) / Math.max(1, info.width));
    c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
    thumb = c.toDataURL('image/jpeg', 0.7);
    video.removeAttribute('src');
    video.load();
  } catch {
    // A missing thumbnail is fine.
  }
  return {
    id: uid('media'),
    kind: 'video',
    name: file.name,
    file,
    url: info.url,
    width: info.width,
    height: info.height,
    duration: info.duration,
    image: null,
    thumb,
  };
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
}

export function loadReelMedia(file: File): Promise<MediaAsset> {
  return isVideoFile(file) ? loadReelClip(file) : loadReelPhoto(file);
}

export function loadMusicFile(file: File): Promise<MusicAsset> {
  const url = URL.createObjectURL(file);
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.src = url;
  return new Promise((resolve, reject) => {
    audio.onloadedmetadata = () =>
      resolve({ id: uid('music'), name: file.name, file, url, duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`"${file.name}" isn't an audio file this browser can play.`));
    };
  });
}
