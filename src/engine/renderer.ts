import { clamp01, easeInCubic, easeInOutCubic, easeOutCubic, easeOutExpo, lerp } from './easing';
import { fontStack } from './fonts';
import { planMorph, type MorphPlan } from './morph';
import { drawPlaceholderBackground, placeholderCover } from './placeholder';
import { morphSection, sectionMarkup, stackSections } from './sections';
import {
  cachedGlyphs,
  cachedLayout,
  type Glyph,
  type PlacedLine,
  type TextBlock,
  type TextMetricsStyle,
} from './textLayout';
import { slideIndexAt, type Timeline } from './timeline';
import type { Project, Ratio, TextSection } from './types';

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
  bodyLine: number;
  /** Id of the per-slide section the intro morph applies to. */
  morphId: string | undefined;
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
    bodyLine: bodyPx * p.text.lineHeight,
    morphId: morphSection(p.sections)?.id,
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
  if (input.safeZones) drawSafeZones(ctx, W, H, p.ratio);

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
  if (!f.morphId || !slide.morphFrom.trim()) return 1;
  const start = f.tl.slideStarts[i] + (i === 0 ? f.p.motion.introDelay : f.p.motion.transition + 0.35);
  return clamp01((t - start) / Math.max(0.05, f.p.motion.morphDuration));
}

function sectionColor(f: Frame, section: TextSection): string {
  return section.color ?? f.p.text.color;
}

function sectionStyle(f: Frame, section: TextSection): TextMetricsStyle {
  if (section.scale === 1) return f.style;
  return { ...f.style, bodyPx: f.style.bodyPx * section.scale, headlinePx: f.style.headlinePx * section.scale };
}

function block(f: Frame, markup: string, style: TextMetricsStyle): TextBlock {
  return cachedLayout(f.ctx, markup, style, f.maxTextWidth);
}

/** Height of a section on slide i at time t, following the intro morph. */
function sectionHeight(f: Frame, section: TextSection, i: number, t: number): number {
  const slide = f.p.slides[i];
  const style = sectionStyle(f, section);
  const to = block(f, sectionMarkup(section, slide), style).height;
  if (section.id !== f.morphId || !slide.morphFrom.trim()) return to;
  const from = block(f, slide.morphFrom, style).height;
  return lerp(from, to, easeInOutCubic(morphProgress(f, i, t)));
}

/** Top offset (below the cover) of every section on slide i at time t. */
function sectionTops(f: Frame, i: number, t: number): number[] {
  const { sections } = f.p;
  return stackSections(
    sections.map((s) => sectionHeight(f, s, i, t)),
    sections.map((s) => s.gap),
    f.bodyLine,
  );
}

/** Top of section k at time t, gliding from its old spot during a slide change. */
function glidingTop(f: Frame, k: number, t: number): number {
  const idx = slideIndexAt(f.tl, Math.min(t, f.tl.endStart - 1e-6));
  const cur = sectionTops(f, idx, t)[k];
  const local = t - f.tl.slideStarts[idx];
  const d = f.p.motion.transition;
  if (idx > 0 && local < d) {
    const prev = sectionTops(f, idx - 1, f.tl.slideStarts[idx])[k];
    return lerp(prev, cur, easeInOutCubic(local / d));
  }
  return cur;
}

function drawSlideText(f: Frame, alpha: number): void {
  const { p, tl, t } = f;
  if (!p.sections.length) return;
  const idx = slideIndexAt(tl, Math.min(t, tl.endStart - 1e-6));
  if (idx < 0) return;
  const slide = p.slides[idx];
  const local = t - tl.slideStarts[idx];
  const d = p.motion.transition;
  const stagger = d * 0.075;

  // Outgoing per-slide text of the previous slide, line by line.
  if (idx > 0 && local < d * 1.5) {
    const prevSlide = p.slides[idx - 1];
    const tops = sectionTops(f, idx - 1, tl.slideStarts[idx]);
    let k = 0;
    p.sections.forEach((section, s) => {
      if (section.mode !== 'slide') return;
      for (const line of block(f, sectionMarkup(section, prevSlide), sectionStyle(f, section)).lines) {
        const e = clamp01((local - k++ * stagger * 0.6) / (d * 0.45));
        if (e >= 1) continue;
        const dy = -easeInCubic(e) * f.bodyLine * 1.1;
        const smear = easeInCubic(e) * f.bodyLine * 0.7;
        const fade = alpha * (1 - easeOutCubic(e));
        drawLine(f, line, f.baseX, f.textTop + tops[s] + line.top + dy, fade, 0, smear, sectionColor(f, section));
      }
    });
  }

  // Current per-slide text (sliding in after a slide change).
  const tops = sectionTops(f, idx, t);
  const mu = morphProgress(f, idx, t);
  let k = 0;
  p.sections.forEach((section, s) => {
    if (section.mode !== 'slide') return;
    const style = sectionStyle(f, section);
    const color = sectionColor(f, section);
    const top = f.textTop + tops[s];
    const morphing = section.id === f.morphId && slide.morphFrom.trim() !== '';
    if (morphing && mu > 0 && mu < 1) {
      drawMorph(f, slide.morphFrom, sectionMarkup(section, slide), style, top, mu, alpha, color);
      return;
    }
    const markup = morphing && mu <= 0 ? slide.morphFrom : sectionMarkup(section, slide);
    for (const line of block(f, markup, style).lines) {
      const lineIndex = k++;
      if (idx === 0) {
        drawLine(f, line, f.baseX, top + line.top, alpha, 0, 0, color);
        continue;
      }
      const v = clamp01((local - d * 0.3 - lineIndex * stagger) / (d * 0.75));
      if (v <= 0) continue;
      const eased = easeOutExpo(v);
      const dy = (1 - eased) * f.bodyLine * 1.3;
      const smear = (1 - eased) * f.bodyLine * 0.9;
      drawLine(f, line, f.baseX, top + line.top + dy, alpha * easeOutCubic(v), 0, smear, color);
    }
  });

  // Shared sections stay on screen and glide to their new spot.
  p.sections.forEach((section, s) => {
    if (section.mode !== 'shared' || !section.text.trim()) return;
    const b = block(f, section.text, sectionStyle(f, section));
    const y = f.textTop + glidingTop(f, s, t);
    const smear = Math.min(f.bodyLine, Math.abs(y - (f.textTop + glidingTop(f, s, t - 1 / 60))) * 2.5);
    for (const line of b.lines) drawLine(f, line, f.baseX, y + line.top, alpha, 0, smear, sectionColor(f, section));
  });
}

