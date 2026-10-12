/** Draws Photo Reel frames: the shot sequence and the overlay animation on top. */
import { easeInOutCubic } from './easing';
import type { LayeredFrame } from './compositor';
import { overlayLength, stillOverlayFrame, type OverlayAsset } from './overlay';
import { overlayTime, reelLayersAt, type MediaAsset, type ReelProject, type ReelTimeline } from './reel';
import type { DrawableImage } from './renderer';
import type { Lut } from './luts';

export interface ReelRenderInput {
  project: ReelProject;
  timeline: ReelTimeline;
  t: number;
  getMedia: (id: string | null) => MediaAsset | null;
  /** Current decoded frame for the video shot at index i (null if none / not ready). */
  videoFrame: (itemIndex: number) => DrawableImage | null;
  overlay: OverlayAsset | null;
  /** Current frame of a video overlay (null if not ready); sequences/stills are resolved here. */
  overlayVideoFrame: DrawableImage | null;
}

/** Splits a reel frame into compositor layers (overlay graded or kept clean). */
export function reelFrame(input: ReelRenderInput, getLut: (key: string) => Lut | null, safeZones: boolean): LayeredFrame {
  const { project } = input;
  const clean = project.overlay.abovePost;
  return {
    t: input.t,
    post: project.post,
    getLut,
    base: (ctx, W, H) => {
      drawShots(ctx, W, H, input);
      if (!clean) drawOverlay(ctx, W, H, input);
    },
    top: clean ? (ctx, W, H) => drawOverlay(ctx, W, H, input) : undefined,
    safeZones: safeZones ? project.ratio : null,
  };
}

/* ------------------------------------------------------------------ */
/* Shots                                                               */
/* ------------------------------------------------------------------ */

