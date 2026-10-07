import { clamp01, easeInCubic, easeInOutCubic, easeOutCubic, easeOutExpo, lerp } from './easing';
import { fontStack } from './fonts';
import { planMorph, type MorphPlan } from './morph';
import { drawPlaceholderBackground, placeholderCover } from './placeholder';
import {
  cachedGlyphs,
  cachedLayout,
  type Glyph,
  type PlacedLine,
  type TextBlock,
  type TextMetricsStyle,
} from './textLayout';
import { slideIndexAt, type Timeline } from './timeline';
import type { Project } from './types';

export interface DrawableImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export interface RenderInput {
  project: Project;
  timeline: Timeline;
  t: number;
  getImage: (id: string | null) => DrawableImage | null;
  /** Current frame of the background clip, or null for the built-in stand-in. */
  video: DrawableImage | null;
  /** Draw Instagram UI safe-zone guides (preview only). */
  safeZones?: boolean;
}

/** Everything that depends on canvas size + project, computed once per frame. */
interface Frame {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  p: Project;
  tl: Timeline;
  t: number;
  baseX: number;
  baseY: number;
  coverSize: number;
  textTop: number;
  maxTextWidth: number;
  style: TextMetricsStyle;
  footerStyle: TextMetricsStyle;
  bodyLine: number;
}

const morphPlans = new Map<string, MorphPlan<Glyph>>();

