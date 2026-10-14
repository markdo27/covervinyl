/**
 * Overlay animations drawn on top of the reel. Supported uploads:
 *  - video with an alpha channel (WebM VP8/VP9, or HEVC .mov in Safari)
 *  - a PNG/WebP image sequence (several files, played at a chosen fps)
 *  - an animated GIF / APNG / WebP (decoded with ImageDecoder where available)
 *  - a single still image (e.g. a transparent PNG sticker)
 */
import { uid } from './defaults';
import type { DrawableImage } from './renderer';

export type OverlayAsset =
  | { kind: 'video'; id: string; name: string; file: File; url: string; width: number; height: number; duration: number }
  | {
      kind: 'frames';
      id: string;
      name: string;
      frames: CanvasImageSource[];
      width: number;
      height: number;
      /** Per-frame durations in seconds (animated images), or null to use the chosen fps (sequences). */
      delays: number[] | null;
      /** Object URLs to revoke when the overlay is removed. */
      urls: string[];
      files: File[];
    }
  | { kind: 'image'; id: string; name: string; file: File; image: HTMLImageElement; url: string; width: number; height: number };

export const OVERLAY_ACCEPT = 'video/webm,video/quicktime,video/mp4,.webm,.mov,.mp4,image/png,image/webp,image/gif,image/apng,.png,.webp,.gif,.apng';

const MAX_FRAMES = 900;
const MAX_FRAME_SIDE = 1280;

const isVideoFile = (f: File) => f.type.startsWith('video/') || /\.(webm|mov|mp4|m4v)$/i.test(f.name);
const naturalSort = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

async function loadImage(file: File): Promise<{ image: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`"${file.name}" isn't an image this browser can open.`);
  }
  return { image, url };
}

async function loadOverlayVideo(file: File): Promise<OverlayAsset> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.src = url;
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      resolve({
        kind: 'video',
        id: uid('ovl'),
        name: file.name,
        file,
        url,
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          `"${file.name}" can't be played here. Export your animation as WebM (VP9 with alpha) or a PNG sequence — ProRes 4444 .mov files don't play in browsers.`,
        ),
      );
    };
  });
}

/** Decodes every frame of an animated GIF / APNG / WebP. Returns null if it's a still or unsupported. */
async function decodeAnimatedImage(file: File): Promise<{ frames: ImageBitmap[]; delays: number[] } | null> {
  const Decoder = (globalThis as { ImageDecoder?: typeof ImageDecoder }).ImageDecoder;
  if (!Decoder || !(await Decoder.isTypeSupported(file.type).catch(() => false))) return null;
  const decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track || !track.animated || track.frameCount <= 1) return null;
    const frames: ImageBitmap[] = [];
    const delays: number[] = [];
    for (let i = 0; i < Math.min(track.frameCount, MAX_FRAMES); i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(image.displayWidth, image.displayHeight));
      frames.push(
        await createImageBitmap(image, {
          resizeWidth: Math.round(image.displayWidth * scale),
          resizeHeight: Math.round(image.displayHeight * scale),
        }),
      );
      // Durations are in microseconds; browsers treat very short GIF delays as 100 ms.
      const d = (image.duration ?? 0) / 1e6;
      delays.push(d >= 0.02 ? d : 0.1);
      image.close();
    }
    return { frames, delays };
  } finally {
    decoder.close();
  }
}

export async function loadOverlayFiles(files: File[]): Promise<OverlayAsset> {
  if (!files.length) throw new Error('No files selected.');
  if (files.length === 1 && isVideoFile(files[0])) return loadOverlayVideo(files[0]);

  const images = files.filter((f) => !isVideoFile(f)).sort(naturalSort);
  if (images.length > 1) {
    if (images.length > MAX_FRAMES) throw new Error(`That's ${images.length} frames — the limit is ${MAX_FRAMES}.`);
    const loaded = await Promise.all(images.map(loadImage));
    const first = loaded[0].image;
    return {
      kind: 'frames',
      id: uid('ovl'),
      name: `${images[0].name} … (${images.length} frames)`,
      frames: loaded.map((l) => l.image),
      width: first.naturalWidth,
      height: first.naturalHeight,
      delays: null,
      urls: loaded.map((l) => l.url),
      files: images,
    };
  }

  const file = images[0];
  const animated = await decodeAnimatedImage(file).catch(() => null);
  if (animated) {
    return {
      kind: 'frames',
      id: uid('ovl'),
      name: file.name,
      frames: animated.frames,
      width: animated.frames[0].width,
      height: animated.frames[0].height,
      delays: animated.delays,
      urls: [],
      files: [file],
    };
  }
  const { image, url } = await loadImage(file);
  return { kind: 'image', id: uid('ovl'), name: file.name, file, image, url, width: image.naturalWidth, height: image.naturalHeight };
}

/** The files the overlay was loaded from. */
export function overlayFiles(asset: OverlayAsset): File[] {
  return asset.kind === 'frames' ? asset.files : [asset.file];
}

export function releaseOverlay(asset: OverlayAsset): void {
  if (asset.kind === 'video' || asset.kind === 'image') URL.revokeObjectURL(asset.url);
  if (asset.kind === 'frames') {
    asset.urls.forEach((u) => URL.revokeObjectURL(u));
    for (const f of asset.frames) if (f instanceof ImageBitmap) f.close();
  }
}

/** Length of one loop of the overlay, in seconds. */
export function overlayLength(asset: OverlayAsset, fps: number): number {
  if (asset.kind === 'video') return asset.duration;
  if (asset.kind === 'frames') {
    return asset.delays ? asset.delays.reduce((a, b) => a + b, 0) : asset.frames.length / Math.max(1, fps);
  }
  return 0;
}

/** The frame of an image sequence / animated image at `time` seconds into its loop. */
export function frameIndexAt(delays: number[] | null, count: number, fps: number, time: number): number {
  if (count <= 1) return 0;
  if (!delays) return Math.min(count - 1, Math.floor(time * Math.max(1, fps)) % count);
  let acc = 0;
  for (let i = 0; i < delays.length; i++) {
    acc += delays[i];
    if (time < acc) return i;
  }
  return delays.length - 1;
}

/** Still frame of a non-video overlay at a time inside its loop. */
export function stillOverlayFrame(asset: OverlayAsset, fps: number, time: number): DrawableImage | null {
  if (asset.kind === 'image') return { source: asset.image, width: asset.width, height: asset.height };
  if (asset.kind === 'frames') {
    const f = asset.frames[frameIndexAt(asset.delays, asset.frames.length, fps, time)];
    return { source: f, width: asset.width, height: asset.height };
  }
  return null;
}