export function drawShots(ctx: CanvasRenderingContext2D, W: number, H: number, input: ReelRenderInput): void {
  const { project, timeline, t } = input;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const { layers, flash } = reelLayersAt(project, timeline, t);
  for (const layer of layers) {
    const item = project.items[layer.index];
    const asset = input.getMedia(item.assetId);
    const progress = Math.min(1, Math.max(0, layer.local / Math.max(0.1, item.duration)));
    const zoom = 1 + project.zoom * easeInOutCubic(progress);
    ctx.globalAlpha = Math.min(1, Math.max(0, layer.alpha));
    const frame = asset
      ? asset.kind === 'image' && asset.image
        ? { source: asset.image, width: asset.width, height: asset.height }
        : input.videoFrame(layer.index)
      : null;
    if (frame) drawCover(ctx, frame, W, H, zoom);
    else drawPlaceholderShot(ctx, W, H, layer.index, zoom, !!asset);
  }
  ctx.globalAlpha = 1;
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${(flash * 0.85).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

function drawCover(ctx: CanvasRenderingContext2D, img: DrawableImage, W: number, H: number, zoom: number) {
  const scale = Math.max(W / img.width, H / img.height) * zoom;
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img.source, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

const SHOT_COLOURS = [
  ['#5b3a29', '#c9894f'],
  ['#2f3b2a', '#8aa36b'],
  ['#3a2f45', '#b48ac9'],
  ['#2a3b45', '#7fb3c9'],
  ['#4a2a2a', '#d0705a'],
  ['#3b3a28', '#d1c27a'],
];

/** Stand-in shot shown before media is uploaded (or while a clip loads). */
function drawPlaceholderShot(ctx: CanvasRenderingContext2D, W: number, H: number, index: number, zoom: number, loading: boolean) {
  const [a, b] = SHOT_COLOURS[index % SHOT_COLOURS.length];
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-W / 2, -H / 2);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // A few "brick" rows so it reads as a street photo.
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = Math.max(1, W * 0.004);
  const row = H / 22;
  for (let r = 0; r < 24; r++) {
    const y = r * row;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    for (let x = (r % 2) * (W / 12); x < W; x += W / 6) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + row);
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${W * 0.16}px "Inter Variable", system-ui, sans-serif`;
  ctx.fillText(String(index + 1).padStart(2, '0'), W / 2, H * 0.8);
  ctx.font = `600 ${W * 0.035}px "Inter Variable", system-ui, sans-serif`;
  ctx.fillText(loading ? 'LOADING…' : 'YOUR PHOTO / CLIP', W / 2, H * 0.87);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

const BLEND: Record<ReelProject['overlay']['blend'], GlobalCompositeOperation> = {
  normal: 'source-over',
  screen: 'screen',
  multiply: 'multiply',
  overlay: 'overlay',
};

export function drawOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, input: ReelRenderInput): void {
  const o = input.project.overlay;
  if (!o.visible || o.opacity <= 0) return;
  const cx = o.x * W;
  const cy = o.y * H;
  const w = o.scale * W;

  ctx.save();
  ctx.globalAlpha = o.opacity;
  ctx.globalCompositeOperation = BLEND[o.blend];
  if (!input.overlay) {
    drawDemoOverlay(ctx, cx, cy, w, input.t * o.speed);
  } else {
    const frame =
      input.overlay.kind === 'video'
        ? input.overlayVideoFrame
        : stillOverlayFrame(input.overlay, o.fps, overlayTime(input.t, o.speed, overlayLength(input.overlay, o.fps)));
    if (frame && frame.width > 0) {
      const h = w * (frame.height / frame.width);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(frame.source, cx - w / 2, cy - h / 2, w, h);
    }
  }
  ctx.restore();
}

/**
 * Built-in demo: a hand-drawn style record character strutting in place at
 * 12 fps with "boiling" lines, so the preview shows the idea before upload.
 */
function drawDemoOverlay(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, t: number) {
  const frame = Math.floor(t * 12);
  const step = Math.floor(t * 4) % 2; // which leg is forward, on the beat
  const jitter = (n: number) => {
    const x = Math.sin((frame + 1) * 12.9898 + n * 78.233) * 43758.5453;
    return (x - Math.floor(x) - 0.5) * size * 0.012;
  };
  const orange = '#f0712c';
  const r = size * 0.3;
  const bob = (step ? -1 : 1) * size * 0.015;
  const bx = cx + jitter(1);
  const by = cy - size * 0.08 + bob + jitter(2);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = orange;
  ctx.fillStyle = orange;

  // Legs: two parallel strokes each, alternating stride.
  ctx.lineWidth = size * 0.022;
  for (const side of [-1, 1]) {
    const forward = (side === -1) === (step === 0);
    const hipX = bx + side * r * 0.35;
    const hipY = by + r * 0.85;
    const footX = hipX + (forward ? side * r * 0.55 : -side * r * 0.1) + jitter(3 + side);
    const footY = by + r * 2.0;
    for (const o of [-0.06, 0.06]) {
      ctx.beginPath();
      ctx.moveTo(hipX + o * r, hipY);
      ctx.lineTo(footX + o * r, footY);
      ctx.stroke();
    }
    // Shoe
    ctx.beginPath();
    ctx.ellipse(footX + side * r * 0.12, footY + r * 0.05, r * 0.24, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Record body with grooves and a label.
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = size * 0.006;
  for (let k = 0.45; k < 0.95; k += 0.12) {
    ctx.beginPath();
    ctx.arc(bx + jitter(10 + k * 10), by + jitter(20 + k * 10), r * k, 0.3 + frame * 0.2, 0.3 + frame * 0.2 + Math.PI * 1.4);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff4e6';
  ctx.beginPath();
  ctx.arc(bx, by, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = orange;
  ctx.beginPath();
  ctx.arc(bx, by, r * 0.05, 0, Math.PI * 2);
  ctx.fill();

  // Arms swinging opposite to the legs.
  ctx.strokeStyle = orange;
  ctx.lineWidth = size * 0.02;
  for (const side of [-1, 1]) {
    const swing = (side === -1) === (step === 0) ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(bx + side * r * 0.95, by + r * 0.1);
    ctx.quadraticCurveTo(
      bx + side * r * 1.35,
      by + r * 0.45,
      bx + side * r * 1.15 + swing * r * 0.25 + jitter(30 + side),
      by + r * 0.85 + jitter(40 + side),
    );
    ctx.stroke();
  }

  // Music notes drifting up on the right.
  ctx.fillStyle = orange;
  ctx.strokeStyle = orange;
  ctx.lineWidth = size * 0.012;
  for (let n = 0; n < 2; n++) {
    const phase = (t * 0.8 + n * 0.5) % 1;
    const nx = bx + r * (1.15 + n * 0.35) + jitter(50 + n);
    const ny = by - r * (0.6 + phase * 0.9);
    ctx.beginPath();
    ctx.ellipse(nx, ny, size * 0.03, size * 0.022, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(nx + size * 0.026, ny);
    ctx.lineTo(nx + size * 0.026, ny - size * 0.1);
    ctx.lineTo(nx + size * 0.06, ny - size * 0.085);
    ctx.stroke();
  }
}
