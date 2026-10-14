import { describe, expect, it } from 'vitest';
import { defaultProject, newSlide } from '../defaults';
import { presetLut } from '../luts';
import {
  applyCoverPreset,
  applyReelPreset,
  COVER_GROUPS,
  coverPresetSettings,
  embedLut,
  makePreset,
  parsePreset,
  presetFileName,
  REEL_GROUPS,
  reelPresetSettings,
  remapSlideTexts,
  sameLut,
  unembedLut,
  type CoverPresetSettings,
  type PresetGroup,
} from '../presets';
import { defaultReel, setAllDurations } from '../reel';
import type { Project, TextSection } from '../types';

const all = (groups: { key: PresetGroup }[]) => new Set(groups.map((g) => g.key));
const roundTrip = (value: unknown) => parsePreset(JSON.parse(JSON.stringify(value)));
const coverCtx = { lutKey: null, logoId: null, hasFont: () => true };

function styledProject(): Project {
  const p = defaultProject();
  return {
    ...p,
    ratio: '3:4',
    text: { ...p.text, color: '#e2402f', size: 0.05, family: 'user:PP Neue', headlineFamily: 'serif' },
    cover: { ...p.cover, stackCount: 2, radius: 0.04 },
    motion: { ...p.motion, fanOut: false },
    video: { ...p.video, start: 12, dim: 0.4 },
    post: { lut: 'noir', lutIntensity: 0.7, grain: 0.5, grainSize: 2, vignette: 0.3 },
    export: { resolution: 720, fps: 24, method: 'realtime' },
    endCard: { ...p.endCard, logoColor: '#ff0000', text: 'bye', logoId: 'img-old' },
    sections: [{ ...p.sections[0], color: '#00ff00' }],
    slides: p.slides.map((s, i) => ({ ...s, texts: { [p.sections[0].id]: `**slide ${i}**` }, duration: 2 + i })),
  };
}

const section = (id: string, mode: TextSection['mode'] = 'slide'): TextSection => ({
  id,
  name: id,
  mode,
  text: '',
  scale: 1,
  gap: 0,
  color: null,
});

