/**
 * Where text can sit without Instagram's own UI covering it. In a 9:16
 * Reel the top bar, the caption / audio line at the bottom and the like /
 * comment / share buttons on the right all sit over the video.
 */
import type { Ratio } from './types';

/** The area that's clear for text, as fractions of the canvas width (x) and height (y). */
export interface SafeArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const SAFE_AREAS: Record<Ratio, SafeArea> = {
  '9:16': { left: 0.07, right: 0.86, top: 0.12, bottom: 0.78 },
  '3:4': { left: 0.06, right: 0.94, top: 0.05, bottom: 0.95 },
};

/** How far (in px, ≤ 0) to lift a block so its bottom stays above the safe area's bottom, without pushing its top above the safe area. */
export function safeLift(top: number, bottom: number, H: number, area: SafeArea): number {
  const over = bottom - area.bottom * H;
  if (over <= 0) return 0;
  return -Math.max(0, Math.min(over, top - area.top * H));
}

/** Draws the parts of the frame Instagram's UI covers (preview only). */
export function drawSafeZones(ctx: CanvasRenderingContext2D, W: number, H: number, ratio: Ratio): void {
  if (ratio !== '9:16') return;
  const a = SAFE_AREAS[ratio];
  ctx.save();
  ctx.fillStyle = 'rgba(255, 64, 64, 0.16)';
  ctx.strokeStyle = 'rgba(255, 120, 120, 0.6)';
  ctx.lineWidth = Math.max(1, W * 0.002);
  ctx.setLineDash([W * 0.012, W * 0.01]);
  const zones: [number, number, number, number][] = [
    [0, 0, W, H * a.top],
    [0, H * a.bottom, W, H * (1 - a.bottom)],
    // Like / comment / share / audio buttons.
    [W * a.right, H * 0.45, W * (1 - a.right), H * (a.bottom - 0.45)],
  ];
  for (const [x, y, w, h] of zones) {
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}
