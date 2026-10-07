/**
 * Font handling: built-in font stacks plus user-uploaded font files that are
 * registered with the document through the FontFace API so canvas text can
 * use them.
 */

export interface FontOption {
  key: string;
  label: string;
  stack: string;
  builtIn: boolean;
}

export const BUILT_IN_FONTS: FontOption[] = [
  { key: 'inter', label: 'Inter', stack: '"Inter Variable", Inter, system-ui, sans-serif', builtIn: true },
  {
    key: 'helvetica',
    label: 'Helvetica (system)',
    stack: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    builtIn: true,
  },
  { key: 'serif', label: 'Serif (system)', stack: 'Georgia, "Times New Roman", serif', builtIn: true },
  { key: 'mono', label: 'Mono (system)', stack: '"SF Mono", Menlo, Consolas, "Courier New", monospace', builtIn: true },
];

export interface UserFontFace {
  id: string;
  family: string;
  /** CSS weight descriptor, e.g. "700" or "100 900" for variable fonts. */
  weight: string;
  style: 'normal' | 'italic';
  fileName: string;
  face: FontFace;
}

export const USER_FONT_PREFIX = 'user:';

export function userFontKey(family: string): string {
  return USER_FONT_PREFIX + family;
}

export function fontStack(key: string): string {
  if (key.startsWith(USER_FONT_PREFIX)) {
    const family = key.slice(USER_FONT_PREFIX.length).replace(/"/g, '');
    return `"${family}", "Inter Variable", system-ui, sans-serif`;
  }
  return (BUILT_IN_FONTS.find((f) => f.key === key) ?? BUILT_IN_FONTS[0]).stack;
}

/** Builds a CSS/canvas font shorthand. */
export function fontString(stack: string, px: number, weight: number, italic: boolean): string {
  return `${italic ? 'italic ' : ''}${weight} ${px.toFixed(2)}px ${stack}`;
}

/* ------------------------------------------------------------------ */
/* Guessing family / weight / style                                    */
/* ------------------------------------------------------------------ */

const WEIGHT_WORDS: [RegExp, number][] = [
  [/^(thin|hairline)$/, 100],
  [/^(extralight|ultralight|xlight)$/, 200],
  [/^light$/, 300],
  [/^(regular|normal|book|roman|plain)$/, 400],
  [/^medium$/, 500],
  [/^(semibold|demibold|demi|semi)$/, 600],
  [/^bold$/, 700],
  [/^(extrabold|ultrabold|xbold)$/, 800],
  [/^(black|heavy|ultra)$/, 900],
];
const ITALIC_WORDS = /^(italic|ital|oblique|it|slanted)$/;
const VARIABLE_WORDS = /^(variable|vf|var|wght|opsz|ital,wght|wght,ital)$/;

export interface FontGuess {
  family: string;
  weight: number;
  italic: boolean;
  variable: boolean;
}

/** Guesses family / weight / style from a font file name such as "Inter-SemiBoldItalic.ttf". */
export function guessFromFileName(fileName: string): FontGuess {
  let base = fileName.replace(/\.(ttf|otf|woff2?|ttc)$/i, '');
  const variable = /\[|variable|[-_ ]vf\b/i.test(base);
  base = base.replace(/\[[^\]]*\]/g, ' ');
  // Split on separators and camelCase boundaries ("SemiBoldItalic" -> Semi Bold Italic).
  const tokens = base
    .replace(/[-_,.]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);

  let weight = 400;
  let italic = false;
  const lowerJoin = (a: string, b: string) => (a + b).toLowerCase();

  // Pop style words off the end; also merge pairs like "Semi Bold" / "Extra Light".
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1].toLowerCase();
    const prev = tokens.length > 2 ? tokens[tokens.length - 2] : '';
    if (ITALIC_WORDS.test(last)) {
      italic = true;
      tokens.pop();
      continue;
    }
    if (VARIABLE_WORDS.test(last)) {
      tokens.pop();
      continue;
    }
    if (prev && /^(semi|demi|extra|ultra|x)$/i.test(prev)) {
      const combined = lowerJoin(prev, last);
      const hit = WEIGHT_WORDS.find(([re]) => re.test(combined));
      if (hit) {
        weight = hit[1];
        tokens.splice(tokens.length - 2, 2);
        continue;
      }
    }
    const hit = WEIGHT_WORDS.find(([re]) => re.test(last));
    if (hit) {
      weight = hit[1];
      tokens.pop();
      continue;
    }
    break;
  }

  return { family: tokens.join(' ').trim() || 'Custom Font', weight, italic, variable };
}

/* ------------------------------------------------------------------ */
/* Reading the real names from TrueType / OpenType files               */
/* ------------------------------------------------------------------ */

export interface SfntInfo {
  family?: string;
  weight?: number;
  italic?: boolean;
  weightRange?: [number, number];
}

