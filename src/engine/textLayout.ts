import { fontString } from './fonts';
import { parseMarkup, type LineKind, type Run } from './markup';

/** The subset of the 2D context needed for measuring. */
export interface MeasureContext {
  font: string;
  letterSpacing?: string;
  measureText(text: string): { width: number };
}

export interface TextMetricsStyle {
  bodyStack: string;
  headlineStack: string;
  bodyPx: number;
  headlinePx: number;
  lineHeight: number;
  /** Letter spacing in em. */
  tracking: number;
  weights: { light: number; regular: number; bold: number };
}

export interface PlacedRun {
  text: string;
  font: string;
  letterSpacing: string;
  /** Inline colour, if the markup set one. */
  color?: string;
  x: number;
  width: number;
}

export interface PlacedLine {
  kind: LineKind;
  /** Top of the line box relative to the block top. */
  top: number;
  height: number;
  px: number;
  width: number;
  runs: PlacedRun[];
}

export interface TextBlock {
  lines: PlacedLine[];
  height: number;
  width: number;
}

export interface Glyph {
  ch: string;
  font: string;
  letterSpacing: string;
  color?: string;
  /** Left edge of the glyph relative to the block's left. */
  x: number;
  /** Vertical centre of the glyph's line relative to the block top. */
  y: number;
  /** Identity used to match glyphs between two texts (char + font + colour). */
  key: string;
}

interface Token {
  text: string;
  run: Run;
  space: boolean;
}

function runFont(run: Run, stack: string, px: number, style: TextMetricsStyle): string {
  const weight = run.bold ? style.weights.bold : run.light ? style.weights.light : style.weights.regular;
  return fontString(stack, px, weight, run.italic);
}

function measure(ctx: MeasureContext, text: string, font: string, letterSpacing: string): number {
  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = letterSpacing;
  return ctx.measureText(text).width;
}

const sameStyle = (a: Run, b: Run) =>
  a.bold === b.bold && a.italic === b.italic && a.light === b.light && a.color === b.color;

export function layoutText(
  ctx: MeasureContext,
  markup: string,
  style: TextMetricsStyle,
  maxWidth: number,
): TextBlock {
  const lines: PlacedLine[] = [];
  let y = 0;
  let blockWidth = 0;

  for (const line of parseMarkup(markup)) {
    if (line.kind === 'blank') {
      const h = style.bodyPx * style.lineHeight * 0.5;
      lines.push({ kind: 'blank', top: y, height: h, px: style.bodyPx, width: 0, runs: [] });
      y += h;
      continue;
    }

    const headline = line.kind === 'headline';
    const px = headline ? style.headlinePx : style.bodyPx;
    const stack = headline ? style.headlineStack : style.bodyStack;
    const letterSpacing = `${(style.tracking * px).toFixed(3)}px`;

    const tokens: Token[] = [];
    for (const run of line.runs) {
      for (const part of run.text.split(/(\s+)/)) {
        if (part) tokens.push({ text: part, run, space: /^\s+$/.test(part) });
      }
    }

    // Greedy word wrap.
    const rows: Token[][] = [[]];
    let rowWidth = 0;
    for (const tok of tokens) {
      const row = rows[rows.length - 1];
      const w = measure(ctx, tok.text, runFont(tok.run, stack, px, style), letterSpacing);
      if (!tok.space && rowWidth + w > maxWidth && row.some((t) => !t.space)) {
        while (row.length && row[row.length - 1].space) row.pop();
        rows.push([tok]);
        rowWidth = w;
        continue;
      }
      if (tok.space && row.length === 0 && rows.length > 1) continue;
      row.push(tok);
      rowWidth += w;
    }

    for (const row of rows) {
      const merged: { text: string; run: Run }[] = [];
      for (const tok of row) {
        const last = merged[merged.length - 1];
        if (last && sameStyle(last.run, tok.run)) last.text += tok.text;
        else merged.push({ text: tok.text, run: tok.run });
      }
      let x = 0;
      const runs: PlacedRun[] = merged.map(({ text, run }) => {
        const font = runFont(run, stack, px, style);
        const width = measure(ctx, text, font, letterSpacing);
        const placed: PlacedRun = { text, font, letterSpacing, x, width };
        if (run.color) placed.color = run.color;
        x += width;
        return placed;
      });
      const height = px * style.lineHeight;
      lines.push({ kind: line.kind, top: y, height, px, width: x, runs });
      blockWidth = Math.max(blockWidth, x);
      y += height;
    }
  }

  return { lines, height: y, width: blockWidth };
}

/** Breaks a laid-out block into individually positioned glyphs (used by the morph animation). */
export function blockGlyphs(ctx: MeasureContext, block: TextBlock): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const line of block.lines) {
    const cy = line.top + line.height / 2;
    for (const run of line.runs) {
      const chars = Array.from(run.text);
      let prefix = '';
      for (const ch of chars) {
        const x = run.x + (prefix ? measure(ctx, prefix, run.font, run.letterSpacing) : 0);
        prefix += ch;
        if (/\s/.test(ch)) continue;
        glyphs.push({
          ch,
          font: run.font,
          letterSpacing: run.letterSpacing,
          color: run.color,
          x,
          y: cy,
          key: `${ch}|${run.font}|${run.color ?? ''}`,
        });
      }
    }
  }
  return glyphs;
}

/* A small cache so the renderer can lay text out every frame cheaply. */

const cache = new Map<string, TextBlock>();
const glyphCache = new Map<string, Glyph[]>();

function cacheKey(markup: string, style: TextMetricsStyle, maxWidth: number): string {
  return JSON.stringify([markup, style, Math.round(maxWidth)]);
}

export function cachedLayout(
  ctx: MeasureContext,
  markup: string,
  style: TextMetricsStyle,
  maxWidth: number,
): TextBlock {
  const key = cacheKey(markup, style, maxWidth);
  let block = cache.get(key);
  if (!block) {
    if (cache.size > 300) cache.clear();
    block = layoutText(ctx, markup, style, maxWidth);
    cache.set(key, block);
  }
  return block;
}

export function cachedGlyphs(
  ctx: MeasureContext,
  markup: string,
  style: TextMetricsStyle,
  maxWidth: number,
): Glyph[] {
  const key = cacheKey(markup, style, maxWidth);
  let glyphs = glyphCache.get(key);
  if (!glyphs) {
    if (glyphCache.size > 100) glyphCache.clear();
    glyphs = blockGlyphs(ctx, cachedLayout(ctx, markup, style, maxWidth));
    glyphCache.set(key, glyphs);
  }
  return glyphs;
}

/** Must be called when fonts finish loading, since measurements change. */
export function clearLayoutCache(): void {
  cache.clear();
  glyphCache.clear();
}