describe('cover presets', () => {
  it('survives a JSON round trip and re-applies every part', () => {
    const source = styledProject();
    const preset = roundTrip(makePreset('Late nights', { mode: 'cover', settings: coverPresetSettings(source) }, {}));
    expect(preset.mode).toBe('cover');
    expect(preset.name).toBe('Late nights');

    const target = { ...defaultProject(), video: { ...defaultProject().video, start: 3 } };
    const out = applyCoverPreset(target, preset.settings as CoverPresetSettings, all(COVER_GROUPS), coverCtx);
    expect(out.ratio).toBe('3:4');
    expect(out.text).toEqual(source.text);
    expect(out.cover).toEqual(source.cover);
    expect(out.motion).toEqual(source.motion);
    expect(out.post).toEqual(source.post);
    expect(out.export).toEqual(source.export);
    expect(out.sections).toEqual(source.sections);
    expect(out.slides.map((s) => s.texts)).toEqual(source.slides.map((s) => s.texts));
    expect(out.slides.map((s) => s.duration)).toEqual([2, 3, 4]);
    // The clip's trim point and the current logo aren't part of a preset.
    expect(out.video.start).toBe(3);
    expect(out.video.dim).toBe(0.4);
    expect(out.endCard).toEqual({ ...source.endCard, logoId: null });
  });

  it('only touches the chosen parts', () => {
    const source = styledProject();
    const target = defaultProject();
    const out = applyCoverPreset(target, coverPresetSettings(source), new Set<PresetGroup>(['look']), coverCtx);
    expect(out.post).toEqual(source.post);
    expect(out.text).toEqual(target.text);
    expect(out.slides).toEqual(target.slides);
    expect(out.sections).toEqual(target.sections);
  });

  it('puts slide text onto the current slides, keeping their covers', () => {
    const settings = coverPresetSettings(styledProject());
    const two = { ...defaultProject(), slides: [newSlide({ coverId: 'a' }), newSlide({ coverId: 'b' })] };
    const grown = applyCoverPreset(two, settings, new Set<PresetGroup>(['slides']), coverCtx);
    expect(grown.slides.map((s) => s.coverId)).toEqual(['a', 'b', null]);
    expect(grown.slides[0].id).toBe(two.slides[0].id);
    expect(grown.slides[2].texts).toEqual(settings.slides[2].texts);

    const five = { ...defaultProject(), slides: ['a', 'b', 'c', 'd', 'e'].map((coverId) => newSlide({ coverId, morphFrom: 'keep' })) };
    const kept = applyCoverPreset(five, settings, new Set<PresetGroup>(['slides']), coverCtx);
    expect(kept.slides).toHaveLength(5);
    expect(kept.slides[3]).toEqual(five.slides[3]);
  });

  it('re-keys slide text when the section ids differ', () => {
    const from = [section('a'), section('foot', 'shared'), section('b')];
    const to = [section('x'), section('y')];
    expect(remapSlideTexts({ a: 'one', b: 'two', foot: 'f' }, from, to)).toEqual({ x: 'one', y: 'two' });
    expect(remapSlideTexts({ x: 'kept', a: 'dropped' }, from, to)).toEqual({ x: 'kept' });
  });

  it('keeps slide text when only the sections change', () => {
    const target = defaultProject();
    const settings = { ...coverPresetSettings(target), sections: [section('new-main'), section('new-foot', 'shared')] };
    const out = applyCoverPreset(target, settings, new Set<PresetGroup>(['sections']), coverCtx);
    expect(out.slides.map((s) => Object.keys(s.texts))).toEqual(target.slides.map(() => ['new-main']));
    expect(out.slides[1].texts['new-main']).toBe(target.slides[1].texts['sec-main']);
  });

  it('falls back when the preset’s font or LUT is missing', () => {
    const source = styledProject();
    source.post = { ...source.post, lut: 'custom:lut-old' };
    const settings = coverPresetSettings(source);
    const groups = new Set<PresetGroup>(['style', 'look']);
    const missing = applyCoverPreset(defaultProject(), settings, groups, { ...coverCtx, hasFont: (k) => !k.startsWith('user:') });
    expect(missing.text.family).toBe('inter');
    expect(missing.text.headlineFamily).toBe('serif');
    expect(missing.post.lut).toBe('none');
    const found = applyCoverPreset(defaultProject(), settings, groups, { ...coverCtx, lutKey: 'custom:lut-new' });
    expect(found.text.family).toBe('user:PP Neue');
    expect(found.post.lut).toBe('custom:lut-new');
  });

  it('uses the preset’s logo when it carries one', () => {
    const settings = coverPresetSettings(styledProject());
    const target = { ...defaultProject(), endCard: { ...defaultProject().endCard, logoId: 'mine' } };
    const groups = new Set<PresetGroup>(['endCard']);
    expect(applyCoverPreset(target, settings, groups, coverCtx).endCard.logoId).toBe('mine');
    expect(applyCoverPreset(target, settings, groups, { ...coverCtx, logoId: 'theirs' }).endCard.logoId).toBe('theirs');
  });
});

