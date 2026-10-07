/**
 * CoverVinyl text markup — a tiny Markdown-like syntax for the mixed
 * bold / italic / light styling seen in vinyl "sample breakdown" reels.
 *
 *   **bold**      *italic*      ~light~      \* escapes a marker
 *   # Headline    (a line starting with "# " is drawn larger)
 *
 * Markers toggle, so they can be combined (`***bold italic***`) and an
 * unclosed marker simply runs to the end of the line. Styles reset per line.
 */

export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  light: boolean;
}

export type LineKind = 'headline' | 'body' | 'blank';

export interface Line {
  kind: LineKind;
  runs: Run[];
}

export function parseInline(src: string): Run[] {
  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  let light = false;
  let buf = '';

  const flush = () => {
    if (!buf) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === bold && last.italic === italic && last.light === light) {
      last.text += buf;
    } else {
      runs.push({ text: buf, bold, italic, light });
    }
    buf = '';
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      buf += src[i + 1];
      i++;
    } else if (ch === '*' && src[i + 1] === '*') {
      flush();
      bold = !bold;
      i++;
    } else if (ch === '*') {
      flush();
      italic = !italic;
    } else if (ch === '~') {
      flush();
      light = !light;
    } else {
      buf += ch;
    }
  }
  flush();
  return runs;
}

export function parseMarkup(src: string): Line[] {
  const lines: Line[] = [];
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      lines.push({ kind: 'blank', runs: [] });
      continue;
    }
    const headline = /^#\s+/.exec(line);
    const body = headline ? line.slice(headline[0].length) : line;
    const runs = parseInline(body);
    lines.push({ kind: headline ? 'headline' : 'body', runs });
  }
  // Leading / trailing blank lines would only push the block around.
  while (lines.length && lines[0].kind === 'blank') lines.shift();
  while (lines.length && lines[lines.length - 1].kind === 'blank') lines.pop();
  return lines;
}

/** Plain text without markers, e.g. for labels in the UI. */
export function stripMarkup(src: string): string {
  return parseMarkup(src)
    .map((l) => l.runs.map((r) => r.text).join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
