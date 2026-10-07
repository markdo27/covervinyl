import { describe, expect, it } from 'vitest';
import { fontStack, guessFromFileName, readSfntInfo, userFontKey } from '../fonts';

describe('guessFromFileName', () => {
  it.each([
    ['Inter-Bold.ttf', 'Inter', 700, false],
    ['Inter-SemiBoldItalic.otf', 'Inter', 600, true],
    ['HelveticaNeue-LightItalic.woff2', 'Helvetica Neue', 300, true],
    ['Space Grotesk Regular.ttf', 'Space Grotesk', 400, false],
    ['PPNeueMontreal-Medium.otf', 'PP Neue Montreal', 500, false],
    ['GT_America_Extra_Light.woff', 'GT America', 200, false],
    ['MyFont.ttf', 'My Font', 400, false],
  ])('%s → %s %d italic=%s', (file, family, weight, italic) => {
    const g = guessFromFileName(file);
    expect(g.family).toBe(family);
    expect(g.weight).toBe(weight);
    expect(g.italic).toBe(italic);
  });

  it('detects variable fonts', () => {
    expect(guessFromFileName('Inter[opsz,wght].ttf')).toMatchObject({ family: 'Inter', variable: true });
  });
});

/** Builds a minimal TrueType file containing only OS/2 and name tables. */
function fakeTtf(family: string, weight: number, italic: boolean): ArrayBuffer {
  const os2 = new Uint8Array(78);
  const os2v = new DataView(os2.buffer);
  os2v.setUint16(4, weight);
  os2v.setUint16(62, italic ? 0x1 : 0x40);

  const str = new Uint8Array(family.length * 2);
  for (let i = 0; i < family.length; i++) new DataView(str.buffer).setUint16(i * 2, family.charCodeAt(i));
  const name = new Uint8Array(6 + 12 + str.length);
  const nv = new DataView(name.buffer);
  nv.setUint16(0, 0); // format
  nv.setUint16(2, 1); // count
  nv.setUint16(4, 6 + 12); // string storage offset
  nv.setUint16(6, 3); // platform: Windows
  nv.setUint16(8, 1); // encoding: Unicode BMP
  nv.setUint16(10, 0x409); // language: en-US
  nv.setUint16(12, 1); // nameID: family
  nv.setUint16(14, str.length);
  nv.setUint16(16, 0);
  name.set(str, 18);

  const tables: [string, Uint8Array][] = [
    ['OS/2', os2],
    ['name', name],
  ];
  const headerSize = 12 + tables.length * 16;
  const total = headerSize + tables.reduce((n, [, t]) => n + t.length, 0);
  const buf = new Uint8Array(total);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, tables.length);
  let offset = headerSize;
  tables.forEach(([tag, data], i) => {
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) v.setUint8(rec + k, tag.charCodeAt(k));
    v.setUint32(rec + 8, offset);
    v.setUint32(rec + 12, data.length);
    buf.set(data, offset);
    offset += data.length;
  });
  return buf.buffer;
}

describe('readSfntInfo', () => {
  it('reads the family name, weight and italic flag', () => {
    expect(readSfntInfo(fakeTtf('Neue Haas', 700, true))).toMatchObject({ family: 'Neue Haas', weight: 700, italic: true });
    expect(readSfntInfo(fakeTtf('Grotesk', 300, false))).toMatchObject({ family: 'Grotesk', weight: 300, italic: false });
  });

  it('ignores files that are not TrueType/OpenType', () => {
    const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0]).buffer;
    expect(readSfntInfo(woff2)).toBeNull();
  });
});

describe('fontStack', () => {
  it('quotes uploaded families and falls back to Inter', () => {
    expect(fontStack(userFontKey('My Font'))).toBe('"My Font", "Inter Variable", system-ui, sans-serif');
    expect(fontStack('nope')).toContain('Inter');
  });
});