describe('reel presets', () => {
  it('round-trips and applies timing, look and animation settings', () => {
    const source = setAllDurations(defaultReel(), 0.25);
    source.transition = 'flash';
    source.bpm = 96;
    source.overlay = { ...source.overlay, x: 0.3, scale: 0.4, blend: 'screen', abovePost: false };
    source.music = { ...source.music, volume: 0.6 };
    source.post = { ...source.post, lut: 'moonlight' };
    const preset = roundTrip(makePreset('Agave', { mode: 'reel', settings: reelPresetSettings(source) }, {}));
    if (preset.mode !== 'reel') throw new Error('wrong mode');
    expect(preset.settings.shotLength).toBe(0.25);

    const target = { ...defaultReel(), music: { assetId: 'song', start: 8, volume: 1 } };
    target.overlay.assetId = 'ovl';
    const out = applyReelPreset(target, preset.settings, all(REEL_GROUPS), { lutKey: null });
    expect(out.items.map((i) => i.duration)).toEqual(target.items.map(() => 0.25));
    expect(out.items.map((i) => i.id)).toEqual(target.items.map((i) => i.id));
    expect(out.transition).toBe('flash');
    expect(out.bpm).toBe(96);
    expect(out.overlay).toEqual({ ...source.overlay, assetId: 'ovl' });
    expect(out.music).toEqual({ assetId: 'song', start: 8, volume: 0.6 });
    expect(out.post.lut).toBe('moonlight');
  });

  it('saves the most common shot length', () => {
    const p = setAllDurations(defaultReel(), 0.5);
    p.items[0] = { ...p.items[0], duration: 2 };
    expect(reelPresetSettings(p).shotLength).toBe(0.5);
  });
});

describe('preset files', () => {
  it('rejects files that are not presets', () => {
    expect(() => parsePreset({ hello: 'world' })).toThrow(/isn’t a CoverVinyl preset/);
    expect(() => parsePreset({ app: 'CoverVinyl', type: 'preset', version: 99, mode: 'cover' })).toThrow(/newer version/);
    expect(() => parsePreset({ app: 'CoverVinyl', type: 'preset', version: 1, mode: 'collage' })).toThrow();
  });

  it('repairs missing and invalid values with defaults', () => {
    const preset = parsePreset({
      app: 'CoverVinyl',
      type: 'preset',
      version: 1,
      mode: 'cover',
      settings: {
        ratio: '1:1',
        text: { color: '#123456', size: 'big' },
        post: { lut: 'not-a-look', grain: 0.4 },
        export: { fps: 25, resolution: 720 },
        sections: [{ id: 'a', mode: 'sideways', text: 'hi' }, { id: 'a' }],
        slides: [{ texts: { a: 'x', b: 5 }, duration: -1 }],
      },
      files: { fonts: [{ name: 'A.ttf', data: 'AAAA' }, { nope: true }], lut: { name: 'L' } },
    });
    if (preset.mode !== 'cover') throw new Error('wrong mode');
    const def = defaultProject();
    const s = preset.settings;
    expect(s.ratio).toBe('9:16');
    expect(s.text.color).toBe('#123456');
    expect(s.text.size).toBe(def.text.size);
    expect(s.post).toEqual({ ...def.post, grain: 0.4 });
    expect(s.export).toEqual({ ...def.export, resolution: 720 });
    expect(s.sections[0]).toMatchObject({ id: 'a', mode: 'slide', text: 'hi', color: null });
    expect(s.sections[1].id).not.toBe('a');
    expect(s.slides).toEqual([{ texts: { a: 'x' }, morphFrom: '', duration: 0.3 }]);
    expect(preset.files).toEqual({ fonts: [{ name: 'A.ttf', type: '', data: 'AAAA' }] });
    expect(preset.name).toBe('Preset');
  });

  it('packs LUTs compactly and restores them exactly', () => {
    const lut = presetLut('teal-orange')!;
    const packed = embedLut(lut);
    expect(packed.data.length).toBe(Math.ceil((lut.size ** 3 * 3) / 3) * 4);
    const restored = unembedLut(JSON.parse(JSON.stringify(packed)), 'custom:x');
    expect(restored.key).toBe('custom:x');
    expect(sameLut(restored, lut)).toBe(true);
    expect(sameLut(restored, presetLut('noir')!)).toBe(false);
    expect(() => unembedLut({ ...packed, size: 17 }, 'k')).toThrow(/damaged/);
  });

  it('names preset files after the preset', () => {
    expect(presetFileName('Late Nights / Agave #2')).toBe('late-nights-agave-2.covervinyl.json');
    expect(presetFileName('   ')).toBe('preset.covervinyl.json');
  });
});
