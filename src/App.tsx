import { useCallback, useEffect, useMemo, useState } from 'react';
import { CoverApp } from './CoverApp';
import type { LutLibrary, Mode } from './components/shell';
import { uid } from './engine/defaults';
import { CUSTOM_LUT_PREFIX, parseCubeLut, presetLut, type Lut } from './engine/luts';
import { ReelApp } from './ReelApp';

/**
 * Two editors share the app: "Cover Crate" (album covers + credits over a
 * clip) and "Photo Reel" (beat-cut photos/clips with an animation on top).
 * Both stay mounted so switching keeps each one's work.
 */
export default function App() {
  const [mode, setMode] = useState<Mode>(() => (window.location.hash === '#reel' ? 'reel' : 'cover'));
  const [customLuts, setCustomLuts] = useState<Lut[]>([]);

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
      remove: (key) => setCustomLuts((old) => old.filter((l) => l.key !== key)),
    }),
    [customLuts, get],
  );

  return (
    <>
      <CoverApp active={mode === 'cover'} mode={mode} onModeChange={setMode} luts={luts} />
      <ReelApp active={mode === 'reel'} mode={mode} onModeChange={setMode} luts={luts} />
    </>
  );
}
