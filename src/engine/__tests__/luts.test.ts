import { describe, expect, it } from 'vitest';
import { applyLutCpu, bakeLut, LOOKS, parseCubeLut, presetLut } from '../luts';

const pixel = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255]);

describe('bakeLut + applyLutCpu', () => {
  it('an identity LUT leaves colours unchanged', () => {
    const lut = { key: 'id', name: 'id', size: 17, data: bakeLut((c) => c, 17) };
    for (const [r, g, b] of [
      [0, 0, 0],
      [255, 255, 255],
      [12, 200, 77],
      [128, 64, 250],
    ]) {
      const px = pixel(r, g, b);
      applyLutCpu(px, lut);
      expect(Math.abs(px[0] - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(px[1] - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(px[2] - b)).toBeLessThanOrEqual(1);
    }
  });

  it('intensity 0 keeps the original', () => {
    const px = pixel(10, 120, 240);
    applyLutCpu(px, presetLut('noir')!, 0);
    expect(Array.from(px)).toEqual([10, 120, 240, 255]);
  });
});

describe('preset looks', () => {
  it('all bake to valid LUTs', () => {
    for (const look of LOOKS) {
      const lut = presetLut(look.key)!;
      expect(lut.data.length).toBe(lut.size ** 3 * 4);
    }
  });

  it('noir is monochrome', () => {
    const px = pixel(200, 40, 90);
    applyLutCpu(px, presetLut('noir')!);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
  });

  it('teal & orange warms skin tones and cools shadows', () => {
    const skin = pixel(220, 170, 140);
    applyLutCpu(skin, presetLut('teal-orange')!);
    expect(skin[0] - skin[2]).toBeGreaterThan(220 - 140);
    const shadow = pixel(40, 40, 40);
    applyLutCpu(shadow, presetLut('teal-orange')!);
    expect(shadow[2]).toBeGreaterThan(shadow[0]);
  });
});

describe('parseCubeLut', () => {
  it('reads a 3D LUT with title and red varying fastest', () => {
    const cube = [
      '# comment',
      'TITLE "Swap"',
      'LUT_3D_SIZE 2',
      // identity, except pure red becomes blue
      '0 0 0',
      '0 0 1',
      '0 1 0',
      '1 1 0',
      '0 0 1',
      '1 0 1',
      '0 1 1',
      '1 1 1',
    ].join('\n');
    const lut = parseCubeLut(cube, 'custom:x', 'file');
    expect(lut).toMatchObject({ name: 'Swap', size: 2, key: 'custom:x' });
    const red = pixel(255, 0, 0);
    applyLutCpu(red, lut);
    expect(Array.from(red)).toEqual([0, 0, 255, 255]);
  });

  it('honours DOMAIN_MIN / DOMAIN_MAX', () => {
    const cube = ['LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2', ...Array(8).fill('2 1 0')].join('\n');
    const lut = parseCubeLut(cube, 'k', 'Fallback');
    expect(lut.name).toBe('Fallback');
    expect(Array.from(lut.data.slice(0, 4))).toEqual([255, 128, 0, 255]);
  });

  it('expands 1D LUTs to 3D', () => {
    const lut = parseCubeLut(['LUT_1D_SIZE 2', '1 1 1', '0 0 0'].join('\n'), 'k', 'Invert');
    const px = pixel(255, 0, 255);
    applyLutCpu(px, lut);
    expect(Array.from(px)).toEqual([0, 255, 0, 255]);
  });

  it('rejects files that are not LUTs or are truncated', () => {
    expect(() => parseCubeLut('hello world', 'k', 'x')).toThrow(/Not a \.cube LUT/);
    expect(() => parseCubeLut('LUT_3D_SIZE 2\n0 0 0', 'k', 'x')).toThrow(/Expected 8/);
  });
});