export function renderFrame(ctx: CanvasRenderingContext2D, W: number, H: number, input: RenderInput): void {
  const { project: p, timeline: tl, t } = input;
  const place = p.placement[p.ratio];
  const coverSize = p.cover.size * W;
  const bodyPx = p.text.size * W;
  const style: TextMetricsStyle = {
    bodyStack: fontStack(p.text.family),
    headlineStack: fontStack(p.text.headlineFamily),
    bodyPx,
    headlinePx: bodyPx * p.text.headlineScale,
    lineHeight: p.text.lineHeight,
    tracking: p.text.tracking,
    weights: p.text.weights,
  };
  const f: Frame = {
    ctx,
    W,
    H,
    p,
    tl,
    t,
    baseX: place.x * W,
    baseY: place.y * H,
    coverSize,
    textTop: place.y * H + coverSize + 0.035 * W,
    maxTextWidth: Math.max(W * 0.2, W - place.x * W - 0.05 * W),
    style,
    footerStyle: { ...style, bodyPx: bodyPx * p.text.footerScale, headlinePx: style.headlinePx * p.text.footerScale },
    bodyLine: bodyPx * p.text.lineHeight,
  };

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  drawBackground(f, input.video);

  const d = Math.max(0.05, p.motion.transition);
  const hasEnd = tl.endStart < tl.total;
  const overlayAlpha = hasEnd ? 1 - easeOutCubic((t - tl.endStart) / (d * 0.5)) : 1;
  if (p.slides.length && overlayAlpha > 0.001) {
    ctx.globalAlpha = 1;
    drawCovers(f, input.getImage, overlayAlpha);
    drawSlideText(f, overlayAlpha);
  }
  if (hasEnd && t >= tl.endStart) drawEndCard(f, input.getImage, d);
  if (input.safeZones) drawSafeZones(f);

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Background                                                          */
/* ------------------------------------------------------------------ */

function drawBackground(f: Frame, video: DrawableImage | null): void {
  const { ctx, W, H, p } = f;
  if (video && video.width > 0 && video.height > 0) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const scale = Math.max(W / video.width, H / video.height) * Math.max(1, p.video.zoom);
    const dw = video.width * scale;
    const dh = video.height * scale;
    const x = (W - dw) * ((p.video.panX + 1) / 2);
    const y = (H - dh) * ((p.video.panY + 1) / 2);
    ctx.drawImage(video.source, x, y, dw, dh);
  } else {
    drawPlaceholderBackground(ctx, W, H, f.t);
  }
  if (p.video.dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${p.video.dim})`;
    ctx.fillRect(0, 0, W, H);
  }
}

/* ------------------------------------------------------------------ */
/* Cover crate                                                         */
/* ------------------------------------------------------------------ */

/** Continuous "which cover is in front" position, e.g. 1.4 = 40% through flipping from cover 2 to cover 3. */
function coverPosition(f: Frame): number {
  const idx = slideIndexAt(f.tl, Math.min(f.t, f.tl.endStart - 1e-6));
  if (idx <= 0) return Math.max(0, idx);
  const local = f.t - f.tl.slideStarts[idx];
  const d = f.p.motion.transition * 0.8;
  if (local >= d) return idx;
  return idx - 1 + easeInOutCubic(local / d);
}

function drawCovers(f: Frame, getImage: RenderInput['getImage'], alpha: number): void {
  const { p, W, coverSize, baseX, baseY } = f;
  const pos = coverPosition(f);
  const fan = p.motion.fanOut ? easeOutExpo((f.t - p.motion.introDelay) / 1.1) : 1;
  const offset = p.cover.stackOffset * coverSize;
  const stack = Math.max(0, Math.round(p.cover.stackCount));

  const items: { i: number; r: number }[] = [];
  for (let i = 0; i < p.slides.length; i++) {
    const r = i - pos;
    if (r <= -1 || r >= Math.max(1, stack + 1)) continue;
    items.push({ i, r });
  }
  items.sort((a, b) => b.r - a.r); // back to front

  for (const { i, r } of items) {
    const slide = p.slides[i];
    const img = getImage(slide.coverId) ?? {
      source: placeholderCover(i),
      width: 512,
      height: 512,
    };
    let x = baseX;
    let a = alpha;
    let blur = 0;
    let scale = 1;
    if (r < 0) {
      // Outgoing cover: fades and softens on top of the one sliding into place.
      const k = -r;
      a *= 1 - easeOutCubic(k);
      blur = k * W * 0.012;
      scale = 1 + k * 0.03;
    } else {
      x = baseX + (stack === 0 ? 0 : r * offset * fan);
      a *= stack === 0 ? clamp01(1 - r) : clamp01(stack + 1 - r);
    }
    if (a <= 0.002) continue;
    const s = coverSize * scale;
    drawCover(f, img, x - (s - coverSize) / 2, baseY - (s - coverSize) / 2, s, a, blur);
  }
}

function drawCover(f: Frame, img: DrawableImage, x: number, y: number, size: number, alpha: number, blur: number) {
  const { ctx, W, p } = f;
  const radius = p.cover.radius * size;
  // Square centre-crop of the artwork.
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (p.cover.shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = W * 0.018;
    ctx.shadowOffsetX = W * 0.004;
    ctx.shadowOffsetY = W * 0.004;
    ctx.fillStyle = '#000';
    roundRect(ctx, x, y, size, size, radius);
    ctx.fill();
    ctx.restore();
  }
  if (radius > 0) {
    roundRect(ctx, x, y, size, size, radius);
    ctx.clip();
  }
  if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.drawImage(img.source, sx, sy, side, side, x, y, size, size);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

/* ------------------------------------------------------------------ */
/* Slide text                                                          */
/* ------------------------------------------------------------------ */

function morphProgress(f: Frame, i: number, t: number): number {
  const slide = f.p.slides[i];
  if (!slide.morphFrom.trim()) return 1;
  const start = f.tl.slideStarts[i] + (i === 0 ? f.p.motion.introDelay : f.p.motion.transition + 0.35);
  return clamp01((t - start) / Math.max(0.05, f.p.motion.morphDuration));
}

function block(f: Frame, markup: string, style = f.style): TextBlock {
  return cachedLayout(f.ctx, markup, style, f.maxTextWidth);
}

/** Height of slide i's text at time t, following its morph. */
function textHeight(f: Frame, i: number, t: number): number {
  const slide = f.p.slides[i];
  const to = block(f, slide.text).height;
  if (!slide.morphFrom.trim()) return to;
  const from = block(f, slide.morphFrom).height;
  return lerp(from, to, easeInOutCubic(morphProgress(f, i, t)));
}

function footerTop(f: Frame, t: number): number {
  const idx = slideIndexAt(f.tl, Math.min(t, f.tl.endStart - 1e-6));
  const gap = f.p.footerGap * f.bodyLine;
  const cur = textHeight(f, idx, t);
  const local = t - f.tl.slideStarts[idx];
  const d = f.p.motion.transition;
  if (idx > 0 && local < d) {
    const prev = textHeight(f, idx - 1, f.tl.slideStarts[idx]);
    return f.textTop + lerp(prev, cur, easeInOutCubic(local / d)) + gap;
  }
  return f.textTop + cur + gap;
}

function drawSlideText(f: Frame, alpha: number): void {
  const { p, tl, t } = f;
  const idx = slideIndexAt(tl, Math.min(t, tl.endStart - 1e-6));
  if (idx < 0) return;
  const slide = p.slides[idx];
  const local = t - tl.slideStarts[idx];
  const d = p.motion.transition;
  const stagger = d * 0.075;

  // Outgoing text of the previous slide.
  if (idx > 0 && local < d * 1.5) {
    const prev = block(f, p.slides[idx - 1].text);
    prev.lines.forEach((line, k) => {
      const e = clamp01((local - k * stagger * 0.6) / (d * 0.45));
      if (e >= 1) return;
      const dy = -easeInCubic(e) * f.bodyLine * 1.1;
      const smear = easeInCubic(e) * f.bodyLine * 0.7;
      drawLine(f, line, f.baseX, f.textTop + line.top + dy, alpha * (1 - easeOutCubic(e)), 0, smear);
    });
  }

  const mu = morphProgress(f, idx, t);
  const entering = idx > 0;
  if (mu > 0 && mu < 1) {
    drawMorph(f, slide.morphFrom, slide.text, mu, alpha);
  } else {
    const markup = mu <= 0 ? slide.morphFrom : slide.text;
    const cur = block(f, markup);
    cur.lines.forEach((line, k) => {
      if (!entering) {
        drawLine(f, line, f.baseX, f.textTop + line.top, alpha, 0, 0);
        return;
      }
      const v = clamp01((local - d * 0.3 - k * stagger) / (d * 0.75));
      if (v <= 0) return;
      const eased = easeOutExpo(v);
      const dy = (1 - eased) * f.bodyLine * 1.3;
      const smear = (1 - eased) * f.bodyLine * 0.9;
      drawLine(f, line, f.baseX, f.textTop + line.top + dy, alpha * easeOutCubic(v), 0, smear);
    });
  }

  // Footer glides to its new spot under the text.
  if (p.footer.trim()) {
    const fb = block(f, p.footer, f.footerStyle);
    const y = footerTop(f, t);
    const smear = Math.min(f.bodyLine, Math.abs(y - footerTop(f, t - 1 / 60)) * 2.5);
    for (const line of fb.lines) drawLine(f, line, f.baseX, y + line.top, alpha, 0, smear);
  }
}

function drawMorph(f: Frame, fromMarkup: string, toMarkup: string, mu: number, alpha: number): void {
  const { ctx } = f;
  const from = cachedGlyphs(ctx, fromMarkup, f.style, f.maxTextWidth);
  const to = cachedGlyphs(ctx, toMarkup, f.style, f.maxTextWidth);
  const key = JSON.stringify([fromMarkup, toMarkup, f.style, Math.round(f.maxTextWidth)]);
  let plan = morphPlans.get(key);
  if (!plan) {
    if (morphPlans.size > 50) morphPlans.clear();
    plan = planMorph(from, to);
    morphPlans.set(key, plan);
  }

  const eased = easeInOutCubic(mu);
  const ox = f.baseX;
  const oy = f.textTop;
  setTextStyle(f);

  for (const [a, b] of plan.matched) {
    drawGlyph(ctx, b, ox + lerp(a.x, b.x, eased), oy + lerp(a.y, b.y, eased), alpha, 0);
  }
  const outT = clamp01(mu * 2.2);
  for (const g of plan.removed) {
    drawGlyph(ctx, g, ox + g.x, oy + g.y - outT * f.bodyLine * 0.3, alpha * (1 - easeOutCubic(outT)), outT * f.bodyLine * 0.5);
  }
  const n = plan.added.length;
  plan.added.forEach((g, k) => {
    const start = n > 1 ? (k / (n - 1)) * 0.4 : 0;
    const v = clamp01((mu - 0.1 - start) / 0.5);
    if (v <= 0) return;
    const smear = (1 - easeOutCubic(v)) * f.bodyLine * 0.8;
    drawGlyph(ctx, g, ox + g.x, oy + g.y, alpha * easeOutCubic(v), smear, true);
  });
  ctx.shadowColor = 'transparent';
}

function setTextStyle(f: Frame): void {
  const { ctx, p, W } = f;
  ctx.fillStyle = p.text.color;
  if (p.text.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = W * 0.012;
    ctx.shadowOffsetY = W * 0.0015;
    ctx.shadowOffsetX = 0;
  } else {
    ctx.shadowColor = 'transparent';
  }
}

/** Number of copies + per-copy alpha for a cheap directional motion blur. */
function smearCopies(smear: number, alpha: number, W: number): { n: number; a: number } {
  const n = smear > W * 0.002 ? Math.min(8, 2 + Math.ceil(smear / (W * 0.006))) : 1;
  return { n, a: n === 1 ? alpha : 1 - Math.pow(1 - Math.min(alpha, 0.999), 1 / n) };
}

function drawLine(f: Frame, line: PlacedLine, x: number, top: number, alpha: number, smearX: number, smearY: number) {
  if (alpha <= 0.003 || !line.runs.length) return;
  const { ctx, W } = f;
  setTextStyle(f);
  const cy = top + line.height / 2;
  const { n, a } = smearCopies(Math.max(Math.abs(smearX), Math.abs(smearY)), alpha, W);
  ctx.globalAlpha = a;
  for (let c = 0; c < n; c++) {
    const k = n === 1 ? 0 : c / (n - 1) - 0.5;
    for (const run of line.runs) {
      ctx.font = run.font;
      if ('letterSpacing' in ctx) ctx.letterSpacing = run.letterSpacing;
      ctx.fillText(run.text, x + run.x + k * smearX, cy + k * smearY);
    }
  }
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'transparent';
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  g: Glyph,
  x: number,
  y: number,
  alpha: number,
  smear: number,
  horizontal = false,
) {
  if (alpha <= 0.003) return;
  const { n, a } = smearCopies(smear, alpha, ctx.canvas.width);
  ctx.font = g.font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = g.letterSpacing;
  ctx.globalAlpha = a;
  for (let c = 0; c < n; c++) {
    const k = n === 1 ? 0 : c / (n - 1) - 0.5;
    ctx.fillText(g.ch, x + (horizontal ? k * smear : 0), y + (horizontal ? 0 : k * smear));
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* End card                                                            */
/* ------------------------------------------------------------------ */

function drawEndCard(f: Frame, getImage: RenderInput['getImage'], d: number): void {
  const { ctx, p, W, H, t, tl } = f;
  const v = clamp01((t - tl.endStart - d * 0.25) / (d * 0.8));
  if (v <= 0) return;
  const eased = easeOutExpo(v);
  const logo = getImage(p.endCard.logoId);
  const textBlock = p.endCard.text.trim()
    ? cachedLayout(ctx, p.endCard.text, f.style, W * 0.84)
    : null;

  let logoH = 0;
  let logoW = 0;
  if (logo) {
    logoW = p.endCard.logoSize * W;
    logoH = logoW * (logo.height / logo.width);
  }
  const gap = logo && textBlock ? W * 0.04 : 0;
  const total = logoH + gap + (textBlock?.height ?? 0);
  let y = H / 2 - total / 2 + (1 - eased) * W * 0.03;

  if (logo) {
    ctx.save();
    ctx.globalAlpha = easeOutCubic(v);
    if (v < 1) ctx.filter = `blur(${((1 - eased) * W * 0.01).toFixed(1)}px)`;
    ctx.drawImage(logo.source, (W - logoW) / 2, y, logoW, logoH);
    ctx.restore();
    y += logoH + gap;
  }
  if (textBlock) {
    for (const line of textBlock.lines) {
      drawLine(f, line, (W - line.width) / 2, y + line.top, easeOutCubic(v), 0, (1 - eased) * f.bodyLine * 0.6);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Safe zones                                                          */
/* ------------------------------------------------------------------ */

function drawSafeZones(f: Frame): void {
  const { ctx, W, H, p } = f;
  if (p.ratio !== '9:16') return;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 64, 64, 0.16)';
  ctx.strokeStyle = 'rgba(255, 120, 120, 0.6)';
  ctx.lineWidth = Math.max(1, W * 0.002);
  ctx.setLineDash([W * 0.012, W * 0.01]);
  const zones: [number, number, number, number][] = [
    [0, 0, W, H * 0.11],
    [0, H * 0.79, W, H * 0.21],
    [W * 0.85, H * 0.5, W * 0.15, H * 0.29],
  ];
  for (const [x, y, w, h] of zones) {
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}
