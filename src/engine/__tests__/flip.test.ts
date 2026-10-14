import { describe, expect, it } from 'vitest';
import {
  audioWindow,
  buildFlipTimeline,
  creditsMarkup,
  defaultFlip,
  fillTemplate,
  flipAudioGain,
  flipClipTime,
  flipLayersAt,
  NEW,
  ORIGINAL,
  yearOf,
  type FlipProject,
} from '../flip';
import { applyFlipPreset, flipPresetSettings, makePreset, parsePreset, type PresetGroup } from '../presets';
import { SAFE_AREAS, safeLift } from '../safeZone';

function project(patch: Partial<FlipProject> = {}): FlipProject {
  const p = defaultFlip();
  p.parts[NEW] = { ...p.parts[NEW], duration: 6, title: 'Hypnotize', artist: 'The Notorious B.I.G.', released: 'March 1997' };
  p.parts[ORIGINAL] = { ...p.parts[ORIGINAL], duration: 5, title: 'Rise', artist: 'Herb Alpert', released: 'July 1979' };
  return { ...p, ...patch };
}

describe('sample flip timing', () => {
  it('plays the new track first by default, then the original, then the end card', () => {
    const tl = buildFlipTimeline(project());
    expect(tl.order).toEqual([NEW, ORIGINAL]);
    expect(tl.parts[NEW]).toEqual({ start: 0, end: 6 });
    expect(tl.parts[ORIGINAL]).toEqual({ start: 6, end: 11 });
    expect(tl.outroStart).toBe(11);
    expect(tl.total).toBe(13.5);
  });

  it('can start with the original and skip the end card', () => {
    const p = project({ first: 'original' });
    p.outro = { ...p.outro, enabled: false };
    const tl = buildFlipTimeline(p);
    expect(tl.order).toEqual([ORIGINAL, NEW]);
    expect(tl.parts[ORIGINAL]).toEqual({ start: 0, end: 5 });
    expect(tl.total).toBe(11);
  });

  it('pushes the second clip in over the first around the cut', () => {
    const p = project({ transition: 'push' });
    const tl = buildFlipTimeline(p);
    expect(flipLayersAt(p, tl, 5).layers.map((l) => l.part)).toEqual([NEW]);
    const mid = flipLayersAt(p, tl, 6).layers;
    expect(mid.map((l) => l.part)).toEqual([NEW, ORIGINAL]);
    expect(mid[0].offset).toBeCloseTo(-0.5, 5);
    expect(mid[1].offset).toBeCloseTo(0.5, 5);
    expect(flipLayersAt(p, tl, 6.4).layers.map((l) => l.part)).toEqual([ORIGINAL]);
  });

  it('cuts cleanly and flashes on "flash"', () => {
    const p = project({ transition: 'flash' });
    const tl = buildFlipTimeline(p);
    expect(tl.overlap).toBe(0);
    expect(flipLayersAt(p, tl, 5.99).layers.map((l) => l.part)).toEqual([NEW]);
    expect(flipLayersAt(p, tl, 6).flash).toBe(1);
    expect(flipLayersAt(p, tl, 6.5).flash).toBe(0);
  });

  it('keeps the last clip running under the end card', () => {
    const p = project();
    const tl = buildFlipTimeline(p);
    const end = flipLayersAt(p, tl, 13);
    expect(end.layers.map((l) => l.part)).toEqual([ORIGINAL]);
    expect(end.outro).toBe(1);
    expect(end.layers[0].local).toBeCloseTo(13 - tl.playStart[ORIGINAL], 5);
  });

  it('maps edit time into each clip, looping a short clip', () => {
    expect(flipClipTime({ start: 2 }, 10, 1.5)).toBe(3.5);
    expect(flipClipTime({ start: 2 }, 5, 4)).toBeCloseTo(3);
  });

  it('crossfades the two clips’ sound at the cut and fades out at the end', () => {
    const p = project({ transition: 'cut' });
    const tl = buildFlipTimeline(p);
    expect(flipAudioGain(p, tl, NEW, 3)).toBe(1);
    expect(flipAudioGain(p, tl, ORIGINAL, 3)).toBe(0);
    expect(flipAudioGain(p, tl, NEW, 6) + flipAudioGain(p, tl, ORIGINAL, 6)).toBeCloseTo(1, 5);
    expect(flipAudioGain(p, tl, ORIGINAL, 8)).toBe(1);
    expect(flipAudioGain(p, tl, ORIGINAL, tl.total - 0.3)).toBeCloseTo(0.5, 5);
    expect(audioWindow(tl, NEW)).toEqual({ start: 0, end: 6 + tl.crossfade / 2 });
    expect(audioWindow(tl, ORIGINAL)).toEqual({ start: 6 - tl.crossfade / 2, end: tl.total });
    p.parts[ORIGINAL].volume = 0;
    expect(flipAudioGain(p, tl, ORIGINAL, 8)).toBe(0);
  });
});

