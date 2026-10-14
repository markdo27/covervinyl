/** Draws Sample Flip frames: the two clips, their credits, the opening hook and the end card. */
import type { LayeredFrame } from './compositor';
import { clamp01, easeInCubic, easeOutCubic, easeOutExpo } from './easing';
import { creditsMarkup, fillTemplate, flipLayersAt, NEW, ORIGINAL, type FlipProject, type FlipTimeline } from './flip';
import { fontStack, fontString } from './fonts';
import type { Lut } from './luts';
import { drawPlaceholderBackground, placeholderCover } from './placeholder';
import { tintedImage, type DrawableImage } from './renderer';
import { SAFE_AREAS, type SafeArea } from './safeZone';
import { drawTextLine, roundRect } from './textDraw';
import { cachedLayout, type TextBlock, type TextMetricsStyle } from './textLayout';

export interface FlipRenderInput {
  project: FlipProject;
  timeline: FlipTimeline;
  t: number;
  /** Current frame of a part's footage (decoded video frame or photo), or null for the stand-in. */
  footage: (part: number) => DrawableImage | null;
  /** Album covers. */
  getImage: (id: string | null) => DrawableImage | null;
}

/** Splits a frame into compositor layers: the clips are graded, the text stays clean unless asked. */
export function flipFrame(input: FlipRenderInput, getLut: (key: string) => Lut | null, safeZones: boolean): LayeredFrame {
  const graded = input.project.layout.gradeText;
  return {
    t: input.t,
    post: input.project.post,
    getLut,
    base: (ctx, W, H) => {
      drawFootage(ctx, W, H, input);
      if (graded) drawGraphics(ctx, W, H, input);
    },
    top: graded ? undefined : (ctx, W, H) => drawGraphics(ctx, W, H, input),
    safeZones: safeZones ? input.project.ratio : null,
  };
}

const LOOSE_AREA: SafeArea = { left: 0.06, right: 0.94, top: 0.05, bottom: 0.95 };

function textArea(p: FlipProject): SafeArea {
  return p.layout.safeArea ? SAFE_AREAS[p.ratio] : LOOSE_AREA;
}

/* ------------------------------------------------------------------ */
/* Footage                                                             */
/* ------------------------------------------------------------------ */

let blurCanvas: HTMLCanvasElement | null = null;

