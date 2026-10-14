import { useCallback, useEffect, useMemo, useState } from 'react';
import { CoverApp } from './CoverApp';
import type { LutLibrary, Mode } from './components/shell';
import { uid } from './engine/defaults';
import { CUSTOM_LUT_PREFIX, parseCubeLut, presetLut, type Lut } from './engine/luts';
import { sameLut, type Preset } from './engine/presets';
import { ReelApp } from './ReelApp';

/**
 * Two editors share the app: "Cover Crate" (album covers + credits over a
 * clip) and "Photo Reel" (beat-cut photos/clips with an animation on top).
 * Both stay mounted so switching keeps each one's work.
 */
export default function App() {
  const [mode, setMode] = useState<Mode>(() => (window.location.hash === '#reel' ? 'reel' : 'cover'));
  const [customLuts, setCustomLuts] = useState<Lut[]>([]);
  const [pendingPreset, setPendingPreset] = useState<Preset | null>(null);

  useEffect(() => {
    const url = `${window.location.pathname}${window.location.search}${mode === 'reel' ? '#reel' : ''}`;
    window.history.replaceState(null, '', url);
  }, [mode]);

  const get = useCallback(
    (key: string): Lut | null =>
      key.startsWith(CUSTOM_LUT_PREFIX) ? (customLuts.find((l) => l.key === key) ?? null) : presetLut(key),
    [customLuts],
  );

  const luts = useMemo<LutLibrary>(
    () => ({
      custom: customLuts,
      get,
      addFile: async (file) => {
        const lut = parseCubeLut(await file.text(), CUSTOM_LUT_PREFIX + uid('lut'), file.name.replace(/\.cube$/i, ''));
        setCustomLuts((old) => [...old, lut]);
        return lut;
      },
      adopt: (incoming) => {
        const existing = customLuts.find((l) => sameLut(l, { ...incoming, key: '' }));
        if (existing) return existing;
        const lut = { ...incoming, key: CUSTOM_LUT_PREFIX + uid('lut') };
        setCustomLuts((old) => [...old, lut]);
        return lut;
      },
      remove: (key) => setCustomLuts((old) => old.filter((l) => l.key !== key)),
    }),
    [customLuts, get],
  );

  // A preset opens in the editor it was saved from.
  const onPreset = useCallback((preset: Preset | null) => {
    setPendingPreset(preset);
    if (preset) setMode(preset.mode);
  }, []);

  const shared = { mode, onModeChange: setMode, luts, pendingPreset, onPreset };
  return (
    <>
      <CoverApp active={mode === 'cover'} {...shared} />
      <ReelApp active={mode === 'reel'} {...shared} />
    </>
  );
}