describe('sample flip text', () => {
  it('builds the credits with optional labels', () => {
    const p = project();
    p.parts[NEW] = { ...p.parts[NEW], album: 'Life After Death', genre: 'Hip-hop' };
    expect(creditsMarkup(p.parts[NEW], p)).toBe(
      '# **Hypnotize**\nThe Notorious B.I.G.\n~Released~ March 1997\n~Album~ *Life After Death*\n~Genre~ Hip-hop',
    );
    expect(creditsMarkup({ ...p.parts[NEW], album: '', genre: '' }, { ...p, showLabels: false })).toBe(
      '# **Hypnotize**\nThe Notorious B.I.G.\nMarch 1997',
    );
    expect(creditsMarkup({ ...p.parts[NEW], released: 'Tháng 3, 1997' }, { ...p, labels: { ...p.labels, released: 'Phát hành' } })).toContain(
      '~Phát hành~ Tháng 3, 1997',
    );
  });

  it('fills in titles, artists and years', () => {
    const p = project();
    expect(fillTemplate('# the sample behind **{new}**', p)).toBe('# the sample behind **Hypnotize**');
    expect(fillTemplate('{original} ({original-year}) → {new} by {new-artist}', p)).toBe(
      'Rise (1979) → Hypnotize by The Notorious B.I.G.',
    );
    expect(yearOf('1972 (original release)')).toBe('1972');
    expect(yearOf('soon')).toBe('');
  });
});

describe('safe zone', () => {
  const area = SAFE_AREAS['9:16'];
  it('lifts a block that runs into the caption area, but not above the top bar', () => {
    expect(safeLift(500, 1400, 1920, area)).toBe(0);
    expect(safeLift(500, 1600, 1920, area)).toBeCloseTo(1497.6 - 1600, 5);
    expect(safeLift(300, 1900, 1920, area)).toBeCloseTo(-(300 - 230.4), 5);
    expect(safeLift(100, 1900, 1920, area)).toBe(-0);
  });
});

describe('sample flip presets', () => {
  it('round-trips through JSON and applies only the chosen parts', () => {
    const source = project({ transition: 'fade', accent: '#7fd1c7' });
    source.parts[NEW] = { ...source.parts[NEW], assetId: 'clip-a', coverId: 'cover-a', start: 12, volume: 0.4 };
    const preset = parsePreset(JSON.parse(JSON.stringify(makePreset('Hypnotize × Rise', { mode: 'flip', settings: flipPresetSettings(source) }, {}))));
    if (preset.mode !== 'flip') throw new Error('wrong mode');

    const target = defaultFlip();
    target.parts[NEW] = { ...target.parts[NEW], assetId: 'mine', coverId: 'my-cover', start: 3 };
    const ctx = { lutKey: null, logoId: null, hasFont: () => true };
    const credits = applyFlipPreset(target, preset.settings, new Set<PresetGroup>(['credits']), ctx);
    expect(credits.parts[NEW]).toMatchObject({ title: 'Hypnotize', artist: 'The Notorious B.I.G.', assetId: 'mine', coverId: 'my-cover', start: 3 });
    expect(credits.parts[NEW].volume).toBe(1);
    expect(credits.accent).toBe(target.accent);

    const all = applyFlipPreset(target, preset.settings, new Set<PresetGroup>(['style', 'look', 'credits', 'timing']), ctx);
    expect(all.transition).toBe('fade');
    expect(all.accent).toBe('#7fd1c7');
    expect(all.parts[NEW]).toMatchObject({ duration: 6, volume: 0.4, assetId: 'mine', start: 3 });
    expect(all.outro).toEqual(target.outro);
  });

  it('applies the end card with its logo, keeping the current logo when the preset has none', () => {
    const source = project();
    source.outro = { ...source.outro, logoId: 'their-logo', logoColor: '#e2402f', logoSize: 0.4, text: '**crate** diggers', duration: 4 };
    const settings = flipPresetSettings(source);
    expect('logoId' in settings.outro).toBe(false);
    const target = defaultFlip();
    target.outro = { ...target.outro, logoId: 'my-logo' };
    const groups = new Set<PresetGroup>(['endCard']);
    const kept = applyFlipPreset(target, settings, groups, { lutKey: null, logoId: null, hasFont: () => true });
    expect(kept.outro).toEqual({ ...source.outro, logoId: 'my-logo' });
    const loaded = applyFlipPreset(target, settings, groups, { lutKey: null, logoId: 'loaded-logo', hasFont: () => true });
    expect(loaded.outro.logoId).toBe('loaded-logo');
    expect(loaded.parts).toEqual(target.parts);
  });

  it('repairs invalid values', () => {
    const preset = parsePreset({
      app: 'CoverVinyl',
      type: 'preset',
      version: 1,
      mode: 'flip',
      settings: { first: 'sideways', transition: 'wipe', layout: { position: 'left', scrim: 0.3 }, parts: [{ title: 'A', duration: 500 }] },
    });
    if (preset.mode !== 'flip') throw new Error('wrong mode');
    const def = defaultFlip();
    expect(preset.settings.first).toBe('new');
    expect(preset.settings.transition).toBe(def.transition);
    expect(preset.settings.layout).toEqual({ ...def.layout, scrim: 0.3 });
    expect(preset.settings.parts[0]).toMatchObject({ title: 'A', duration: 90 });
    expect(preset.settings.parts[1].title).toBe(def.parts[1].title);
  });
});