function drawMorph(
  f: Frame,
  fromMarkup: string,
  toMarkup: string,
  style: TextMetricsStyle,
  oy: number,
  mu: number,
  alpha: number,
  color: string,
): void {
  const { ctx } = f;
  const from = cachedGlyphs(ctx, fromMarkup, style, f.maxTextWidth);
  const to = cachedGlyphs(ctx, toMarkup, style, f.maxTextWidth);
  const key = JSON.stringify([fromMarkup, toMarkup, style, Math.round(f.maxTextWidth)]);
  let plan = morphPlans.get(key);
  if (!plan) {
    if (morphPlans.size > 50) morphPlans.clear();
    plan = planMorph(from, to);
    morphPlans.set(key, plan);
  }

  const eased = easeInOutCubic(mu);
  const ox = f.baseX;
  setTextStyle(f);

  for (const [a, b] of plan.matched) {
    drawGlyph(ctx, b, ox + lerp(a.x, b.x, eased), oy + lerp(a.y, b.y, eased), alpha, 0, color);
  }
  const outT = clamp01(mu * 2.2);
  for (const g of plan.removed) {
    drawGlyph(
      ctx,
      g,
      ox + g.x,
      oy + g.y - outT * f.bodyLine * 0.3,
      alpha * (1 - easeOutCubic(outT)),
      outT * f.bodyLine * 0.5,
      color,
    );
  }
  const n = plan.added.length;
  plan.added.forEach((g, k) => {
    const start = n > 1 ? (k / (n - 1)) * 0.4 : 0;
    const v = clamp01((mu - 0.1 - start) / 0.5);
    if (v <= 0) return;
    const smear = (1 - easeOutCubic(v)) * f.bodyLine * 0.8;
    drawGlyph(ctx, g, ox + g.x, oy + g.y, alpha * easeOutCubic(v), smear, color, true);
  });
  ctx.shadowColor = 'transparent';
}

function setTextStyle(f: Frame): void {
  const { ctx, p, W } = f;
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

function drawLine(
  f: Frame,
  line: PlacedLine,
  x: number,
  top: number,
  alpha: number,
  smearX: number,
  smearY: number,
  color = f.p.text.color,
) {
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
      ctx.fillStyle = run.color ?? color;
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
  color: string,
  horizontal = false,
) {
  if (alpha <= 0.003) return;
  const { n, a } = smearCopies(smear, alpha, ctx.canvas.width);
  ctx.font = g.font;
  ctx.fillStyle = g.color ?? color;
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
    const source = p.endCard.logoColor ? tintedImage(logo, p.endCard.logoColor) : logo.source;
    ctx.drawImage(source, (W - logoW) / 2, y, logoW, logoH);
    ctx.restore();
    y += logoH + gap;
  }
  if (textBlock) {
    for (const line of textBlock.lines) {
      drawLine(f, line, (W - line.width) / 2, y + line.top, easeOutCubic(v), 0, (1 - eased) * f.bodyLine * 0.6);
    }
  }
}

const tintCache = new WeakMap<object, Map<string, HTMLCanvasElement>>();

/** The image with every visible pixel painted `color`, keeping its transparency (cached). */
function tintedImage(img: DrawableImage, color: string): HTMLCanvasElement {
  let byColor = tintCache.get(img.source);
  if (!byColor) {
    byColor = new Map();
    tintCache.set(img.source, byColor);
  }
  let canvas = byColor.get(color);
  if (!canvas) {
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const c = canvas.getContext('2d')!;
    c.drawImage(img.source, 0, 0, canvas.width, canvas.height);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = color;
    c.fillRect(0, 0, canvas.width, canvas.height);
    if (byColor.size > 8) byColor.clear();
    byColor.set(color, canvas);
  }
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Safe zones                                                          */
/* ------------------------------------------------------------------ */

export function drawSafeZones(ctx: CanvasRenderingContext2D, W: number, H: number, ratio: Ratio): void {
  if (ratio !== '9:16') return;
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