/** Reads family name, weight class and italic flag from a TTF/OTF file. Returns null for WOFF/WOFF2/other. */
export function readSfntInfo(buffer: ArrayBuffer): SfntInfo | null {
  if (buffer.byteLength < 12) return null;
  const view = new DataView(buffer);
  const tag = view.getUint32(0);
  // 0x00010000 = TrueType, 'OTTO' = CFF, 'true' = old Apple TrueType
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null;

  try {
    const numTables = view.getUint16(4);
    const tables = new Map<string, { offset: number; length: number }>();
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      const name = String.fromCharCode(
        view.getUint8(rec),
        view.getUint8(rec + 1),
        view.getUint8(rec + 2),
        view.getUint8(rec + 3),
      );
      tables.set(name, { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) });
    }

    const info: SfntInfo = {};

    const os2 = tables.get('OS/2');
    if (os2 && os2.length >= 64) {
      info.weight = view.getUint16(os2.offset + 4);
      const fsSelection = view.getUint16(os2.offset + 62);
      info.italic = (fsSelection & 0x1) !== 0 || (fsSelection & 0x200) !== 0;
    }

    const fvar = tables.get('fvar');
    if (fvar) {
      const axesOffset = view.getUint16(fvar.offset + 4);
      const axisCount = view.getUint16(fvar.offset + 8);
      const axisSize = view.getUint16(fvar.offset + 10);
      for (let i = 0; i < axisCount; i++) {
        const a = fvar.offset + axesOffset + i * axisSize;
        const axisTag = view.getUint32(a);
        if (axisTag === 0x77676874 /* 'wght' */) {
          info.weightRange = [view.getInt32(a + 4) / 65536, view.getInt32(a + 12) / 65536];
        }
      }
    }

    const nameTable = tables.get('name');
    if (nameTable) {
      const base = nameTable.offset;
      const count = view.getUint16(base + 2);
      const stringOffset = base + view.getUint16(base + 4);
      const found = new Map<number, { score: number; value: string }>();
      for (let i = 0; i < count; i++) {
        const r = base + 6 + i * 12;
        const platformId = view.getUint16(r);
        const encodingId = view.getUint16(r + 2);
        const languageId = view.getUint16(r + 4);
        const nameId = view.getUint16(r + 6);
        const length = view.getUint16(r + 8);
        const offset = view.getUint16(r + 10);
        if (nameId !== 1 && nameId !== 16) continue;
        let value = '';
        let score = 0;
        const start = stringOffset + offset;
        if (platformId === 3 || platformId === 0) {
          for (let j = 0; j + 1 < length; j += 2) value += String.fromCharCode(view.getUint16(start + j));
          score = platformId === 3 && languageId === 0x409 ? 3 : 2;
        } else if (platformId === 1 && encodingId === 0) {
          for (let j = 0; j < length; j++) value += String.fromCharCode(view.getUint8(start + j));
          score = 1;
        } else {
          continue;
        }
        const prev = found.get(nameId);
        if (value.trim() && (!prev || score > prev.score)) found.set(nameId, { score, value: value.trim() });
      }
      info.family = (found.get(16) ?? found.get(1))?.value;
    }
    return info;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

let faceCounter = 0;

export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';

export async function loadUserFont(file: File): Promise<UserFontFace> {
  const buffer = await file.arrayBuffer();
  const guess = guessFromFileName(file.name);
  const sfnt = readSfntInfo(buffer);

  const family = sfnt?.family || guess.family;
  const italic = sfnt?.italic ?? guess.italic;
  let weight: string;
  if (sfnt?.weightRange) weight = `${Math.round(sfnt.weightRange[0])} ${Math.round(sfnt.weightRange[1])}`;
  else if (guess.variable && !sfnt?.weight) weight = '100 900';
  else weight = String(sfnt?.weight || guess.weight);

  const style = italic ? 'italic' : 'normal';
  const face = new FontFace(family, buffer, { weight, style });
  await face.load();
  document.fonts.add(face);
  faceCounter += 1;
  return { id: `font-${faceCounter}`, family, weight, style, fileName: file.name, face };
}

export function unloadUserFont(font: UserFontFace): void {
  document.fonts.delete(font.face);
}

/** Makes sure every weight/style combination we may draw with is loaded before rendering offscreen. */
export async function ensureFontsLoaded(stacks: string[], weights: number[]): Promise<void> {
  const loads: Promise<unknown>[] = [];
  for (const stack of new Set(stacks)) {
    for (const w of new Set(weights)) {
      for (const italic of [false, true]) {
        loads.push(document.fonts.load(fontString(stack, 32, w, italic), 'AaBb"1').catch(() => undefined));
      }
    }
  }
  await Promise.all(loads);
  await document.fonts.ready;
}
