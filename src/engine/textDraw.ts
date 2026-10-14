/** Drawing laid-out text lines on a canvas, shared by the renderers. */
import type { PlacedLine } from './textLayout';

export function setTextShadow(ctx: CanvasRenderingContext2D, W: number, on: boolean): void {
  if (on) {
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = W * 0.012;
    ctx.shadowOffsetY = W * 0.0015;
    ctx.shadowOffsetX = 0;
  } else {
    ctx.shadowColor = 'transparent';
  }
}

/** Number of copies + per-copy alpha for a cheap directional motion blur. */
export function smearCopies(smear: number, alpha: number, W: number): { n: number; a: number } {
  const n = smear > W * 0.002 ? Math.min(8, 2 + Math.ceil(smear / (W * 0.006))) : 1;
  return { n, a: n === 1 ? alpha : 1 - Math.pow(1 - Math.min(alpha, 0.999), 1 / n) };
}

/** Draws one line at (x, top), optionally smeared along x / y for motion blur. */
export function drawTextLine(
  ctx: CanvasRenderingContext2D,
  line: PlacedLine,
  x: number,
  top: number,
  opts: { alpha: number; color: string; shadow: boolean; smearX?: number; smearY?: number },
): void {
  if (opts.alpha <= 0.003 || !line.runs.length) return;
  const W = ctx.canvas.width;
  const smearX = opts.smearX ?? 0;
  const smearY = opts.smearY ?? 0;
  setTextShadow(ctx, W, opts.shadow);
  const cy = top + line.height / 2;
  const { n, a } = smearCopies(Math.max(Math.abs(smearX), Math.abs(smearY)), opts.alpha, W);
  ctx.globalAlpha = a;
  for (let c = 0; c < n; c++) {
    const k = n === 1 ? 0 : c / (n - 1) - 0.5;
    for (const run of line.runs) {
      ctx.font = run.font;
      ctx.fillStyle = run.color ?? opts.color;
      if ('letterSpacing' in ctx) ctx.letterSpacing = run.letterSpacing;
      ctx.fillText(run.text, x + run.x + k * smearX, cy + k * smearY);
    }
  }
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'transparent';
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