function drawFill(ctx: CanvasRenderingContext2D, img: DrawableImage, W: number, H: number, zoom: number) {
  const scale = Math.max(W / img.width, H / img.height) * zoom;
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img.source, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

export function drawFootage(ctx: CanvasRenderingContext2D, W: number, H: number, input: FlipRenderInput): void {
  const { project: p, timeline: tl, t } = input;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const { layers, flash, outro } = flipLayersAt(p, tl, t);
  // Dark gradient behind each part's credits, easing away for the end card.
  const scrim = p.layout.scrim * (1 - outro);
  for (const layer of layers) {
    const span = tl.parts[layer.part];
    const progress = clamp01((t - span.start) / Math.max(0.1, span.end - span.start));
    const zoom = 1 + Math.max(0, p.footage.zoom) * progress;
    ctx.save();
    ctx.globalAlpha = clamp01(layer.alpha);
    ctx.translate(0, layer.offset * H);
    const img = input.footage(layer.part);
    if (img && img.width > 0 && img.height > 0) {
      drawFill(ctx, img, W, H, zoom);
    } else {
      // The stand-in turntable, tinted differently for the original.
      if (layer.part === ORIGINAL) ctx.filter = 'hue-rotate(150deg) saturate(0.7)';
      drawPlaceholderBackground(ctx, W, H, layer.local);
      ctx.filter = 'none';
    }
    if (p.footage.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${p.footage.dim})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (scrim > 0.01) drawScrim(ctx, W, H, layoutPart(ctx, p, layer.part, W, H), p.layout.position, scrim);
    ctx.restore();
  }

  // End card: the last clip goes soft and dark behind the logo.
  if (outro > 0) {
    const e = easeOutCubic(outro);
    blurCanvas ??= document.createElement('canvas');
    const bw = Math.max(8, Math.round(W / 14));
    const bh = Math.max(8, Math.round(H / 14));
    if (blurCanvas.width !== bw || blurCanvas.height !== bh) {
      blurCanvas.width = bw;
      blurCanvas.height = bh;
    }
    const bctx = blurCanvas.getContext('2d')!;
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(ctx.canvas, 0, 0, bw, bh);
    ctx.globalAlpha = e;
    ctx.drawImage(blurCanvas, 0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(0,0,0,${0.5 * e})`;
    ctx.fillRect(0, 0, W, H);
  }

  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flash})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/** A soft dark band behind a credits block, reaching the frame edge it sits against. */
function drawScrim(ctx: CanvasRenderingContext2D, W: number, H: number, L: PartLayout, position: FlipProject['layout']['position'], s: number) {
  const fade = H * 0.12;
  const top = L.top;
  const bottom = L.top + L.height;
  const y0 = position === 'top' ? 0 : Math.max(0, top - fade);
  const y1 = position === 'bottom' ? H : Math.min(H, bottom + fade);
  if (y1 - y0 < 1) return;
  const at = (y: number) => clamp01((y - y0) / (y1 - y0));
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  const solid = `rgba(0,0,0,${s * 0.75})`;
  g.addColorStop(0, position === 'top' ? `rgba(0,0,0,${s})` : 'rgba(0,0,0,0)');
  g.addColorStop(at(top + Math.min(L.height * 0.25, fade)), solid);
  g.addColorStop(at(bottom - Math.min(L.height * 0.25, fade)), solid);
  g.addColorStop(1, position === 'bottom' ? `rgba(0,0,0,${s})` : 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, W, y1 - y0);
}

/* ------------------------------------------------------------------ */
/* Credits layout                                                      */
/* ------------------------------------------------------------------ */

function textStyle(p: FlipProject, W: number, scale: number): TextMetricsStyle {
  const bodyPx = p.text.size * W * scale;
  return {
    bodyStack: fontStack(p.text.family),
    headlineStack: fontStack(p.text.headlineFamily),
    bodyPx,
    headlinePx: bodyPx * p.text.headlineScale,
    lineHeight: p.text.lineHeight,
    tracking: p.text.tracking,
    weights: p.text.weights,
  };
}

function scaled(style: TextMetricsStyle, k: number): TextMetricsStyle {
  return { ...style, bodyPx: style.bodyPx * k, headlinePx: style.headlinePx * k };
}

interface Tag {
  text: string;
  font: string;
  letterSpacing: string;
  width: number;
  height: number;
  px: number;
}

function measureTag(ctx: CanvasRenderingContext2D, text: string, style: TextMetricsStyle, k = 1): Tag | null {
  const label = text.trim().toUpperCase();
  if (!label) return null;
  const px = style.bodyPx * 0.7 * k;
  const font = fontString(style.bodyStack, px, style.weights.bold, false);
  const letterSpacing = `${(px * 0.14).toFixed(2)}px`;
  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = letterSpacing;
  const width = ctx.measureText(label).width + px * 1.9;
  return { text: label, font, letterSpacing, width, height: px * 2.1, px };
}

export interface PartLayout {
  x: number;
  top: number;
  height: number;
  scale: number;
  bodyLine: number;
  cover: { y: number; size: number } | null;
  tag: (Tag & { y: number }) | null;
  credits: { y: number; block: TextBlock } | null;
  story: { y: number; block: TextBlock } | null;
}

function measurePart(ctx: CanvasRenderingContext2D, p: FlipProject, part: number, W: number, maxWidth: number, scale: number) {
  const credits = p.parts[part];
  const style = textStyle(p, W, scale);
  const bodyLine = style.bodyPx * style.lineHeight;
  let y = 0;
  let cover: PartLayout['cover'] = null;
  if (p.layout.cover) {
    const size = p.layout.coverSize * W * scale;
    cover = { y, size };
    y += size + W * 0.035 * scale;
  }
  let tag: PartLayout['tag'] = null;
  const measured = measureTag(ctx, credits.tag, style);
  if (measured) {
    tag = { ...measured, y };
    y += measured.height + bodyLine * 0.4;
  }
  let creditsBlock: PartLayout['credits'] = null;
  const markup = creditsMarkup(credits, p);
  if (markup) {
    const block = cachedLayout(ctx, markup, style, maxWidth);
    creditsBlock = { y, block };
    y += block.height;
  }
  let story: PartLayout['story'] = null;
  if (credits.story.trim()) {
    if (y > 0) y += bodyLine * 0.6;
    const block = cachedLayout(ctx, credits.story, scaled(style, p.layout.storyScale), maxWidth);
    story = { y, block };
    y += block.height;
  }
  // Nothing but a cover: drop the gap under it.
  if (cover && !tag && !creditsBlock && !story) y = cover.size;
  return { height: y, bodyLine, cover, tag, credits: creditsBlock, story };
}

/** Lays out a part's cover, tag, credits and story inside the text area, shrinking it to fit when needed. */
export function layoutPart(ctx: CanvasRenderingContext2D, p: FlipProject, part: number, W: number, H: number): PartLayout {
  const area = textArea(p);
  const x = area.left * W;
  const maxWidth = (area.right - area.left) * W;
  const bandTop = area.top * H;
  const band = (area.bottom - area.top) * H;
  let scale = 1;
  let m = measurePart(ctx, p, part, W, maxWidth, scale);
  for (let i = 0; i < 4 && p.layout.safeArea && m.height > band; i++) {
    scale *= Math.max(0.4, (band / m.height) * 0.98);
    m = measurePart(ctx, p, part, W, maxWidth, scale);
  }
  const pos = p.layout.position;
  const top = pos === 'top' ? bandTop : pos === 'bottom' ? bandTop + band - m.height : bandTop + (band - m.height) / 2;
  return { x, top, scale, ...m };
}

/* ------------------------------------------------------------------ */
/* Text + graphics                                                     */
/* ------------------------------------------------------------------ */

const STAGGER = 0.07;
const ENTER = 0.65;
const EXIT = 0.35;

/** When a part's credits arrive and leave. */
export function partTextWindow(p: FlipProject, tl: FlipTimeline, part: number): { start: number; end: number } {
  const span = tl.parts[part];
  const first = part === tl.order[0];
  const start = first ? span.start + (p.hook.enabled ? Math.max(0.3, p.hook.duration) + 0.1 : 0.3) : span.start + tl.overlap / 2 + 0.2;
  let end = span.end - tl.overlap / 2 - 0.05;
  if (first && p.transition === 'push') end = Infinity; // it rides out with its clip
  if (!first) end = p.outro.enabled ? tl.outroStart : Infinity;
  return { start, end };
}

export function drawGraphics(ctx: CanvasRenderingContext2D, W: number, H: number, input: FlipRenderInput): void {
  const { project: p, timeline: tl, t } = input;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  if (p.hook.enabled && p.hook.text.trim()) drawHook(ctx, W, H, input);
  const { layers } = flipLayersAt(p, tl, t);
  for (const layer of layers) drawPartText(ctx, W, H, input, layer.part, layer.offset * H);
  if (p.outro.enabled && t >= tl.outroStart) drawOutro(ctx, W, H, input);
  ctx.restore();
}

/** Entry / exit animation of element j: offset, motion smear and alpha. */
function motion(t: number, start: number, end: number, j: number, line: number) {
  const v = clamp01((t - start - j * STAGGER) / ENTER);
  const eased = easeOutExpo(v);
  let dy = (1 - eased) * line * 1.2;
  let smear = (1 - eased) * line * 0.9;
  let alpha = easeOutCubic(v);
  if (Number.isFinite(end)) {
    const w = clamp01((t - (end - EXIT)) / EXIT);
    alpha *= 1 - easeOutCubic(w);
    dy -= easeInCubic(w) * line * 0.8;
    smear += easeInCubic(w) * line * 0.6;
  }
  return { dy, smear, alpha };
}

function drawPartText(ctx: CanvasRenderingContext2D, W: number, H: number, input: FlipRenderInput, part: number, offsetY: number) {
  const { project: p, timeline: tl, t } = input;
  const win = partTextWindow(p, tl, part);
  if (t < win.start || t >= win.end) return;
  const L = layoutPart(ctx, p, part, W, H);
  const color = p.text.color;
  let j = 0;

  if (L.cover) {
    const m = motion(t, win.start, win.end, j++, L.bodyLine);
    if (m.alpha > 0.003) {
      const img = input.getImage(p.parts[part].coverId) ?? { source: placeholderCover(part === NEW ? 0 : 6), width: 512, height: 512 };
      drawSquare(ctx, img, L.x, L.top + L.cover.y + offsetY + m.dy * 0.6, L.cover.size, m.alpha, (m.smear / L.bodyLine) * W * 0.008);
    }
  }
  if (L.tag) {
    const m = motion(t, win.start, win.end, j++, L.bodyLine);
    drawTag(ctx, L.tag, L.x - m.smear * 0.6, L.top + L.tag.y + offsetY, m.alpha, p.accent);
  }
  for (const block of [L.credits, L.story]) {
    if (!block) continue;
    for (const line of block.block.lines) {
      const m = motion(t, win.start, win.end, j++, L.bodyLine);
      drawTextLine(ctx, line, L.x, L.top + block.y + line.top + offsetY + m.dy, {
        alpha: m.alpha,
        color,
        shadow: p.text.shadow,
        smearY: m.smear,
      });
    }
  }
}

function drawSquare(ctx: CanvasRenderingContext2D, img: DrawableImage, x: number, y: number, size: number, alpha: number, blur: number) {
  const side = Math.min(img.width, img.height);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = size * 0.08;
  ctx.shadowOffsetY = size * 0.015;
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, size, size);
  ctx.shadowColor = 'transparent';
  if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.drawImage(img.source, (img.width - side) / 2, (img.height - side) / 2, side, side, x, y, size, size);
  ctx.restore();
}

/** Black or white, whichever reads better on `hex`. */
function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#111111' : '#ffffff';
}

function drawTag(ctx: CanvasRenderingContext2D, tag: Tag, x: number, y: number, alpha: number, accent: string) {
  if (alpha <= 0.003) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = accent;
  roundRect(ctx, x, y, tag.width, tag.height, tag.height / 2);
  ctx.fill();
  ctx.fillStyle = inkFor(accent);
  ctx.font = tag.font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = tag.letterSpacing;
  ctx.textBaseline = 'middle';
  // Letter spacing adds a trailing gap; centre the visible letters.
  ctx.fillText(tag.text, x + tag.px * 0.95 + tag.px * 0.07, y + tag.height / 2 + tag.px * 0.04);
  ctx.restore();
}

function drawHook(ctx: CanvasRenderingContext2D, W: number, H: number, input: FlipRenderInput) {
  const { project: p, t } = input;
  const end = Math.max(0.3, p.hook.duration);
  if (t >= end) return;
  const area = textArea(p);
  const style = textStyle(p, W, 1);
  const block = cachedLayout(ctx, fillTemplate(p.hook.text, p), style, (area.right - area.left) * W);
  const line = style.bodyPx * style.lineHeight;
  const top = (area.top + (area.bottom - area.top) * 0.42) * H - block.height / 2;
  block.lines.forEach((l, j) => {
    const m = motion(t, 0.15, end, j, line);
    drawTextLine(ctx, l, (W - l.width) / 2, top + l.top + m.dy, { alpha: m.alpha, color: p.text.color, shadow: p.text.shadow, smearY: m.smear });
  });
}

/** The end card: the logo (optionally recoloured) and a line of text, centred in the safe area. */
function drawOutro(ctx: CanvasRenderingContext2D, W: number, H: number, input: FlipRenderInput) {
  const { project: p, timeline: tl, t } = input;
  const v = clamp01((t - tl.outroStart - 0.15) / 0.5);
  if (v <= 0) return;
  const eased = easeOutExpo(v);
  const style = textStyle(p, W, 1);
  const line = style.bodyPx * style.lineHeight;
  const area = textArea(p);
  const logo = input.getImage(p.outro.logoId);
  const text = fillTemplate(p.outro.text, p);
  const block = text.trim() ? cachedLayout(ctx, text, style, (area.right - area.left) * W) : null;

  let logoW = 0;
  let logoH = 0;
  if (logo) {
    logoW = p.outro.logoSize * W;
    logoH = logoW * (logo.height / logo.width);
  }
  const gap = logo && block ? W * 0.04 : 0;
  const total = logoH + gap + (block?.height ?? 0);
  let y = ((area.top + area.bottom) / 2) * H - total / 2 + (1 - eased) * W * 0.03;

  if (logo) {
    ctx.save();
    ctx.globalAlpha = easeOutCubic(v);
    if (v < 1) ctx.filter = `blur(${((1 - eased) * W * 0.01).toFixed(1)}px)`;
    const source = p.outro.logoColor ? tintedImage(logo, p.outro.logoColor) : logo.source;
    ctx.drawImage(source, (W - logoW) / 2, y, logoW, logoH);
    ctx.restore();
    y += logoH + gap;
  }
  if (block) {
    for (const l of block.lines) {
      drawTextLine(ctx, l, (W - l.width) / 2, y + l.top, {
        alpha: easeOutCubic(v),
        color: p.text.color,
        shadow: p.text.shadow,
        smearY: (1 - eased) * line * 0.6,
      });
    }
  }
}
